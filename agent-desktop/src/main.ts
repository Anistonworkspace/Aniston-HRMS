import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import AutoLaunch from 'auto-launch';
import { CONFIG } from './config';
import { ipcMain } from 'electron';
import { pairWithCode, setTokens, sendHeartbeat, isLoggedIn, getAgentConfig, UnauthorizedError, setTokenRefreshCallback } from './api';
import { startTracking, stopTracking, getBuffer, drainBuffer } from './tracker';
import { startScreenshots, stopScreenshots, updateActiveWindow, updateInterval } from './screenshot';
import { createTray, updateTrayMenu, showPairWindow, closePairWindow, sendPairError } from './tray';
import io from 'socket.io-client';

// ── Global error handlers ─────────────────────────────────────────────────────
// Register FIRST — before any module-level code that could throw.
// Without these, Electron shows "A JavaScript error occurred in the main process"
// and terminates. With them, we get a log entry and the app stays alive.
process.on('uncaughtException', (err) => {
  console.error('[Agent] Uncaught exception:', err);
  // Do not re-throw — let the app continue running
});

process.on('unhandledRejection', (reason) => {
  console.error('[Agent] Unhandled rejection:', reason);
});

// ── Safe ElectronStore initializer ────────────────────────────────────────────
// electron-store uses the `conf` package which calls JSON.parse on the stored
// file at construction time.  If that file is corrupt (interrupted write, OS
// crash, encryption-key change) the throw propagates synchronously, crashes the
// Electron main process, and produces:
//
//   SyntaxError: Unexpected non-whitespace character after JSON at position 1
//   at JSON.parse  →  Conf._deserialize  →  ElectronStore  →  main.js
//
// We protect against this by:
//   1. Locating the store file BEFORE constructing the Store.
//   2. Attempting JSON.parse on the raw file content ourselves.
//   3. If it fails: back up the corrupt file and let electron-store create a
//      fresh one (it always starts from defaults when no file is present).
//   4. Logging the recovery so it appears in pm2/electron logs.
//
// The same treatment is applied to the screenshot-queue store in screenshot.ts.

function safeCreateStore<T extends Record<string, unknown>>(
  opts: ConstructorParameters<typeof Store<T>>[0] & { name?: string }
): Store<T> {
  const storeName = (opts.name as string) || 'config';

  // Build the expected file path.  electron-store places files under
  // app.getPath('userData') once `app` is ready; we can compute it here
  // because this function is only called after app.whenReady() in the cases
  // that matter, OR at module-init time for the main config where we must
  // handle the path manually.
  let storeFilePath: string | null = null;
  try {
    // app.getPath throws if called before app is ready AND before the path is
    // overridden by a test environment.  Catch and fall through — if we can't
    // check we'll let electron-store construct normally (it'll handle most cases).
    const userData = app.getPath('userData');
    storeFilePath = path.join(userData, `${storeName}.json`);
  } catch {
    // app not ready yet — skip pre-check; the try/catch Store constructor below
    // still protects us.
  }

  if (storeFilePath && fs.existsSync(storeFilePath)) {
    try {
      const raw = fs.readFileSync(storeFilePath, 'utf-8');
      JSON.parse(raw); // dry run — will throw if corrupt
    } catch (parseErr) {
      // Corrupt file detected — back it up and remove so Store starts fresh.
      const backupPath = `${storeFilePath}.corrupt.${Date.now()}.bak`;
      try {
        fs.renameSync(storeFilePath, backupPath);
        console.warn(`[Agent] Corrupt config detected — backed up to: ${backupPath}`);
        console.warn('[Agent] Starting with fresh config. Pairing will be required.');
      } catch (backupErr) {
        // Rename failed (permissions?). Try to simply delete the corrupt file.
        try {
          fs.unlinkSync(storeFilePath);
          console.warn('[Agent] Corrupt config removed (backup failed). Starting fresh.');
        } catch {
          // Nothing left to try — Store constructor below may still succeed if
          // it overwrites the file, or will throw and be caught.
        }
      }
    }
  }

  // Now construct the store.  Even with the pre-check above, guard here for
  // edge cases (race conditions, partial writes that look valid to JSON.parse
  // but fail electron-store's schema validation, etc.).
  try {
    return new Store<T>(opts);
  } catch (storeErr) {
    console.error('[Agent] Store constructor failed after pre-check — resetting config:', storeErr);
    // Last resort: delete the file and try once more with a blank slate.
    if (storeFilePath) {
      try { fs.unlinkSync(storeFilePath); } catch { /* ignore */ }
    }
    return new Store<T>(opts);
  }
}

