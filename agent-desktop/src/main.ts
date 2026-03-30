import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import AutoLaunch from 'auto-launch';
import { CONFIG } from './config';
import { pairWithCode, setTokens, sendHeartbeat, isLoggedIn, getAgentConfig } from './api';
import { startTracking, stopTracking, getBuffer } from './tracker';
import { startScreenshots, stopScreenshots, updateActiveWindow } from './screenshot';
import { createTray, updateTrayMenu, showPairWindow, closePairWindow, sendPairError } from './tray';

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

async function handlePair() {
  try {
    const code = await showPairWindow();
    const result = await pairWithCode(code);

    // Save token
    store.set('accessToken', result.accessToken);
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
  }
}

function handleLogout() {
  stopTracking();
  stopScreenshots();
  stopSyncLoop();
  setTokens('');
  store.clear();
  updateTrayMenu(handlePair, handleLogout);
  // Re-show pairing window
  handlePair();
}

function startAgent() {
  startTracking();
  startScreenshots();
  startSyncLoop();
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
  if (!savedToken) return false;

  setTokens(savedToken);

  // Verify token actually works by calling agent config
  try {
    await getAgentConfig();
    return true;
  } catch {
    // Token invalid/expired — clear it
    store.clear();
    setTokens('');
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
