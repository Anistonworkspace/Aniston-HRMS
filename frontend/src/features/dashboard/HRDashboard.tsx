import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Users, UserCheck, UserX, Clock, CalendarOff, Home,
  AlertTriangle, FileCheck, Ticket, UserPlus, ShieldAlert,
  Cake, ChevronRight, ClipboardList,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../app/store';
import { useGetHRStatsQuery } from './dashboardApi';
import { formatDate } from '../../lib/utils';
import {
  StatusCard, DashboardSection, ActionCard, QuickActionGrid,
  EmployeeListWidget, SkeletonLoader, MobileStickyActions,
} from './components';
import type { AttentionItem } from '@aniston/shared';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const MOBILE_STICKY_ACTIONS = [
  { label: 'Approvals', path: '/pending-approvals', icon: ClipboardList, color: 'text-amber-600' },
  { label: 'Attendance', path: '/attendance', icon: Clock, color: 'text-blue-600' },
  { label: 'Helpdesk', path: '/helpdesk', icon: Ticket, color: 'text-purple-600' },
  { label: 'Employees', path: '/employees', icon: Users, color: 'text-gray-600' },
];

const QUICK_ACTIONS = [
  { label: 'Approve Leaves', path: '/pending-approvals', icon: '✅' },
  { label: 'Manage Attendance', path: '/attendance', icon: '📊' },
  { label: 'Add Employee', path: '/employees', icon: '➕' },
  { label: 'View Helpdesk', path: '/helpdesk', icon: '🎫' },
  { label: 'Run Payroll', path: '/payroll', icon: '💰' },
  { label: 'Recruitment', path: '/recruitment', icon: '🎯' },
  { label: 'Walk-ins', path: '/walk-in-management', icon: '🚶' },
  { label: 'Send Bulk Email', path: '/send-bulk-email', icon: '📧' },
];

const attentionIconMap: Record<string, typeof Clock> = {
  late: Clock,
  missing_checkout: ShieldAlert,
  leave_conflict: CalendarOff,
  probation_ending: UserPlus,
  document_expiry: FileCheck,
};

function HRDashboard() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { data: response, isLoading, isError } = useGetHRStatsQuery(undefined, {
    pollingInterval: 60000,
  });
  const stats = response?.data;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const attendanceCards = useMemo(() => {
    if (!stats) return [];
    const att = stats.todayAttendance;
    return [
      { label: 'Present', value: att.present, icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
      { label: 'Absent', value: att.absent, icon: UserX, color: 'text-red-600', bg: 'bg-red-50' },
      { label: 'Late', value: att.late, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
      { label: 'On Leave', value: att.onLeave, icon: CalendarOff, color: 'text-purple-600', bg: 'bg-purple-50' },
      { label: 'Not Checked In', value: att.notCheckedIn, icon: ShieldAlert, color: 'text-gray-600', bg: 'bg-gray-50' },
      { label: 'WFH', value: att.workFromHome, icon: Home, color: 'text-blue-600', bg: 'bg-blue-50' },
    ];
  }, [stats]);

  const actionItems = useMemo(() => {
    if (!stats) return [];
    const pa = stats.pendingActions;
    return [
      { label: 'Leave Requests', count: pa.leaveRequests, icon: CalendarOff, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', path: '/pending-approvals' },
      { label: 'Regularizations', count: pa.regularizations, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', path: '/attendance' },
      { label: 'Helpdesk Tickets', count: pa.helpdeskTickets, icon: Ticket, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', path: '/helpdesk' },
      { label: 'Documents to Verify', count: pa.documentsToVerify, icon: FileCheck, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200', path: '/employees' },
      { label: 'Pending Onboarding', count: pa.pendingOnboarding, icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', path: '/employees' },
    ].filter((a) => a.count > 0);
  }, [stats]);

  const totalPending = useMemo(() => {
    if (!stats) return 0;
    const pa = stats.pendingActions;
    return pa.leaveRequests + pa.regularizations + pa.helpdeskTickets + pa.documentsToVerify + pa.pendingOnboarding;
  }, [stats]);

  // === LOADING ===
  if (isLoading) {
    return (
      <div className="page-container">
        <div className="mb-6">
          <div className="h-8 bg-gray-200 rounded-lg w-64 mb-2 animate-pulse" />
          <div className="h-4 bg-gray-100 rounded w-48 animate-pulse" />
        </div>
        <SkeletonLoader variant="status-grid" count={6} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <SkeletonLoader variant="section" count={3} />
          <SkeletonLoader variant="section" count={3} />
        </div>
      </div>
    );
  }

  // === ERROR ===
  if (isError || !stats) {
    return (
      <div className="page-container">
        <div className="layer-card p-12 text-center">
          <AlertTriangle size={32} className="text-red-400 mx-auto mb-3" />
          <p className="text-red-500 font-medium">Failed to load dashboard</p>
          <p className="text-sm text-gray-400 mt-1">Please refresh the page</p>
        </div>
      </div>
    );
  }

  const att = stats.todayAttendance;
  const presentPct = att.totalActive > 0 ? Math.round(((att.present + att.workFromHome) / att.totalActive) * 100) : 0;

  return (
    <div className="page-container pb-20 md:pb-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting}, {user?.firstName || 'HR'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Today's operations — {formatDate(new Date(), 'long')}
        </p>
      </motion.div>

      {/* TODAY'S ATTENDANCE STATUS */}
      <motion.div variants={container} initial="hidden" animate="show" className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-600">Today's Status</h2>
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
        {/* Attendance percentage bar */}
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

      {/* Two Column: Action Center + Attention Required */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 gap-4 mb-6">
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
          {stats.attentionItems.length > 0 ? (
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {stats.attentionItems.map((attn: AttentionItem, i: number) => {
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
      </motion.div>

      {/* Bottom Row: Today's Leaves + Recent Hires + Birthdays */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Today's Leaves */}
        <DashboardSection
          title="On Leave Today"
          icon={CalendarOff}
          iconColor="text-purple-500"
          badge={att.onLeave}
          badgeVariant="info"
        >
          {stats.todayLeaves.length > 0 ? (
            <div className="space-y-2">
              {stats.todayLeaves.map((leave) => (
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

        {/* Recent Hires */}
        <DashboardSection title="Recent Hires" icon={UserPlus} iconColor="text-emerald-500">
          <EmployeeListWidget
            items={stats.recentHires}
            type="hire"
            emptyText="No recent hires"
          />
        </DashboardSection>

        {/* Birthdays */}
        <DashboardSection title="Upcoming Birthdays" icon={Cake} iconColor="text-pink-500">
          <EmployeeListWidget
            items={stats.upcomingBirthdays}
            type="birthday"
            clickable={false}
            emptyText="No upcoming birthdays"
          />
        </DashboardSection>
      </motion.div>

      {/* Quick Actions — hidden on mobile (replaced by sticky bar) */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
        initial="hidden"
        animate="show"
        className="layer-card p-5 hidden md:block"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
        <QuickActionGrid actions={QUICK_ACTIONS} />
      </motion.div>

      {/* Mobile Sticky Actions */}
      <MobileStickyActions actions={MOBILE_STICKY_ACTIONS} />
    </div>
  );
}

export default memo(HRDashboard);
