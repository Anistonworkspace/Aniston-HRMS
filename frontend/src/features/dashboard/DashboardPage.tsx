import { useState, useMemo, useEffect, useCallback, memo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, MapPin, Loader2, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, Clock3, Sun, Coffee,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../app/store';
import { useGetDashboardStatsQuery } from './dashboardApi';
import { useGetTodayStatusQuery, useClockInMutation, useClockOutMutation, useGetMyAttendanceQuery } from '../attendance/attendanceApi';
import { useGetLeaveBalancesQuery, useGetHolidaysQuery } from '../leaves/leaveApi';
import { formatDate } from '../../lib/utils';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { SkeletonLoader, QuickActionGrid } from './components';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// Lazy-load role-specific dashboards
const SuperAdminDashboard = lazy(() => import('./SuperAdminDashboard'));
const HRDashboard = lazy(() => import('./HRDashboard'));

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon: LucideIcon }> = {
  PRESENT: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle2 },
  ABSENT: { bg: 'bg-red-50', text: 'text-red-700', icon: XCircle },
  HALF_DAY: { bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock3 },
  ON_LEAVE: { bg: 'bg-purple-50', text: 'text-purple-700', icon: Coffee },
  HOLIDAY: { bg: 'bg-blue-50', text: 'text-blue-700', icon: Sun },
  WEEKEND: { bg: 'bg-gray-50', text: 'text-gray-500', icon: Sun },
  WORK_FROM_HOME: { bg: 'bg-blue-50', text: 'text-blue-700', icon: CheckCircle2 },
};

// ─── ROLE-BASED ROUTER ─────────────────────────────────────────
export default function DashboardPage() {
  const user = useAppSelector((state) => state.auth.user);
  const role = user?.role || '';

  if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
    return (
      <Suspense fallback={<SkeletonLoader variant="full-page" />}>
        <SuperAdminDashboard />
      </Suspense>
    );
  }

  if (role === 'HR') {
    return (
      <Suspense fallback={<SkeletonLoader variant="full-page" />}>
        <HRDashboard />
      </Suspense>
    );
  }

  return <EmployeeDashboard />;
}