// ── Main config store ─────────────────────────────────────────────────────────
// NOTE: We intentionally do NOT pass encryptionKey to the main store.
// The old builds used an encryption key derived from hostname+username.
// If the machine was renamed, or the user profile changed (common after
// Windows updates / domain migrations), the key changes and the previously
// encrypted store becomes unreadable — producing exactly the JSON corruption
// crash we are fixing here.
//
// The tokens stored here (accessToken, refreshToken) are JWTs that expire;
// losing them only requires re-pairing — not data loss.  Removing encryption
// from the main config prevents the key-mismatch corruption class entirely.
// The screenshot offline queue continues to use the encryption key because
// it holds file paths, not credentials.
const store = safeCreateStore<Record<string, unknown>>({
  name: 'config',
  defaults: {
    paired: false,
    accessToken: '',
    refreshToken: '',
    userEmail: '',
  },
});

// Persist refreshed tokens to disk so the agent doesn't re-pair on every restart
setTokenRefreshCallback((access, refresh) => {
  store.set('accessToken', access);
  if (refresh !== null) store.set('refreshToken', refresh);
});

// Prevent multiple instances
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
}

// Auto-launch on startup — use the installed exe path so it survives upgrades.
// We defer enabling until after app.whenReady() to ensure app.getPath() works.
let autoLauncher: AutoLaunch | null = null;

let syncInterval: NodeJS.Timeout | null = null;
let isRepairing = false; // guard against concurrent re-pair attempts

async function handlePair() {
  if (isRepairing) return;
  isRepairing = true;
  try {
    const code = await showPairWindow();
    const result = await pairWithCode(code);

    // Persist both tokens — refresh token enables silent renewal (30-day window)
    store.set('accessToken', result.accessToken);
    if (result.refreshToken) {
      store.set('refreshToken', result.refreshToken);
    } else {
      console.warn('[Pair] Server did not return a refreshToken — token renewal will require re-pairing');
    }
    store.set('userEmail', result.user?.email || '');
    store.set('paired', true);
    closePairWindow();

    // Start tracking
    startAgent();
    updateTrayMenu(handlePair, handleLogout);
  } catch (err) {
    const msg = (err as Error).message;
    // 'cancelled' means the user closed the window intentionally — no error UI needed
    if (msg !== 'cancelled') {
      console.error('[Pair] Error:', msg);
      sendPairError(msg || 'Pairing failed. Try generating a new code.');
    }
  } finally {
    isRepairing = false;
  }
}

function handleLogout() {
  stopTracking();
  stopScreenshots();
  stopSyncLoop();
  stopConfigPoll();
  agentSocket?.disconnect();
  agentSocket = null;
  setTokens('', '');
  store.clear();
  // Stay idle after disconnect — tray now shows "Enter Pairing Code" so employee
  // can re-pair manually without being immediately forced back into the pair flow.
  updateTrayMenu(handlePair, handleLogout);
}

let configPollInterval: NodeJS.Timeout | null = null;

let agentSocket: ReturnType<typeof io> | null = null;

function startAgent() {
  startTracking();
  startScreenshots();
  startSyncLoop();
  startConfigPoll();
  connectAgentSocket();
  // FIX-3: Read server config immediately so screenshot interval is applied at startup
  // (not just after the first CONFIG_POLL_INTERVAL_MS cycle)
  setTimeout(async () => {
    try {
      const config = await getAgentConfig();
      if (config?.screenshotIntervalSeconds) {
        updateInterval(config.screenshotIntervalSeconds * 1000);
      }
    } catch { /* non-critical, next poll will retry */ }
  }, 5000); // 5s delay — wait for socket to connect first
}

