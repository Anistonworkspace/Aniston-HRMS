import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import { CONFIG } from './config';

const FETCH_TIMEOUT_MS = 15_000;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onTokenRefresh: ((access: string, refresh: string | null) => void) | null = null;

// A-004: Serialise concurrent token refresh — only one in-flight refresh at a time.
// Without this, two simultaneous 401 responses each attempt a refresh, one succeeds
// and the other gets a "token already used" error, producing a spurious UnauthorizedError.
let refreshPromise: Promise<boolean> | null = null;

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

/**
 * Thrown when the server returns 403 Forbidden.
 * Distinct from UnauthorizedError — 403 means the token is valid but the action is not
 * allowed (e.g. employee trying to call an admin endpoint). These should NOT trigger
 * re-pair and should NOT be retried — they indicate a permanent permission mismatch.
 */
export class ForbiddenError extends Error {
  constructor() {
    super('FORBIDDEN');
    this.name = 'ForbiddenError';
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

async function tryRefreshToken(): Promise<boolean> {
  if (!refreshToken) return false;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshRes = await fetchWithTimeout(`${CONFIG.API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!refreshRes.ok) return false;
      const data = await refreshRes.json() as any;
      const newAccess: string = data.data?.accessToken || accessToken!;
      const newRefresh: string | null = data.data?.refreshToken ?? refreshToken;
      accessToken = newAccess;
      refreshToken = newRefresh;
      onTokenRefresh?.(newAccess, newRefresh);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function authFetch(url: string, options: Parameters<typeof fetch>[1] = {}) {
  if (!accessToken) throw new UnauthorizedError();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
    Authorization: `Bearer ${accessToken}`,
  };

  const res = await fetchWithTimeout(`${CONFIG.API_URL}${url}`, { ...options, headers });

  // A-003: Distinguish 403 from 401 — forbidden means the token is valid but the
  // action is not permitted. Do NOT retry, do NOT refresh — throw ForbiddenError.
  if (res.status === 403) throw new ForbiddenError();

  if (res.status === 401) {
    // A-004: Use shared refresh promise to serialise concurrent refresh attempts.
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return fetchWithTimeout(`${CONFIG.API_URL}${url}`, {
        ...options,
        headers: { ...(options.headers as Record<string, string> || {}), Authorization: `Bearer ${accessToken}` },
      });
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

function buildScreenshotForm(filePath: string, metadata: { activeApp: string; activeWindow: string; timestamp: string }) {
  // A-028: Always build a fresh FormData with a new ReadStream — streams are read-once
  // and cannot be replayed on a 401-retry. Each call to this function creates a new stream.
  const form = new FormData();
  form.append('screenshot', fs.createReadStream(filePath));
  form.append('activeApp', metadata.activeApp);
  form.append('activeWindow', metadata.activeWindow);
  form.append('timestamp', metadata.timestamp);
  return form;
}

export async function uploadScreenshot(
  filePath: string,
  metadata: { activeApp: string; activeWindow: string; timestamp: string }
) {
  if (!filePath || typeof filePath !== 'string') throw new Error('filePath must be a non-empty string');
  if (!accessToken) throw new UnauthorizedError();

  const form = buildScreenshotForm(filePath, metadata);
  const res = await fetchWithTimeout(`${CONFIG.API_URL}/agent/screenshot`, {
    method: 'POST',
    body: form as any,
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
  });

  // A-003: 403 is permanent — do not retry
  if (res.status === 403) throw new ForbiddenError();

  if (res.status === 401) {
    // A-028: Refresh token, then re-build FormData with a fresh stream for the retry
    const refreshed = await tryRefreshToken();
    if (!refreshed) throw new UnauthorizedError();

    const retryForm = buildScreenshotForm(filePath, metadata);
    const retryRes = await fetchWithTimeout(`${CONFIG.API_URL}/agent/screenshot`, {
      method: 'POST',
      body: retryForm as any,
      headers: { ...retryForm.getHeaders(), Authorization: `Bearer ${accessToken}` },
    });
    if (retryRes.status === 403) throw new ForbiddenError();
    if (!retryRes.ok) throw new UnauthorizedError();
    return retryRes.json();
  }

  return res.json();
}

export function isLoggedIn() { return !!accessToken; }
