import { Capacitor } from '@capacitor/core';

// Secure token storage abstraction.
// On native Android/iOS: uses localStorage (survives process kill — required for
// background-killed app to restore session without re-login).
// On web: tokens are in Redux state (in-memory) + httpOnly cookies via the server.
// NOTE: For production-grade security, replace with @capacitor/preferences once
// the native build pipeline supports it.

const NATIVE_REFRESH_KEY = 'nativeRefreshToken';

function storage(): Storage | null {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const secureStorage = {
  getRefreshToken(): string | null {
    return storage()?.getItem(NATIVE_REFRESH_KEY) ?? null;
  },
  setRefreshToken(token: string): void {
    storage()?.setItem(NATIVE_REFRESH_KEY, token);
  },
  removeRefreshToken(): void {
    storage()?.removeItem(NATIVE_REFRESH_KEY);
  },
};
