import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch } from '../app/store';
import { logout } from '../features/auth/authSlice';

const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const WARNING_BEFORE = 60 * 1000; // Show warning 60s before

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

    timerRef.current = setTimeout(() => {
      dispatch(logout());
      window.location.href = '/login?reason=inactivity';
    }, INACTIVITY_TIMEOUT);
  }, [dispatch, onWarning]);

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    const handler = () => resetTimer();

    events.forEach(e => document.addEventListener(e, handler, { passive: true }));
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
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      channel.close();
    };
  }, [resetTimer, dispatch]);

  return { resetTimer };
}
