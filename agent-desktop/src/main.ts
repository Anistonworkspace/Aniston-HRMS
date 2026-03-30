import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import AutoLaunch from 'auto-launch';
import { CONFIG } from './config';
import { pairWithCode, setTokens, sendHeartbeat, isLoggedIn } from './api';
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
    store.set('accessToken', result.accessToken);
    store.set('userEmail', result.user?.email);
    closePairWindow();

    // Start tracking
    await startTracking();
    startScreenshots();
    startSyncLoop();

    updateTrayMenu(handlePair, handleLogout);
  } catch (err) {
    sendPairError((err as Error).message);
  }
}

function handleLogout() {
  stopTracking();
  stopScreenshots();
  stopSyncLoop();
  setTokens('');
  store.delete('accessToken');
  store.delete('refreshToken');
  updateTrayMenu(handlePair, handleLogout);
}

function startSyncLoop() {
  if (syncInterval) return;
  syncInterval = setInterval(async () => {
    if (!isLoggedIn()) return;
    const activities = getBuffer();
    if (activities.length === 0) return;

    try {
      await sendHeartbeat(activities);

      // Update screenshot context from last activity
      const last = activities[activities.length - 1];
      if (last) updateActiveWindow(last.activeApp, last.activeWindow);
    } catch (err) {
      console.error('[Sync] Failed to send heartbeat:', (err as Error).message);
      // TODO: queue for retry
    }
  }, CONFIG.SYNC_INTERVAL_MS);
}

function stopSyncLoop() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

app.whenReady().then(async () => {
  // Hide dock icon on macOS
  if (process.platform === 'darwin') app.dock?.hide();

  // Don't show in taskbar
  const win = new BrowserWindow({ show: false, skipTaskbar: true });
  win.hide();

  // Enable auto-launch
  try {
    const isEnabled = await autoLauncher.isEnabled();
    if (!isEnabled) await autoLauncher.enable();
  } catch {
    // Auto-launch setup failed — non-critical
  }

  // Create system tray
  createTray(handlePair, handleLogout);

  // Try auto-connect with stored token
  const savedToken = store.get('accessToken') as string | undefined;
  if (savedToken) {
    setTokens(savedToken);
    try {
      await startTracking();
      startScreenshots();
      startSyncLoop();
      updateTrayMenu(handlePair, handleLogout);
    } catch {
      handleLogout();
    }
  } else {
    // No stored token — auto-show pairing window on first launch
    handlePair();
  }
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault(); // Don't quit when windows close — we're a tray app
});
