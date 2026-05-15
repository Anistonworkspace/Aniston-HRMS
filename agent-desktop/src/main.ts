import { app, BrowserWindow, powerMonitor } from 'electron';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import AutoLaunch from 'auto-launch';
import { CONFIG } from './config';
import { ipcMain } from 'electron';
import { pairWithCode, setTokens, sendHeartbeat, sendPing, isLoggedIn, getAgentConfig, UnauthorizedError, setTokenRefreshCallback } from './api';
import { startTracking, stopTracking, getBuffer, drainBuffer, pauseTracking, resumeTracking } from './tracker';
import { startScreenshots, stopScreenshots, updateActiveWindow, updateInterval } from './screenshot';
import { createTray, updateTrayMenu, showPairWindow, closePairWindow, sendPairError } from './tray';
import io from 'socket.io-client';

// ── Global error handlers ─────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[Agent] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Agent] Unhandled rejection:', reason);
});

// ── Safe ElectronStore initializer ────────────────────────────────────────────
function safeCreateStore<T extends Record<string, unknown>>(
  opts: ConstructorParameters<typeof Store<T>>[0] & { name?: string }
): Store<T> {
  const storeName = (opts.name as string) || 'config';

  let storeFilePath: string | null = null;
  try {
    const userData = app.getPath('userData');
    storeFilePath = path.join(userData, `${storeName}.json`);
  } catch {
    // app not ready yet — skip pre-check
  }

  if (storeFilePath && fs.existsSync(storeFilePath)) {
    try {
      const raw = fs.readFileSync(storeFilePath, 'utf-8');
      JSON.parse(raw);
    } catch (parseErr) {
      const backupPath = `${storeFilePath}.corrupt.${Date.now()}.bak`;
      try {
        fs.renameSync(storeFilePath, backupPath);
        console.warn(`[Agent] Corrupt config detected — backed up to: ${backupPath}`);
        console.warn('[Agent] Starting with fresh config. Pairing will be required.');
      } catch (backupErr) {
        try {
          fs.unlinkSync(storeFilePath);
          console.warn('[Agent] Corrupt config removed (backup failed). Starting fresh.');
        } catch {
          // Nothing left to try
        }
      }
    }
  }

  try {
    return new Store<T>(opts);
  } catch (storeErr) {
    console.error('[Agent] Store constructor failed after pre-check — resetting config:', storeErr);
    if (storeFilePath) {
      try { fs.unlinkSync(storeFilePath); } catch { /* ignore */ }
    }
    return new Store<T>(opts);
  }
}

// ── Main config store ─────────────────────────────────────────────────────────
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

let autoLauncher: AutoLaunch | null = null;

let syncInterval: NodeJS.Timeout | null = null;
let pingInterval: NodeJS.Timeout | null = null;
let isRepairing = false;

// Track whether the employee manually paused tracking from the tray menu.
// Sleep/resume should NOT override a deliberate user pause.
let wasManuallyPaused = false;

export function setManualPause(paused: boolean) {
  wasManuallyPaused = paused;
  if (paused) pauseTracking(); else resumeTracking();
}

async function handlePair(): Promise<void> {
  if (isRepairing) return;
  isRepairing = true;
  try {
    const code = await showPairWindow();
    const result = await pairWithCode(code);

    store.set('accessToken', result.accessToken);
    if (result.refreshToken) {
      store.set('refreshToken', result.refreshToken);
    } else {
      console.warn('[Pair] Server did not return a refreshToken — token renewal will require re-pairing');
    }
    store.set('userEmail', result.user?.email || '');
    store.set('paired', true);
    closePairWindow();

    // BUG-002 fix: start/restart agent after successful pairing so the sync loop
    // resumes even if it was killed by a prior UnauthorizedError
    startAgent();
    updateTrayMenu(handlePair, handleLogout);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'cancelled') {
      // User closed the window — throw so callers (.catch) can schedule retry
      throw err;
    }
    console.error('[Pair] Error:', msg);
    sendPairError(msg || 'Pairing failed. Try generating a new code.');
    throw err;
  } finally {
    isRepairing = false;
  }
}

function handleLogout() {
  stopTracking();
  stopScreenshots();
  stopSyncLoop();
  stopPingLoop();
  stopConfigPoll();
  destroySocket();
  setTokens('', '');
  store.clear();
  updateTrayMenu(handlePair, handleLogout);
}

