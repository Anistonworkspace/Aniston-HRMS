import { Tray, Menu, nativeImage, BrowserWindow, app, ipcMain } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { isTracking, pauseTracking, resumeTracking, stopTracking } from './tracker';
import { stopScreenshots } from './screenshot';
import { isLoggedIn } from './api';

let tray: Tray | null = null;
let pairWindow: BrowserWindow | null = null;
let pairHtmlPath: string | null = null;

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
    // Not connected: offer pairing
    { label: 'Enter Pairing Code', visible: !loggedIn, click: onPair },
    // Connected: pause/resume and disconnect options
    { label: tracking ? 'Pause Tracking' : 'Resume Tracking', visible: loggedIn, click: () => {
      if (tracking) pauseTracking(); else resumeTracking();
      updateTrayMenu(onPair, onLogout);
    }},
    // Disconnect clears credentials and stays idle — does NOT immediately re-prompt pairing.
    // Employee can re-pair manually via "Enter Pairing Code" or quit and reopen.
    { label: 'Disconnect', visible: loggedIn, click: () => {
      onLogout();
      updateTrayMenu(onPair, onLogout);
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { stopTracking(); stopScreenshots(); app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(loggedIn ? `Aniston Agent — ${tracking ? 'Tracking' : 'Paused'}` : 'Aniston Agent — Not Connected');
}

function writePairHtml(): string {
  const tmpDir = path.join(os.tmpdir(), 'aniston-agent');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const htmlPath = path.join(tmpDir, 'pair.html');
  fs.writeFileSync(htmlPath, getPairHTML(), 'utf-8');
  return htmlPath;
}

export function showPairWindow(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pairWindow) { pairWindow.focus(); reject(new Error('Already open')); return; }

    pairHtmlPath = writePairHtml();

    pairWindow = new BrowserWindow({
      width: 360, height: 280, resizable: false, minimizable: false, maximizable: false,
      title: 'Aniston Agent — Pair',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'pair-preload.js'),
      },
    });
    pairWindow.setMenuBarVisibility(false);
    pairWindow.loadFile(pairHtmlPath);

    const handler = (_: Electron.IpcMainEvent, code: string) => { resolve(code); };
    ipcMain.once('agent-pair', handler);

    pairWindow.on('closed', () => {
      pairWindow = null;
      ipcMain.removeListener('agent-pair', handler);
      if (pairHtmlPath) {
        try { fs.unlinkSync(pairHtmlPath); } catch {}
        pairHtmlPath = null;
      }
      // Reject so handlePair()'s finally block runs and isRepairing resets —
      // without this the agent is permanently locked if the user closes the window
      reject(new Error('cancelled'));
    });
  });
}

export function closePairWindow() {
  if (pairWindow) {
    pairWindow.webContents.send('pair-success');
    setTimeout(() => pairWindow?.close(), 300);
  }
}

export function sendPairError(msg: string) {
  if (pairWindow) pairWindow.webContents.send('pair-error', msg);
}

function getPairHTML(): string {
  return `<!DOCTYPE html>
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
  .logo { margin-bottom: 10px; }
</style></head><body>
  <div class="logo">
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="36" height="24" rx="3" fill="#4f46e5"/>
      <rect x="6" y="8" width="28" height="16" rx="1" fill="#e0e7ff"/>
      <rect x="14" y="28" width="12" height="4" fill="#4f46e5"/>
      <rect x="10" y="32" width="20" height="3" rx="1.5" fill="#4f46e5"/>
    </svg>
  </div>
  <h2>Aniston Agent</h2>
  <p>Enter the pairing code from your HRMS portal</p>
  <form id="form">
    <input type="text" id="code" placeholder="ANST-XXXX" maxlength="9" required autofocus />
    <p class="hint">Go to <b>hr.anistonav.com</b> &rarr; Click &ldquo;Link Agent&rdquo; to get your code</p>
    <p class="hint" style="margin-top:4px;font-size:9px;color:#94a3b8;">By connecting, you consent to activity tracking including screen capture, app usage monitoring, and periodic screenshots during work hours.</p>
    <div class="error" id="error"></div>
    <button type="submit" id="btn">Connect</button>
  </form>
  <script>
    document.getElementById('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (!code) return;
      document.getElementById('btn').disabled = true;
      document.getElementById('btn').textContent = 'Connecting...';
      window.pairAPI.sendCode(code);
    });
    window.pairAPI.onError((msg) => {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = msg;
      document.getElementById('btn').disabled = false;
      document.getElementById('btn').textContent = 'Connect';
    });
    window.pairAPI.onSuccess(() => { window.close(); });
  </script>
</body></html>`;
}
