import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import AutoLaunch from 'auto-launch';
import { CONFIG } from './config';
import { ipcMain } from 'electron';
import { pairWithCode, setTokens, sendHeartbeat, isLoggedIn, getAgentConfig, UnauthorizedError } from './api';
import { startTracking, stopTracking, getBuffer } from './tracker';
import { startScreenshots, stopScreenshots, updateActiveWindow, updateInterval } from './screenshot';
import { createTray, updateTrayMenu, showPairWindow, closePairWindow, sendPairError } from './tray';
import { initStreamWindow, startStream, stopStream, handleSignalingMessage } from './stream';
import io from 'socket.io-client';

const store = new Store({ encryptionKey: CONFIG.STORE_ENCRYPTION_KEY });

// Prevent multiple instances
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
}

// Auto-launch on startup
const autoLauncher = new AutoLaunch({
  name: CONFIG.APP_NAME,
  isHidden: true,
});

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
    store.set('refreshToken', result.refreshToken || ''); // Bug #8: persist refresh token
    store.set('userEmail', result.user?.email || '');
    store.set('paired', true);
    closePairWindow();

    // Start tracking
    startAgent();
    updateTrayMenu(handlePair, handleLogout);
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[Pair] Error:', msg);
    sendPairError(msg || 'Pairing failed. Try generating a new code.');
  } finally {
    isRepairing = false;
  }
}

function handleLogout() {
  stopTracking();
  stopScreenshots();
  stopSyncLoop();
  setTokens('', '');
  store.clear();
  updateTrayMenu(handlePair, handleLogout);
  // Re-show pairing window
  handlePair();
}

let configPollInterval: NodeJS.Timeout | null = null;

let agentSocket: any = null;

function startAgent() {
  startTracking();
  startScreenshots();
  startSyncLoop();
  startConfigPoll();
  connectAgentSocket();
  initStreamWindow();
}

function connectAgentSocket() {
  const apiUrl = CONFIG.API_URL.replace('/api', '');
  const token = store.get('accessToken') as string;
  if (!token) return;

  agentSocket = io(apiUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  agentSocket.on('connect', () => {
    console.log('[Socket] Agent connected to server');
    agentSocket.emit('agent:register');
  });

  // Admin requests live stream
  agentSocket.on('stream:start', (data: any) => {
    console.log('[Socket] Stream start requested by admin:', data.adminSocketId);
    startStream(data.adminSocketId, apiUrl);
  });

  agentSocket.on('stream:stop', () => {
    console.log('[Socket] Stream stop requested');
    stopStream();
  });

  // WebRTC signaling from admin browser
  agentSocket.on('stream:signal', (data: any) => {
    handleSignalingMessage(data);
  });

  // Bug #10: Live mode toggled by admin — immediately apply new screenshot interval
  // (agent also polls /config every 30s as fallback, but this gives instant response)
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

// Bug #2: Forward WebRTC signals from renderer to server
ipcMain.on('webrtc-signal', (_, data) => {
  if (agentSocket?.connected) {
    agentSocket.emit('stream:signal', data);
  }
});

// Bug #2: Forward WebRTC errors from renderer to admin via server
ipcMain.on('webrtc-error', (_, data: { message: string; adminSocketId?: string }) => {
  console.error('[Stream] WebRTC renderer error:', data.message);
  if (agentSocket?.connected) {
    agentSocket.emit('stream:agent-error', {
      message: data.message,
      targetSocketId: data.adminSocketId,
    });
  }
});

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
      const last = activities[activities.length - 1];
      if (last) updateActiveWindow(last.activeApp, last.activeWindow);
    } catch (err) {
      // Bug #8: Token truly expired (access + refresh both failed) — clear and re-pair
      if (err instanceof UnauthorizedError) {
        console.warn('[Sync] Token expired — clearing credentials and prompting re-pair');
        store.delete('accessToken');
        store.delete('refreshToken');
        setTokens('', '');
        stopSyncLoop();
        agentSocket?.disconnect();
        handlePair();
        return;
      }
      console.error('[Sync] Failed:', (err as Error).message);
    }
  }, CONFIG.SYNC_INTERVAL_MS);
}

function stopSyncLoop() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

async function verifyStoredToken(): Promise<boolean> {
  const savedToken = store.get('accessToken') as string | undefined;
  const savedRefreshToken = store.get('refreshToken') as string | undefined;
  if (!savedToken) return false;

  // Bug #8: restore both tokens so authFetch can silently refresh if access token expired
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
    }
    return false;
  }
}

app.whenReady().then(async () => {
  // Hide dock icon on macOS
  if (process.platform === 'darwin') app.dock?.hide();

  // Hidden window (keeps app alive)
  const win = new BrowserWindow({ show: false, skipTaskbar: true });
  win.hide();

  // Enable auto-launch
  try {
    const isEnabled = await autoLauncher.isEnabled();
    if (!isEnabled) await autoLauncher.enable();
  } catch { /* non-critical */ }

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