let configPollInterval: NodeJS.Timeout | null = null;
let agentSocket: ReturnType<typeof io> | null = null;

// ── Socket lifecycle ──────────────────────────────────────────────────────────

function destroySocket() {
  if (agentSocket) {
    agentSocket.removeAllListeners();
    agentSocket.disconnect();
    agentSocket = null;
  }
}

function connectAgentSocket() {
  // Guard: don't create a second socket if one already exists and is connected
  if (agentSocket?.connected) return;

  // If there's a dead socket, destroy it first
  if (agentSocket) destroySocket();

  const apiUrl = CONFIG.API_URL.replace('/api', '');
  const token = store.get('accessToken') as string;
  if (!token) return;

  agentSocket = io(apiUrl, {
    // Use callback form so the current token is re-read on every reconnect attempt
    // (handles the case where the access token was silently refreshed mid-session)
    auth: (cb: (data: Record<string, string>) => void) => {
      cb({ token: store.get('accessToken') as string });
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,   // never give up on reconnect attempts
    reconnectionDelay: 2000,          // start at 2s
    reconnectionDelayMax: 30000,      // cap at 30s
    timeout: 20000,
  });

  const registerAgent = () => agentSocket?.emit('agent:register');

  agentSocket.on('connect', () => {
    console.log('[Socket] Agent connected to server');
    registerAgent();
  });

  agentSocket.on('reconnect', (attempt: number) => {
    console.log(`[Socket] Agent reconnected after ${attempt} attempt(s) — re-registering`);
    registerAgent();
  });

  agentSocket.on('reconnect_attempt', (attempt: number) => {
    console.log(`[Socket] Reconnect attempt #${attempt}`);
  });

  agentSocket.on('reconnect_error', (err: Error) => {
    console.warn('[Socket] Reconnect error:', err.message);
  });

  agentSocket.on('agent:config-update', (data: { liveMode: boolean; intervalSeconds: number }) => {
    console.log('[Socket] Config update received:', data);
    if (data.liveMode && data.intervalSeconds) {
      updateInterval(data.intervalSeconds * 1000);
    } else if (!data.liveMode) {
      updateInterval(600_000);
    }
  });

  agentSocket.on('disconnect', (reason: string) => {
    console.log('[Socket] Agent disconnected, reason:', reason);
    // socket.io will auto-reconnect for transport-level disconnects.
    // 'io server disconnect' means the server kicked us — re-auth may be needed.
    if (reason === 'io server disconnect') {
      console.warn('[Socket] Server initiated disconnect — attempting reconnect');
      agentSocket?.connect();
    }
  });
}

// ── Power event handlers ──────────────────────────────────────────────────────
// These are the core fix for "agent shows OFFLINE after sleep/lock":
//   - lock-screen / suspend  → pause tracking, stop ping (don't show ONLINE while locked/sleeping)
//   - unlock-screen / resume → re-verify token, reconnect socket, resume tracking + ping
//
// We register these AFTER app.whenReady() so powerMonitor is available.

function registerPowerEvents() {
  // Screen locked — pause everything, stop reporting ONLINE
  powerMonitor.on('lock-screen', () => {
    console.log('[Power] Screen locked — pausing tracking');
    pauseTracking();
    stopPingLoop();
  });

  // Screen unlocked — resume tracking and ping (respects manual pause)
  powerMonitor.on('unlock-screen', () => {
    console.log('[Power] Screen unlocked — resuming tracking');
    if (!wasManuallyPaused) {
      resumeTracking();
      startPingLoop();
    }
  });

  // System going to sleep — same as lock-screen
  powerMonitor.on('suspend', () => {
    console.log('[Power] System suspending — pausing tracking and stopping ping');
    pauseTracking();
    stopPingLoop();
  });

  // System woke up from sleep — full reconnect sequence
  powerMonitor.on('resume', async () => {
    console.log('[Power] System resumed from sleep — reconnecting agent');

    // 1. Destroy the dead socket (TCP was torn down during sleep)
    destroySocket();

    // 2. Re-verify token — it may have expired during a long sleep
    const stillValid = await verifyStoredToken();
    if (!stillValid) {
      // PLAN-05: Don't auto-pop pair window on resume — tray menu handles manual re-pair
      console.warn('[Power] Token invalid after resume — waiting for manual re-pair via tray');
      updateTrayMenu(handlePair, handleLogout);
      return;
    }

    // 3. Reconnect socket with fresh token
    connectAgentSocket();

    // 4. Resume loops (ping stopped on suspend; sync/config loops survived because
    //    setInterval fires immediately after wake, which is correct behaviour)
    startPingLoop();

    // 5. Resume activity tracking (respects manual pause)
    if (!wasManuallyPaused) {
      resumeTracking();
    }

    updateTrayMenu(handlePair, handleLogout);
    console.log('[Power] Agent fully reconnected after resume');
  });
}

function startAgent() {
  startTracking();
  startScreenshots();
  startSyncLoop();
  startPingLoop();
  startConfigPoll();
  connectAgentSocket();
  // Read server config immediately so screenshot interval is applied at startup
  setTimeout(async () => {
    try {
      const config = await getAgentConfig();
      if (config?.screenshotIntervalSeconds) {
        updateInterval(config.screenshotIntervalSeconds * 1000);
      }
    } catch { /* non-critical, next poll will retry */ }
  }, 5000);
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
      // Config poll failed — non-critical
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
      // BUG-001 fix: drain ONLY after successful send — buffer is kept intact on failure
      drainBuffer(activities.length);
      const last = activities[activities.length - 1];
      if (last) updateActiveWindow(last.activeApp, last.activeWindow);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        console.warn('[Sync] Token expired — clearing credentials and prompting re-pair');
        // BUG-001 fix: do NOT drain buffer here — keep activities so they are resent after re-pair
        store.delete('accessToken');
        store.delete('refreshToken');
        setTokens('', '');
        stopSyncLoop();
        stopConfigPoll();
        destroySocket();
        // PLAN-05: After token expiry, do NOT auto-show the pair window.
        // The employee already paired this device once (store has paired=true).
        // The tray menu "Enter Pairing Code" is always available for manual re-pair.
        // Silently wait — sync loop will restart once re-paired via tray.
        console.log('[Sync] Token expired — waiting for manual re-pair via tray (Enter Pairing Code)');
        updateTrayMenu(handlePair, handleLogout);
        return;
      }
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

// ── Ping loop — lightweight keepalive every 2 minutes ─────────────────────────
function startPingLoop() {
  if (pingInterval) return;
  pingInterval = setInterval(async () => {
    if (!isLoggedIn()) return;
    try {
      await sendPing();
      console.log('[Ping] keepalive sent');
    } catch (err) {
      console.warn('[Ping] failed (non-critical):', (err as Error).message);
    }
  }, 2 * 60 * 1000);
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

  setTokens(savedToken, savedRefreshToken || undefined);

  try {
    await getAgentConfig();
    return true;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      store.delete('accessToken');
      store.delete('refreshToken');
      setTokens('', '');
      return false;
    }
    // Network timeout / server error — keep stored token, assume still valid
    console.warn('[Verify] Network error at startup — keeping stored token:', (err as Error).message);
    return true;
  }
}

