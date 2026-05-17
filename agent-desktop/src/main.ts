import { app, BrowserWindow, powerMonitor } from 'electron';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import AutoLaunch from 'auto-launch';
import { CONFIG } from './config';
import { ipcMain } from 'electron';
import { pairWithCode, setTokens, sendHeartbeat, sendPing, isLoggedIn, getAgentConfig, UnauthorizedError, ForbiddenError, setTokenRefreshCallback } from './api';
import { startTracking, stopTracking, getBuffer, drainBuffer, pauseTracking, resumeTracking } from './tracker';
import { startScreenshots, stopScreenshots, updateActiveWindow, updateInterval } from './screenshot';
import { startInputTracking, stopInputTracking } from './inputTracker';
import { createTray, updateTrayMenu, showPairWindow, closePairWindow, sendPairError, TrayState } from './tray';
import { registerWatchdog, unregisterWatchdog } from './watchdog';
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
let pingInterval: NodeJS.Timeout | null = null;
let isRepairing = false; // guard against concurrent re-pair attempts
let startAgentConfigTimeout: ReturnType<typeof setTimeout> | null = null; // A-021
let powerMonitorRegistered = false; // register powerMonitor handlers only once

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
    // 'cancelled' = user closed the window; 'Already open' = showPairWindow rejected because
    // window already visible (A-023: guard clause in tray.ts). Both are non-error conditions.
    const isSilent = msg === 'cancelled' || msg === 'Already open';
    if (!isSilent) {
      console.error('[Pair] Error:', msg);
      sendPairError(msg || 'Pairing failed. Try generating a new code.');
    }
  } finally {
    isRepairing = false;
  }
}

function handleLogout() {
  stopTracking();   // also calls stopInputTracking() internally
  stopScreenshots();
  stopSyncLoop();
  stopPingLoop();
  stopConfigPoll();
  agentSocket?.disconnect();
  agentSocket = null;
  // A-021: Cancel the post-startAgent config fetch timeout so it doesn't fire after logout
  if (startAgentConfigTimeout) { clearTimeout(startAgentConfigTimeout); startAgentConfigTimeout = null; }
  setTokens('', '');
  store.clear();
  // Remove the watchdog task on explicit logout — user intentionally disconnected
  unregisterWatchdog().catch(() => { /* non-critical */ });
  // Stay idle after disconnect — tray now shows "Enter Pairing Code" so employee
  // can re-pair manually without being immediately forced back into the pair flow.
  updateTrayMenu(handlePair, handleLogout);
}

let configPollInterval: NodeJS.Timeout | null = null;

let agentSocket: ReturnType<typeof io> | null = null;

