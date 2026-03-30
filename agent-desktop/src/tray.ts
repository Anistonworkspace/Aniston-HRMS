import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'path';
import { isTracking, pauseTracking, resumeTracking, stopTracking } from './tracker';
import { stopScreenshots } from './screenshot';
import { isLoggedIn } from './api';

let tray: Tray | null = null;
let pairWindow: BrowserWindow | null = null;

export function createTray(onPair: () => void, onLogout: () => void) {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Aniston Agent');
  updateTrayMenu(onPair, onLogout);
  return tray;
}

export function updateTrayMenu(onPair: () => void, onLogout: () => void) {
  if (!tray) return;
  const loggedIn = isLoggedIn();
  const tracking = isTracking();

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Aniston Agent', enabled: false },
    { type: 'separator' },
    { label: loggedIn ? '● Connected' : '○ Not Connected', enabled: false },
    { label: loggedIn ? (tracking ? '● Tracking Active' : '○ Tracking Paused') : '', enabled: false, visible: loggedIn },
    { type: 'separator' },
    { label: 'Enter Pairing Code', visible: !loggedIn, click: onPair },
    { label: tracking ? 'Pause Tracking' : 'Resume Tracking', visible: loggedIn, click: () => {
      if (tracking) pauseTracking(); else resumeTracking();
      updateTrayMenu(onPair, onLogout);
    }},
    { label: 'Disconnect', visible: loggedIn, click: () => {
      stopTracking(); stopScreenshots(); onLogout();
      updateTrayMenu(onPair, onLogout);
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { stopTracking(); stopScreenshots(); app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(loggedIn ? `Aniston Agent — ${tracking ? 'Tracking' : 'Paused'}` : 'Aniston Agent — Not Connected');
}

export function showPairWindow(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pairWindow) { pairWindow.focus(); reject(new Error('Already open')); return; }

    pairWindow = new BrowserWindow({
      width: 360, height: 260, resizable: false, minimizable: false, maximizable: false,
      title: 'Aniston Agent — Pair',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    pairWindow.setMenuBarVisibility(false);

    const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; padding: 24px; text-align: center; }
  h2 { color: #1e293b; font-size: 16px; margin-bottom: 4px; }
  p { color: #64748b; font-size: 12px; margin-bottom: 16px; }
  .hint { color: #94a3b8; font-size: 11px; margin-top: 8px; }
  input { width: 100%; padding: 14px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 22px; text-align: center; letter-spacing: 4px; font-family: monospace; font-weight: 700; outline: none; text-transform: uppercase; }
  input:focus { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
  button { width: 100%; padding: 12px; background: #4f46e5; color: white; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 12px; }
  button:hover { background: #4338ca; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: #ef4444; font-size: 12px; margin-top: 8px; display: none; }
  .logo { font-size: 24px; margin-bottom: 8px; }
</style></head><body>
  <div class="logo">🖥️</div>
  <h2>Aniston Agent</h2>
  <p>Enter the pairing code from your HRMS portal</p>
  <form id="form">
    <input type="text" id="code" placeholder="ANST-XXXX" maxlength="9" required autofocus />
    <p class="hint">Go to HRMS → Click "Link Agent" to get your code</p>
    <div class="error" id="error"></div>
    <button type="submit" id="btn">Connect</button>
  </form>
  <script>
    const { ipcRenderer } = require('electron');
    document.getElementById('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (!code) return;
      document.getElementById('btn').disabled = true;
      document.getElementById('btn').textContent = 'Connecting...';
      ipcRenderer.send('agent-pair', code);
    });
    ipcRenderer.on('pair-error', (_, msg) => {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = msg;
      document.getElementById('btn').disabled = false;
      document.getElementById('btn').textContent = 'Connect';
    });
    ipcRenderer.on('pair-success', () => { window.close(); });
  </script>
</body></html>`;

    pairWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const { ipcMain } = require('electron');
    const handler = (_: any, code: string) => { resolve(code); };
    ipcMain.once('agent-pair', handler);
    pairWindow.on('closed', () => {
      pairWindow = null;
      ipcMain.removeListener('agent-pair', handler);
    });
  });
}

export function closePairWindow() {
  if (pairWindow) { pairWindow.webContents.send('pair-success'); setTimeout(() => pairWindow?.close(), 300); }
}

export function sendPairError(msg: string) {
  if (pairWindow) pairWindow.webContents.send('pair-error', msg);
}
