import { motion } from 'framer-motion';
import {
  Users, UserCheck, UserX, Clock, CalendarOff, Home,
  AlertTriangle, FileCheck, Ticket, UserPlus, ShieldAlert,
  ArrowUpRight, Cake, Loader2, ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../app/store';
import { useGetHRStatsQuery } from './dashboardApi';
import { formatDate, getInitials } from '../../lib/utils';
import type { HRDashboardStats, AttentionItem } from '@aniston/shared';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function HRDashboard() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { data: response, isLoading, isError } = useGetHRStatsQuery(undefined, {
    pollingInterval: 60000, // refresh every 60s for real-time ops
  });
  const stats = response?.data;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  // === LOADING ===
  if (isLoading) {
    return (
      <div className="page-container">
        <div className="mb-6">
          <div className="h-8 bg-gray-200 rounded-lg w-64 mb-2 animate-pulse" />
          <div className="h-4 bg-gray-100 rounded w-48 animate-pulse" />
        </div>
        {/* Attendance status skeleton */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-6">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="layer-card p-3 animate-pulse">
              <div className="h-7 bg-gray-200 rounded w-8 mb-1" />
              <div className="h-3 bg-gray-100 rounded w-14" />
            </div>
          ))}
        </div>
        {/* Action center skeleton */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {[1,2].map(i => (
            <div key={i} className="layer-card p-5 h-48 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
              <div className="space-y-3">
                {[1,2,3].map(j => <div key={j} className="h-10 bg-gray-100 rounded" />)}
              </div>
            </div>
          ))}
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

  const { todayAttendance: att, pendingActions: pa } = stats;

  const attendanceCards = [
    { label: 'Present', value: att.present, icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Absent', value: att.absent, icon: UserX, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Late', value: att.late, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'On Leave', value: att.onLeave, icon: CalendarOff, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Not Checked In', value: att.notCheckedIn, icon: ShieldAlert, color: 'text-gray-600', bg: 'bg-gray-50' },
    { label: 'WFH', value: att.workFromHome, icon: Home, color: 'text-blue-600', bg: 'bg-blue-50' },
  ];

  const totalPending = pa.leaveRequests + pa.regularizations + pa.helpdeskTickets + pa.documentsToVerify + pa.pendingOnboarding;

  const actionItems = [
    { label: 'Leave Requests', count: pa.leaveRequests, icon: CalendarOff, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', path: '/pending-approvals' },
    { label: 'Regularizations', count: pa.regularizations, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', path: '/attendance' },
    { label: 'Helpdesk Tickets', count: pa.helpdeskTickets, icon: Ticket, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', path: '/helpdesk' },
    { label: 'Documents to Verify', count: pa.documentsToVerify, icon: FileCheck, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200', path: '/employees' },
    { label: 'Pending Onboarding', count: pa.pendingOnboarding, icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', path: '/employees' },
  ].filter((a) => a.count > 0);

  const attentionIconMap: Record<string, typeof Clock> = {
    late: Clock,
    missing_checkout: ShieldAlert,
    leave_conflict: CalendarOff,
    probation_ending: UserPlus,
    document_expiry: FileCheck,
  };

  return (
    <div className="page-container">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting()}, {user?.firstName || 'HR'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Today's operations — {formatDate(new Date(), 'long')}
        </p>
      </motion.div>

      {/* TODAY'S ATTENDANCE STATUS — always visible, responsive grid */}
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
            <motion.div
              key={card.label}
              variants={item}
              onClick={() => navigate('/attendance')}
              className={`${card.bg} rounded-xl p-3 cursor-pointer hover:shadow-sm transition-all border border-transparent hover:border-gray-200`}
            >
              <div className="flex items-center gap-2 mb-1">
                <card.icon size={14} className={card.color} />
              </div>
              <p className="text-xl font-bold font-mono text-gray-900" data-mono>{card.value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{card.label}</p>
            </motion.div>
          ))}
        </div>
        {/* Attendance percentage bar */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${att.totalActive > 0 ? Math.round(((att.present + att.workFromHome) / att.totalActive) * 100) : 0}%` }}
            />
          </div>
          <span className="text-xs font-mono text-gray-500" data-mono>
            {att.totalActive > 0 ? Math.round(((att.present + att.workFromHome) / att.totalActive) * 100) : 0}% present
          </span>
        </div>
      </motion.div>

      {/* Two Column: Action Center + Attention Required */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 gap-4 mb-6">
        {/* ACTION CENTER */}
        <motion.div variants={item} className="layer-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-500" />
              Action Center
              {totalPending > 0 && (
                <span className="badge badge-warning font-mono text-[10px]" data-mono>{totalPending}</span>
              )}
            </h2>
          </div>
          {actionItems.length > 0 ? (
            <div className="space-y-2">
              {actionItems.map((ai) => (
                <div
                  key={ai.label}
                  onClick={() => navigate(ai.path)}
                  className={`flex items-center justify-between py-2.5 px-3 ${ai.bg} rounded-lg border ${ai.border} cursor-pointer hover:shadow-sm transition-all`}
                >
                  <div className="flex items-center gap-2">
                    <ai.icon size={15} className={ai.color} />
                    <span className="text-sm text-gray-700">{ai.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-gray-800" data-mono>{ai.count}</span>
                    <ArrowUpRight size={12} className="text-gray-400" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <UserCheck size={28} className="text-emerald-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">All caught up! No pending actions.</p>
            </div>
          )}
        </motion.div>

        {/* ATTENTION REQUIRED */}
        <motion.div variants={item} className="layer-card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <ShieldAlert size={15} className="text-red-500" />
            Attention Required
          </h2>
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
        </motion.div>
      </motion.div>

      {/* Bottom Row: Today's Leaves + Recent Hires + Birthdays */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* Today's Leaves */}
        <motion.div variants={item} className="layer-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <CalendarOff size={15} className="text-purple-500" />
              On Leave Today
            </h3>
            <span className="badge badge-info font-mono text-[10px]" data-mono>{att.onLeave}</span>
          </div>
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
        </motion.div>

        {/* Recent Hires */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <UserPlus size={15} className="text-emerald-500" />
            Recent Hires
          </h3>
          {stats.recentHires.length > 0 ? (
            <div className="space-y-2">
              {stats.recentHires.map((hire) => (
                <div
                  key={hire.id}
                  onClick={() => navigate(`/employees/${hire.id}`)}
                  className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-50 rounded-lg px-1 transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-[10px]">
                    {getInitials(hire.firstName, hire.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{hire.firstName} {hire.lastName}</p>
                    <p className="text-[10px] text-gray-400">{hire.department || 'No dept'} · Joined {formatDate(hire.joiningDate)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No recent hires</p>
          )}
        </motion.div>

        {/* Birthdays */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Cake size={15} className="text-pink-500" />
            Upcoming Birthdays
          </h3>
          {stats.upcomingBirthdays.length > 0 ? (
            <div className="space-y-2">
              {stats.upcomingBirthdays.map((bday) => (
                <div key={bday.id} className="flex items-center gap-3 py-1.5">
                  <div className="w-7 h-7 rounded-lg bg-pink-100 flex items-center justify-center text-pink-700 font-semibold text-[10px]">
                    {getInitials(bday.firstName, bday.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{bday.firstName} {bday.lastName}</p>
                    <p className="text-[10px] text-gray-400 font-mono" data-mono>
                      {bday.dateOfBirth ? new Date(bday.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No upcoming birthdays</p>
          )}
        </motion.div>
      </motion.div>

      {/* Quick Actions — sticky on mobile */}
      <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Approve Leaves', path: '/pending-approvals', icon: '✅' },
            { label: 'Manage Attendance', path: '/attendance', icon: '📊' },
            { label: 'Add Employee', path: '/employees', icon: '➕' },
            { label: 'View Helpdesk', path: '/helpdesk', icon: '🎫' },
            { label: 'Run Payroll', path: '/payroll', icon: '💰' },
            { label: 'Recruitment', path: '/recruitment', icon: '🎯' },
            { label: 'Walk-ins', path: '/walk-in-management', icon: '🚶' },
            { label: 'Send Bulk Email', path: '/send-bulk-email', icon: '📧' },
          ].map((action) => (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-left active:scale-[0.98]"
            >
              <span className="text-lg">{action.icon}</span>
              <span className="text-xs font-medium text-gray-700">{action.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
