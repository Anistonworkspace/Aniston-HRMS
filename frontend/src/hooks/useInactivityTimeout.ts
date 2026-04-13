import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch } from '../app/store';
import { logout, setAccessToken } from '../features/auth/authSlice';

const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 60 minutes
const WARNING_BEFORE = 2 * 60 * 1000; // Show warning 2 minutes before logout

const API_URL = import.meta.env.VITE_API_URL || '/api';

/** Attempt a silent token refresh using the httpOnly refresh cookie.
 *  Returns the new access token on success, null on failure. */
async function trySilentRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.accessToken ?? null;
  } catch {
    return null;
  }
}

export function useInactivityTimeout(onWarning: () => void) {
  const dispatch = useAppDispatch();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);

    warningTimerRef.current = setTimeout(() => {
      onWarning();
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE);

    timerRef.current = setTimeout(async () => {
      // Before forcing logout, try a silent refresh — if the server session
      // is still alive (refresh cookie valid) the user stays logged in.
      const newToken = await trySilentRefresh();
      if (newToken) {
        dispatch(setAccessToken(newToken));
        resetTimer(); // session extended, restart the timer
        return;
      }
      // Refresh failed — session truly expired, log out
      dispatch(logout());
      window.location.href = '/login?reason=inactivity';
    }, INACTIVITY_TIMEOUT);
  }, [dispatch, onWarning]);

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove', 'click'];
    const handler = () => resetTimer();

    events.forEach(e => document.addEventListener(e, handler, { passive: true }));

    // Reset timer when the user returns to this tab — prevents premature logout
    // when the tab was in the background (e.g., user was in a meeting)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        resetTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    resetTimer();

    // Cross-tab logout via BroadcastChannel
    const channel = new BroadcastChannel('auth');
    channel.onmessage = (e) => {
      if (e.data === 'logout') {
        dispatch(logout());
        window.location.href = '/login?reason=session_expired';
      }
    };

    return () => {
      events.forEach(e => document.removeEventListener(e, handler));
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      channel.close();
    };
  }, [resetTimer, dispatch]);

  return { resetTimer };
}
