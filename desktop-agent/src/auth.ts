import { BrowserWindow } from 'electron';
import fetch from 'node-fetch';
import store from './store';
import { CONFIG } from './config';
import * as path from 'path';

let loginWindow: BrowserWindow | null = null;

export function isAuthenticated(): boolean {
  return !!store.get('accessToken');
}

export function getAuthHeaders(): Record<string, string> {
  const token = store.get('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = store.get('refreshToken');
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${CONFIG.API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `refreshToken=${refreshToken}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as any;
    if (data?.data?.accessToken) {
      store.set('accessToken', data.data.accessToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function apiRequest(endpoint: string, options: any = {}): Promise<any> {
  const url = `${CONFIG.API_URL}${endpoint}`;
  let headers = { ...getAuthHeaders(), ...options.headers };
  if (!(options.body instanceof (await import('form-data')).default)) {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(url, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers = { ...getAuthHeaders(), ...options.headers };
      if (!(options.body instanceof (await import('form-data')).default)) {
        headers['Content-Type'] = 'application/json';
      }
      res = await fetch(url, { ...options, headers });
    }
  }

  return res.json();
}

export function showLoginWindow(): Promise<boolean> {
  return new Promise((resolve) => {
    if (loginWindow) { loginWindow.focus(); return; }

    loginWindow = new BrowserWindow({
      width: 400,
      height: 500,
      resizable: false,
      title: 'Aniston Activity Agent — Login',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    loginWindow.loadFile(path.join(__dirname, 'ui', 'login.html'));

    loginWindow.on('closed', () => {
      loginWindow = null;
      resolve(isAuthenticated());
    });

    // Listen for login success from renderer
    const { ipcMain } = require('electron');
    ipcMain.once('login-success', (_: any, data: { accessToken: string; refreshToken: string; user: any }) => {
      store.set('accessToken', data.accessToken);
      store.set('refreshToken', data.refreshToken);
      store.set('email', data.user?.email);
      store.set('employeeId', data.user?.employeeId);
      store.set('employeeName', `${data.user?.firstName || ''} ${data.user?.lastName || ''}`);
      loginWindow?.close();
      resolve(true);
    });
  });
}

export function logout() {
  store.set('accessToken', null);
  store.set('refreshToken', null);
  store.set('email', null);
  store.set('employeeId', null);
  store.set('employeeName', null);
}
