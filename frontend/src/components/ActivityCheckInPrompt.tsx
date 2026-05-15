import { useEffect, useRef, useCallback } from 'react';
import { useSendActivityPulseMutation, useGetTodayStatusQuery } from '../features/attendance/attendanceApi';
import { useAppSelector } from '../app/store';
import toast from 'react-hot-toast';

const CHECK_IN_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

export default function ActivityCheckInPrompt() {
  const user = useAppSelector(s => s.auth.user);
  const [sendPulse] = useSendActivityPulseMutation();
  const { data: todayRes } = useGetTodayStatusQuery(undefined, { skip: !user?.employeeId });
  const today = todayRes?.data;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastIdRef = useRef<string | null>(null);

  const isCheckedIn = today?.isCheckedIn && !today?.isCheckedOut;

  const showPrompt = useCallback(() => {
    if (!isCheckedIn || !user?.employeeId) return;

    // Don't show if there's already an active prompt
    if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current);
    }

    toastIdRef.current = toast(
      (t) => (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-800">Are you still working?</p>
          <p className="text-xs text-gray-500">Activity check-in to track your session</p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => {
                sendPulse({ isActive: true, tabVisible: true });
                toast.dismiss(t.id);
                toastIdRef.current = null;
                toast.success('Activity recorded!', { duration: 2000 });
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}
            >
              Yes, I'm working
            </button>
            <button
              onClick={() => {
                sendPulse({ isActive: false, tabVisible: true });
                toast.dismiss(t.id);
                toastIdRef.current = null;
              }}
              className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              On break
            </button>
          </div>
        </div>
      ),
      {
        duration: 10 * 60 * 1000, // 10 min before auto-dismiss
        position: 'bottom-right',
        style: {
          borderRadius: '16px',
          padding: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
        },
      }
    );
  }, [isCheckedIn, user?.employeeId, sendPulse]);

  useEffect(() => {
    if (!isCheckedIn) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Start prompts after the interval
    intervalRef.current = setInterval(showPrompt, CHECK_IN_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (toastIdRef.current) toast.dismiss(toastIdRef.current);
    };
  }, [isCheckedIn, showPrompt]);

  return null; // This is a behavior-only component
}
