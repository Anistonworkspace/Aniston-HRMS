import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { scheduleShiftReminder, cancelShiftReminder } from '../../lib/capacitorShiftReminder';
import {
  Clock, LogIn, LogOut, MapPin, FileText,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Users, Search, Filter, UserCheck, UserX, UserMinus, Eye, Monitor,
  Shield, Bell, RefreshCw, Flag, AlertTriangle, Download, X, Loader2,
  Briefcase, ChevronDown, ChevronUp, Navigation,
} from 'lucide-react';
import {
  useGetTodayStatusQuery,
  useClockInMutation,
  useClockOutMutation,
  useStartBreakMutation,
  useEndBreakMutation,
  useGetMyAttendanceQuery,
  useGetAllAttendanceQuery,
  useSubmitRegularizationMutation,
  useGetMyShiftHistoryQuery,
  useGetGPSConsentStatusQuery,
} from './attendanceApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';
import FieldSalesView from './FieldSalesView';
import { startNativeGpsService, stopNativeGpsService, isNativeAndroid, getCurrentPosition } from '../../lib/capacitorGPS';
import CommandCenter from './components/CommandCenter';
import RegularizationTab from './components/RegularizationTab';
import SelfServiceReport from './components/SelfServiceReport';
import GpsDiagnosticsPanel from './components/GpsDiagnosticsPanel';
import { CompOffTab } from './components/CompOffTab';
import { enqueueAction } from '../../lib/offlineQueue';
import { useAuthDownload } from '../../hooks/useAuthDownload';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';
import ShiftChangeRequestPanel from './components/ShiftChangeRequestPanel';
import HomeLocationRequestPanel from './components/HomeLocationRequestPanel';

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-500',
  ABSENT: 'bg-red-400',
  HALF_DAY: 'bg-amber-400',
  HOLIDAY: 'bg-blue-400',
  WEEKEND: 'bg-gray-300',
  ON_LEAVE: 'bg-purple-400',
  WORK_FROM_HOME: 'bg-teal-400',
  NOT_CHECKED_IN: 'bg-gray-300',
};

