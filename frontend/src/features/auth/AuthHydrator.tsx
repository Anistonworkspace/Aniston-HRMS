import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { setAccessToken, setHydrated } from './authSlice';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

/**
 * Silently restores the user session on app startup by calling /auth/refresh
 * using the httpOnly refresh token cookie (credentials: 'include').
 *
 * The access token is kept in Redux memory only — never written to localStorage.
 * After refresh, ProtectedRoute's useGetMeQuery fetches the user profile normally.
 * This runs once per page load. After it completes (success or failure),
 * `hydrating` is set to false and the router proceeds normally.
 */
export default function AuthHydrator({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const hydrating = useAppSelector(s => s.auth.hydrating);
  const attempted = useRef(false);

  useEffect(() => {
    if (!hydrating || attempted.current) return;
    attempted.current = true;

    fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          dispatch(setHydrated());
          return;
        }
        const json = await res.json();
        const token = json?.data?.accessToken;
        if (token) {
          // setAccessToken also sets isAuthenticated = true.
          // ProtectedRoute will then call /auth/me to restore the user profile.
          dispatch(setAccessToken(token));
        }
        dispatch(setHydrated());
      })
      .catch(() => {
        dispatch(setHydrated());
      });
  }, [dispatch, hydrating]);

  return <>{children}</>;
}
