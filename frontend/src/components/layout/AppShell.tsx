import { useEffect, useState, useRef, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, RefreshCw } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileBottomNav from './MobileBottomNav';
import ActivityCheckInPrompt from '../ActivityCheckInPrompt';
import useActivityTracker from '../../hooks/useActivityTracker';
import { useInactivityTimeout } from '../../hooks/useInactivityTimeout';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import { setUser, logout, setSessionEndReason } from '../../features/auth/authSlice';
import AiAssistantFab from '../../features/ai-assistant/AiAssistantPanel';
import { connectSocket, disconnectSocket, onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { isNativeGpsRunning, updateNativeGpsInterval, startNativeGpsService, isNativeAndroid } from '../../lib/capacitorGPS';
import { isGpsEnabled, openGpsSettings } from '../../lib/capacitorPermissions';
import { Capacitor } from '@capacitor/core';
import { useGetTodayStatusQuery } from '../../features/attendance/attendanceApi';

export default function AppShell() {
  const { t } = useTranslation();

  // Activity tracking — runs globally for all logged-in users
  useActivityTracker();

  // Network status + offline action sync
  const { isOnline } = useNetworkStatus();
  useOfflineSync();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast.success(t('appShell.backOnline'));
    }
  }, [isOnline, t]);
  const dispatch = useAppDispatch();
  const user = useAppSelector(s => s.auth.user);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const { resetTimer } = useInactivityTimeout(() => setShowTimeoutWarning(true));

  // Pull-to-refresh — mobile only
  const mainRef = useRef<HTMLElement>(null);
  const [ptrProgress, setPtrProgress] = useState(0);
  const [ptrRefreshing, setPtrRefreshing] = useState(false);
  const ptrTouchYRef = useRef<number | null>(null);

  const ptrTouchStart = useCallback((e: TouchEvent) => {
    const el = mainRef.current;
    if (!el || el.scrollTop > 5) return;
    ptrTouchYRef.current = e.touches[0].clientY;
  }, []);

  const ptrTouchMove = useCallback((e: TouchEvent) => {
    if (ptrTouchYRef.current === null || ptrRefreshing) return;
    const el = mainRef.current;
    if (!el || el.scrollTop > 5) { ptrTouchYRef.current = null; return; }
    const diff = e.touches[0].clientY - ptrTouchYRef.current;
    if (diff > 0) setPtrProgress(Math.min((diff / 80) * 100, 100));
    else ptrTouchYRef.current = null;
  }, [ptrRefreshing]);

  const ptrTouchEnd = useCallback(async () => {
    if (ptrTouchYRef.current === null) return;
    ptrTouchYRef.current = null;
    if (ptrProgress >= 100) {
      setPtrRefreshing(true);
      setPtrProgress(0);
      dispatch(api.util.invalidateTags(['Dashboard', 'Attendance', 'Leave', 'LeaveBalance', 'Holiday', 'Employee'] as any[]));
      await new Promise(r => setTimeout(r, 1200));
      setPtrRefreshing(false);
    } else {
      setPtrProgress(0);
    }
  }, [ptrProgress, dispatch]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    el.addEventListener('touchstart', ptrTouchStart, { passive: true });
    el.addEventListener('touchmove', ptrTouchMove, { passive: true });
    el.addEventListener('touchend', ptrTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', ptrTouchStart);
      el.removeEventListener('touchmove', ptrTouchMove);
      el.removeEventListener('touchend', ptrTouchEnd);
    };
  }, [ptrTouchStart, ptrTouchMove, ptrTouchEnd]);

  // Connect Socket.io when user is logged in
  const accessToken = useAppSelector(s => s.auth.accessToken);
  useEffect(() => {
    if (accessToken) {
      connectSocket(accessToken);
    }
    return () => { disconnectSocket(); };
  }, [accessToken]);

  // On socket RECONNECT (not initial connect) — check if session was revoked while disconnected.
  // Uses 'reconnect' event which only fires after a dropped-then-restored connection, not on
  // the first connect. api.ts SESSION_REVOKED handler will dispatch logout if the token is revoked.
  useEffect(() => {
    if (!accessToken) return;
    const handleReconnect = () => {
      dispatch(api.util.invalidateTags(['Employee'] as any[]));
    };
    onSocketEvent('reconnect', handleReconnect);
    return () => { offSocketEvent('reconnect', handleReconnect); };
  }, [dispatch, accessToken]);

  // GPS session restore — Android native only.
  // Fetches today's attendance status on mount and on each app resume. If the
  // employee is already checked in on a FIELD shift and the native GPS service
  // is not running, starts it automatically — no need to visit AttendancePage.
  const { data: todayStatusResponse } = useGetTodayStatusQuery(undefined, {
    skip: !isNativeAndroid || !user,
  });
  const gpsRestoreRef = useRef(false);
  useEffect(() => {
    if (!isNativeAndroid || !user || !accessToken) return;
    const todayStatus = todayStatusResponse?.data;
    if (!todayStatus) return;

    const isCheckedIn = todayStatus.isCheckedIn && !todayStatus.isCheckedOut;
    const isFieldShift = (todayStatus.shift as any)?.shiftType === 'FIELD';
    if (!isCheckedIn || !isFieldShift) return;

    async function maybeRestoreGps() {
      const running = await isNativeGpsRunning();
      if (running) return;

      const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
      const backendBase = rawApiUrl
        ? rawApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
        : 'https://hr.anistonav.com';
      const intervalMins = (todayStatus!.shift as any)?.trackingIntervalMinutes as number | undefined;
      const attendanceId = todayStatus!.record?.id ?? '';

      try {
        await startNativeGpsService({
          backendUrl: backendBase,
          authToken: accessToken!,
          employeeId: user!.employeeId || '',
          orgId: user!.organizationId || '',
          ...(attendanceId ? { attendanceId } : {}),
          ...(intervalMins != null ? { trackingIntervalMinutes: intervalMins } : {}),
        });
        dispatch(api.util.invalidateTags(['Attendance'] as any[]));
      } catch {
        // silent — user can open Attendance page to retry
      }
    }

    if (!gpsRestoreRef.current) {
      gpsRestoreRef.current = true;
      maybeRestoreGps();
    }

    // Also attempt restore whenever the app comes back to foreground
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') maybeRestoreGps();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStatusResponse, user, accessToken]);

  // Real-time dashboard refresh — invalidate RTK Query cache on server events
  useEffect(() => {
    const handleDashboardRefresh = () => {
      dispatch(api.util.invalidateTags(['Dashboard']));
    };
    onSocketEvent('dashboard:refresh', handleDashboardRefresh);
    return () => { offSocketEvent('dashboard:refresh', handleDashboardRefresh); };
  }, [dispatch]);

  // Real-time document verification notification — auto-fill feedback
  useEffect(() => {
    const handleDocVerified = (data: { documentType?: string; autoFilledFields?: string[]; message?: string }) => {
      if (data.autoFilledFields && data.autoFilledFields.length > 0) {
        toast.success(data.message || `Document verified! Auto-filled: ${data.autoFilledFields.join(', ')}`, { duration: 6000 });
        // Refresh employee data
        dispatch(api.util.invalidateTags(['Employee', 'Document']));
      } else {
        toast.success(`Your ${(data.documentType || 'document').replace(/_/g, ' ')} was approved by HR`);
        dispatch(api.util.invalidateTags(['Document']));
      }
    };
    onSocketEvent('document:verified', handleDocVerified);
    return () => { offSocketEvent('document:verified', handleDocVerified); };
  }, [dispatch]);

  // Real-time KYC gate enforcement — if HR deletes/rejects a doc, immediately revoke
  // kycCompleted in Redux so the ProtectedRoute re-gates the employee without waiting for
  // the next token refresh.
  useEffect(() => {
    const handleKycStatusChanged = (data: { status?: string; kycCompleted?: boolean; trigger?: string }) => {
      if (data?.status === 'REUPLOAD_REQUIRED' && user && user.kycCompleted) {
        dispatch(setUser({ ...user, kycCompleted: false }));
        const msg = data.trigger === 'rejection'
          ? 'HR rejected a document. Please re-upload it to regain portal access.'
          : 'A document was removed by HR. Please re-upload to regain portal access.';
        toast.error(msg, { duration: 8000 });
        dispatch(api.util.invalidateTags(['Document', 'Employee']));
      } else if (data?.status === 'REUPLOAD_REQUIRED' && user && !user.kycCompleted) {
        // Already blocked — still refresh tags so KycGatePage shows the new reason
        dispatch(api.util.invalidateTags(['Document', 'Employee', 'Onboarding']));
      } else if (data?.status === 'VERIFIED' && user && !user.kycCompleted) {
        dispatch(setUser({ ...user, kycCompleted: true }));
        toast.success('Your KYC has been verified! You now have full access.', { duration: 6000 });
        dispatch(api.util.invalidateTags(['Document', 'Employee']));
      }
    };
    onSocketEvent('kyc:status-changed', handleKycStatusChanged);
    return () => { offSocketEvent('kyc:status-changed', handleKycStatusChanged); };
  }, [dispatch, user]);

  // Real-time shift assignment — refetch attendance context so the employee's page
  // reflects the new shift type (OFFICE/FIELD) without a manual refresh.
  // For FIELD shifts on native Android, also update the GPS interval immediately
  // so the running service doesn't need to be restarted.
  useEffect(() => {
    const handleShiftAssigned = async (data: any) => {
      dispatch(api.util.invalidateTags(['Attendance', 'Employee'] as any[]));
      if (data?.shiftType === 'FIELD') {
        const running = await isNativeGpsRunning();
        if (running) {
          const minutes = typeof data.trackingIntervalMinutes === 'number'
            ? data.trackingIntervalMinutes
            : 60;
          await updateNativeGpsInterval(minutes);
        }
      }
    };
    onSocketEvent('shift:assigned', handleShiftAssigned);
    return () => { offSocketEvent('shift:assigned', handleShiftAssigned); };
  }, [dispatch]);

  // GPS auto-restarted event — fired by MainActivity.onResume() via evaluateJavascript
  // when it detects saved credentials and restarts the service. Invalidate attendance
  // cache so the UI reflects active tracking without the employee navigating to Attend.
  useEffect(() => {
    const handleGpsAutoRestarted = () => {
      dispatch(api.util.invalidateTags(['Attendance'] as any[]));
    };
    window.addEventListener('gps:auto-restarted', handleGpsAutoRestarted);
    return () => window.removeEventListener('gps:auto-restarted', handleGpsAutoRestarted);
  }, [dispatch]);

  // GPS-off watcher — only active on Android native, only while GPS service is running.
  // Polls every 30 s and fires on visibilitychange so the employee is prompted immediately
  // when they turn off GPS mid-shift.
  const gpsOffToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function checkGps() {
      const running = await isNativeGpsRunning();
      if (!running) return; // GPS service not active — nothing to guard
      const enabled = await isGpsEnabled();
      if (!enabled) {
        if (!gpsOffToastRef.current) {
          gpsOffToastRef.current = toast.error(
            (tt) => (
              <span>
                GPS is turned off. Your location cannot be recorded.{' '}
                <button
                  className="underline font-semibold"
                  onClick={async () => {
                    toast.dismiss(tt.id);
                    gpsOffToastRef.current = null;
                    await openGpsSettings();
                  }}
                >
                  Turn On GPS
                </button>
              </span>
            ),
            { duration: Infinity, id: 'gps-off-warning' }
          );
        }
      } else {
        if (gpsOffToastRef.current) {
          toast.dismiss('gps-off-warning');
          gpsOffToastRef.current = null;
        }
      }
    }

    pollTimer = setInterval(checkGps, 30_000);
    const handleVisibility = () => { if (document.visibilityState === 'visible') checkGps(); };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (gpsOffToastRef.current) {
        toast.dismiss('gps-off-warning');
        gpsOffToastRef.current = null;
      }
    };
  }, []);

  const navigate = useNavigate();

  // Single-session enforcement — kicked off because another device logged in with force-login.
  // The backend sends { deviceType } so we only logout if the revoked slot matches this device.
  // Mobile slot revocation must not kick an open desktop browser, and vice versa.
  useEffect(() => {
    const myDeviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    const handleSessionRevoked = (data?: { deviceType?: string; reason?: string }) => {
      // If the event carries a deviceType and it doesn't match ours, ignore it
      if (data?.deviceType && data.deviceType !== myDeviceType) return;
      // Set reason so LoginPage shows the correct toast after redirect
      dispatch(setSessionEndReason('SESSION_REVOKED'));
      dispatch(logout());
      disconnectSocket();
      navigate('/login', { replace: true });
    };
    onSocketEvent('session:revoked', handleSessionRevoked);
    return () => { offSocketEvent('session:revoked', handleSessionRevoked); };
  }, [dispatch, navigate]);

  const location = useLocation();
  const isAdminOrHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const aiContext = location.pathname.startsWith('/recruitment') ? 'hr-recruitment' as const
    : location.pathname.startsWith('/settings') ? 'admin' as const
    : 'hr-general' as const;
  const aiLabel = aiContext === 'hr-recruitment' ? t('appShell.hrRecruitmentAssistant')
    : aiContext === 'admin' ? t('appShell.adminAssistant') : t('appShell.hrAssistant');

  const exitAccess = user?.exitAccess;

  return (
    <div className="flex h-[100dvh] bg-surface-1 overflow-hidden">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main area — min-h-0 lets the flex column shrink below content height,
          enabling the <main> scroll container to work correctly */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <Topbar />
        {/* pb-[calc(5rem+env(safe-area-inset-bottom,0px))]: accounts for 64px mobile nav + iOS safe area */}
        <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          {/* Pull-to-refresh indicator — mobile only */}
          {(ptrProgress > 0 || ptrRefreshing) && (
            <div className="md:hidden fixed top-16 left-1/2 -translate-x-1/2 z-[200] pointer-events-none transition-all duration-200">
              <div
                className="w-10 h-10 rounded-full bg-white shadow-lg border border-gray-100 flex items-center justify-center"
                style={{
                  transform: `scale(${ptrRefreshing ? 1 : 0.4 + (ptrProgress / 100) * 0.6})`,
                  opacity: ptrRefreshing ? 1 : Math.max(ptrProgress / 100, 0.3),
                }}
              >
                <RefreshCw
                  size={18}
                  className={`text-brand-600 ${ptrRefreshing ? 'animate-spin' : ''}`}
                  style={{ transform: `rotate(${ptrProgress * 3.6}deg)` }}
                />
              </div>
            </div>
          )}
          {/* Offline banner */}
          <AnimatePresence>
            {!isOnline && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-2">
                  <WifiOff size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-700 font-medium">{t('appShell.offline')}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Limited access banner for exiting employees */}
          {exitAccess && (
            <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 flex-shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <p className="text-xs text-amber-700">{t('appShell.limitedAccess')}</p>
            </div>
          )}
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <MobileBottomNav />

      {/* Activity check-in prompts for hybrid employees */}
      <ActivityCheckInPrompt />

      {/* AI Assistant FAB — visible to Admin/HR */}
      {isAdminOrHR && <AiAssistantFab context={aiContext} label={aiLabel} />}

      {/* Inactivity timeout warning modal */}
      {showTimeoutWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="timeout-title">
          <div className="layer-card mx-4 w-full max-w-sm rounded-2xl p-6 shadow-xl">
            <h2 id="timeout-title" className="font-sora text-lg font-semibold text-gray-900">{t('appShell.sessionExpiring')}</h2>
            <p className="mt-2 text-sm text-gray-600">
              {t('appShell.sessionExpiryMessage')}
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowTimeoutWarning(false);
                  resetTimer();
                }}
                className="btn-primary px-5 py-2 text-sm"
              >
                {t('appShell.stayLoggedIn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
