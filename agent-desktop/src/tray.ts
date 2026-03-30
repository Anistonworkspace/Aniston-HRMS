import { Tray, Menu, nativeImage, BrowserWindow, dialog, app } from 'electron';
import path from 'path';
import { isTracking, pauseTracking, resumeTracking, stopTracking } from './tracker';
import { stopScreenshots } from './screenshot';
import { isLoggedIn } from './api';

let tray: Tray | null = null;
let loginWindow: BrowserWindow | null = null;

export function createTray(onLogin: () => void, onLogout: () => void) {
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

  updateTrayMenu(onLogin, onLogout);
  return tray;
}

export function updateTrayMenu(onLogin: () => void, onLogout: () => void) {
  if (!tray) return;

  const loggedIn = isLoggedIn();
  const tracking = isTracking();

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Aniston Agent', enabled: false, icon: undefined },
    { type: 'separator' },
    {
      label: loggedIn ? '● Connected' : '○ Not Connected',
      enabled: false,
    },
    {
      label: loggedIn ? (tracking ? '● Tracking Active' : '○ Tracking Paused') : '',
      enabled: false,
      visible: loggedIn,
    },
    { type: 'separator' },
    {
      label: 'Login',
      visible: !loggedIn,
      click: onLogin,
    },
    {
      label: tracking ? 'Pause Tracking' : 'Resume Tracking',
      visible: loggedIn,
      click: () => {
        if (tracking) pauseTracking();
        else resumeTracking();
        updateTrayMenu(onLogin, onLogout);
      },
    },
    {
      label: 'Logout',
      visible: loggedIn,
      click: () => {
        stopTracking();
        stopScreenshots();
        onLogout();
        updateTrayMenu(onLogin, onLogout);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        stopTracking();
        stopScreenshots();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(loggedIn ? `Aniston Agent — ${tracking ? 'Tracking' : 'Paused'}` : 'Aniston Agent — Not Connected');
}

export function showLoginWindow(): Promise<{ email: string; password: string }> {
  return new Promise((resolve, reject) => {
    if (loginWindow) {
      loginWindow.focus();
      reject(new Error('Login window already open'));
      return;
    }

    loginWindow = new BrowserWindow({
      width: 400,
      height: 320,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Aniston Agent — Login',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    loginWindow.setMenuBarVisibility(false);

    const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; padding: 24px; }
  h2 { color: #1e293b; font-size: 18px; margin-bottom: 4px; }
  p { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  label { display: block; font-size: 12px; color: #475569; margin-bottom: 4px; font-weight: 500; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; margin-bottom: 12px; outline: none; }
  input:focus { border-color: #4f46e5; box-shadow: 0 0 0 2px rgba(79,70,229,0.1); }
  button { width: 100%; padding: 10px; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #4338ca; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .error { color: #ef4444; font-size: 12px; margin-bottom: 8px; display: none; }
</style></head><body>
  <h2>Aniston Agent</h2>
  <p>Login with your HRMS credentials</p>
  <form id="form">
    <label>Email</label>
    <input type="email" id="email" placeholder="you@anistonav.com" required autofocus />
    <label>Password</label>
    <input type="password" id="password" placeholder="Enter password" required />
    <div class="error" id="error"></div>
    <button type="submit" id="btn">Sign In</button>
  </form>
  <script>
    const { ipcRenderer } = require('electron');
    document.getElementById('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      document.getElementById('btn').disabled = true;
      document.getElementById('btn').textContent = 'Connecting...';
      ipcRenderer.send('agent-login', { email, password });
    });
    ipcRenderer.on('login-error', (_, msg) => {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = msg;
      document.getElementById('btn').disabled = false;
      document.getElementById('btn').textContent = 'Sign In';
    });
    ipcRenderer.on('login-success', () => { window.close(); });
  </script>
</body></html>`;

    loginWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const { ipcMain } = require('electron');
    const handler = (_: any, data: { email: string; password: string }) => {
      resolve(data);
    };
    ipcMain.once('agent-login', handler);

    loginWindow.on('closed', () => {
      loginWindow = null;
      ipcMain.removeListener('agent-login', handler);
    });
  });
}

export function closeLoginWindow() {
  if (loginWindow) {
    loginWindow.webContents.send('login-success');
    setTimeout(() => loginWindow?.close(), 300);
  }
}

export function sendLoginError(msg: string) {
  if (loginWindow) {
    loginWindow.webContents.send('login-error', msg);
  }
}