// ─── LEAVE BALANCE WIDGET ──────────────────────────────────────
const LeaveBalanceWidget = memo(function LeaveBalanceWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAppSelector(s => s.auth.user);
  const { data: balRes, isLoading } = useGetLeaveBalancesQuery(undefined, { skip: !user?.employeeId });
  const balances = balRes?.data || [];

  if (isLoading) {
    return (
      <div className="layer-card p-4">
        <h3 className="text-sm font-semibold text-gray-600 mb-3">{t('dashboard.leaveBalance')}</h3>
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (balances.length === 0) return null;

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-600">{t('dashboard.leaveBalance')}</h3>
        <button onClick={() => navigate('/leaves')} className="text-xs text-brand-600 hover:text-brand-700">
          {t('dashboard.applyLeave')}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {balances.slice(0, 6).map((b: { id: string; remaining?: number; allocated?: number; carriedForward?: number; used?: number; pending?: number; leaveType?: { code?: string; name?: string } }) => {
          const remaining = b.remaining ?? (Number(b.allocated || 0) + Number(b.carriedForward || 0) - Number(b.used || 0) - Number(b.pending || 0));
          return (
            <div key={b.id} className="text-center p-2 bg-gray-50 rounded-lg">
              <p className="text-lg font-bold font-mono text-gray-900" data-mono>{remaining}</p>
              <p className="text-[10px] text-gray-500 truncate">{b.leaveType?.code || b.leaveType?.name}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── UPCOMING HOLIDAYS WIDGET ──────────────────────────────────
const UpcomingHolidaysWidget = memo(function UpcomingHolidaysWidget() {
  const { t, i18n } = useTranslation();
  const { data: holRes } = useGetHolidaysQuery({});
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const holidays = useMemo(() =>
    (holRes?.data || [])
      .filter((h: { date: string }) => new Date(h.date) >= new Date())
      .sort((a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 3),
    [holRes]
  );

  if (holidays.length === 0) return null;

  return (
    <div className="layer-card p-4">
      <h3 className="text-sm font-semibold text-gray-600 mb-3">{t('dashboard.upcomingHolidays')}</h3>
      <div className="space-y-2">
        {holidays.map((h: { id: string; name: string; date: string }) => (
          <div key={h.id} className="flex items-center justify-between text-sm">
            <span className="text-gray-700">{h.name}</span>
            <span className="text-xs text-gray-400 font-mono" data-mono>
              {new Date(h.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', weekday: 'short' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── ATTENDANCE RECORD ROW ─────────────────────────────────────
interface AttendanceRecord {
  id?: string;
  date: string;
  status: string;
  checkIn?: string | null;
  checkOut?: string | null;
  totalHours?: number | null;
}

const AttendanceRow = memo(function AttendanceRow({ record }: { record: AttendanceRecord }) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const cfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.ABSENT;
  const StatusIcon = cfg.icon;

  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-lg ${cfg.bg} transition-colors`}>
      <div className="flex items-center gap-2.5">
        <StatusIcon size={14} className={cfg.text} />
        <div>
          <p className="text-xs font-medium text-gray-700">
            {new Date(record.date).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' })}
          </p>
          <p className="text-[10px] text-gray-400">
            {record.checkIn
              ? new Date(record.checkIn).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
              : '—'}
            {record.checkOut
              ? ` → ${new Date(record.checkOut).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
              : ''}
          </p>
        </div>
      </div>
      <div className="text-right">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/80 ${cfg.text}`}>
          {record.status?.replace('_', ' ')}
        </span>
        {record.totalHours != null && (
          <p className="text-[10px] text-gray-400 mt-0.5 font-mono" data-mono>
            {Number(record.totalHours).toFixed(1)}h
          </p>
        )}
      </div>
    </div>
  );
});

// ─── EMPLOYEE DASHBOARD ────────────────────────────────────────
function EmployeeDashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const canCheckIn = !isManagement && isMobile;
  const { data: statsResponse, isLoading, isError } = useGetDashboardStatsQuery();
  const stats = statsResponse?.data;
  const { data: todayRes } = useGetTodayStatusQuery(undefined, {
    pollingInterval: 60000,
    skip: isManagement,
  });
  const todayStatus = todayRes?.data;
  const [clockIn, { isLoading: clockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: clockingOut }] = useClockOutMutation();

  const [selectedMonth, setSelectedMonth] = useState(() => new Date());
  const monthStart = useMemo(() => {
    const d = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    return d.toISOString().split('T')[0];
  }, [selectedMonth]);
  const monthEnd = useMemo(() => {
    const d = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);
    return d.toISOString().split('T')[0];
  }, [selectedMonth]);

  const { data: myAttendanceRes } = useGetMyAttendanceQuery({ startDate: monthStart, endDate: monthEnd });
  const myAttendance = myAttendanceRes?.data;

  const [gettingGps, setGettingGps] = useState(false);

  const [liveElapsed, setLiveElapsed] = useState('');
  useEffect(() => {
    if (!todayStatus?.record?.checkIn || todayStatus?.isCheckedOut) return;
    const update = () => {
      const start = new Date(todayStatus.record.checkIn).getTime();
      const diff = Date.now() - start;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setLiveElapsed(`${h}h ${m}m`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [todayStatus?.record?.checkIn, todayStatus?.isCheckedOut]);

  const handleQuickCheckIn = useCallback(async () => {
    if (gettingGps || clockingIn || clockingOut) return;
    setGettingGps(true);
    try {
      let coords: { latitude?: number; longitude?: number } = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch { /* proceed without */ }
      }
      setGettingGps(false);
      const deviceType = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' as const : 'desktop' as const;
      if (todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut) {
        await clockOut({ ...coords, deviceType }).unwrap();
        toast.success(t('dashboard.checkedOut'));
      } else {
        await clockIn({ ...coords, source: 'MANUAL_APP', deviceType }).unwrap();
        toast.success(todayStatus?.isCheckedOut ? t('dashboard.reCheckedIn') : t('dashboard.checkedIn'));
      }
    } catch (err: any) {
      setGettingGps(false);
      toast.error(err?.data?.error?.message || t('dashboard.failedToClock'));
    }
  }, [gettingGps, clockingIn, clockingOut, todayStatus, clockIn, clockOut, t]);

  const isCheckingInOut = gettingGps || clockingIn || clockingOut;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 17 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening');

  const EMP_QUICK_ACTIONS = [
    { label: t('dashboard.attendanceAction'), icon: '⏰', path: '/attendance' },
    { label: t('dashboard.applyLeaveAction'), icon: '🏖️', path: '/leaves' },
    { label: t('dashboard.viewPayslip'), icon: '💰', path: '/payroll' },
    { label: t('dashboard.raiseTicket'), icon: '🎫', path: '/helpdesk' },
  ];

  const expectedHours = useMemo(() => {
    if (todayStatus?.shift?.startTime && todayStatus?.shift?.endTime) {
      const [sh, sm] = todayStatus.shift.startTime.split(':').map(Number);
      const [eh, em] = todayStatus.shift.endTime.split(':').map(Number);
      let diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff < 0) diff += 24 * 60;
      return Math.round(diff / 60 * 10) / 10;
    }
    return 9;
  }, [todayStatus?.shift]);

  const completedHours = Number(todayStatus?.totalHours || 0);
  const hoursPercent = Math.min((completedHours / expectedHours) * 100, 100);

  const sortedRecords = useMemo(() => {
    if (!myAttendance?.records) return [];
    return [...myAttendance.records].sort((a: AttendanceRecord, b: AttendanceRecord) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [myAttendance?.records]);

  const navigateMonth = useCallback((dir: number) => {
    setSelectedMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + dir, 1));
  }, []);

  const monthLabel = selectedMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const isCurrentMonth = selectedMonth.getMonth() === new Date().getMonth() && selectedMonth.getFullYear() === new Date().getFullYear();

  if (isLoading && !stats) {
    return (
      <div className="page-container animate-pulse">
        <div className="mb-8">
          <div className="h-8 bg-gray-200 rounded-lg w-64 mb-2" />
          <div className="h-4 bg-gray-100 rounded w-48" />
        </div>
        <div className="layer-card p-6 mb-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="w-[200px] h-[200px] rounded-full bg-gray-100" />
            <div className="flex-1 space-y-3 w-full">
              <div className="h-5 bg-gray-200 rounded w-40" />
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="p-3 bg-gray-50 rounded-xl">
                    <div className="h-3 bg-gray-200 rounded w-12 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-16" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-container">
        <div className="layer-card p-8 text-center">
          <p className="text-red-500">{t('dashboard.failedToLoad')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container pb-6">
      {/* Greeting */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting}, {user?.firstName || 'there'}
        </h1>
        <p className="text-gray-500 mt-1">{t('dashboard.manageDesc')}</p>
      </motion.div>

      {/* Today's Hours Circular Chart — only for non-management */}
      {!isManagement && <motion.div variants={container} initial="hidden" animate="show" className="mb-8">
        <motion.div variants={item} className="layer-card p-6">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="relative">
              <RadialBarChart
                width={200} height={200} cx={100} cy={100}
                innerRadius={70} outerRadius={90} barSize={14}
                data={[{ value: hoursPercent, fill: hoursPercent >= 100 ? '#10b981' : hoursPercent >= 50 ? '#6366f1' : '#f59e0b' }]}
                startAngle={90} endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background={{ fill: '#f1f5f9' }} dataKey="value" angleAxisId={0} cornerRadius={10} />
              </RadialBarChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-bold font-mono text-gray-900" data-mono>
                  {todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut
                    ? liveElapsed || `${Math.floor(completedHours)}h ${Math.round((completedHours % 1) * 60)}m`
                    : todayStatus?.isCheckedOut
                    ? `${completedHours.toFixed(1)}h`
                    : '0h 0m'}
                </p>
                <p className="text-xs text-gray-400">{t('common.of')} {expectedHours}h</p>
              </div>
            </div>

            <div className="flex-1 space-y-3">
              <h2 className="text-lg font-display font-semibold text-gray-800">{t('dashboard.todaysProgress')}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-surface-2 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">{t('dashboard.statusLabel')}</p>
                  <p className="text-sm font-semibold text-gray-700">
                    {todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut ? t('dashboard.working')
                      : todayStatus?.isCheckedOut ? t('dashboard.completed') : t('dashboard.notStarted')}
                  </p>
                </div>
                <div className="p-3 bg-surface-2 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">{t('dashboard.checkIn')}</p>
                  <p className="text-sm font-semibold text-gray-700" data-mono>
                    {todayStatus?.record?.checkIn
                      ? new Date(todayStatus.record.checkIn).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
                      : '—'}
                  </p>
                </div>
                <div className="p-3 bg-surface-2 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">{t('dashboard.checkOut')}</p>
                  <p className="text-sm font-semibold text-gray-700" data-mono>
                    {todayStatus?.record?.checkOut
                      ? new Date(todayStatus.record.checkOut).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
                      : '—'}
                  </p>
                </div>
                <div className="p-3 bg-surface-2 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">{t('dashboard.shift')}</p>
                  <p className="text-sm font-semibold text-gray-700">
                    {todayStatus?.shift ? `${todayStatus.shift.startTime}–${todayStatus.shift.endTime}` : t('dashboard.default')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>}

      {/* Two column layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Quick actions */}
        <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-brand-500" />
            {t('dashboard.quickActions')}
          </h2>
          {!isManagement && todayStatus && (
            <div className="mb-4 p-4 bg-surface-2 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {todayStatus.isCheckedIn && !todayStatus.isCheckedOut && todayStatus.record?.checkIn
                    ? t('dashboard.checkedInAt', { time: new Date(todayStatus.record.checkIn).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) })
                    : todayStatus.isCheckedOut
                    ? t('dashboard.doneForToday', { hours: Number(todayStatus.totalHours || 0).toFixed(1) })
                    : t('dashboard.notCheckedInYet')}
                </p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <MapPin size={10} />
                  {todayStatus.shift ? `${todayStatus.shift.name || t('dashboard.shift')} (${todayStatus.shift.startTime}–${todayStatus.shift.endTime})` : t('dashboard.gpsAttendance')}
                </p>
              </div>
              {canCheckIn ? (
                <button
                  onClick={handleQuickCheckIn}
                  disabled={isCheckingInOut}
                  className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-all active:scale-95 ${
                    isCheckingInOut ? 'bg-brand-500 text-white animate-pulse'
                      : todayStatus.isCheckedIn && !todayStatus.isCheckedOut ? 'bg-red-500 hover:bg-red-600 text-white'
                      : todayStatus.isCheckedOut ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {isCheckingInOut ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
                  {isCheckingInOut
                    ? (gettingGps ? t('dashboard.gettingGps') : t('dashboard.marking'))
                    : todayStatus.isCheckedIn && !todayStatus.isCheckedOut ? t('dashboard.checkOut')
                    : todayStatus.isCheckedOut ? t('dashboard.reCheckIn') : t('dashboard.checkIn')}
                </button>
              ) : (
                <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">{t('common.mobileOnly')}</span>
              )}
            </div>
          )}
          <QuickActionGrid actions={EMP_QUICK_ACTIONS} columns="grid-cols-2" />
        </motion.div>

        {/* Monthly Attendance History */}
        <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-semibold text-gray-800">{t('dashboard.attendanceHistory')}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => navigateMonth(-1)} aria-label={t('common.previousPage')} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <ChevronLeft size={16} className="text-gray-500" />
              </button>
              <span className="text-sm font-medium text-gray-700 min-w-[140px] text-center">{monthLabel}</span>
              <button onClick={() => navigateMonth(1)} aria-label={t('common.nextPage')} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" disabled={isCurrentMonth}>
                <ChevronRight size={16} className={isCurrentMonth ? 'text-gray-200' : 'text-gray-500'} />
              </button>
            </div>
          </div>

          {myAttendance?.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {[
                { label: t('dashboard.present'), value: myAttendance.summary.present, bg: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-600' },
                { label: t('dashboard.absent'), value: myAttendance.summary.absent, bg: 'bg-red-50', text: 'text-red-700', sub: 'text-red-600' },
                { label: t('dashboard.halfDay'), value: myAttendance.summary.halfDay, bg: 'bg-amber-50', text: 'text-amber-700', sub: 'text-amber-600' },
                { label: t('dashboard.onLeave'), value: myAttendance.summary.onLeave, bg: 'bg-purple-50', text: 'text-purple-700', sub: 'text-purple-600' },
              ].map((s) => (
                <div key={s.label} className={`p-2.5 ${s.bg} rounded-lg text-center`}>
                  <p className={`text-lg font-bold ${s.text} font-mono`} data-mono>{s.value}</p>
                  <p className={`text-[10px] ${s.sub}`}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
            {sortedRecords.length > 0 ? (
              sortedRecords.map((record: AttendanceRecord) => (
                <AttendanceRow key={record.id || record.date} record={record} />
              ))
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">{t('dashboard.noRecords')}</p>
            )}
          </div>

          {myAttendance?.summary && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400">{t('dashboard.avgDailyHours')}</p>
              <p className="text-sm font-semibold text-gray-700 font-mono" data-mono>
                {Number(myAttendance.summary.averageHours || 0).toFixed(1)}h
              </p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Leave Balance + Upcoming Holidays */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <LeaveBalanceWidget />
        <UpcomingHolidaysWidget />
      </div>

    </div>
  );
}
