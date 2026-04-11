import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import {
  Clock, LogIn, LogOut, Coffee, Play, Square, MapPin,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Users, Search, Filter, UserCheck, UserX, UserMinus, Eye, Monitor,
  Shield, Bell, RefreshCw, Flag, AlertTriangle, Download, X, Loader2,
} from 'lucide-react';
import {
  useGetTodayStatusQuery,
  useClockInMutation,
  useClockOutMutation,
  useStartBreakMutation,
  useEndBreakMutation,
  useGetMyAttendanceQuery,
  useGetAllAttendanceQuery,
} from './attendanceApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';
import FieldSalesView from './FieldSalesView';
import ProjectSiteView from './ProjectSiteView';
import CommandCenter from './components/CommandCenter';
import SelfServiceReport from './components/SelfServiceReport';
import { enqueueAction } from '../../lib/offlineQueue';
import { useAuthDownload } from '../../hooks/useAuthDownload';

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
  // System/admin roles (SUPER_ADMIN, ADMIN, HR) are administrative accounts — no personal attendance.
  // Only MANAGER and regular employees can view their own attendance.
  const isSystemRole = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(role);
  const canViewPersonal = !isSystemRole && ['MANAGER', 'EMPLOYEE', 'INTERN'].includes(role);
  const [view, setView] = useState<'team' | 'personal'>(isManagement ? 'team' : 'personal');

  // Non-management roles go straight to personal view
  if (!isManagement) return <AttendancePersonalView />;

  // System roles (SuperAdmin, Admin, HR): show only team view, no toggle
  if (isSystemRole) return <CommandCenter />;

  return (
    <>
      <div className="px-6 pt-5 pb-1 flex gap-2">
        <button onClick={() => setView('team')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === 'team' ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>{t('attendance.teamAttendance')}</button>
        {canViewPersonal && (
          <button onClick={() => setView('personal')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'personal' ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{t('attendance.myAttendance')}</button>
        )}
      </div>
      {view === 'team' ? <CommandCenter /> : <AttendancePersonalView />}
    </>
  );
}

/* =============================================================================
   MANAGEMENT VIEW
   ============================================================================= */

function AttendanceManagementView() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const { data: response, isLoading, refetch } = useGetAllAttendanceQuery({
    startDate: selectedDate,
    endDate: selectedDate,
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    page,
    limit: 25,
  });

  // WebSocket: auto-refresh — use ref to avoid listener re-registration on every refetch change
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:checkout', handler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:checkout', handler);
    };
  }, []);

  const records = response?.data?.data || response?.data || [];
  const meta = response?.data?.meta || response?.meta || {};
  const apiSummary = response?.data?.summary || (response as any)?.summary;

  // Use API summary (totalEmployees from DB) or compute from records
  const summary = useMemo(() => {
    const all = Array.isArray(records) ? records : [];
    const present = apiSummary?.present ?? all.filter((r: any) => r.status === 'PRESENT').length;
    const absent = apiSummary?.absent ?? all.filter((r: any) => r.status === 'ABSENT').length;
    const onLeave = apiSummary?.onLeave ?? all.filter((r: any) => r.status === 'ON_LEAVE').length;
    return {
      totalEmployees: apiSummary?.totalEmployees ?? all.length,
      present,
      absent,
      onLeave,
    };
  }, [records, apiSummary]);

  // Filter records by search query (employee name)
  const filteredRecords = useMemo(() => {
    const all = Array.isArray(records) ? records : [];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((r: any) => {
      const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
      const code = (r.employee?.employeeCode || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [records, searchQuery]);

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">{t('attendance.title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('attendance.subtitle')}</p>
        </div>
        <ExportButton selectedDate={selectedDate} />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{summary.totalEmployees}</p>
              <p className="text-xs text-gray-400">{t('attendance.totalEmployees')}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <UserCheck size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-emerald-600" data-mono>{summary.present}</p>
              <p className="text-xs text-gray-400">{t('attendance.present')}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <UserX size={20} className="text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-red-500" data-mono>{summary.absent}</p>
              <p className="text-xs text-gray-400">{t('attendance.absent')}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
              <UserMinus size={20} className="text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-purple-500" data-mono>{summary.onLeave}</p>
              <p className="text-xs text-gray-400">{t('attendance.onLeave')}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters Row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="layer-card p-4 mb-6"
      >
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Date picker */}
          <div className="flex items-center gap-2">
            <CalendarIcon size={16} className="text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); setPage(1); }}
              className="input-glass text-sm"
            />
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('common.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-glass w-full pl-9 text-sm"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="input-glass text-sm"
            >
              <option value="ALL">{t('attendance.allStatus')}</option>
              <option value="PRESENT">{t('attendance.present')}</option>
              <option value="ABSENT">{t('attendance.absent')}</option>
              <option value="HALF_DAY">{t('attendance.halfDay')}</option>
              <option value="ON_LEAVE">{t('attendance.onLeave')}</option>
              <option value="WORK_FROM_HOME">{t('attendance.wfh')}</option>
              <option value="NOT_CHECKED_IN">{t('attendance.notCheckedIn')}</option>
            </select>
          </div>
        </div>
      </motion.div>

      {/* Attendance Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="layer-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('common.employee')}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('attendance.checkIn')}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('attendance.checkOut')}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('attendance.totalHours')}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('attendance.workMode')}</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('attendance.activity')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="w-8 h-8 bg-gray-100 rounded-full animate-pulse" /><div className="space-y-1"><div className="w-24 h-3 bg-gray-100 rounded animate-pulse" /><div className="w-16 h-2 bg-gray-50 rounded animate-pulse" /></div></div></td>
                      <td className="px-5 py-3.5"><div className="w-12 h-3 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-5 py-3.5"><div className="w-12 h-3 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-5 py-3.5"><div className="w-10 h-3 bg-gray-100 rounded animate-pulse" /></td>
                      <td className="px-5 py-3.5"><div className="w-16 h-5 bg-gray-100 rounded-full animate-pulse" /></td>
                      <td className="px-5 py-3.5"><div className="w-14 h-3 bg-gray-50 rounded animate-pulse" /></td>
                      <td className="px-5 py-3.5"><div className="w-16 h-6 bg-gray-50 rounded-lg animate-pulse" /></td>
                    </tr>
                  ))}
                </>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <Users size={40} className="mx-auto text-gray-200 mb-3" />
                    <p className="text-sm text-gray-400">{t('attendance.noRecords')}</p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record: any, idx: number) => (
                  <tr
                    key={record.id || idx}
                    onClick={() => record.employeeId && navigate(`/attendance/employee/${record.employeeId}`)}
                    className="border-b border-gray-50 hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700">
                          {(record.employee?.firstName?.[0] || '') + (record.employee?.lastName?.[0] || '')}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {record.employee?.firstName} {record.employee?.lastName}
                          </p>
                          <p className="text-xs text-gray-400">{record.employee?.employeeCode || record.employee?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700" data-mono>
                        {formatTime(record.checkIn)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700" data-mono>
                        {formatTime(record.checkOut)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700" data-mono>
                        {record.totalHours ? `${Number(record.totalHours).toFixed(1)}h` : '--'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`badge ${getStatusColor(record.status)} text-xs`}>
                        {record.status?.replace(/_/g, ' ') || '--'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin size={12} />
                        {record.workMode?.replace(/_/g, ' ') || 'OFFICE'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); record.employeeId && navigate(`/attendance/employee/${record.employeeId}`); }}
                        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                        aria-label={t('attendance.viewActivity')}
                      >
                        <Monitor size={12} /> {t('attendance.activity')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Page {meta.page} of {meta.totalPages} ({meta.total} records)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label={t('common.previousPage')}
                className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= (meta.totalPages || 1)}
                aria-label={t('common.nextPage')}
                className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* =============================================================================
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
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [liveTime, setLiveTime] = useState(new Date());
  const { download: downloadReport, downloading: reportDownloading } = useAuthDownload();
  const [locationStatus, setLocationStatus] = useState<'checking' | 'granted' | 'denied' | 'prompt'>('checking');
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
      () => { /* silent — user already on permission-granted screen */ },
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

  const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString().split('T')[0];
  const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).toISOString().split('T')[0];
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
  const [startBreak] = useStartBreakMutation();
  const [endBreak] = useEndBreakMutation();
  const actionLockRef = useRef(false); // debounce guard for clock-in/out

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Enterprise-grade GPS acquisition.
   *
   * Strategy (mirrors Darwinbox / Keka):
   * 1. If pre-warmed position exists AND is < 30 s old AND accuracy < 50 m → use it instantly.
   * 2. Otherwise force a FRESH fix with maximumAge: 0 so the device MUST read the
   *    current GPS signal — no cached/stale positions are ever accepted.
   * 3. Always include gpsTimestamp so the backend can verify freshness server-side.
   */
  const getGPS = async (): Promise<{
    latitude?: number; longitude?: number; accuracy?: number; gpsTimestamp?: string;
  }> => {
    if (!navigator.geolocation) return {};

    const toPayload = (pos: GeolocationPosition) => ({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      gpsTimestamp: new Date(pos.timestamp).toISOString(),
    });

    // --- Stage 1: use pre-warmed position if it is fresh and precise enough ---
    const prewarm = bestPosRef.current;
    if (prewarm) {
      const ageMs = Date.now() - prewarm.timestamp;
      if (ageMs < 30_000 && prewarm.coords.accuracy < 50) {
        return toPayload(prewarm);
      }
    }

    // --- Stage 2: force a fresh GPS fix (maximumAge: 0 = NO cache allowed) ---
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 0,          // ← CRITICAL: never accept cached location
        })
      );
      // Update pre-warm ref with the fresh fix for the next action
      if (!bestPosRef.current || pos.coords.accuracy < bestPosRef.current.coords.accuracy) {
        bestPosRef.current = pos;
        setGpsAccuracy(pos.coords.accuracy);
      }
      return toPayload(pos);
    } catch (err: any) {
      if (err?.code === 1) toast.error(t('attendance.locationDenied'));
      else if (err?.code === 3) toast.error(t('attendance.locationTimeout'));
      return {};
    }
  };

  const handleClockIn = async () => {
    if (actionLockRef.current) return; // prevent double-tap
    actionLockRef.current = true;
    try {
      const coords = await getGPS();
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
      toast.success(t('attendance.checkedIn'));
    } catch (err: any) {
      if (!navigator.onLine) {
        const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        enqueueAction('CLOCK_IN', { source: 'MANUAL_APP', deviceType });
        toast(t('attendance.checkinQueued'), { icon: '📡' });
        return;
      }
      toast.error(err?.data?.error?.message || t('attendance.failedClockIn'));
    } finally {
      setTimeout(() => { actionLockRef.current = false; }, 2000); // 2s cooldown
    }
  };

  const handleClockOut = async () => {
    if (actionLockRef.current) return; // prevent double-tap
    actionLockRef.current = true;
    try {
      const coords = await getGPS();
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      await clockOut({ ...coords, deviceType }).unwrap();
      toast.success(t('attendance.checkedOut'));
    } catch (err: any) {
      if (!navigator.onLine) {
        const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        enqueueAction('CLOCK_OUT', { deviceType });
        toast(t('attendance.checkoutQueued'), { icon: '📡' });
        return;
      }
      toast.error(err?.data?.error?.message || t('attendance.failedClockOut'));
    } finally {
      setTimeout(() => { actionLockRef.current = false; }, 2000); // 2s cooldown
    }
  };

  const handleBreak = async () => {
    if (actionLockRef.current) return; // prevent double-tap
    actionLockRef.current = true;
    try {
      if (today?.isOnBreak) {
        await endBreak().unwrap();
        toast.success(t('attendance.breakEnded'));
      } else {
        await startBreak({ type: 'SHORT' }).unwrap();
        toast.success(t('attendance.breakStarted'));
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || t('common.failed'));
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

    const days: Array<{ date: number; status: string; isToday: boolean; record: any }> = [];

    for (let i = 0; i < firstDay; i++) {
      days.push({ date: 0, status: '', isToday: false, record: null });
    }

    const todayStr = new Date().toISOString().split('T')[0];

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
        status,
        isToday: dateStr === todayStr,
        record,
      });
    }

    return days;
  };

  const calendarDays = buildCalendar();
  const monthName = currentMonth.toLocaleString(locale, { month: 'long', year: 'numeric' });

  // Detect work mode from today's status
  const workMode = today?.workMode || 'OFFICE';

  // BLOCKING: Location permission denied — cannot use attendance at all
  if (locationStatus === 'denied') {
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

  // BLOCKING: Location permission not yet asked — prompt user to grant
  if (locationStatus === 'prompt' || locationStatus === 'checking') {
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
      {notificationStatus === 'denied' && !dismissedNotifBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <p className="text-sm text-amber-700">{t('attendance.notificationsDisabled')}</p>
          <button onClick={() => setDismissedNotifBanner(true)} className="text-amber-500 hover:text-amber-700 ml-2" aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-4">{t('nav.attendance')}</h1>

      {/* Work Mode Indicator */}
      {(workMode === 'FIELD_SALES' || workMode === 'PROJECT_SITE') && (
        <div className="mb-6">
          <div className="flex gap-2 mb-4">
            {['OFFICE', 'FIELD_SALES', 'PROJECT_SITE'].map(mode => (
              <span
                key={mode}
                className={`badge text-xs ${mode === workMode ? 'badge-info' : 'badge-neutral'}`}
              >
                {mode.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          {workMode === 'FIELD_SALES' && <FieldSalesView todayStatus={today} />}
          {workMode === 'PROJECT_SITE' && <ProjectSiteView />}
        </div>
      )}

      {/* Office Mode (default) */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Clock-in widget */}
        <div className="lg:col-span-1 space-y-4">
          {/* Time & Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="layer-card p-6 text-center"
          >
            {/* Live time */}
            <p className="text-4xl font-mono font-bold text-gray-900 mb-1" data-mono>
              {liveTime.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })}
            </p>
            <p className="text-sm text-gray-400 mb-6">{formatDate(new Date(), 'long')}</p>

            {/* Status badge */}
            {today?.isCheckedIn && !today?.isCheckedOut && (
              <div className="mb-4">
                <span className="badge badge-success text-sm px-3 py-1">
                  {today.isOnBreak ? '☕ On Break' : '✅ Checked In'}
                </span>
                <p className="text-3xl font-mono font-bold text-brand-600 mt-3" data-mono>
                  {getElapsedTime()}
                </p>
                <p className="text-xs text-gray-400 mt-1">Time elapsed</p>
              </div>
            )}

            {today?.isCheckedOut && (
              <div className="mb-4">
                <span className="badge badge-neutral text-sm px-3 py-1">{t('attendance.dayComplete')}</span>
                <p className="text-2xl font-mono font-bold text-gray-600 mt-3" data-mono>
                  {Number(today.record?.totalHours || 0).toFixed(1)}h
                </p>
                <p className="text-xs text-gray-400 mt-1">{t('attendance.totalHours')}</p>
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
                    // Check against all configured week-off days (default: Sunday only)
                    const weekOffs = new Set(today?.weekOffDays || [0]); // 0=Sun
                    if (!weekOffs.has(next.getDay()) && !isHoliday) return next;
                  }
                  return null;
                })();
                return (
                  <div className="mb-4 p-3 bg-violet-50 rounded-xl border border-violet-200 text-center">
                    <p className="text-sm font-semibold text-violet-800">
                      Today is {todayHoliday.name} — Holiday
                    </p>
                    <p className="text-xs text-violet-500 mt-1">
                      Enjoy your day off!{nextWorkday && ` Next working day: ${nextWorkday.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' })}`}
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Shift info banner */}
            {today?.shift && (
              <div className="mb-3 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-xs font-medium text-blue-700">
                  Shift: {today.shift.name} ({today.shift.startTime} – {today.shift.endTime})
                </p>
              </div>
            )}
            {!today?.shift && today?.hasShift === false && (
              <div className="mb-3 p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs font-medium text-amber-700">
                  No shift assigned — using default schedule
                </p>
              </div>
            )}

            {/* GPS readiness badge — shown above action buttons so employee knows signal quality */}
            {(() => {
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

            {/* Main CTA button */}
            {!today?.isCheckedIn && !today?.isCheckedOut && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleClockIn}
                disabled={clockingIn || statusLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-200"
              >
                {clockingIn ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <LogIn size={22} />
                )}
                {t('attendance.checkIn')}
              </motion.button>
            )}

            {/* Re-clock-in button (after accidental clock-out) */}
            {today?.isCheckedOut && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleClockIn}
                disabled={clockingIn}
                className="w-full bg-amber-500 hover:bg-amber-400 text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 mt-3"
              >
                {clockingIn ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <LogIn size={20} />
                )}
                {t('dashboard.reCheckIn')}
              </motion.button>
            )}

            {today?.isCheckedIn && !today?.isCheckedOut && (
              <div className="space-y-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleClockOut}
                  disabled={clockingOut}
                  className="w-full bg-red-500 hover:bg-red-400 text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {clockingOut ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <LogOut size={20} />
                  )}
                  {t('attendance.checkOut')}
                </motion.button>

                <button
                  onClick={handleBreak}
                  aria-label={today.isOnBreak ? t('attendance.endBreak') : t('attendance.startBreak')}
                  className={cn(
                    'w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors',
                    today.isOnBreak
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-surface-2 text-gray-600 hover:bg-surface-3'
                  )}
                >
                  {today.isOnBreak ? <Square size={16} /> : <Coffee size={16} />}
                  {today.isOnBreak ? t('attendance.endBreak') : t('attendance.startBreak')}
                </button>
              </div>
            )}

            {/* Work mode indicator */}
            {today?.workMode && (
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                <MapPin size={12} />
                {today.workMode.replace('_', ' ')}
              </div>
            )}

            {/* Geofence violation warning */}
            {today?.geofenceViolation && (
              <div className="mt-3 p-2.5 bg-red-50 rounded-lg border border-red-100">
                <p className="text-xs font-medium text-red-600 flex items-center gap-1">
                  <Shield size={12} /> {t('attendance.outsideGeofence')}
                </p>
              </div>
            )}
          </motion.div>

          {/* Summary card */}
          {monthData?.summary && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="layer-card p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">{t('attendance.thisMonth')}</h3>
                <button
                  onClick={() => {
                    const m = currentMonth.getMonth() + 1;
                    const y = currentMonth.getFullYear();
                    downloadReport(`/attendance/my/report?month=${m}&year=${y}`, `my-attendance-${m}-${y}.xlsx`);
                  }}
                  disabled={!!reportDownloading}
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  <Download size={12} />
                  {reportDownloading ? 'Downloading...' : 'Download Report'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SummaryItem label={t('attendance.present')} value={monthData.summary.present} color="text-emerald-600" />
                <SummaryItem label={t('attendance.absent')} value={monthData.summary.absent} color="text-red-500" />
                <SummaryItem label={t('attendance.halfDay')} value={monthData.summary.halfDay} color="text-amber-500" />
                <SummaryItem label={t('attendance.onLeave')} value={monthData.summary.onLeave} color="text-purple-500" />
                <SummaryItem label={t('attendance.avgHours')} value={`${monthData.summary.averageHours}h`} color="text-blue-600" />
                <SummaryItem label={t('attendance.wfh')} value={monthData.summary.workFromHome} color="text-teal-500" />
              </div>
            </motion.div>
          )}
        </div>

        {/* Right: Calendar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 layer-card p-6"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
              <CalendarIcon size={18} className="text-brand-500" />
              {monthName}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                aria-label={t('common.previousPage')}
                className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="text-sm text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors font-medium"
              >
                Today
              </button>
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                aria-label={t('common.nextPage')}
                className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-gray-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => (
              <div
                key={idx}
                className={cn(
                  'aspect-square rounded-lg p-1.5 flex flex-col items-center justify-center text-sm transition-colors relative',
                  day.date === 0 && 'invisible',
                  day.isToday && 'ring-2 ring-brand-500 ring-offset-1',
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
                <span className={cn(
                  'font-medium',
                  day.isToday ? 'text-brand-600' : 'text-gray-700',
                  day.status === 'WEEKEND' && 'text-gray-400',
                )}>
                  {day.date > 0 ? day.date : ''}
                </span>
                {day.status && day.date > 0 && (
                  <div className="flex items-center gap-0.5 mt-0.5">
                    <div className={cn('w-1.5 h-1.5 rounded-full', STATUS_COLORS[day.status])} />
                    {day.record?.geofenceViolation && (
                      <Flag size={8} className="text-red-500" title="Outside geofence" />
                    )}
                  </div>
                )}
                {day.record?.totalHours && (
                  <span className="text-[9px] font-mono text-gray-400 mt-0.5" data-mono>
                    {Number(day.record.totalHours).toFixed(1)}h
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-5 pt-4 border-t border-gray-100">
            {[
              { labelKey: 'attendance.present', color: 'bg-emerald-500' },
              { labelKey: 'attendance.absent', color: 'bg-red-400' },
              { labelKey: 'attendance.halfDay', color: 'bg-amber-400' },
              { labelKey: 'attendance.holiday', color: 'bg-blue-400' },
              { labelKey: 'attendance.weekend', color: 'bg-gray-300' },
              { labelKey: 'attendance.onLeave', color: 'bg-purple-400' },
              { labelKey: 'attendance.wfh', color: 'bg-teal-400' },
            ].map((item) => (
              <div key={item.labelKey} className="flex items-center gap-1.5">
                <div className={cn('w-2.5 h-2.5 rounded-full', item.color)} />
                <span className="text-xs text-gray-500">{t(item.labelKey)}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <Flag size={10} className="text-red-500" />
              <span className="text-xs text-gray-500">{t('attendance.outsideGeofence')}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* My Report Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="layer-card p-6 mt-6"
      >
        <SelfServiceReport />
      </motion.div>
    </div>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="text-center py-2 px-2 bg-surface-2 rounded-lg">
      <p className={cn('text-lg font-bold font-mono', color)} data-mono>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