export default function AttendancePage() {
  const { t } = useTranslation();
  const user = useAppSelector((state) => state.auth.user);
  const role = user?.role || '';
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(role);
  const isSystemRole = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(role);
  // HR role employee (real person with employeeId) on mobile sees their own attendance.
  // System HR account (no employeeId) and desktop always see the HR management view.
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isHRRoleEmployee = role === 'HR' && !!user?.employeeId && isMobile;
  const canViewPersonal = isHRRoleEmployee || (!isSystemRole && ['MANAGER', 'EMPLOYEE', 'INTERN'].includes(role));
  const [view, setView] = useState<'team' | 'personal'>(
    isHRRoleEmployee ? 'personal' : (isManagement ? 'team' : 'personal')
  );

  // Non-management roles go straight to personal view
  if (!isManagement) return <AttendancePersonalView />;

  // HR role employee on mobile → personal attendance only
  if (isHRRoleEmployee) return <AttendancePersonalView />;

  // System roles (SuperAdmin, Admin, HR system account, HR on desktop): team + regularizations tabs
  if (isSystemRole) return <AttendanceHRView />;

  return (
    <>
      <div className="px-4 sm:px-6 pt-5 pb-1 flex flex-wrap gap-2">
        <button onClick={() => setView('team')}
          style={view === 'team' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === 'team' ? 'shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>{t('attendance.teamAttendance')}</button>
        {canViewPersonal && (
          <button onClick={() => setView('personal')}
            style={view === 'personal' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'personal' ? 'shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{t('attendance.myAttendance')}</button>
        )}
      </div>
      {view === 'team' ? <CommandCenter /> : <AttendancePersonalView />}
    </>
  );
}

/* =============================================================================
   HR / ADMIN ATTENDANCE VIEW — Attendance + Regularizations tabs
   ============================================================================= */

function AttendanceHRView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'attendance' | 'regularizations'>('attendance');

  return (
    <>
      <div className="px-4 sm:px-6 pt-5 pb-1 flex flex-wrap gap-2">
        <button
          onClick={() => setTab('attendance')}
          style={tab === 'attendance' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'attendance' ? 'shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {t('attendance.teamAttendance')}
        </button>
        <button
          onClick={() => setTab('regularizations')}
          style={tab === 'regularizations' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'regularizations' ? 'shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Regularizations
        </button>
      </div>
      {tab === 'attendance' ? <CommandCenter /> : <RegularizationTab />}
    </>
  );
}


   EXPORT BUTTON — uses authenticated fetch instead of window.open
   ============================================================================= */

function ExportButton({ selectedDate }: { selectedDate: string }) {
  const { t } = useTranslation();
  const { download, downloading } = useAuthDownload();
  const handleExport = () => {
    const date = new Date(selectedDate);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    download(`/attendance/export?month=${month}&year=${year}`, `attendance-${month}-${year}.xlsx`);
  };
  return (
    <button onClick={handleExport} disabled={!!downloading} className="btn-primary text-sm flex items-center gap-1.5">
      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {t('common.exportExcel')}
    </button>
  );
}

/* =============================================================================
   PERSONAL VIEW (existing)
   ============================================================================= */

// ---------------------------------------------------------------------------
// Enterprise GPS accuracy state — shown to employee before they can mark
// ---------------------------------------------------------------------------
type GpsReadiness = 'acquiring' | 'poor' | 'fair' | 'good';

function gpsReadinessFrom(accuracy: number | null): GpsReadiness {
  if (accuracy === null) return 'acquiring';
  if (accuracy > 100) return 'poor';
  if (accuracy > 40)  return 'fair';
  return 'good';
}

function AttendancePersonalView() {
  const { perms } = useEmpPerms();
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const authUser = useAppSelector((state) => state.auth.user);
  const accessToken = useAppSelector((state) => state.auth.accessToken);
  const { data: consentRes } = useGetGPSConsentStatusQuery();
  const hasGpsConsent = consentRes?.data?.consented && consentRes?.data?.consentVersion === 'v1';
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [liveTime, setLiveTime] = useState(new Date());

  const [locationStatus, setLocationStatus] = useState<'checking' | 'granted' | 'denied' | 'prompt' | 'gps_off'>('checking');

  // Desktop users cannot mark attendance — only mobile app is allowed
  const isDesktop = !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const [notificationStatus, setNotificationStatus] = useState<'checking' | 'granted' | 'denied' | 'default'>('checking');
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [requestingNotification, setRequestingNotification] = useState(false);
  const [dismissedNotifBanner, setDismissedNotifBanner] = useState(false);

  // -------------------------------------------------------------------------
  // Enterprise GPS pre-warming
  // As soon as location permission is confirmed we start watchPosition so the
  // GPS chip is already locked by the time the employee taps Check In.
  // We continuously keep the *best* (most accurate) recent fix in a ref.
  // -------------------------------------------------------------------------
  const bestPosRef = useRef<GeolocationPosition | null>(null);
  const gpsWatchRef = useRef<number | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null); // metres

  useEffect(() => {
    if (locationStatus !== 'granted' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Always keep the freshest position; prefer higher accuracy (lower number)
        const prev = bestPosRef.current;
        if (!prev || pos.coords.accuracy < prev.coords.accuracy || (Date.now() - pos.timestamp) < 5000) {
          bestPosRef.current = pos;
        }
        setGpsAccuracy(pos.coords.accuracy);
      },
      (err) => {
        // Location became unavailable while app is open — invalidate the pre-warmed cache
        bestPosRef.current = null;
        setGpsAccuracy(null);
        if (err.code === 1) setLocationStatus('denied');
        else if (err.code === 2) setLocationStatus('gps_off'); // device GPS turned off
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    gpsWatchRef.current = watchId;

    return () => {
      navigator.geolocation.clearWatch(watchId);
      gpsWatchRef.current = null;
    };
  }, [locationStatus]);

  // Check location permission on mount with timeout fallback
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    // Fallback: if still 'checking' after 5s, assume 'prompt' so UI is never stuck
    timeoutId = setTimeout(() => {
      setLocationStatus(prev => prev === 'checking' ? 'prompt' : prev);
    }, 5000);

    // Detect Android WebView: Samsung Internet / MIUI browser / Android System WebView
    // These browsers either don't support Permissions API for geolocation, or return
    // wrong state. We skip the API and probe directly with getCurrentPosition instead.
    const isAndroidWebView = /Android/.test(navigator.userAgent) && (
      /wv\)/.test(navigator.userAgent) ||          // WebView flag in UA string
      /SamsungBrowser/.test(navigator.userAgent) || // Samsung Internet
      /MiuiBrowser/.test(navigator.userAgent)       // MIUI browser
    );

    if (!navigator.geolocation) {
      clearTimeout(timeoutId);
      setLocationStatus('denied');
      return () => clearTimeout(timeoutId);
    }

    if (isAndroidWebView || !navigator.permissions) {
      // Probe GPS directly — triggers native Android permission dialog if not yet granted
      clearTimeout(timeoutId);
      navigator.geolocation.getCurrentPosition(
        () => setLocationStatus('granted'),
        (err) => setLocationStatus(err.code === 1 ? 'denied' : 'prompt'),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    } else {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        clearTimeout(timeoutId);
        setLocationStatus(result.state as any);
        result.onchange = () => setLocationStatus(result.state as any);
      }).catch(() => {
        // Permissions API failed — fall back to direct probe (handles edge cases)
        clearTimeout(timeoutId);
        navigator.geolocation.getCurrentPosition(
          () => setLocationStatus('granted'),
          (err) => setLocationStatus(err.code === 1 ? 'denied' : 'prompt'),
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
        );
      });
    }
    return () => clearTimeout(timeoutId);
  }, []);

  // Check notification permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationStatus(Notification.permission as any);
    } else {
      setNotificationStatus('default');
    }
  }, []);

  const handleRequestLocation = () => {
    setRequestingLocation(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationStatus('granted');
        setRequestingLocation(false);
      },
      (err) => {
        // GeolocationPositionError.PERMISSION_DENIED = 1
        if (err.code === 1) {
          setLocationStatus('denied');
        }
        setRequestingLocation(false);
      },
      { timeout: 10000 }
    );
  };

  const handleRequestNotification = async () => {
    setRequestingNotification(true);
    try {
      const result = await Notification.requestPermission();
      setNotificationStatus(result as any);
    } catch {
      setNotificationStatus('default');
    }
    setRequestingNotification(false);
  };

  const { data: todayResponse, isLoading: statusLoading, refetch: refetchToday } = useGetTodayStatusQuery();
  const today = todayResponse?.data;

  // Schedule shift reminder 15 min before shift start (Android only, once per day, skip if already checked in)
  useEffect(() => {
    if (!today?.shift?.startTime || today?.isCheckedIn) return;
    const [h, m] = today.shift.startTime.split(':').map(Number);
    const now = new Date();
    const shiftStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (shiftStart.getTime() > now.getTime()) {
      scheduleShiftReminder(shiftStart.getTime(), today.shift.name || 'your shift').catch(() => {});
    }
  }, [today?.shift?.startTime, today?.isCheckedIn]);

  // Compute earliest checkout time from shift — updates every second via liveTime
  const checkoutGate = (() => {
    if (!today?.isCheckedIn || today?.isCheckedOut) return null;
    const shift = today?.shift;
    const nowIST = new Date(liveTime.getTime() + liveTime.getTimezoneOffset() * 60000 + 5.5 * 3600 * 1000);
    const nowMins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();

    let minMins: number;
    let label: string;
    if (shift?.endTime) {
      const [h, m] = shift.endTime.split(':').map(Number);
      minMins = h * 60 + m;
      const h12 = h % 12 || 12;
      label = `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    } else {
      minMins = 18 * 60 + 30; // 6:30 PM default
      label = '6:30 PM';
    }

    const canCheckOut = nowMins >= minMins;
    const minsLeft = minMins - nowMins;
    return { canCheckOut, label, minsLeft };
  })();

  // Build date strings directly from year/month to avoid UTC-offset shifting
  const _cmYear = currentMonth.getFullYear();
  const _cmMonth = currentMonth.getMonth();
  const _pad = (n: number) => String(n).padStart(2, '0');
  const startDate = `${_cmYear}-${_pad(_cmMonth + 1)}-01`;
  const endDate = `${_cmYear}-${_pad(_cmMonth + 1)}-${String(new Date(_cmYear, _cmMonth + 1, 0).getDate())}`;
  const { data: monthResponse, refetch: refetchMonth } = useGetMyAttendanceQuery({ startDate, endDate });
  const monthData = monthResponse?.data;

  // WebSocket: auto-refresh personal calendar + today status on attendance events
  const personalRefetchRef = useRef({ refetchToday, refetchMonth });
  personalRefetchRef.current = { refetchToday, refetchMonth };
  useEffect(() => {
    const handler = () => {
      personalRefetchRef.current.refetchToday();
      personalRefetchRef.current.refetchMonth();
    };
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:checkout', handler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:checkout', handler);
    };
  }, []);

  const [clockIn, { isLoading: clockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: clockingOut }] = useClockOutMutation();
  const [startBreak, { isLoading: startingBreak }] = useStartBreakMutation();
  const [endBreak, { isLoading: endingBreak }] = useEndBreakMutation();
  const [breakType, setBreakType] = useState<'LUNCH' | 'SHORT' | 'PRAYER' | 'CUSTOM'>('SHORT');
  const [gpsAcquiring, setGpsAcquiring] = useState(false);
  const [showBreakPicker, setShowBreakPicker] = useState(false);
  const [submitRegularization, { isLoading: submittingReg }] = useSubmitRegularizationMutation();

  const handleStartBreak = async (type: string) => {
    try {
      await startBreak({ type }).unwrap();
      toast.success(`${type === 'LUNCH' ? 'Lunch' : type === 'PRAYER' ? 'Prayer' : 'Short'} break started`);
      setShowBreakPicker(false);
      refetchToday();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to start break');
    }
  };

  const handleEndBreak = async () => {
    try {
      await endBreak().unwrap();
      toast.success('Break ended — back to work!');
      refetchToday();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to end break');
    }
  };

  const [showRegModal, setShowRegModal] = useState(false);
  const [regDate, setRegDate] = useState<string | null>(null); // null = today
  const [regReason, setRegReason] = useState('');

  const openRegModal = (dateStr?: string) => {
    setRegDate(dateStr || null);
    setRegReason('');
    setShowRegModal(true);
  };

  const regSubmitLockRef = useRef(false);
  const handleSubmitRegularization = async () => {
    if (regSubmitLockRef.current) return;
    if (regReason.trim().length < 10) { toast.error('Reason must be at least 10 characters.'); return; }
    regSubmitLockRef.current = true;
    try {
      const isToday = !regDate;
      const attendanceId = isToday ? today?.record?.id : undefined;
      const dateForRequest = regDate || new Date().toISOString().split('T')[0];
      await submitRegularization({
        ...(attendanceId ? { attendanceId } : { date: dateForRequest }),
        reason: regReason.trim(),
      }).unwrap();
      toast.success('Regularization request submitted. HR will review it shortly.');
      setShowRegModal(false);
      setRegDate(null);
      setRegReason('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit regularization request.');
    } finally {
      regSubmitLockRef.current = false;
    }
  };

  const actionLockRef = useRef(false); // debounce guard for clock-in/out
  const [shiftWarning, setShiftWarning] = useState<{ message: string; onConfirm: () => void; title?: string; confirmLabel?: string } | null>(null);

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  /**
   * GPS acquisition for attendance marking.
   * Always fetches a LIVE fix — no pre-warm cache used here.
   * Every check-in/out click triggers a real OS permission check.
   */
  // Returns null when location is unavailable/denied — callers must abort on null.
  // Uses watchPosition for up to 25 seconds to get the best GPS fix before proceeding.
  const getGPS = async (): Promise<{
    latitude: number; longitude: number; accuracy: number; gpsTimestamp: string;
  } | null> => {
    if (!navigator.geolocation) {
      toast.error('Location is not supported on this device.');
      return null;
    }

    const toPayload = (pos: GeolocationPosition) => ({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      gpsTimestamp: new Date(pos.timestamp).toISOString(),
    });

    setGpsAcquiring(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        let best: GeolocationPosition | null = null;
        let watchId: number;
        // Resolve with best fix after 25 seconds, or sooner if accuracy ≤ 50m
        const timer = setTimeout(() => {
          navigator.geolocation.clearWatch(watchId);
          if (best) resolve(best);
          else reject(new GeolocationPositionError());
        }, 25000);

        watchId = navigator.geolocation.watchPosition(
          (p) => {
            if (!best || p.coords.accuracy < best.coords.accuracy) {
              best = p;
            }
            // Accept immediately if accuracy is good enough (≤ 80m)
            if (p.coords.accuracy <= 80) {
              clearTimeout(timer);
              navigator.geolocation.clearWatch(watchId);
              resolve(p);
            }
          },
          (err) => {
            clearTimeout(timer);
            navigator.geolocation.clearWatch(watchId);
            reject(err);
          },
          { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
        );
      });
      bestPosRef.current = pos;
      setGpsAccuracy(pos.coords.accuracy);
      setLocationStatus('granted');
      return toPayload(pos);
    } catch (err: any) {
      if (err?.code === 1) {
        setLocationStatus('denied');
        toast.error('Location access denied. Please enable location to mark attendance.', { duration: 4000 });
      } else if (err?.code === 2) {
        setLocationStatus('gps_off');
        toast.error('Please turn on your device GPS/Location to mark attendance.', { duration: 4000 });
      } else if (err?.code === 3) {
        toast.error(t('attendance.locationTimeout'));
      } else {
        toast.error('Could not get your location. Please try again.');
      }
      return null;
    } finally {
      setGpsAcquiring(false);
    }
  };

  const doClockIn = async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    let coords: { latitude: number; longitude: number; accuracy: number; gpsTimestamp: string } | null = null;
    try {
      // FIELD shift on native Android: use Capacitor Geolocation plugin — faster lock,
      // avoids the 30s web geolocation timeout on cold GPS start.
      if (isFieldShift && isNativeAndroid) {
        try {
          const pos = await getCurrentPosition();
          coords = { latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy ?? 0, gpsTimestamp: new Date(pos.timestamp ?? Date.now()).toISOString() };
        } catch {
          coords = await getGPS(); // fallback to web geolocation if Capacitor fails
        }
      } else {
        coords = await getGPS();
      }
      if (coords === null) return;
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
      toast.success(t('attendance.checkedIn'));
      cancelShiftReminder().catch(() => {});
      // FIELD shift: start native background GPS service only when consent is already granted.
      // If consent is missing, FieldSalesView (rendered below) will show the consent modal
      // and start tracking after the employee accepts — no double-prompt needed here.
      if (isFieldShift && isNativeAndroid && hasGpsConsent) {
        const backendBase = (import.meta.env.VITE_API_URL || 'https://hr.anistonav.com/api').replace(/\/api$/, '');
        const intervalMins = (today?.shift as any)?.trackingIntervalMinutes;
        startNativeGpsService({
          backendUrl: backendBase,
          authToken: accessToken || '',
          employeeId: authUser?.employeeId || '',
          orgId: authUser?.organizationId || '',
          ...(intervalMins != null ? { trackingIntervalMinutes: intervalMins } : {}),
        }).catch((e: any) => console.warn('Native GPS service start failed:', e?.message));
      }
    } catch (err: any) {
      if (!navigator.onLine && coords) {
        const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        enqueueAction('CLOCK_IN', { ...coords, source: 'MANUAL_APP', deviceType });
        toast(t('attendance.checkinQueued'), { icon: '📡' });
        return;
      }
      toast.error(err?.data?.error?.message || t('attendance.failedClockIn'));
    } finally {
      setTimeout(() => { actionLockRef.current = false; }, 2000);
    }
  };

  const handleClockIn = () => {
    // Shift boundary guard — frontend UX warning only (backend enforces separately)
    if (today?.shift) {
      const now = new Date();
      const [startH, startM] = today.shift.startTime.split(':').map(Number);
      const [endH, endM] = today.shift.endTime.split(':').map(Number);
      const shiftStartMins = startH * 60 + startM;
      const shiftEndMins = endH * 60 + endM;
      const nowMins = now.getHours() * 60 + now.getMinutes();

      const tooEarly = nowMins < shiftStartMins - 30;
      const tooLate = nowMins > shiftStartMins + 120;
      const pastEnd = nowMins > shiftEndMins;

      if (tooEarly || tooLate || pastEnd) {
        setShiftWarning({
          message: `You are clocking in outside your scheduled shift time (Shift: ${today.shift.startTime} – ${today.shift.endTime}). Do you want to continue?`,
          onConfirm: () => { setShiftWarning(null); doClockIn(); },
        });
        return;
      }
    }
    doClockIn();
  };

  const doClockOut = async (coords: { latitude: number; longitude: number; accuracy: number; gpsTimestamp: string }, earlyCheckoutConfirmed?: boolean) => {
    const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    try {
      await clockOut({ ...(coords ?? {}), deviceType, ...(earlyCheckoutConfirmed ? { earlyCheckoutConfirmed: true } : {}) }).unwrap();
      toast.success(t('attendance.checkedOut'));
      if (isFieldShift && isNativeAndroid) {
        stopNativeGpsService().catch((e: any) => console.warn('Native GPS service stop failed:', e?.message));
      }
    } catch (err: any) {
      if (!navigator.onLine) {
        enqueueAction('CLOCK_OUT', { ...coords, deviceType });
        toast(t('attendance.checkoutQueued'), { icon: '📡' });
        return;
      }
      const errorData = err?.data?.error;
      const msg: string = errorData?.message || t('attendance.failedClockOut');
      // EARLY_CHECKOUT: structured code or legacy prefix signals the server is asking for confirmation, not hard-blocking
      if (errorData?.code === 'EARLY_CHECKOUT_CONFIRMATION_REQUIRED' || msg.startsWith('EARLY_CHECKOUT:')) {
        const displayMsg = msg.startsWith('EARLY_CHECKOUT:') ? msg.replace('EARLY_CHECKOUT:', '').trim() : msg;
        setShiftWarning({
          title: 'Early Check-Out',
          message: displayMsg,
          confirmLabel: 'Check Out Anyway',
          onConfirm: () => { setShiftWarning(null); doClockOut(coords, true); },
        });
      } else {
        toast.error(msg);
      }
    }
  };

  const handleClockOut = async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    let coords: { latitude: number; longitude: number; accuracy: number; gpsTimestamp: string } | null = null;
    try {
      if (isFieldShift) {
        if (isNativeAndroid) {
          try {
            const pos = await getCurrentPosition();
            coords = { latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy ?? 0, gpsTimestamp: new Date(pos.timestamp ?? Date.now()).toISOString() };
          } catch {
            coords = await getGPS();
          }
        } else {
          coords = await getGPS();
        }
        if (coords === null) return;
      } else {
        coords = await getGPS();
        if (coords === null) return;
      }
      await doClockOut(coords);
    } catch {
      // GPS acquisition errors are handled inside getGPS()
    } finally {
      setTimeout(() => { actionLockRef.current = false; }, 2000);
    }
  };

  // Calculate elapsed time
  const getElapsedTime = () => {
    if (!today?.record?.checkIn) return '00:00:00';
    const start = new Date(today.record.checkIn);
    const diff = liveTime.getTime() - start.getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Build calendar grid
  const buildCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const recordMap = new Map<string, any>();
    monthData?.records?.forEach((r: any) => {
      const dateKey = new Date(r.date).toISOString().split('T')[0];
      recordMap.set(dateKey, r);
    });

    const holidayDates = new Set(
      monthData?.holidays?.map((h: any) => new Date(h.date).toISOString().split('T')[0]) || []
    );

    const days: Array<{ date: number; dateStr: string; status: string; isToday: boolean; record: any }> = [];

    for (let i = 0; i < firstDay; i++) {
      days.push({ date: 0, dateStr: '', status: '', isToday: false, record: null });
    }

    // IST-aware today string — prevents off-by-one when browser clock crosses UTC midnight before IST midnight
    const _tNow = new Date();
    const _tIst = new Date(_tNow.getTime() + _tNow.getTimezoneOffset() * 60000 + 5.5 * 3600000);
    const todayStr = `${_tIst.getUTCFullYear()}-${String(_tIst.getUTCMonth() + 1).padStart(2, '0')}-${String(_tIst.getUTCDate()).padStart(2, '0')}`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const record = recordMap.get(dateStr);
      const isHoliday = holidayDates.has(dateStr);

      let status = '';
      if (record) {
        status = record.status;
      } else if (isHoliday) {
        status = 'HOLIDAY';
      } else if ((today?.weekOffDays || [0]).includes(dayOfWeek)) {
        status = 'WEEKEND';
      } else if (new Date(dateStr) < new Date(todayStr)) {
        status = 'ABSENT';
      }

      days.push({
        date: d,
        dateStr,
        status,
        isToday: dateStr === todayStr,
        record,
      });
    }

    return days;
  };

  const calendarDays = buildCalendar();
  const monthName = currentMonth.toLocaleString(locale, { month: 'long', year: 'numeric' });
  const _now = new Date();
  const _ist = new Date(_now.getTime() + _now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const calTodayStr = `${_ist.getUTCFullYear()}-${String(_ist.getUTCMonth() + 1).padStart(2, '0')}-${String(_ist.getUTCDate()).padStart(2, '0')}`;

  // Detect work mode from today's status
  const workMode = today?.workMode || 'OFFICE';

  // True when the employee is assigned to a FIELD shift (GPS-based live tracking)
  // Also detect via workMode on the today record, in case shiftType is not set
  const isFieldShift = (today?.shift as any)?.shiftType === 'FIELD' || (today as any)?.workMode === 'FIELD_SALES';

  // Desktop users skip all location gates — they see status-only UI
  // Employee-level permission gate (canViewAttendanceHistory)
  if (!perms.canViewAttendanceHistory) return <PermDenied action="view attendance history" />;

  // BLOCKING: Location permission denied — cannot use attendance at all
  // FIELD shift employees: StartupPermissionGuard already requested permissions at install.
  // If denied, GpsTrackingService handles it internally — don't block the Field Sales UI.
  if (!isDesktop && !isFieldShift && locationStatus === 'denied') {
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Shield size={40} className="text-red-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">{t('attendance.locationRequired')}</h2>
            <p className="text-sm text-gray-500 mb-6">
              {t('attendance.locationDenied')}
            </p>
            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6">
              <p className="text-xs font-semibold text-gray-700 mb-2">{t('attendance.howToEnable')}</p>
              <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
                <li>{t('attendance.openBrowserSettings')}</li>
                <li>{t('attendance.goToSiteSettings')}</li>
                <li>{t('attendance.tapLocation')}</li>
                <li>{t('attendance.findSiteAllow')}</li>
              </ol>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} /> {t('common.refresh')}
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // BLOCKING: Device GPS/Location Services is off (browser permission granted, but hardware disabled)
  // FIELD shift employees: native GpsTrackingService manages GPS state — don't block their UI.
  if (!isDesktop && !isFieldShift && locationStatus === 'gps_off') {
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <MapPin size={40} className="text-amber-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">Turn On Device Location</h2>
            <p className="text-sm text-gray-500 mb-6">
              Your phone's GPS / Location Services is turned off. You must enable it to mark attendance.
            </p>
            <div className="bg-amber-50 rounded-xl p-4 text-left mb-6">
              <p className="text-xs font-semibold text-gray-700 mb-2">How to enable:</p>
              <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
                <li>Open your phone <strong>Settings</strong></li>
                <li>Go to <strong>Location</strong> (or Privacy → Location)</li>
                <li>Turn <strong>Location</strong> ON</li>
                <li>Return here and tap Refresh</li>
              </ol>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // BLOCKING: Location permission not yet asked — prompt user to grant (mobile only)
  // FIELD shift employees: StartupPermissionGuard handles this at app start — skip for them.
  if (!isDesktop && !isFieldShift && (locationStatus === 'prompt' || locationStatus === 'checking')) {
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Shield size={40} className="text-blue-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">{t('attendance.enableLocation')}</h2>
            <p className="text-sm text-gray-500 mb-6">
              {t('attendance.locationDenied')}
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleRequestLocation}
              disabled={requestingLocation}
              className="btn-primary w-full py-3.5 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {requestingLocation ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <MapPin size={16} />
              )}
              {t('attendance.enableLocation')}
            </motion.button>
          </motion.div>
        </div>
      </div>
    );
  }

  // Both location permission states handled — show attendance UI (notification is non-blocking)
  return (
    <div className="page-container">
      {/* Shift boundary warning dialog */}
      {shiftWarning && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-4 md:p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">{shiftWarning.title ?? 'Outside Shift Hours'}</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">{shiftWarning.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShiftWarning(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={shiftWarning.onConfirm}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold transition-colors"
              >
                {shiftWarning.confirmLabel ?? 'Clock In Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {notificationStatus === 'denied' && !dismissedNotifBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <p className="text-sm text-amber-700">{t('attendance.notificationsDisabled')}</p>
          <button onClick={() => setDismissedNotifBanner(true)} className="text-amber-500 hover:text-amber-700 ml-2" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      <h1 className="text-xl font-display font-bold text-gray-900 mb-3">{t('nav.attendance')}</h1>

      {/* Field Sales: Live Tracking View — shown for FIELD shift employees regardless of today's recorded workMode */}
      {(workMode === 'FIELD_SALES' || isFieldShift) && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="badge badge-info text-xs">Field Sales</span>
            <span className="badge badge-neutral text-xs">Live GPS Tracking</span>
          </div>
          <FieldSalesView todayStatus={today} />
        </div>
      )}

      {/* Office Mode (default) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: Clock-in widget */}
        <div className="md:col-span-1 space-y-3">
          {/* Time & Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 md:layer-card md:p-5 text-center"
          >
            {/* Live time */}
            <p className="text-2xl md:text-3xl font-mono font-bold text-gray-900 mb-0.5" data-mono>
              {liveTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}
            </p>
            <p className="text-xs text-gray-400 mb-4">{formatDate(new Date(), 'long')}</p>

            {/* Status badge */}
            {today?.isCheckedIn && !today?.isCheckedOut && (
              <div className="mb-3">
                <span className="badge badge-success text-sm px-3 py-1">
                  {today.isOnBreak ? '☕ On Break' : '✅ Checked In'}
                </span>
                <p className="text-2xl font-mono font-bold mt-2" style={{ color: 'var(--primary-color)' }} data-mono>
                  {getElapsedTime()}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Time elapsed</p>
              </div>
            )}

            {today?.isCheckedOut && (
              <div className="mb-3">
                <span className="badge badge-neutral text-sm px-3 py-1">{t('attendance.dayComplete')}</span>
                <p className="text-xl font-mono font-bold text-gray-600 mt-2" data-mono>
                  {Number(today.record?.totalHours || 0).toFixed(1)}h
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{t('attendance.totalHours')}</p>
              </div>
            )}

            {/* Holiday banner */}
            {(() => {
              const todayStr = new Date().toISOString().split('T')[0];
              const todayHoliday = monthData?.holidays?.find((h: any) => new Date(h.date).toISOString().split('T')[0] === todayStr);
              if (todayHoliday) {
                const nextWorkday = (() => {
                  const d = new Date();
                  for (let i = 1; i <= 7; i++) {
                    const next = new Date(d);
                    next.setDate(d.getDate() + i);
                    const key = next.toISOString().split('T')[0];
                    const isHoliday = monthData?.holidays?.some((h: any) => new Date(h.date).toISOString().split('T')[0] === key);
                    const weekOffs = new Set(today?.weekOffDays || [0]);
                    if (!weekOffs.has(next.getDay()) && !isHoliday) return next;
                  }
                  return null;
                })();
                return (
                  <div className="mb-3 p-2.5 bg-violet-50 rounded-xl border border-violet-200 text-center">
                    <p className="text-sm font-semibold text-violet-800">
                      Today is {todayHoliday.name} — Holiday
                    </p>
                    <p className="text-xs text-violet-500 mt-0.5">
                      Enjoy your day off!{nextWorkday && ` Next: ${nextWorkday.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}`}
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Shift info banner + grace period countdown */}
            {today?.shift && (() => {
              const shift = today.shift as any;
              const nowIST = new Date(liveTime.getTime() + liveTime.getTimezoneOffset() * 60000 + 5.5 * 3600 * 1000);
              const nowMins = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
              const [startH, startM] = (shift.startTime || '09:00').split(':').map(Number);
              const shiftStartMins = startH * 60 + startM;
              const graceMins: number = shift.graceMinutes ?? shift.lateGraceMinutes ?? 15;
              const minsToStart = shiftStartMins - nowMins;
              const minsLate = nowMins - shiftStartMins;
              const inGrace = minsLate > 0 && minsLate <= graceMins;
              const isLate = minsLate > graceMins;
              const beforeShift = minsToStart > 0 && minsToStart <= 60;
              return (
                <div className="mb-2 space-y-1">
                  <div className="p-2 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs font-medium text-blue-700">
                      Shift: {shift.name} ({shift.startTime} – {shift.endTime})
                    </p>
                  </div>
                  {!today.isCheckedIn && beforeShift && (
                    <div className="p-1.5 bg-indigo-50 rounded-lg border border-indigo-100 text-center">
                      <p className="text-[11px] font-medium text-indigo-700">
                        Shift starts in <span className="font-bold">{minsToStart}m</span>
                      </p>
                    </div>
                  )}
                  {!today.isCheckedIn && inGrace && (
                    <div className="p-1.5 bg-amber-50 rounded-lg border border-amber-200 text-center">
                      <p className="text-[11px] font-medium text-amber-700">
                        Grace period — <span className="font-bold">{graceMins - minsLate}m</span> left before Late
                      </p>
                    </div>
                  )}
                  {!today.isCheckedIn && isLate && (
                    <div className="p-1.5 bg-red-50 rounded-lg border border-red-200 text-center">
                      <p className="text-[11px] font-medium text-red-600">
                        Late by <span className="font-bold">{minsLate}m</span>
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
            {!today?.shift && today?.hasShift === false && (
              <div className="mb-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs font-medium text-amber-700">
                  No shift assigned — using default schedule
                </p>
              </div>
            )}

            {/* Desktop: no marking allowed — show app download prompt */}
            {isDesktop ? (
              (workMode === 'FIELD_SALES' || isFieldShift) ? (
                <div className="mt-2 p-3 bg-orange-50 rounded-xl border border-orange-200 text-left">
                  <p className="text-xs font-semibold text-orange-800 mb-1 flex items-center gap-1.5">
                    <MapPin size={11} /> Field GPS requires the mobile app
                  </p>
                  <p className="text-[11px] text-orange-700 leading-relaxed mb-2">
                    Continuous background GPS tracking for field shifts only works on the native Android or iOS app. Desktop cannot track your location while you're out in the field.
                  </p>
                  <div className="flex gap-2">
                    <a href="/download/android" className="flex-1 text-center text-[11px] font-semibold bg-orange-600 text-white py-1.5 rounded-lg hover:bg-orange-700 transition-colors">
                      Install on Android
                    </a>
                    <a href="/download/ios" className="flex-1 text-center text-[11px] font-semibold bg-gray-800 text-white py-1.5 rounded-lg hover:bg-gray-900 transition-colors">
                      Install on iPhone
                    </a>
                  </div>
                  <p className="text-[10px] text-orange-500 mt-2">
                    Desktop can view your attendance history and reports.
                  </p>
                </div>
              ) : (
                <div className="mt-2 p-3 bg-indigo-50 rounded-xl border border-indigo-100 text-left">
                  <p className="text-xs font-semibold text-indigo-800 mb-1 flex items-center gap-1">
                    <MapPin size={11} /> Mark attendance on the app
                  </p>
                  <p className="text-[11px] text-indigo-600 leading-relaxed mb-2">
                    Check-in and check-out is only available on the Aniston HRMS mobile app.
                  </p>
                  <div className="flex gap-2">
                    <a href="/download/android" className="flex-1 text-center text-[11px] font-semibold bg-indigo-600 text-white py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                      Install on Android
                    </a>
                    <a href="/download/ios" className="flex-1 text-center text-[11px] font-semibold bg-gray-800 text-white py-1.5 rounded-lg hover:bg-gray-900 transition-colors">
                      Install on iPhone
                    </a>
                  </div>
                </div>
              )
            ) : (
              <>
                {/* GPS readiness badge — only for OFFICE shifts (geofence required).
                    FIELD shift employees can check in from anywhere, no radius to show. */}
                {!isFieldShift && (() => {
                  const readiness = gpsReadinessFrom(gpsAccuracy);
                  const badge: Record<GpsReadiness, { dot: string; label: string; text: string }> = {
                    acquiring: { dot: 'bg-gray-400 animate-pulse', label: 'Acquiring GPS…',   text: 'text-gray-500' },
                    poor:      { dot: 'bg-red-400 animate-pulse',  label: `GPS weak ±${Math.round(gpsAccuracy ?? 999)}m`, text: 'text-red-500' },
                    fair:      { dot: 'bg-amber-400',              label: `GPS fair ±${Math.round(gpsAccuracy!)}m`,       text: 'text-amber-600' },
                    good:      { dot: 'bg-emerald-500',            label: `GPS ready ±${Math.round(gpsAccuracy!)}m`,      text: 'text-emerald-600' },
                  };
                  const b = badge[readiness];
                  return (
                    <div className={`flex items-center justify-center gap-1.5 text-xs font-medium mb-3 ${b.text}`}>
                      <span className={`w-2 h-2 rounded-full ${b.dot}`} />
                      {b.label}
                    </div>
                  );
                })()}

                {/* For FIELD shift: show a small "live tracking" indicator above buttons */}
                {isFieldShift && (
                  <div className="flex items-center justify-center gap-1.5 text-xs font-medium mb-3 text-orange-500">
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                    Live GPS Tracking shift
                  </div>
                )}

                {/* Permission gate */}
                {!perms.canMarkAttendance && (
                  <PermDenied action="mark attendance" inline />
                )}

                {/* Check In button — same for all shift types */}
                {perms.canMarkAttendance && !today?.isCheckedIn && !today?.isCheckedOut && workMode !== 'FIELD_SALES' && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleClockIn}
                    disabled={clockingIn || gpsAcquiring || statusLoading || (!isDesktop && locationStatus !== 'granted')}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 md:py-4 rounded-xl font-semibold text-sm md:text-lg flex items-center justify-center gap-2 md:gap-3 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-200"
                  >
                    {clockingIn || gpsAcquiring ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <LogIn size={22} />
                    )}
                    {gpsAcquiring ? 'Locating...' : t('attendance.checkIn')}
                  </motion.button>
                )}

                {/* Break + Check Out block — same for all shift types */}
                {perms.canMarkAttendance && today?.isCheckedIn && !today?.isCheckedOut && workMode !== 'FIELD_SALES' && (
                  <div className="space-y-1.5">
                    {/* Break controls */}
                    {today?.isOnBreak ? (
                      <div className="space-y-1.5">
                        <div className="px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-center">
                          <p className="text-[11px] text-amber-700 font-medium">
                            ☕ On break
                            {today.activeBreak?.startTime && (
                              <span className="font-normal ml-1">
                                since {new Date(today.activeBreak.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                              </span>
                            )}
                            {today.activeBreak?.type && (
                              <span className="ml-1 text-amber-500">· {today.activeBreak.type.charAt(0) + today.activeBreak.type.slice(1).toLowerCase()}</span>
                            )}
                          </p>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleEndBreak}
                          disabled={endingBreak}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-white py-2 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                          {endingBreak ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Clock size={15} />}
                          {t('attendance.endBreak')}
                        </motion.button>
                      </div>
                    ) : (
                      <div>
                        {showBreakPicker ? (
                          <div className="border border-gray-200 rounded-xl p-2 space-y-1.5 bg-gray-50">
                            <p className="text-[10px] font-semibold text-gray-500 text-center mb-1">Select break type</p>
                            {(['SHORT', 'LUNCH', 'PRAYER', 'CUSTOM'] as const).map((bt) => (
                              <button
                                key={bt}
                                onClick={() => handleStartBreak(bt)}
                                disabled={startingBreak}
                                className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-amber-50 hover:text-amber-700 text-xs font-medium text-gray-600 transition-colors disabled:opacity-50"
                              >
                                {bt === 'SHORT' ? '☕ Short Break' : bt === 'LUNCH' ? '🍽 Lunch Break' : bt === 'PRAYER' ? '🕌 Prayer Break' : '⏸ Custom Break'}
                              </button>
                            ))}
                            <button
                              onClick={() => setShowBreakPicker(false)}
                              className="w-full text-center text-[10px] text-gray-400 hover:text-gray-600 py-1"
                            >Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowBreakPicker(true)}
                            className="w-full py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Clock size={13} /> {t('attendance.startBreak')}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Earliest checkout info — shown when shift hasn't ended yet */}
                    {checkoutGate && !checkoutGate.canCheckOut && (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                        <Clock size={12} className="text-amber-600 shrink-0" />
                        <p className="text-[11px] text-amber-700 font-medium">
                          Check-out available from <span className="font-bold">{checkoutGate.label}</span>
                          {checkoutGate.minsLeft > 0 && (
                            <span className="text-amber-500 font-normal ml-1">
                              ({checkoutGate.minsLeft >= 60
                                ? `${Math.floor(checkoutGate.minsLeft / 60)}h ${checkoutGate.minsLeft % 60}m left`
                                : `${checkoutGate.minsLeft}m left`})
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                    <motion.button
                      whileHover={{ scale: checkoutGate?.canCheckOut !== false ? 1.02 : 1 }}
                      whileTap={{ scale: checkoutGate?.canCheckOut !== false ? 0.98 : 1 }}
                      onClick={handleClockOut}
                      disabled={clockingOut || gpsAcquiring || checkoutGate?.canCheckOut === false || today?.isOnBreak}
                      className="w-full bg-red-500 hover:bg-red-400 text-white py-2.5 md:py-3.5 rounded-xl font-semibold text-sm md:text-base flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {clockingOut || gpsAcquiring ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <LogOut size={20} />
                      )}
                      {today?.isOnBreak ? 'End break first' : gpsAcquiring ? 'Locating...' : t('attendance.checkOut')}
                    </motion.button>
                  </div>
                )}

                {/* Checked out — prompt for regularization */}
                {perms.canMarkAttendance && today?.isCheckedOut && (
                  <button
                    onClick={() => openRegModal()}
                    className="mt-3 w-full p-3 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-200 text-center transition-colors"
                  >
                    <p className="text-xs text-amber-700 font-semibold flex items-center justify-center gap-1.5">
                      <FileText size={13} />
                      Tap to apply for Regularization
                    </p>
                  </button>
                )}

                {/* Not checked in at all — allow regularization for missed attendance (no record = full absent) */}
                {perms.canMarkAttendance && !today?.isCheckedIn && !today?.isCheckedOut && (
                  <button
                    onClick={() => openRegModal()}
                    className="mt-3 w-full p-3 bg-orange-50 hover:bg-orange-100 rounded-xl border border-orange-200 text-center transition-colors"
                  >
                    <p className="text-xs text-orange-700 font-semibold flex items-center justify-center gap-1.5">
                      <FileText size={13} />
                      Missed Check-In? Apply for Regularization
                    </p>
                  </button>
                )}
              </>
            )}

            {/* Work mode indicator */}
            {today?.workMode && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                <MapPin size={12} />
                {today.workMode.replace(/_/g, ' ')}
              </div>
            )}

            {/* WFH option for hybrid/WFH-enabled shifts — only before clock-in */}
            {!today?.isCheckedIn && !today?.isCheckedOut && (today?.shift as any)?.allowWfh && (
              <div className="mt-2 p-2 bg-teal-50 border border-teal-200 rounded-lg text-center">
                <p className="text-[10px] text-teal-600 font-medium mb-1">Your shift allows WFH today</p>
                <a
                  href={`/leaves/new?type=WFH`}
                  className="text-[10px] font-semibold text-teal-700 underline hover:text-teal-900"
                >
                  Submit WFH request →
                </a>
              </div>
            )}

            {/* Geofence violation warning */}
            {today?.geofenceViolation && (
              <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
                <p className="text-xs font-medium text-red-600 flex items-center gap-1">
                  <Shield size={12} /> {t('attendance.outsideGeofence')}
                </p>
              </div>
            )}
          </motion.div>

        </div>

        {/* Right: Calendar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="md:col-span-2 layer-card p-4"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-semibold text-gray-800 flex items-center gap-1.5">
              <CalendarIcon size={14} style={{ color: 'var(--primary-color)' }} />
              {monthName}
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                aria-label={t('common.previousPage')}
                className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="text-xs px-2.5 py-1 rounded-lg transition-colors font-medium" style={{ color: 'var(--primary-color)' }}
              >
                Today
              </button>
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                aria-label={t('common.nextPage')}
                className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0.5 mb-0.5">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <div key={i} className="text-center text-[10px] font-semibold text-gray-400 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {calendarDays.map((day, idx) => {
              const canRegularize = day.date > 0
                && day.dateStr < calTodayStr
                && day.status !== 'WEEKEND'
                && day.status !== 'HOLIDAY';
              return (
                <div
                  key={idx}
                  style={day.isToday ? { '--tw-ring-color': 'var(--primary-color)' } as React.CSSProperties : undefined}
                  className={cn(
                    'rounded-md p-1 flex flex-col items-center justify-center transition-colors relative group',
                    'min-h-[36px]',
                    day.date === 0 && 'invisible',
                    day.isToday && 'ring-2 ring-offset-1',
                    day.status === 'PRESENT' && 'bg-emerald-50',
                    day.status === 'ABSENT' && 'bg-red-50',
                    day.status === 'HALF_DAY' && 'bg-amber-50',
                    day.status === 'HOLIDAY' && 'bg-blue-50',
                    day.status === 'WEEKEND' && 'bg-gray-50',
                    day.status === 'ON_LEAVE' && 'bg-purple-50',
                    day.status === 'WORK_FROM_HOME' && 'bg-teal-50',
                    !day.status && day.date > 0 && 'bg-white',
                  )}
                >
                  <span
                    style={day.isToday ? { color: 'var(--primary-color)' } : undefined}
                    className={cn(
                    'text-xs font-medium leading-none',
                    day.isToday ? '' : 'text-gray-700',
                    day.status === 'WEEKEND' && 'text-gray-400',
                  )}>
                    {day.date > 0 ? day.date : ''}
                  </span>
                  {day.status && day.date > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      <div className={cn('w-1 h-1 rounded-full', STATUS_COLORS[day.status])} />
                      {day.record?.geofenceViolation && (
                        <Flag size={6} className="text-red-500" aria-label="Outside geofence" />
                      )}
                    </div>
                  )}
                  {day.record?.totalHours && (
                    <span className="text-[8px] font-mono text-gray-400 leading-none mt-0.5 hidden sm:block" data-mono>
                      {Number(day.record.totalHours).toFixed(1)}h
                    </span>
                  )}
                  {/* Per-day Regularize button — shown on hover for past eligible days */}
                  {canRegularize && (
                    <button
                      onClick={() => openRegModal(day.dateStr)}
                      title={`Regularize ${day.dateStr}`}
                      className="absolute inset-0 w-full h-full flex items-end justify-center pb-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <span className="text-[7px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 leading-tight">
                        Reg
                      </span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
            {[
              { labelKey: 'attendance.present', color: 'bg-emerald-500' },
              { labelKey: 'attendance.absent', color: 'bg-red-400' },
              { labelKey: 'attendance.halfDay', color: 'bg-amber-400' },
              { labelKey: 'attendance.holiday', color: 'bg-blue-400' },
              { labelKey: 'attendance.weekend', color: 'bg-gray-300' },
              { labelKey: 'attendance.onLeave', color: 'bg-purple-400' },
              { labelKey: 'attendance.wfh', color: 'bg-teal-400' },
            ].map((item) => (
              <div key={item.labelKey} className="flex items-center gap-1">
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', item.color)} />
                <span className="text-[10px] text-gray-500">{t(item.labelKey)}</span>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <Flag size={8} className="text-red-500 flex-shrink-0" />
              <span className="text-[10px] text-gray-500">{t('attendance.outsideGeofence')}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* My Report Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="md:layer-card md:p-4 mt-4"
      >
        <SelfServiceReport />
      </motion.div>

      {/* My Shifts History */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="mt-4"
      >
        <MyShiftsSection />
      </motion.div>

      {/* Home Location Request Panel (WFH employees) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-4">
        <HomeLocationRequestPanel />
      </motion.div>

      {/* Shift Change Request Panel */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mt-4">
        <ShiftChangeRequestPanel />
      </motion.div>

      {/* GPS Diagnostics — Android only, collapsed by default */}
      <GpsDiagnosticsPanel />

      {/* Regularization Modal */}
      {showRegModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText size={18} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-display font-bold text-gray-900">Regularization Request</h3>
                  <p className="text-xs text-gray-500">Attendance correction · goes to HR for approval</p>
                </div>
              </div>
              <button
                onClick={() => { setShowRegModal(false); setRegDate(null); setRegReason(''); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Info row */}
              <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
                {regDate
                  ? <>For <strong>{new Date(regDate + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>. Submit a regularization request — HR will review and approve it.</>
                  : <>{today?.isCheckedOut ? 'You have already checked in and checked out today. Re-marking is not allowed.' : 'You missed check-in today. Re-marking is not allowed.'}{' '}Submit a regularization request — HR will review and approve it.</>
                }
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={regReason}
                  onChange={(e) => setRegReason(e.target.value)}
                  placeholder="Explain why you need to correct your attendance (min. 10 characters)…"
                  className="input-glass w-full text-sm resize-none"
                />
                {regReason.length > 0 && regReason.length < 10 && (
                  <p className="text-xs text-red-500 mt-1">{10 - regReason.length} more characters needed</p>
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => { setShowRegModal(false); setRegDate(null); setRegReason(''); }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitRegularization}
                disabled={submittingReg || regReason.trim().length < 10}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {submittingReg ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <FileText size={15} />
                )}
                Submit to HR
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   MY SHIFTS HISTORY SECTION
   ============================================================================= */
function MyShiftsSection() {
  const [expanded, setExpanded] = useState(true);
  const { data, isLoading } = useGetMyShiftHistoryQuery();
  const shifts: any[] = data?.data || [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const shiftTypeColors: Record<string, string> = {
    OFFICE: 'bg-blue-100 text-blue-700',
    FIELD: 'bg-orange-100 text-orange-700',
    HYBRID: 'bg-purple-100 text-purple-700',
    PROJECT_SITE: 'bg-emerald-100 text-emerald-700',
  };

  const getStatus = (a: any): { label: string; color: string } => {
    const start = new Date(a.startDate);
    const end = a.endDate ? new Date(a.endDate) : null;
    if (start > today) return { label: 'Upcoming', color: 'text-indigo-600 bg-indigo-50' };
    if (!end || end >= today) return { label: 'Active', color: 'text-emerald-600 bg-emerald-50' };
    return { label: 'Past', color: 'text-gray-400 bg-gray-50' };
  };

  return (
    <div className="layer-card p-4">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-sm font-display font-semibold text-gray-800 flex items-center gap-2">
          <Briefcase size={14} style={{ color: 'var(--primary-color)' }} />
          My Shifts
        </h3>
        {expanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-3">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--primary-color)', borderTopColor: 'transparent' }} />
            </div>
          ) : shifts.length === 0 ? (
            <div className="text-center py-6">
              <Navigation size={24} className="mx-auto text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">No shift assignments found</p>
              <p className="text-xs text-gray-300 mt-1">Contact HR to assign a shift.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {shifts.map((a: any) => {
                const status = getStatus(a);
                const shift = a.shift;
                return (
                  <div
                    key={a.id}
                    className="border border-gray-100 rounded-xl p-3 hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-sm font-semibold text-gray-800 truncate">{shift?.name || '—'}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${shiftTypeColors[shift?.shiftType] || 'bg-gray-100 text-gray-500'}`}>
                            {shift?.shiftType || '—'}
                          </span>
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${status.color}`}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 font-mono" data-mono>
                          {shift?.startTime} – {shift?.endTime}
                          {shift?.graceMinutes != null && (
                            <span className="text-gray-400 ml-1.5">· {shift.graceMinutes}m grace</span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          From {new Date(a.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {a.endDate && ` → ${new Date(a.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                          {!a.endDate && <span className="text-emerald-500"> (ongoing)</span>}
                        </p>
                        {a.location?.name && (
                          <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                            <MapPin size={9} /> {a.location.name}
                          </p>
                        )}
                        {shift?.shiftType === 'FIELD' && shift?.trackingIntervalMinutes && (
                          <p className="text-[10px] text-orange-500 mt-0.5">
                            GPS interval: every {shift.trackingIntervalMinutes >= 60 ? `${shift.trackingIntervalMinutes / 60}h` : `${shift.trackingIntervalMinutes}m`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