app.whenReady().then(async () => {
  console.log('[Agent] Starting Aniston Support v' + app.getVersion());
  console.log('[Agent] userData path:', app.getPath('userData'));

  if (process.platform === 'darwin') app.dock?.hide();

  // Hidden window (keeps app alive without showing in taskbar)
  const win = new BrowserWindow({ show: false, skipTaskbar: true });
  win.hide();

  // Register power monitor events (sleep, lock-screen, resume, unlock-screen)
  registerPowerEvents();

  // Enable auto-launch using the correct installed exe path
  try {
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
    startAgent();
    updateTrayMenu(handlePair, handleLogout);
    console.log('[Agent] Auto-connected with stored token');
  } else {
    // PLAN-05: Only show the pair window automatically on FIRST EVER launch
    // (i.e., the employee has never paired this machine before).
    // If the device was previously paired but the token is now invalid (expired,
    // server reset, etc.), we stay silent — the tray menu "Enter Pairing Code"
    // option is always available for manual re-pair. This prevents the setup
    // window from popping up unexpectedly every time a token expires.
    const wasEverPaired = store.get('paired') === true;
    if (!wasEverPaired) {
      console.log('[Agent] First launch — showing pairing window');
      handlePair().catch(() => {
        console.log('[Agent] Pairing window closed without pairing — waiting for manual pair via tray');
      });
    } else {
      console.log('[Agent] Token invalid but device was previously paired — waiting for manual re-pair via tray');
    }
    updateTrayMenu(handlePair, handleLogout);
  }
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});
