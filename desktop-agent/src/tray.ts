import { Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import store from './store';
import { logout } from './auth';
import { stopActiveWindowTracker } from './tracker/activeWindow';
import { stopScreenshotCapture, pauseScreenshots, resumeScreenshots } from './tracker/screenshot';
import { stopIdleDetector } from './tracker/idleDetector';
import { stopSync, forceSyncNow } from './tracker/syncManager';

let tray: Tray | null = null;
let isPaused = false;
let trackingStartTime = new Date();

export function createTray(onLogin: () => void, onQuit: () => void) {
  // Use a simple icon — in production, use proper icon files
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(1)) : icon);
  tray.setToolTip('Aniston Activity Agent');
  updateTrayMenu(onLogin, onQuit);
  trackingStartTime = new Date();
}

function getTrackedTime(): string {
  const ms = Date.now() - trackingStartTime.getTime();
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export function updateTrayMenu(onLogin: () => void, onQuit: () => void) {
  if (!tray) return;

  const name = store.get('employeeName') || 'Not logged in';
  const isLoggedIn = !!store.get('accessToken');

  const menu = Menu.buildFromTemplate([
    { label: `👤 ${name}`, enabled: false },
    { type: 'separator' },
    ...(isLoggedIn
      ? [
          { label: `⏱ Tracked: ${getTrackedTime()}`, enabled: false },
          { label: isPaused ? '▶ Resume Tracking' : '⏸ Pause Tracking (30 min)', click: () => togglePause(onLogin, onQuit) },
          { type: 'separator' as const },
          { label: '🌐 Open HRMS Dashboard', click: () => shell.openExternal('http://localhost:5173/attendance') },
          { label: '🔄 Sync Now', click: () => forceSyncNow() },
          { type: 'separator' as const },
          {
            label: '🚪 Logout',
            click: () => {
              stopAllTrackers();
              logout();
              updateTrayMenu(onLogin, onQuit);
            },
          },
        ]
      : [{ label: '🔑 Login', click: onLogin }]),
    { type: 'separator' },
    { label: 'Quit', click: onQuit },
  ]);

  tray.setContextMenu(menu);
}

function togglePause(onLogin: () => void, onQuit: () => void) {
  isPaused = !isPaused;
  if (isPaused) {
    pauseScreenshots();
    // Auto-resume after 30 min
    setTimeout(() => {
      isPaused = false;
      resumeScreenshots();
      updateTrayMenu(onLogin, onQuit);
    }, 30 * 60 * 1000);
  } else {
    resumeScreenshots();
  }
  updateTrayMenu(onLogin, onQuit);
}

function stopAllTrackers() {
  stopActiveWindowTracker();
  stopScreenshotCapture();
  stopIdleDetector();
  stopSync();
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
