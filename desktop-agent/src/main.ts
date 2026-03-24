import { app, BrowserWindow } from 'electron';
import { createTray, updateTrayMenu, destroyTray } from './tray';
import { isAuthenticated, showLoginWindow } from './auth';
import { startActiveWindowTracker, stopActiveWindowTracker } from './tracker/activeWindow';
import { startScreenshotCapture, stopScreenshotCapture } from './tracker/screenshot';
import { startIdleDetector, stopIdleDetector } from './tracker/idleDetector';
import { startSync, stopSync } from './tracker/syncManager';
import { pauseScreenshots, resumeScreenshots } from './tracker/screenshot';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Hide dock icon on macOS (tray-only app)
if (process.platform === 'darwin') {
  app.dock?.hide();
}

function startTracking() {
  console.log('[Agent] Starting all trackers...');
  startActiveWindowTracker();
  startScreenshotCapture();
  startIdleDetector((idle) => {
    if (idle) pauseScreenshots();
    else resumeScreenshots();
  });
  startSync();
}

function stopTracking() {
  console.log('[Agent] Stopping all trackers...');
  stopActiveWindowTracker();
  stopScreenshotCapture();
  stopIdleDetector();
  stopSync();
}

async function handleLogin() {
  const success = await showLoginWindow();
  if (success) {
    startTracking();
    updateTrayMenu(handleLogin, handleQuit);
  }
}

function handleQuit() {
  stopTracking();
  destroyTray();
  app.quit();
}

app.whenReady().then(async () => {
  // Create system tray
  createTray(handleLogin, handleQuit);

  if (isAuthenticated()) {
    startTracking();
    updateTrayMenu(handleLogin, handleQuit);
  } else {
    await handleLogin();
  }

  // Set auto-start on login
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });
});

app.on('window-all-closed', (e: Event) => {
  // Don't quit when all windows closed — we're a tray app
  e.preventDefault();
});

app.on('before-quit', () => {
  stopTracking();
});
