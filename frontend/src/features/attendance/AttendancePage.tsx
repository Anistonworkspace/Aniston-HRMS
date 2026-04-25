import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import {
  Clock, LogIn, LogOut, MapPin, FileText,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Users, Search, Filter, UserCheck, UserX, UserMinus, Eye, Monitor,
  Shield, Bell, RefreshCw, Flag, AlertTriangle, Download, X, Loader2,
} from 'lucide-react';
import {
  useGetTodayStatusQuery,
  useClockInMutation,
  useClockOutMutation,
  useGetMyAttendanceQuery,
  useGetAllAttendanceQuery,
  useSubmitRegularizationMutation,
} from './attendanceApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';
import FieldSalesView from './FieldSalesView';
import ProjectSiteView from './ProjectSiteView';
import CommandCenter from './components/CommandCenter';
import SelfServiceReport from './components/SelfServiceReport';
import { CompOffTab } from './components/CompOffTab';
import { enqueueAction } from '../../lib/offlineQueue';
import { useAuthDownload } from '../../hooks/useAuthDownload';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';

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
      <div className="px-4 sm:px-6 pt-5 pb-1 flex flex-wrap gap-2">
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

  const { data: response, isLoading, isError, error, refetch } = useGetAllAttendanceQuery({
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-display font-bold text-gray-900">{t('attendance.title')}</h1>
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

      {isError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 mb-4">
          <AlertTriangle size={18} className="text-red-500 shrink-0" />
          <div>
            <p className="font-medium">Failed to load attendance records</p>
            <p className="text-red-500 mt-0.5">{(error as any)?.data?.error?.message || 'Please refresh the page or try again.'}</p>
          </div>
        </div>
      )}

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
  const { perms } = useEmpPerms();
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
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
  const [submitRegularization, { isLoading: submittingReg }] = useSubmitRegularizationMutation();

  const [showRegModal, setShowRegModal] = useState(false);
  const [regReason, setRegReason] = useState('');
  const [regCheckIn, setRegCheckIn] = useState('');
  const [regCheckOut, setRegCheckOut] = useState('');

  const handleSubmitRegularization = async () => {
    const attendanceId = today?.record?.id;
    if (!attendanceId) { toast.error('No attendance record found for today.'); return; }
    if (regReason.trim().length < 10) { toast.error('Reason must be at least 10 characters.'); return; }
    try {
      await submitRegularization({
        attendanceId,
        reason: regReason.trim(),
        ...(regCheckIn ? { requestedCheckIn: new Date(regCheckIn).toISOString() } : {}),
        ...(regCheckOut ? { requestedCheckOut: new Date(regCheckOut).toISOString() } : {}),
      }).unwrap();
      toast.success('Regularization request submitted. HR will review it shortly.');
      setShowRegModal(false);
      setRegReason('');
      setRegCheckIn('');
      setRegCheckOut('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit regularization request.');
    }
  };

  const actionLockRef = useRef(false); // debounce guard for clock-in/out
  const [shiftWarning, setShiftWarning] = useState<{ message: string; onConfirm: () => void } | null>(null);

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

    // Always force a fresh GPS fix on every button press.
    // maximumAge: 0 forces the OS to read the current GPS signal — no cached position accepted.
    // This ensures if the user turned off location after the last fix, the OS will deny here.
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 0,
        })
      );
      bestPosRef.current = pos;
      setGpsAccuracy(pos.coords.accuracy);
      setLocationStatus('granted');
      return toPayload(pos);
    } catch (err: any) {
      if (err?.code === 1) {
        // Permission denied — move to blocked screen so user sees the enable-location instructions
        setLocationStatus('denied');
        toast.error('Location access denied. Please enable location to mark attendance.', { duration: 4000 });
      } else if (err?.code === 2) {
        // Device GPS / Location Services is turned off
        setLocationStatus('gps_off');
        toast.error('Please turn on your device GPS/Location to mark attendance.', { duration: 4000 });
      } else if (err?.code === 3) {
        toast.error(t('attendance.locationTimeout'));
      } else {
        toast.error('Could not get your location. Please try again.');
      }
      return null; // abort — do NOT proceed with clock-in/out
    }
  };

  const doClockIn = async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    // Declare coords outside try so the catch block can include them in the offline queue
    let coords: { latitude: number; longitude: number; accuracy: number; gpsTimestamp: string } | null = null;
    try {
      coords = await getGPS();
      if (coords === null) return; // location denied/off — toast already shown, never queue
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
      toast.success(t('attendance.checkedIn'));
    } catch (err: any) {
      // Only queue offline if GPS was successfully obtained — never queue without location
      if (!navigator.onLine && coords) {
        const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        enqueueAction('CLOCK_IN', { ...coords, source: 'MANUAL_APP', deviceType });
        toast(t('attendance.checkinQueued'), { icon: '📡' });
        return;
      }
      toast.error(err?.data?.error?.message || t('attendance.failedClockIn'));
    } finally {
      setTimeout(() => { actionLockRef.current = false; }, 2000); // 2s cooldown
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

  const handleClockOut = async () => {
    if (actionLockRef.current) return; // prevent double-tap
    actionLockRef.current = true;
    let coords: { latitude: number; longitude: number; accuracy: number; gpsTimestamp: string } | null = null;
    try {
      coords = await getGPS();
      if (coords === null) return; // location denied/off — toast already shown, never queue
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      await clockOut({ ...coords, deviceType }).unwrap();
      toast.success(t('attendance.checkedOut'));
    } catch (err: any) {
      // Only queue offline if GPS was successfully obtained — never queue without location
      if (!navigator.onLine && coords) {
        const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
        enqueueAction('CLOCK_OUT', { ...coords, deviceType });
        toast(t('attendance.checkoutQueued'), { icon: '📡' });
        return;
      }
      toast.error(err?.data?.error?.message || t('attendance.failedClockOut'));
    } finally {
      setTimeout(() => { actionLockRef.current = false; }, 2000); // 2s cooldown
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

  // Desktop users skip all location gates — they see status-only UI
  // Employee-level permission gate (canViewAttendanceHistory)
  if (!perms.canViewAttendanceHistory) return <PermDenied action="view attendance history" />;

  // BLOCKING: Location permission denied — cannot use attendance at all
  if (!isDesktop && locationStatus === 'denied') {
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
  if (!isDesktop && locationStatus === 'gps_off') {
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
  if (!isDesktop && (locationStatus === 'prompt' || locationStatus === 'checking')) {
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
              <h3 className="text-base font-semibold text-gray-900">Outside Shift Hours</h3>
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
                Clock In Anyway
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

      {/* Work Mode Indicator */}
      {(workMode === 'FIELD_SALES' || workMode === 'PROJECT_SITE') && (
        <div className="mb-4">
          <div className="flex gap-2 mb-3">
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
                <p className="text-2xl font-mono font-bold text-brand-600 mt-2" data-mono>
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

            {/* Shift info banner */}
            {today?.shift && (
              <div className="mb-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-xs font-medium text-blue-700">
                  Shift: {today.shift.name} ({today.shift.startTime} – {today.shift.endTime})
                </p>
              </div>
            )}
            {!today?.shift && today?.hasShift === false && (
              <div className="mb-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs font-medium text-amber-700">
                  No shift assigned — using default schedule
                </p>
              </div>
            )}

            {/* Desktop: no marking allowed — show app download prompt */}
            {isDesktop ? (
              <div className="mt-2 p-3 bg-indigo-50 rounded-xl border border-indigo-100 text-left">
                <p className="text-xs font-semibold text-indigo-800 mb-1 flex items-center gap-1">
                  <MapPin size={11} /> Mark attendance on the app
                </p>
                <p className="text-[11px] text-indigo-600 leading-relaxed mb-2">
                  Check-in and check-out is only available on the Aniston HRMS mobile app.
                </p>
                <div className="flex gap-2">
                  <a href="/download/android" className="flex-1 text-center text-[11px] font-semibold bg-indigo-600 text-white py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
                    Android App
                  </a>
                  <a href="/download/ios" className="flex-1 text-center text-[11px] font-semibold bg-gray-800 text-white py-1.5 rounded-lg hover:bg-gray-900 transition-colors">
                    iOS App
                  </a>
                </div>
              </div>
            ) : (
              <>
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
                {!perms.canMarkAttendance && (
                  <PermDenied action="mark attendance" inline />
                )}
                {perms.canMarkAttendance && !today?.isCheckedIn && !today?.isCheckedOut && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleClockIn}
                    disabled={clockingIn || statusLoading || (!isDesktop && locationStatus !== 'granted')}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 md:py-4 rounded-xl font-semibold text-sm md:text-lg flex items-center justify-center gap-2 md:gap-3 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-200"
                  >
                    {clockingIn ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <LogIn size={22} />
                    )}
                    {t('attendance.checkIn')}
                  </motion.button>
                )}

                {perms.canMarkAttendance && today?.isCheckedIn && !today?.isCheckedOut && (
                  <div className="space-y-1.5">
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
                      disabled={clockingOut || checkoutGate?.canCheckOut === false}
                      className="w-full bg-red-500 hover:bg-red-400 text-white py-2.5 md:py-3.5 rounded-xl font-semibold text-sm md:text-base flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {clockingOut ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <LogOut size={20} />
                      )}
                      {t('attendance.checkOut')}
                    </motion.button>
                  </div>
                )}

                {/* Checked out — prompt for regularization */}
                {perms.canMarkAttendance && today?.isCheckedOut && (
                  <button
                    onClick={() => setShowRegModal(true)}
                    className="mt-3 w-full p-3 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-200 text-center transition-colors"
                  >
                    <p className="text-xs text-amber-700 font-semibold flex items-center justify-center gap-1.5">
                      <FileText size={13} />
                      Tap to apply for Regularization
                    </p>
                  </button>
                )}

                {/* Not checked in at all — allow regularization for missed attendance */}
                {perms.canMarkAttendance && !today?.isCheckedIn && !today?.isCheckedOut && today?.record?.id && (
                  <button
                    onClick={() => setShowRegModal(true)}
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
                {today.workMode.replace('_', ' ')}
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
              <CalendarIcon size={14} className="text-brand-500" />
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
                className="text-xs text-brand-600 px-2.5 py-1 rounded-lg hover:bg-brand-50 transition-colors font-medium"
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
            {calendarDays.map((day, idx) => (
              <div
                key={idx}
                className={cn(
                  'rounded-md p-1 flex flex-col items-center justify-center transition-colors relative',
                  'min-h-[36px]',
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
                  'text-xs font-medium leading-none',
                  day.isToday ? 'text-brand-600' : 'text-gray-700',
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
              </div>
            ))}
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

      {/* Comp-Off Credits */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="mt-4"
      >
        <CompOffTab />
      </motion.div>

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
                onClick={() => { setShowRegModal(false); setRegReason(''); setRegCheckIn(''); setRegCheckOut(''); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Info row */}
              <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
                {today?.isCheckedOut
                  ? 'You have already checked in and checked out today. Re-marking is not allowed.'
                  : 'You missed check-in today. Re-marking is not allowed.'}
                {' '}Submit a regularization request — HR will review and approve it.
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

              {/* Time corrections (optional) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Requested Check-In</label>
                  <input
                    type="datetime-local"
                    value={regCheckIn}
                    onChange={(e) => setRegCheckIn(e.target.value)}
                    className="input-glass w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Requested Check-Out</label>
                  <input
                    type="datetime-local"
                    value={regCheckOut}
                    onChange={(e) => setRegCheckOut(e.target.value)}
                    className="input-glass w-full text-sm"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">Time corrections are optional. Leave blank to keep original times.</p>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => { setShowRegModal(false); setRegReason(''); setRegCheckIn(''); setRegCheckOut(''); }}
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

