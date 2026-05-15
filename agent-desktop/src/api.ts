import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import { CONFIG } from './config';

const FETCH_TIMEOUT_MS = 15_000;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onTokenRefresh: ((access: string, refresh: string | null) => void) | null = null;

/**
 * Thrown when the access token has expired AND the refresh also fails (or is absent).
 * Caught in main.ts sync loop to trigger re-pair without crashing the agent.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (refresh !== undefined) refreshToken = refresh || null;
}

export function getAccessToken() { return accessToken; }

/** Register a callback so refreshed tokens are persisted to disk (set in main.ts). */
export function setTokenRefreshCallback(cb: (access: string, refresh: string | null) => void) {
  onTokenRefresh = cb;
}

function fetchWithTimeout(url: string, options: Parameters<typeof fetch>[1] = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal as any })
    .finally(() => clearTimeout(timer));
}

async function authFetch(url: string, options: Parameters<typeof fetch>[1] = {}) {
  if (!accessToken) throw new UnauthorizedError();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
    Authorization: `Bearer ${accessToken}`,
  };

  const res = await fetchWithTimeout(`${CONFIG.API_URL}${url}`, { ...options, headers });

  if (res.status === 401) {
    if (refreshToken) {
      const refreshRes = await fetchWithTimeout(`${CONFIG.API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json() as any;
        const newAccess: string = data.data?.accessToken || accessToken!;
        const newRefresh: string | null = data.data?.refreshToken ?? refreshToken;
        accessToken = newAccess;
        refreshToken = newRefresh;
        onTokenRefresh?.(newAccess, newRefresh);
        return fetchWithTimeout(`${CONFIG.API_URL}${url}`, {
          ...options,
          headers: { ...(options.headers as Record<string, string> || {}), Authorization: `Bearer ${accessToken}` },
        });
      }
    }
    throw new UnauthorizedError();
  }

  return res;
}

export async function pairWithCode(code: string) {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('Pairing code must be a non-empty string');
  }
  const res = await fetchWithTimeout(`${CONFIG.API_URL}/agent/pair/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  });
  const data = await res.json() as any;
  if (!data.success) throw new Error(data.error?.message || 'Invalid pairing code');
  accessToken = data.data.accessToken;
  refreshToken = data.data.refreshToken || null;
  return data.data;
}

export async function getAgentConfig() {
  const res = await authFetch('/agent/config');
  const data = await res.json() as any;
  return data.data;
}

/** Lightweight keepalive — no payload, just proves the agent is alive to the server.
 *  Called every 2 minutes independent of the heartbeat cycle. */
export async function sendPing() {
  const res = await authFetch('/agent/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`Ping rejected: ${res.status}`);
}

export async function sendHeartbeat(activities: unknown[]) {
  if (!Array.isArray(activities)) throw new Error('activities must be an array');
  const res = await authFetch('/agent/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activities }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Heartbeat rejected: ${res.status} ${text.slice(0, 120)}`);
  }
  return res.json();
}

export async function uploadScreenshot(
  filePath: string,
  metadata: { activeApp: string; activeWindow: string; timestamp: string }
) {
  if (!filePath || typeof filePath !== 'string') throw new Error('filePath must be a non-empty string');
  const form = new FormData();
  form.append('screenshot', fs.createReadStream(filePath));
  form.append('activeApp', metadata.activeApp);
  form.append('activeWindow', metadata.activeWindow);
  form.append('timestamp', metadata.timestamp);

  const res = await authFetch('/agent/screenshot', {
    method: 'POST',
    body: form as any,
    headers: form.getHeaders(),
  });
  return res.json();
}

export function isLoggedIn() { return !!accessToken; }
