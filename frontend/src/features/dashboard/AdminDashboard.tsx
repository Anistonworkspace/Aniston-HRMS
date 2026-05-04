import { memo, useMemo, lazy, Suspense, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, UserPlus,
  AlertTriangle, Building2, Cake, UserCheck, UserX,
  Clock, CalendarOff, ShieldAlert, FileCheck,
  Ticket, ChevronRight, CalendarDays, ListChecks, X, ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { useGetSuperAdminStatsQuery, useGetHRStatsQuery } from './dashboardApi';
import { useGetHolidaysQuery } from '../leaves/leaveApi';
import { useGetProfileEditRequestsForOrgQuery } from '../profile/profileEditRequestApi';
import {
  AlertBanner, DashboardSection, StatusCard,
  ActionCard, QuickActionGrid, EmployeeListWidget, SkeletonLoader,
} from './components';
import { UserCog } from 'lucide-react';
import type { SuperAdminDashboardStats, AttentionItem } from '@aniston/shared';

// Lazy-load heavy chart components
const TrendCharts = lazy(() => import('./sections/TrendCharts'));

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
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const role = user?.role || '';
  const isHR = role === 'HR';
  const isSystemAdmin = role === 'ADMIN'; // system/IT admin — not HR, not Super Admin
  const locale = i18n.language?.startsWith('hi') ? 'hi-IN' : 'en-IN';

  // Fetch BOTH data sources in parallel
  const { data: saResponse, isLoading: saLoading, isError: saError } = useGetSuperAdminStatsQuery(undefined, {
    pollingInterval: 300000,
  });
  const { data: hrResponse, isLoading: hrLoading, isError: hrError } = useGetHRStatsQuery(undefined, {
    pollingInterval: 60000,
  });

  // Real-time dashboard updates via socket — no manual refresh needed
  const handleDashboardRefresh = useCallback(() => {
    dispatch(api.util.invalidateTags(['Dashboard'] as any));
  }, [dispatch]);

  useEffect(() => {
    // dashboard:refresh  — emitted by backend after any leave/attendance/payroll change
    // leave:actioned     — emitted directly to HR when a leave is approved/rejected
    onSocketEvent('dashboard:refresh', handleDashboardRefresh);
    onSocketEvent('leave:actioned', handleDashboardRefresh);
    onSocketEvent('leave:applied', handleDashboardRefresh);

    return () => {
      offSocketEvent('dashboard:refresh', handleDashboardRefresh);
      offSocketEvent('leave:actioned', handleDashboardRefresh);
      offSocketEvent('leave:applied', handleDashboardRefresh);
    };
  }, [handleDashboardRefresh]);

  const { data: holidaysRes } = useGetHolidaysQuery({});
  const { data: pendingProfileRes } = useGetProfileEditRequestsForOrgQuery(
    { status: 'PENDING', limit: 100 },
    { skip: isSystemAdmin, pollingInterval: 60000 }
  );
  const pendingProfileEdits = pendingProfileRes?.data?.length || 0;

  const saStats = saResponse?.data;
  const hrStats = hrResponse?.data;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('dashboard.goodMorning') : hour < 17 ? t('dashboard.goodAfternoon') : t('dashboard.goodEvening');

  // ─── Popup state (attendance cards + action center) ───────────
  const [activePopup, setActivePopup] = useState<string | null>(null);
  const [actionPopup, setActionPopup] = useState<string | null>(null);

  // ─── Today's Attendance Cards (from HR stats) ─────────────────
  const attendanceCards = useMemo(() => {
    if (!hrStats) return [];
    const att = hrStats.todayAttendance;
    return [
      { label: 'Total', value: att.totalActive, icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50', employees: [] },
      { label: 'Present', value: att.present, icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50', employees: att.presentEmployees || [] },
      { label: 'Absent', value: att.absent, icon: UserX, color: 'text-red-600', bg: 'bg-red-50', employees: att.absentEmployees || [] },
      { label: 'Late', value: att.late, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', employees: att.lateEmployees || [] },
      { label: 'On Leave', value: att.onLeave, icon: CalendarOff, color: 'text-purple-600', bg: 'bg-purple-50', employees: att.onLeaveEmployees || [] },
    ];
  }, [hrStats]);

  // ─── Action Items (from HR stats) ─────────────────────────────
  const actionItems = useMemo(() => {
    if (!hrStats) return [];
    const pa = hrStats.pendingActions;
    if (isSystemAdmin) {
      return [
        { label: 'Helpdesk Tickets', count: pa.helpdeskTickets, icon: Ticket, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', path: '/helpdesk', popup: 'helpdesk' },
      ].filter((a) => a.count > 0);
    }
    return [
      { label: 'Leave Requests', count: pa.leaveRequests, icon: CalendarOff, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', path: '/pending-approvals', popup: null },
      { label: 'Regularizations', count: pa.regularizations, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', path: '/attendance', popup: null },
      { label: 'Helpdesk Tickets', count: pa.helpdeskTickets, icon: Ticket, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', path: '/helpdesk', popup: 'helpdesk' },
      { label: 'Documents to Verify', count: pa.documentsToVerify, icon: FileCheck, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200', path: '/employees', popup: 'docs' },
      { label: 'Pending Onboarding', count: pa.pendingOnboarding, icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', path: '/employees', popup: null },
      { label: 'Profile Edit Requests', count: pendingProfileEdits, icon: UserCog, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', path: '/employees', popup: null },
    ].filter((a) => a.count > 0);
  }, [hrStats, isSystemAdmin]);

  const totalPending = useMemo(() => {
    if (!hrStats) return 0;
    const pa = hrStats.pendingActions;
    if (isSystemAdmin) return pa.helpdeskTickets;
    return pa.leaveRequests + pa.regularizations + pa.helpdeskTickets + pa.documentsToVerify + pa.pendingOnboarding + pendingProfileEdits;
  }, [hrStats, isSystemAdmin, pendingProfileEdits]);

  const upcomingHolidays = useMemo(() =>
    (holidaysRes?.data || [])
      .filter((h: { date: string }) => new Date(h.date) >= new Date())
      .sort((a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5),
    [holidaysRes]
  );

  // ─── Quick Actions ────────────────────────────────────────────
  const QUICK_ACTIONS = isSystemAdmin ? [
    { label: t('nav.helpdesk'), path: '/helpdesk', icon: '🎫' },
    { label: t('nav.assetManagement') || 'Assets', path: '/assets', icon: '💼' },
    { label: t('nav.activityTracking'), path: '/activity-tracking', icon: '📊' },
    { label: t('nav.employeeExit') || 'Exit Mgmt', path: '/exit-management', icon: '🚪' },
    { label: t('nav.employees') || 'Employees', path: '/employees', icon: '👥' },
    { label: t('nav.reports'), path: '/reports', icon: '📈' },
    { label: t('nav.announcements'), path: '/announcements', icon: '📢' },
    { label: t('nav.settings'), path: '/settings', icon: '⚙️' },
  ] : [
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
  if (saLoading && hrLoading) return <SkeletonLoader variant="full-page" />;

  // ─── ERROR (both failed) ──────────────────────────────────────
  if ((saError || !saStats) && (hrError || !hrStats)) {
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

      {/* ═══ TODAY'S ATTENDANCE STATUS ════════════════════════════ */}
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
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {attendanceCards.map((card) => (
              <StatusCard
                key={card.label}
                {...card}
                onClick={card.label === 'Total' ? undefined : () => setActivePopup(card.label)}
              />
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

          {/* ── Attendance Popup ── */}
          <AnimatePresence>
            {activePopup && (() => {
              const card = attendanceCards.find((c) => c.label === activePopup);
              if (!card) return null;
              const Icon = card.icon;
              return (
                <motion.div
                  key="att-popup"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                  onClick={() => setActivePopup(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 12 }}
                    transition={{ duration: 0.18 }}
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={`${card.bg} px-5 py-4 flex items-center justify-between`}>
                      <div className="flex items-center gap-3">
                        <Icon size={18} className={card.color} />
                        <div>
                          <p className={`text-sm font-semibold ${card.color}`}>{card.label}</p>
                          <p className="text-xs text-gray-500">{card.value} employee{card.value !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setActivePopup(null)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                      {card.employees.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">No employees</p>
                      ) : (
                        card.employees.map((emp) => (
                          <div key={emp.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                              <span className="text-xs font-semibold text-gray-500">
                                {emp.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm text-gray-700">{emp.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ═══ QUICK ACTIONS (All admin roles) ════════════════════ */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
        initial="hidden"
        animate="show"
        className="layer-card p-5 mb-6"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
        <QuickActionGrid actions={QUICK_ACTIONS} columns="grid-cols-4 md:grid-cols-4" />
      </motion.div>

      {/* ═══ ON LEAVE + RECENT ACTIVITY + BIRTHDAYS ════════════ */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {hrStats && (
          <DashboardSection title="On Leave Today" icon={CalendarOff} iconColor="text-purple-500" badge={att?.onLeave} badgeVariant="info">
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
        <DashboardSection title="Upcoming Birthdays" icon={Cake} iconColor="text-pink-500">
          <EmployeeListWidget
            items={(saStats?.upcomingBirthdays || hrStats?.upcomingBirthdays || [])}
            type="birthday"
            clickable={false}
            emptyText="No upcoming birthdays"
          />
        </DashboardSection>
      </motion.div>

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
                  ai.popup
                    ? (
                      <div
                        key={ai.label}
                        onClick={() => setActionPopup(ai.popup!)}
                        className={`flex items-center justify-between py-2.5 px-3 ${ai.bg} rounded-lg border ${ai.border} cursor-pointer hover:shadow-sm transition-all`}
                      >
                        <div className="flex items-center gap-2">
                          <ai.icon size={15} className={ai.color} />
                          <span className="text-sm text-gray-700">{ai.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-gray-800" data-mono>{ai.count}</span>
                          <ExternalLink size={12} className="text-gray-400" />
                        </div>
                      </div>
                    )
                    : <ActionCard key={ai.label} {...ai} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <UserCheck size={28} className="text-emerald-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">All caught up! No pending actions.</p>
              </div>
            )}
          </DashboardSection>

          {/* ACTION CENTER POPUP — Documents / Helpdesk */}
          <AnimatePresence>
            {actionPopup && hrStats && (() => {
              const isDocs = actionPopup === 'docs';
              const isHelpdesk = actionPopup === 'helpdesk';
              const title = isDocs ? 'Documents to Verify' : 'Open Helpdesk Tickets';
              const Icon = isDocs ? FileCheck : Ticket;
              const iconColor = isDocs ? 'text-teal-600' : 'text-purple-600';
              const bgColor = isDocs ? 'bg-teal-50' : 'bg-purple-50';

              return (
                <motion.div
                  key="action-popup"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                  onClick={() => setActionPopup(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 12 }}
                    transition={{ duration: 0.18 }}
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={`${bgColor} px-5 py-4 flex items-center justify-between`}>
                      <div className="flex items-center gap-3">
                        <Icon size={18} className={iconColor} />
                        <div>
                          <p className={`text-sm font-semibold ${iconColor}`}>{title}</p>
                          <p className="text-xs text-gray-500">
                            {isDocs
                              ? `${hrStats.pendingActions.unverifiedDocEmployees.length} employee${hrStats.pendingActions.unverifiedDocEmployees.length !== 1 ? 's' : ''}`
                              : `${hrStats.pendingActions.openTicketsList.length} ticket${hrStats.pendingActions.openTicketsList.length !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => setActionPopup(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X size={16} />
                      </button>
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                      {isDocs && (
                        hrStats.pendingActions.unverifiedDocEmployees.length === 0
                          ? <p className="text-sm text-gray-400 text-center py-8">No pending documents</p>
                          : hrStats.pendingActions.unverifiedDocEmployees.map((emp) => (
                            <div
                              key={emp.id}
                              onClick={() => { navigate(`/employees/${emp.id}?tab=documents`); setActionPopup(null); }}
                              className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors cursor-pointer"
                            >
                              <div className="w-7 h-7 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
                                <span className="text-xs font-semibold text-teal-600">{emp.name.charAt(0).toUpperCase()}</span>
                              </div>
                              <span className="text-sm text-gray-700 flex-1">{emp.name}</span>
                              <ChevronRight size={14} className="text-gray-300" />
                            </div>
                          ))
                      )}
                      {isHelpdesk && (
                        hrStats.pendingActions.openTicketsList.length === 0
                          ? <p className="text-sm text-gray-400 text-center py-8">No open tickets</p>
                          : hrStats.pendingActions.openTicketsList.map((t) => (
                            <div
                              key={t.id}
                              onClick={() => { navigate('/helpdesk'); setActionPopup(null); }}
                              className="px-5 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                            >
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[10px] font-mono text-gray-400">{t.ticketCode}</span>
                                <span className="text-xs text-gray-500 truncate">{t.employeeName}</span>
                              </div>
                              <p className="text-sm text-gray-700 truncate">{t.subject}</p>
                            </div>
                          ))
                      )}
                    </div>

                    <div className="px-5 py-3 border-t border-gray-100">
                      <button
                        onClick={() => { navigate(isDocs ? '/employees' : '/helpdesk'); setActionPopup(null); }}
                        className="w-full text-xs text-brand-600 hover:text-brand-700 flex items-center justify-center gap-1"
                      >
                        View all in {isDocs ? 'Employees' : 'Helpdesk'} <ChevronRight size={12} />
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* ATTENTION REQUIRED */}
          <DashboardSection title="Attention Required" icon={ShieldAlert} iconColor="text-red-500">
            {(() => {
              // System Admin only sees exit/offboarding-related attention items
              const visibleItems = isSystemAdmin
                ? hrStats.attentionItems.filter((a: AttentionItem) => ['probation_ending', 'document_expiry'].includes(a.type))
                : hrStats.attentionItems;
              return visibleItems.length > 0 ? (
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {visibleItems.map((attn: AttentionItem, i: number) => {
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
            );
            })()}
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

      {/* ═══ DEPARTMENT HEADCOUNT ════════════════════════════════ */}
      {saStats && (
        <div className="mb-6">
          <DashboardSection title="Department Headcount" icon={Building2} iconColor="text-indigo-500">
            <DepartmentBreakdown departments={saStats.departmentBreakdown} total={saStats.totalEmployees} />
          </DashboardSection>
        </div>
      )}

      {/* ═══ TREND CHARTS (all system roles) ═══════════════════ */}
      {saStats && (
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
