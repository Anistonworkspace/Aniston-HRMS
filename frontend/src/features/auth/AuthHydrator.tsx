import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { setAccessToken, setHydrated } from './authSlice';

// On native Capacitor, VITE_API_URL resolves to '/api' at build time, which maps to
// capacitor://localhost/api — there is no backend there. Always use the production URL.
const API_URL = Capacitor.isNativePlatform()
  ? 'https://hr.anistonav.com/api'
  : (import.meta.env.VITE_API_URL || 'http://localhost:4000/api');

/**
 * Silently restores the user session on app startup.
 *
 * Web: Uses the httpOnly refreshToken cookie (credentials: 'include').
 * Native Android/iOS: The cookie cannot be sent cross-site (capacitor://localhost →
 * hr.anistonav.com), so we fall back to a refresh token stored in localStorage.
 * The token is saved on login and rotated on every successful refresh.
 */
export default function AuthHydrator({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const hydrating = useAppSelector(s => s.auth.hydrating);
  const attempted = useRef(false);

  useEffect(() => {
    if (!hydrating || attempted.current) return;
    attempted.current = true;

    const isNative = Capacitor.isNativePlatform();
    const storedRefreshToken = isNative ? localStorage.getItem('nativeRefreshToken') : null;

    // On native with no stored token, skip the call — user must log in
    if (isNative && !storedRefreshToken) {
      dispatch(setHydrated());
      return;
    }

    fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(isNative ? { 'X-Native-App': 'true' } : {}),
      },
      body: storedRefreshToken ? JSON.stringify({ refreshToken: storedRefreshToken }) : undefined,
    })
      .then(async (res) => {
        if (!res.ok) {
          // Stored token is expired or invalid — clear it
          if (isNative) localStorage.removeItem('nativeRefreshToken');
          dispatch(setHydrated());
          return;
        }
        const json = await res.json();
        const token = json?.data?.accessToken;
        const newRefreshToken = json?.data?.refreshToken;
        if (token) {
          dispatch(setAccessToken(token));
        }
        // Rotate stored refresh token with the newly issued one
        if (newRefreshToken && isNative) {
          localStorage.setItem('nativeRefreshToken', newRefreshToken);
        }
        dispatch(setHydrated());
      })
      .catch(() => {
        dispatch(setHydrated());
      });
  }, [dispatch, hydrating]);

  return <>{children}</>;
}
