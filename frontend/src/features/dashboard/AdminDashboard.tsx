import { memo, useMemo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import {
  Users, TrendingDown, IndianRupee, Briefcase, UserPlus,
  AlertTriangle, Building2, Cake, UserCheck, UserX,
  Clock, CalendarOff, Home, ShieldAlert, FileCheck,
  Ticket, ChevronRight, CalendarDays, ListChecks,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../../app/store';
import { useGetSuperAdminStatsQuery, useGetHRStatsQuery } from './dashboardApi';
import { useGetHolidaysQuery } from '../leaves/leaveApi';
import { formatCurrency } from '../../lib/utils';
import {
  KPICard, AlertBanner, DashboardSection, StatusCard,
  ActionCard, QuickActionGrid, EmployeeListWidget, SkeletonLoader,
} from './components';
import type { SuperAdminDashboardStats, AttentionItem } from '@aniston/shared';

// Lazy-load heavy chart components
const TrendCharts = lazy(() => import('./sections/TrendCharts'));
const LiveAttendanceWidget = lazy(() => import('../attendance/components/LiveAttendanceWidget'));

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const attentionIconMap: Record<string, typeof Clock> = {
  late: Clock,
  missing_checkout: ShieldAlert,
  leave_conflict: CalendarOff,
  probation_ending: UserPlus,
  document_expiry: FileCheck,
};

function AdminDashboard() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const user = useAppSelector((s) => s.auth.user);
  const role = user?.role || '';
  const isHR = role === 'HR';
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';

  // Fetch BOTH data sources in parallel
  const { data: saResponse, isLoading: saLoading, isError: saError } = useGetSuperAdminStatsQuery(undefined, {
    pollingInterval: 300000,
    skip: isHR,
  });
  const { data: hrResponse, isLoading: hrLoading, isError: hrError } = useGetHRStatsQuery(undefined, {
    pollingInterval: 60000,
  });
  const { data: holidaysRes } = useGetHolidaysQuery({});

  const saStats = saResponse?.data;
  const hrStats = hrResponse?.data;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 17 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening');

  // ─── KPI Cards (from SuperAdmin stats) ────────────────────────
  const kpis = useMemo(() => {
    if (!saStats) return [];
    return [
      { label: 'Total Employees', value: saStats.totalEmployees, icon: Users, color: 'bg-blue-500', iconBg: 'bg-blue-100', iconText: 'text-blue-600', sub: `${saStats.activeEmployees} active`, onClick: () => navigate('/employees') },
      { label: 'New Hires', value: saStats.newHiresThisMonth, icon: UserPlus, color: 'bg-emerald-500', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', sub: 'this month', onClick: () => navigate('/employees?status=ACTIVE&sortBy=joiningDate') },
      { label: 'Attrition Rate', value: `${saStats.attritionRate}%`, icon: TrendingDown, color: saStats.attritionRate > 15 ? 'bg-red-500' : 'bg-amber-500', iconBg: saStats.attritionRate > 15 ? 'bg-red-100' : 'bg-amber-100', iconText: saStats.attritionRate > 15 ? 'text-red-600' : 'text-amber-600', sub: 'last 12 months', onClick: () => navigate('/exit-management') },
      { label: 'Payroll Cost', value: formatCurrency(saStats.monthlyPayrollCost), icon: IndianRupee, color: 'bg-purple-500', iconBg: 'bg-purple-100', iconText: 'text-purple-600', sub: 'last month net', onClick: () => navigate('/payroll') },
      { label: 'Open Positions', value: saStats.openPositions, icon: Briefcase, color: 'bg-indigo-500', iconBg: 'bg-indigo-100', iconText: 'text-indigo-600', sub: 'hiring', onClick: () => navigate('/recruitment') },
      { label: 'Active Employees', value: saStats.activeEmployees, icon: UserCheck, color: 'bg-teal-500', iconBg: 'bg-teal-100', iconText: 'text-teal-600', sub: 'currently working', onClick: () => navigate('/employees?status=ACTIVE') },
    ];
  }, [saStats, navigate]);

  // ─── Today's Attendance Cards (from HR stats) ─────────────────
  const attendanceCards = useMemo(() => {
    if (!hrStats) return [];
    const att = hrStats.todayAttendance;
    return [
      { label: 'Present', value: att.present, icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
      { label: 'Absent', value: att.absent, icon: UserX, color: 'text-red-600', bg: 'bg-red-50' },
      { label: 'Late', value: att.late, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
      { label: 'On Leave', value: att.onLeave, icon: CalendarOff, color: 'text-purple-600', bg: 'bg-purple-50' },
      { label: 'Not Checked In', value: att.notCheckedIn, icon: ShieldAlert, color: 'text-gray-600', bg: 'bg-gray-50' },
      { label: 'WFH', value: att.workFromHome, icon: Home, color: 'text-blue-600', bg: 'bg-blue-50' },
    ];
  }, [hrStats]);

  // ─── Action Items (from HR stats) ─────────────────────────────
  const actionItems = useMemo(() => {
    if (!hrStats) return [];
    const pa = hrStats.pendingActions;
    return [
      { label: 'Leave Requests', count: pa.leaveRequests, icon: CalendarOff, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', path: '/pending-approvals' },
      { label: 'Regularizations', count: pa.regularizations, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', path: '/attendance' },
      { label: 'Helpdesk Tickets', count: pa.helpdeskTickets, icon: Ticket, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', path: '/helpdesk' },
      { label: 'Documents to Verify', count: pa.documentsToVerify, icon: FileCheck, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200', path: '/employees' },
      { label: 'Pending Onboarding', count: pa.pendingOnboarding, icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', path: '/employees' },
    ].filter((a) => a.count > 0);
  }, [hrStats]);

  const totalPending = useMemo(() => {
    if (!hrStats) return 0;
    const pa = hrStats.pendingActions;
    return pa.leaveRequests + pa.regularizations + pa.helpdeskTickets + pa.documentsToVerify + pa.pendingOnboarding;
  }, [hrStats]);

  const upcomingHolidays = useMemo(() =>
    (holidaysRes?.data || [])
      .filter((h: { date: string }) => new Date(h.date) >= new Date())
      .sort((a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5),
    [holidaysRes]
  );

  // ─── Quick Actions ────────────────────────────────────────────
  const QUICK_ACTIONS = [
    { label: t('leaves.approvals'), path: '/pending-approvals', icon: '✅' },
    { label: t('nav.attendance'), path: '/attendance', icon: '📊' },
    { label: t('employees.addEmployee'), path: '/employees', icon: '➕' },
    { label: t('nav.helpdesk'), path: '/helpdesk', icon: '🎫' },
    { label: t('nav.payroll'), path: '/payroll', icon: '💰' },
    { label: t('nav.recruitment'), path: '/recruitment', icon: '🎯' },
    { label: t('nav.reports'), path: '/reports', icon: '📈' },
    { label: t('nav.settings'), path: '/settings', icon: '⚙️' },
  ];

  // ─── LOADING ──────────────────────────────────────────────────
  if ((isHR ? false : saLoading) && hrLoading) return <SkeletonLoader variant="full-page" />;

  // ─── ERROR (both failed) ──────────────────────────────────────
  if ((isHR ? false : (saError || !saStats)) && (hrError || !hrStats)) {
    return (
      <div className="page-container">
        <div className="layer-card p-12 text-center">
          <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
          <p className="text-red-500 font-medium">Failed to load dashboard data</p>
          <p className="text-sm text-gray-400 mt-1">Please refresh the page or try again later</p>
        </div>
      </div>
    );
  }

  const att = hrStats?.todayAttendance;
  const presentPct = att && att.totalActive > 0
    ? Math.round(((att.present + att.workFromHome) / att.totalActive) * 100)
    : 0;

  return (
    <div className="page-container pb-6">
      {/* ═══ HEADER ══════════════════════════════════════════════ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting}, {user?.firstName || 'Admin'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Company overview — {new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </motion.div>

      {/* ═══ KPI GRID (Admin / Super Admin only) ════════════════ */}
      {!isHR && saStats && (
        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {kpis.map((kpi) => (
            <KPICard key={kpi.label} {...kpi} />
          ))}
        </motion.div>
      )}

      {/* ═══ HR KPI CARDS (HR only) ══════════════════════════════ */}
      {isHR && hrStats?.hrKpis && (
        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Employees', value: hrStats.hrKpis.totalEmployees, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', onClick: () => navigate('/employees') },
            { label: 'Pending Leave Requests', value: hrStats.pendingActions.leaveRequests, icon: CalendarOff, color: 'text-amber-600', bg: 'bg-amber-50', onClick: () => navigate('/pending-approvals') },
            { label: 'Pending Onboarding', value: hrStats.hrKpis.pendingOnboarding, icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', onClick: () => navigate('/employees') },
            { label: 'Helpdesk (Assigned)', value: hrStats.pendingActions.helpdeskTickets, icon: Ticket, color: 'text-purple-600', bg: 'bg-purple-50', onClick: () => navigate('/helpdesk') },
          ].map((kpi) => (
            <motion.div key={kpi.label} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              <button onClick={kpi.onClick} className={`w-full ${kpi.bg} rounded-xl p-4 text-left hover:opacity-90 transition-opacity`}>
                <kpi.icon size={18} className={`${kpi.color} mb-2`} />
                <p className={`text-2xl font-display font-bold ${kpi.color}`} data-mono>{kpi.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{kpi.label}</p>
              </button>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* ═══ ALERTS (Admin / Super Admin only) ══════════════════ */}
      {!isHR && saStats && <AlertBanner alerts={saStats.alerts} />}

      {/* ═══ TODAY'S ATTENDANCE STATUS (HR) ══════════════════════ */}
      {hrStats && att && (
        <motion.div variants={container} initial="hidden" animate="show" className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-600">Today's Attendance</h2>
            <button
              onClick={() => navigate('/attendance')}
              className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
            >
              View All <ChevronRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {attendanceCards.map((card) => (
              <StatusCard key={card.label} {...card} onClick={() => navigate('/attendance')} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${presentPct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-gray-500" data-mono>
              {presentPct}% present
            </span>
          </div>
        </motion.div>
      )}

      {/* ═══ TREND CHARTS (Admin / Super Admin only) ════════════ */}
      {!isHR && saStats && (
        <Suspense fallback={
          <div className="grid lg:grid-cols-3 gap-4 mb-6">
            {[1,2,3].map(i => (
              <div key={i} className="layer-card p-6 h-64 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
                <div className="h-40 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        }>
          <TrendCharts
            hiringTrend={saStats.hiringTrend}
            attendanceTrend={saStats.attendanceTrend}
            leaveTrend={saStats.leaveTrend}
          />
        </Suspense>
      )}

      {/* ═══ ACTION CENTER + ATTENTION REQUIRED + UPCOMING HOLIDAYS (All roles) ═ */}
      {hrStats && (
        <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {/* ACTION CENTER */}
          <DashboardSection
            title="Action Center"
            icon={AlertTriangle}
            iconColor="text-amber-500"
            badge={totalPending > 0 ? totalPending : undefined}
            badgeVariant="warning"
          >
            {actionItems.length > 0 ? (
              <div className="space-y-2">
                {actionItems.map((ai) => (
                  <ActionCard key={ai.label} {...ai} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <UserCheck size={28} className="text-emerald-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">All caught up! No pending actions.</p>
              </div>
            )}
          </DashboardSection>

          {/* ATTENTION REQUIRED */}
          <DashboardSection title="Attention Required" icon={ShieldAlert} iconColor="text-red-500">
            {hrStats.attentionItems.length > 0 ? (
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {hrStats.attentionItems.map((attn: AttentionItem, i: number) => {
                  const AttnIcon = attentionIconMap[attn.type] || AlertTriangle;
                  return (
                    <div
                      key={i}
                      onClick={() => attn.action && navigate(attn.action)}
                      className="flex items-start gap-3 py-2.5 px-3 bg-surface-2 rounded-lg cursor-pointer hover:bg-surface-3 transition-colors"
                    >
                      <AttnIcon size={14} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{attn.title}</p>
                        <p className="text-xs text-gray-500 truncate">{attn.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <UserCheck size={28} className="text-emerald-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No issues need attention right now</p>
              </div>
            )}
          </DashboardSection>

          {/* UPCOMING HOLIDAYS */}
          <DashboardSection title="Upcoming Holidays" icon={CalendarDays} iconColor="text-indigo-500">
            {upcomingHolidays.length > 0 ? (
              <div className="space-y-2">
                {upcomingHolidays.map((h: { id: string; name: string; date: string }) => {
                  const d = new Date(h.date);
                  const daysLeft = Math.ceil((d.getTime() - new Date().setHours(0,0,0,0)) / 86400000);
                  return (
                    <div key={h.id} className="flex items-center justify-between py-2 px-3 bg-surface-2 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{h.name}</p>
                        <p className="text-xs text-gray-400 font-mono" data-mono>
                          {d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 shrink-0 ${
                        daysLeft <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'
                      }`}>
                        {daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <CalendarDays size={28} className="text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No upcoming holidays</p>
              </div>
            )}
          </DashboardSection>
        </motion.div>
      )}

      {/* ═══ RECENT LEAVE REQUESTS (HR only) ════════════════════ */}
      {isHR && hrStats?.recentLeaveRequests && hrStats.recentLeaveRequests.length > 0 && (
        <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} initial="hidden" animate="show" className="mb-6">
          <DashboardSection
            title="Recent Leave Requests"
            icon={ListChecks}
            iconColor="text-amber-500"
            badge={hrStats.pendingActions.leaveRequests > 0 ? hrStats.pendingActions.leaveRequests : undefined}
            badgeVariant="warning"
          >
            <div className="space-y-2">
              {hrStats.recentLeaveRequests.map((l: { id: string; employeeName: string; leaveType: string; days: number; startDate: string; endDate: string; reason?: string }) => (
                <div
                  key={l.id}
                  onClick={() => navigate('/pending-approvals')}
                  className="flex items-center justify-between py-2.5 px-3 bg-surface-2 rounded-lg cursor-pointer hover:bg-surface-3 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{l.employeeName}</p>
                    <p className="text-xs text-gray-400">{l.leaveType} · {new Date(l.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(l.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className="text-xs font-mono text-gray-500" data-mono>{l.days}d</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Pending</span>
                  </div>
                </div>
              ))}
              <button onClick={() => navigate('/pending-approvals')} className="w-full text-xs text-brand-600 hover:text-brand-700 flex items-center justify-center gap-1 pt-1">
                View all pending approvals <ChevronRight size={12} />
              </button>
            </div>
          </DashboardSection>
        </motion.div>
      )}

      {/* ═══ LIVE ATTENDANCE + DEPARTMENT HEADCOUNT (Admin / Super Admin only) ═ */}
      {!isHR && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <Suspense fallback={<div className="layer-card p-6 h-48 animate-pulse"><div className="h-5 bg-gray-200 rounded w-32 mb-4" /></div>}>
            <LiveAttendanceWidget />
          </Suspense>
          {saStats && (
            <DashboardSection title="Department Headcount" icon={Building2} iconColor="text-indigo-500">
              <DepartmentBreakdown departments={saStats.departmentBreakdown} total={saStats.totalEmployees} />
            </DashboardSection>
          )}
        </div>
      )}

      {/* ═══ ON LEAVE + RECENT HIRES/EXITS + BIRTHDAYS ══════════ */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Today's Leaves (HR) */}
        {hrStats && (
          <DashboardSection
            title="On Leave Today"
            icon={CalendarOff}
            iconColor="text-purple-500"
            badge={att?.onLeave}
            badgeVariant="info"
          >
            {hrStats.todayLeaves.length > 0 ? (
              <div className="space-y-2">
                {hrStats.todayLeaves.map((leave) => (
                  <div key={leave.id} className="flex items-center justify-between py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{leave.employeeName}</p>
                      <p className="text-[10px] text-gray-400">{leave.leaveType}</p>
                    </div>
                    <span className="text-xs font-mono text-gray-500" data-mono>{leave.days}d</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-6">No one on leave today</p>
            )}
          </DashboardSection>
        )}

        {/* Recent Activity (SuperAdmin has hires+exits, HR has hires) */}
        <DashboardSection title="Recent Activity" icon={UserPlus} iconColor="text-emerald-500">
          {saStats ? (
            saStats.recentHires.length === 0 && saStats.recentExits.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No recent activity</p>
            ) : (
              <>
                <EmployeeListWidget items={saStats.recentHires.slice(0, 3)} type="hire" />
                <EmployeeListWidget items={saStats.recentExits.slice(0, 2)} type="exit" />
              </>
            )
          ) : hrStats ? (
            <EmployeeListWidget items={hrStats.recentHires} type="hire" emptyText="No recent hires" />
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No recent activity</p>
          )}
        </DashboardSection>

        {/* Birthdays */}
        <DashboardSection title="Upcoming Birthdays" icon={Cake} iconColor="text-pink-500">
          <EmployeeListWidget
            items={(saStats?.upcomingBirthdays || hrStats?.upcomingBirthdays || [])}
            type="birthday"
            clickable={false}
            emptyText="No upcoming birthdays"
          />
        </DashboardSection>
      </motion.div>

      {/* ═══ QUICK ACTIONS (All admin roles) ════════════════════ */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
        initial="hidden"
        animate="show"
        className="layer-card p-5"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
        <QuickActionGrid actions={QUICK_ACTIONS} columns="grid-cols-4 md:grid-cols-4" />
      </motion.div>
    </div>
  );
}

// ─── Department Breakdown sub-component ─────────────────────────
const DepartmentBreakdown = memo(function DepartmentBreakdown({
  departments,
  total,
}: {
  departments: { name: string; count: number }[];
  total: number;
}) {
  if (departments.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-8">No departments</p>;
  }
  return (
    <div className="space-y-2">
      {departments.map((dept) => (
        <div key={dept.name} className="flex items-center justify-between py-1.5">
          <span className="text-sm text-gray-600 truncate mr-2">{dept.name}</span>
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${Math.min((dept.count / Math.max(total, 1)) * 100, 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-gray-500 w-6 text-right" data-mono>{dept.count}</span>
          </div>
        </div>
      ))}
    </div>
  );
});

export default memo(AdminDashboard);
