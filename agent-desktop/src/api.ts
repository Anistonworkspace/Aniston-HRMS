import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import { CONFIG } from './config';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (refresh) refreshToken = refresh;
}

export function getAccessToken() { return accessToken; }

async function authFetch(url: string, options: any = {}) {
  if (!accessToken) throw new Error('Not logged in');
  const res = await fetch(`${CONFIG.API_URL}${url}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401 && refreshToken) {
    // Try refresh
    const refreshRes = await fetch(`${CONFIG.API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json() as any;
      accessToken = data.data?.accessToken || accessToken;
      // Retry original request
      return fetch(`${CONFIG.API_URL}${url}`, {
        ...options,
        headers: { ...options.headers, 'Authorization': `Bearer ${accessToken}` },
      });
    }
  }
  return res;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${CONFIG.API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(data.error?.message || 'Login failed');
  accessToken = data.data.accessToken;
  refreshToken = data.data.refreshToken;
  return data.data;
}

export async function pairWithCode(code: string) {
  const res = await fetch(`${CONFIG.API_URL}/agent/pair/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(data.error?.message || 'Invalid pairing code');
  accessToken = data.data.accessToken;
  return data.data;
}

export async function getAgentConfig() {
  const res = await authFetch('/agent/config');
  const data = await res.json() as any;
  return data.data;
}

export async function sendHeartbeat(activities: any[]) {
  const res = await authFetch('/agent/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activities }),
  });
  return res.json();
}

export async function uploadScreenshot(filePath: string, metadata: { activeApp: string; activeWindow: string }) {
  const form = new FormData();
  form.append('screenshot', fs.createReadStream(filePath));
  form.append('activeApp', metadata.activeApp);
  form.append('activeWindow', metadata.activeWindow);

  const res = await authFetch('/agent/screenshot', {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });
  return res.json();
}

export function isLoggedIn() { return !!accessToken; }