function connectAgentSocket() {
  // Guard: don't create a second socket if one already exists (e.g. startAgent called twice)
  if (agentSocket) return;

  const apiUrl = CONFIG.API_URL.replace('/api', '');
  const token = store.get('accessToken') as string;
  if (!token) return;

  agentSocket = io(apiUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  const registerAgent = () => agentSocket?.emit('agent:register');

  agentSocket.on('connect', () => {
    console.log('[Socket] Agent connected to server');
    registerAgent();
  });

  // Re-register after reconnect so the server re-adds this socket to the agent room
  agentSocket.on('reconnect', () => {
    console.log('[Socket] Agent reconnected — re-registering');
    registerAgent();
  });

  // Live mode toggled by admin — immediately apply new screenshot interval
  // (agent also polls /config every 5min as fallback, but this gives instant response)
  agentSocket.on('agent:config-update', (data: { liveMode: boolean; intervalSeconds: number }) => {
    console.log('[Socket] Config update received:', data);
    if (data.liveMode && data.intervalSeconds) {
      updateInterval(data.intervalSeconds * 1000);
    } else if (!data.liveMode) {
      updateInterval(600_000); // restore default 10-minute interval
    }
  });

  agentSocket.on('disconnect', () => {
    console.log('[Socket] Agent disconnected');
  });
}

function startConfigPoll() {
  if (configPollInterval) return;
  configPollInterval = setInterval(async () => {
    if (!isLoggedIn()) return;
    try {
      const config = await getAgentConfig();
      if (config?.screenshotIntervalSeconds) {
        updateInterval(config.screenshotIntervalSeconds * 1000);
      }
    } catch {
      // Config poll failed — non-critical, socket event is primary delivery
    }
  }, CONFIG.CONFIG_POLL_INTERVAL_MS);
}

function startSyncLoop() {
  if (syncInterval) return;
  syncInterval = setInterval(async () => {
    if (!isLoggedIn()) return;
    const activities = getBuffer();
    if (activities.length === 0) return;

    try {
      await sendHeartbeat(activities);
      // Drain only the entries we just sent — new entries added during the async call are preserved
      drainBuffer(activities.length);
      const last = activities[activities.length - 1];
      if (last) updateActiveWindow(last.activeApp, last.activeWindow);
    } catch (err) {
      // Token truly expired (access + refresh both failed) — discard buffer and re-pair
      if (err instanceof UnauthorizedError) {
        console.warn('[Sync] Token expired — clearing credentials and prompting re-pair');
        drainBuffer(activities.length);
        store.delete('accessToken');
        store.delete('refreshToken');
        setTokens('', '');
        stopSyncLoop();
        stopConfigPoll();
        agentSocket?.disconnect();
        agentSocket = null;
        handlePair();
        return;
      }
      // Network/server error — keep buffer intact so next sync cycle retries these entries
      console.error('[Sync] Failed (will retry next cycle):', (err as Error).message);
    }
  }, CONFIG.SYNC_INTERVAL_MS);
}

function stopSyncLoop() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function stopConfigPoll() {
  if (configPollInterval) {
    clearInterval(configPollInterval);
    configPollInterval = null;
  }
}

async function verifyStoredToken(): Promise<boolean> {
  const savedToken = store.get('accessToken') as string | undefined;
  const savedRefreshToken = store.get('refreshToken') as string | undefined;
  if (!savedToken) return false;

  // Restore both tokens so authFetch can silently refresh if access token expired
  setTokens(savedToken, savedRefreshToken || undefined);

  // Verify token actually works by calling agent config
  try {
    await getAgentConfig();
    return true;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      // Token invalid/expired — clear stored credentials
      store.delete('accessToken');
      store.delete('refreshToken');
      setTokens('', '');
      return false;
    }
    // Network timeout / server error at boot — keep stored token, assume still valid.
    // Agent will retry on next heartbeat cycle.
    console.warn('[Verify] Network error at startup — keeping stored token:', (err as Error).message);
    return true;
  }
}

app.whenReady().then(async () => {
  console.log('[Agent] Starting Aniston Agent v' + app.getVersion());
  console.log('[Agent] userData path:', app.getPath('userData'));

  // Hide dock icon on macOS
  if (process.platform === 'darwin') app.dock?.hide();

  // Hidden window (keeps app alive)
  const win = new BrowserWindow({ show: false, skipTaskbar: true });
  win.hide();

  // Enable auto-launch using the correct installed exe path
  try {
    // Use the process exe path so it works for both packaged and dev builds
    autoLauncher = new AutoLaunch({
      name: CONFIG.APP_NAME,
      path: app.getPath('exe'),
      isHidden: true,
    });
    const isEnabled = await autoLauncher.isEnabled();
    if (!isEnabled) {
      await autoLauncher.enable();
      console.log('[Agent] Auto-launch enabled at:', app.getPath('exe'));
    }
  } catch (autoErr) {
    console.warn('[Agent] Auto-launch setup failed (non-critical):', (autoErr as Error).message);
  }

  // Create system tray
  createTray(handlePair, handleLogout);

  // Check if we have a valid stored token
  const isValid = await verifyStoredToken();

  if (isValid) {
    // Token works — start tracking
    startAgent();
    updateTrayMenu(handlePair, handleLogout);
    console.log('[Agent] Auto-connected with stored token');
  } else {
    // No valid token — show pairing window immediately
    console.log('[Agent] No valid token — showing pairing window');
    handlePair();
  }
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});