function startAgent() {
  startTracking(); // also calls startInputTracking() internally
  startScreenshots();
  startSyncLoop();
  startPingLoop();
  startConfigPoll();
  connectAgentSocket();

  // BUG-001: Register powerMonitor sleep/resume handlers once per app lifetime.
  // setInterval timers do NOT pause during sleep — on wake, the elapsed time fires
  // all missed ticks instantly, inflating `activeMinutes` with fake data.
  // Pausing tracking on suspend and restarting on resume eliminates this burst.
  if (!powerMonitorRegistered) {
    powerMonitorRegistered = true;

    // 'suspend' = system going to sleep (lid close, sleep button, idle timeout)
    powerMonitor.on('suspend', () => {
      console.log('[Agent] System suspending — pausing all tracking');
      pauseTracking();
      stopScreenshots();
      stopInputTracking();
    });

    // 'resume' = system waking from sleep
    powerMonitor.on('resume', () => {
      console.log('[Agent] System resumed — restarting tracking');
      if (!isLoggedIn()) return;
      resumeTracking();
      startScreenshots();
      startInputTracking();
    });

    // 'lock-screen' / 'unlock-screen': pause while screen is locked (Windows + macOS)
    powerMonitor.on('lock-screen', () => {
      console.log('[Agent] Screen locked — pausing tracking');
      pauseTracking();
      stopScreenshots();
      stopInputTracking();
    });

    powerMonitor.on('unlock-screen', () => {
      console.log('[Agent] Screen unlocked — resuming tracking');
      if (!isLoggedIn()) return;
      resumeTracking();
      startScreenshots();
      startInputTracking();
    });
  }

  // FIX-3: Read server config immediately so screenshot interval is applied at startup
  // (not just after the first CONFIG_POLL_INTERVAL_MS cycle)
  // A-021: Store timeout ref so logout can cancel it and prevent post-logout API calls
  startAgentConfigTimeout = setTimeout(async () => {
    startAgentConfigTimeout = null;
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

  // A-026: Use URL.origin instead of string replace — '.replace("/api", "")' would break
  // API_URLs that have "/api" elsewhere (e.g. "https://api.example.com/api/v1").
  // URL.origin gives exactly "https://host:port" with no path component.
  let apiUrl: string;
  try {
    apiUrl = new URL(CONFIG.API_URL).origin;
  } catch {
    // Fallback for malformed URLs — keeps the old behaviour
    apiUrl = CONFIG.API_URL.replace('/api', '');
  }
  const token = store.get('accessToken') as string;
  if (!token) return;

  agentSocket = io(apiUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  const registerAgent = () => agentSocket?.emit('agent:register');

  // socket.io-client v4: 'connect' fires on both initial connect AND every reconnect.
  // The old 'reconnect' event was removed in v4; keeping only 'connect' is correct.
  agentSocket.on('connect', () => {
    console.log('[Socket] Agent connected to server');
    registerAgent();
  });

  // Live mode toggled by admin — immediately apply new screenshot interval
  // (agent also polls /config every 5min as fallback, but this gives instant response)
  agentSocket.on('agent:config-update', (data: { liveMode?: boolean; intervalSeconds?: number; screenshotIntervalSeconds?: number }) => {
    console.log('[Socket] Config update received:', data);
    if (data.liveMode && data.intervalSeconds) {
      // Live mode enabled — apply the live interval immediately
      updateInterval(data.intervalSeconds * 1000);
    } else if (data.liveMode === false) {
      // CALC-004: Live mode disabled — fetch the server config to restore the admin-configured
      // per-employee interval instead of hardcoding 600s (which ignores custom settings).
      getAgentConfig().then(config => {
        if (config?.screenshotIntervalSeconds) {
          updateInterval(config.screenshotIntervalSeconds * 1000);
        }
      }).catch(() => {
        // Fallback to default if config fetch fails
        updateInterval(CONFIG.SCREENSHOT_INTERVAL_MS);
      });
    } else if (data.screenshotIntervalSeconds) {
      // AGENT-004: Admin updated the screenshot interval outside of live mode — apply immediately.
      updateInterval(data.screenshotIntervalSeconds * 1000);
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
      // Token truly expired (access + refresh both failed)
      if (err instanceof UnauthorizedError) {
        console.warn('[Sync] Token expired — clearing credentials');
        // A-005: Do NOT drain buffer on token expiry — the data was never sent to the server.
        // Draining here silently discards buffered activity records. Keep them so that after
        // re-pair the next sync cycle retransmits them.
        store.delete('accessToken');
        store.delete('refreshToken');
        setTokens('', '');
        stopSyncLoop();
        stopConfigPoll();
        agentSocket?.disconnect();
        agentSocket = null;
        // PERMANENT PAIRING: once configured, NEVER auto-show the pair window.
        // The employee deliberately installed and configured this agent. If the server
        // token expires, we just wait idle in the tray. The employee can manually
        // trigger re-pair from the tray menu if needed. This prevents the pair window
        // from startling employees who have already configured their agent.
        if (store.get('paired') === true) {
          console.log('[Sync] Permanent pairing active — staying idle, not showing pair window');
          // A-010: Show 'reconnect-required' so employee knows they need to re-pair (not just "Not Connected")
          updateTrayMenu(handlePair, handleLogout, 'reconnect-required');
        } else {
          handlePair();
        }
        return;
      }
      // A-003: ForbiddenError means valid token but wrong permissions — not a transient error.
      // Log it and stop retrying. This prevents flooding the server with 403 requests.
      if (err instanceof ForbiddenError) {
        console.error('[Sync] Forbidden (403) — agent token lacks permission. Contact admin.');
        stopSyncLoop();
        stopConfigPoll();
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

// Lightweight keepalive every 2 minutes — keeps the Redis agent-ping key fresh
// so the admin dashboard shows accurate online/offline status between heartbeats.
function startPingLoop() {
  if (pingInterval) return;
  pingInterval = setInterval(async () => {
    if (!isLoggedIn()) return;
    try { await sendPing(); } catch { /* non-critical — heartbeat is the primary path */ }
  }, 120_000);
}

function stopPingLoop() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
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

  // Register Windows Task Scheduler watchdog — restarts the agent after Task Manager kill.
  // A-009: Only register in packaged builds — in dev mode the exe path points to Electron's
  // development binary, which would create a spurious scheduled task polluting the dev machine.
  // Runs only on Windows; silently skipped on other platforms (handled inside registerWatchdog).
  if (app.isPackaged) {
    registerWatchdog(app.getPath('exe')).catch(() => { /* non-critical, already logged inside */ });
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
  } else if (store.get('paired') === true) {
    // PERMANENT PAIRING: previously configured — DO NOT auto-show pair window.
    // Token may be temporarily invalid (server restart, maintenance window).
    // Stay idle in the tray; employee can re-pair manually from the tray menu.
    console.log('[Agent] Paired device but token currently invalid — staying idle (permanent pairing mode)');
    // A-010: Show 'reconnect-required' so employee knows they need to re-pair (not just "Not Connected")
    updateTrayMenu(handlePair, handleLogout, 'reconnect-required');
  } else {
    // Never been configured — show pairing window on first launch
    console.log('[Agent] No valid token and never paired — showing pairing window');
    handlePair();
  }
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});
