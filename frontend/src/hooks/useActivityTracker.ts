import { useState, useEffect, useRef, useCallback } from 'react';
import { useSendActivityPulseMutation } from '../features/attendance/attendanceApi';
import { useAppSelector } from '../app/store';

const PULSE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function useActivityTracker() {
  const user = useAppSelector(s => s.auth.user);
  const [sendPulse] = useSendActivityPulseMutation();
  const [isTabActive, setIsTabActive] = useState(!document.hidden);
  const [activeMinutes, setActiveMinutes] = useState(0);
  const [sessionStart] = useState(() => new Date());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track tab visibility
  useEffect(() => {
    const handler = () => setIsTabActive(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Send heartbeat pulse every 5 minutes
  const sendHeartbeat = useCallback(async () => {
    if (!user?.employeeId) return;
    try {
      const result = await sendPulse({ isActive: true, tabVisible: isTabActive }).unwrap();
      if (result?.data?.activeMinutes !== undefined) {
        setActiveMinutes(result.data.activeMinutes);
      } else {
        setActiveMinutes(prev => prev + (isTabActive ? 5 : 0));
      }
    } catch {
      // Silently fail — don't interrupt user
    }
  }, [user?.employeeId, isTabActive, sendPulse]);

  useEffect(() => {
    if (!user?.employeeId) return;

    intervalRef.current = setInterval(sendHeartbeat, PULSE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user?.employeeId, sendHeartbeat]);

  return { isTabActive, activeMinutes, sessionStart };
}
