import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../app/store';
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
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  // Keep a ref so the BroadcastChannel closure always reads the latest auth state
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);
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
      // Refresh failed — session truly expired. Call backend logout to invalidate
      // the refresh token and clear the httpOnly cookie before redirecting.
      // Without this, AuthHydrator would restore the session on the next page load.
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch { /* non-blocking — best effort */ }
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
    // Get or create a stable ID for this tab so we ignore broadcasts we originated
    let tabId = sessionStorage.getItem('aniston_tab_id');
    if (!tabId) {
      tabId = Math.random().toString(36).slice(2);
      sessionStorage.setItem('aniston_tab_id', tabId);
    }
    const myTabId = tabId;
    const channel = new BroadcastChannel('auth');
    channel.onmessage = (e) => {
      const msg = e.data;
      // If another tab just completed a force-login, ignore any pending logout
      // broadcasts — the session was intentionally re-established
      if (msg?.type === 'force_login_complete') return;
      // Support both old string format and new tagged-object format
      const isLogout = msg === 'logout' || msg?.type === 'logout';
      if (!isLogout) return;
      // Ignore if this broadcast came from our own tab (prevents self-poisoning after force-login)
      if (msg?.from && msg.from === myTabId) return;
      // Only respond if this tab is currently authenticated — ignore stale broadcasts
      // that arrive after a force-login has already re-authenticated this tab
      if (!isAuthenticatedRef.current) return;
      dispatch(logout());
      window.location.href = '/login?reason=session_expired';
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
