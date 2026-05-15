import { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  Users,
  Clock,
  CalendarDays,
  DollarSign,
  Briefcase,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  FileText,
  Network,
  Megaphone,
  HelpCircle,
  UserPlus,
  LogOut,
  Award,
  ClipboardCheck,
  Monitor,
  Laptop,
  UserMinus,
  MessageCircle,
  Activity,
  FileCheck,
  CheckCircle2,
  Mail,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { cn } from '../../lib/utils';
import { useGetWhatsAppStatusQuery, useGetWhatsAppChatsQuery } from '../../features/whatsapp/whatsappApi';
import { useGetEmployeeQuery } from '../../features/employee/employeeApi';
import { useLogoutMutation } from '../../features/auth/authApi';
import { useTranslation } from 'react-i18next';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

interface NavItem {
  nameKey: string;
  managementNameKey?: string;
  path: string;
  icon: React.ElementType;
  roles?: string[];
  exitAccessKey?: string;
  permissionKey?: string;
}

// Paths visible to ADMIN role (IT/system admin) — HR paths are intentionally excluded
const ADMIN_ALLOWED_PATHS = new Set(['/dashboard', '/activity-tracking', '/exit-management', '/assets', '/announcements', '/helpdesk', '/settings', '/profile']);

const navItems: NavItem[] = [
  { nameKey: 'nav.dashboard', path: '/dashboard', icon: Home, exitAccessKey: 'canViewDashboard', permissionKey: 'canViewDashboardStats' },
  { nameKey: 'nav.employees', managementNameKey: 'nav.manageEmployees', path: '/employees', icon: Users, roles: ['SUPER_ADMIN', 'HR', 'MANAGER'] },
  { nameKey: 'nav.attendance', managementNameKey: 'nav.attendanceManagement', path: '/attendance', icon: Clock, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'], exitAccessKey: 'canViewAttendance', permissionKey: 'canViewAttendanceHistory' },
  { nameKey: 'nav.activityTracking', path: '/activity-tracking', icon: Activity, roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
  { nameKey: 'nav.leave', managementNameKey: 'nav.leaveManagement', path: '/leaves', icon: CalendarDays, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'], exitAccessKey: 'canViewLeaveBalance', permissionKey: 'canViewLeaveBalance' },
  { nameKey: 'nav.payroll', path: '/payroll', icon: DollarSign, roles: ['SUPER_ADMIN', 'HR'], exitAccessKey: 'canViewPayslips' },
  { nameKey: 'nav.payslips', path: '/payroll', icon: DollarSign, roles: ['EMPLOYEE', 'INTERN', 'MANAGER'], permissionKey: 'canViewPayslips' },
  { nameKey: 'nav.roster', path: '/roster', icon: CalendarDays, roles: ['SUPER_ADMIN', 'HR'] },
  { nameKey: 'nav.recruitment', path: '/recruitment', icon: Briefcase, roles: ['SUPER_ADMIN', 'HR', 'MANAGER'] },
  { nameKey: 'nav.employeeExit', path: '/exit-management', icon: UserMinus, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { nameKey: 'nav.interviewTasks', path: '/interview-assignments', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'GUEST_INTERVIEWER'] },
  { nameKey: 'nav.assets', managementNameKey: 'nav.assetManagement', path: '/assets', icon: Monitor, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { nameKey: 'nav.myAssets', path: '/my-assets', icon: Laptop, roles: ['MANAGER', 'EMPLOYEE', 'INTERN'] },
  { nameKey: 'nav.myDocuments', path: '/my-documents', icon: FileCheck, roles: ['EMPLOYEE', 'INTERN', 'MANAGER'], exitAccessKey: 'canViewDocuments', permissionKey: 'canViewDocuments' },
  { nameKey: 'nav.performance', path: '/performance', icon: BarChart3, roles: ['EMPLOYEE', 'INTERN', 'MANAGER'], permissionKey: 'canViewPerformance' },
  { nameKey: 'nav.policies', path: '/policies', icon: FileText, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'], permissionKey: 'canViewPolicies' },
  { nameKey: 'nav.announcements', path: '/announcements', icon: Megaphone, exitAccessKey: 'canViewAnnouncements', permissionKey: 'canViewAnnouncements' },
  { nameKey: 'nav.helpdesk', path: '/helpdesk', icon: HelpCircle, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'], exitAccessKey: 'canViewHelpdesk', permissionKey: 'canRaiseHelpdeskTickets' },
  { nameKey: 'nav.bulkEmail', path: '/bulk-email', icon: Mail, roles: ['SUPER_ADMIN', 'HR'] },
  { nameKey: 'nav.whatsapp', path: '/whatsapp', icon: MessageCircle, roles: ['SUPER_ADMIN', 'HR'] },
  { nameKey: 'nav.orgChart', path: '/org-chart', icon: Network, roles: ['SUPER_ADMIN', 'HR', 'MANAGER'] },
  { nameKey: 'nav.reports', path: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'HR', 'MANAGER'] },
  { nameKey: 'nav.settings', path: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { nameKey: 'nav.profile', path: '/profile', icon: Users, exitAccessKey: 'canViewProfile', permissionKey: 'canViewEditProfile' },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const user = useAppSelector((state) => state.auth.user);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  // WhatsApp unread count — only query when WhatsApp is connected
  const canSeeWhatsApp = user?.role && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role);
  const { data: whatsAppStatusRes } = useGetWhatsAppStatusQuery(undefined, {
    skip: !canSeeWhatsApp,
    pollingInterval: 60000,
  });
  const isWhatsAppConnected = whatsAppStatusRes?.data?.isConnected;
  const { data: whatsAppChatsRes } = useGetWhatsAppChatsQuery(undefined, {
    skip: !canSeeWhatsApp || !isWhatsAppConnected,
    pollingInterval: 30000,
  });
  const whatsAppUnreadCount = (whatsAppChatsRes?.data || []).reduce(
    (sum: number, chat: any) => sum + (chat.unreadCount || 0),
    0
  );

  const [logoutApi] = useLogoutMutation();
  const handleLogout = async () => {
    try { await logoutApi().unwrap(); } catch { /* proceed with client logout even if API fails */ }
    dispatch({ type: 'auth/logout' });
    navigate('/login');
  };

  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;

  const exitAccess = user?.exitAccess;

  const featurePermissions = (user as any)?.featurePermissions;

  const filteredItems = navItems.filter((item) => {
    // ADMIN system account: only show explicitly allowed paths
    if (user?.role === 'ADMIN') return ADMIN_ALLOWED_PATHS.has(item.path);
    // If user has exit access restrictions, only show allowed items
    if (exitAccess) {
      if (!item.exitAccessKey) return false;
      return (exitAccess as any)[item.exitAccessKey] === true;
    }
    // Normal role-based filtering
    if (item.roles && !(user?.role && item.roles.includes(user.role))) return false;
    // Feature permission check (for active employees with restrictions)
    if (!exitAccess && featurePermissions && item.permissionKey) {
      if ((featurePermissions as any)[item.permissionKey] === false) return false;
    }
    return true;
  });

  return (
    <>
    <motion.aside
      animate={{ width: collapsed ? 60 : 230 }}
      transition={{ duration: 0.15, ease: [0, 0, 0.35, 1] }}
      className="hidden md:flex flex-col h-full z-40"
      style={{
        background: 'var(--primary-background-color)',
        borderRight: '1px solid var(--layout-border-color)',
      }}
    >
      {/* Logo — 48px to match topbar */}
      <div
        className="flex items-center gap-2.5 px-3 shrink-0"
        style={{
          height: '48px',
          borderBottom: '1px solid var(--layout-border-color)',
        }}
      >
        <img src="/logo.png" alt="Aniston" className="flex-shrink-0 w-8 h-8 object-contain" />
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.1, ease: [0, 0, 0.35, 1] }}
              className="whitespace-nowrap font-semibold text-base"
              style={{ color: 'var(--primary-text-color)', fontFamily: 'var(--title-font-family)' }}
            >
              Aniston
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto custom-scrollbar py-2 px-2 space-y-0.5">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          const label = isManagement && item.managementNameKey ? t(item.managementNameKey) : t(item.nameKey);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn('flex items-center gap-2.5 px-2 transition-all group relative', collapsed ? 'justify-center' : '')}
              style={{
                height: '36px',
                borderRadius: 'var(--border-radius-small)',
                background: isActive ? 'var(--primary-selected-color)' : 'transparent',
                color: isActive ? 'var(--primary-color)' : 'var(--secondary-text-color)',
                fontWeight: isActive ? 600 : 400,
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--primary-background-hover-color)'; if (!isActive) e.currentTarget.style.color = 'var(--primary-text-color)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; if (!isActive) e.currentTarget.style.color = 'var(--secondary-text-color)'; }}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                  style={{ width: '3px', height: '20px', background: 'var(--primary-color)' }}
                  transition={{ duration: 0.15, ease: [0, 0, 0.35, 1] }}
                />
              )}
              <item.icon
                size={18}
                className="flex-shrink-0"
                style={{ color: isActive ? 'var(--primary-color)' : 'var(--icon-color)' }}
              />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                    className="whitespace-nowrap flex-1 text-sm"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
              {item.path === '/whatsapp' && whatsAppUnreadCount > 0 && (
                <span
                  className="w-4 h-4 text-white text-[9px] flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--positive-color)', borderRadius: '50%' }}
                >
                  {whatsAppUnreadCount > 99 ? '99+' : whatsAppUnreadCount}
                </span>
              )}
              {/* Tooltip — only shown when sidebar is collapsed */}
              {collapsed && (
                <span
                  className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5"
                  style={{
                    background: 'var(--inverted-color-background)',
                    color: 'var(--text-color-on-inverted)',
                    borderRadius: 'var(--border-radius-small)',
                    boxShadow: 'var(--box-shadow-medium)',
                    transitionDuration: 'var(--motion-productive-medium)',
                  }}
                >
                  {label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Profile Completion — hidden for system admin roles */}
      {user?.role && !['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role) && (
        <ProfileCompletionBar collapsed={collapsed} />
      )}

      {/* Logout + Collapse */}
      <div
        className="px-2 py-2 space-y-0.5"
        style={{ borderTop: '1px solid var(--layout-border-color)' }}
      >
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2 transition-all"
          style={{
            height: '36px',
            borderRadius: 'var(--border-radius-small)',
            color: 'var(--negative-color)',
            background: 'transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--negative-color-selected)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut size={17} className="flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="text-xs font-medium">
                {t('nav.logout')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-2 transition-all"
          style={{
            height: '32px',
            borderRadius: 'var(--border-radius-small)',
            color: 'var(--secondary-text-color)',
            background: 'transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="text-xs">
                {t('nav.collapse')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>

    </>
  );
}

function ProfileCompletionBar({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const user = useAppSelector((state) => state.auth.user);
  const { data: empRes } = useGetEmployeeQuery(user?.employeeId || '', {
    skip: !user?.employeeId,
  });
  const employee = empRes?.data;
  const navigate = useNavigate();

  const { completionPct, completedCount, totalCount } = useMemo(() => {
    if (!employee) return { completionPct: 0, completedCount: 0, totalCount: 5 };
    const items = [
      !!(employee.phone && employee.phone !== '0000000000' && employee.dateOfBirth),
      !!(employee.emergencyContact && (employee.emergencyContact as any)?.name),
      !!(employee.department && employee.designation),
      (employee.documents?.length || 0) >= 3,
      !!employee.bankAccountNumber,
    ];
    const done = items.filter(Boolean).length;
    return { completionPct: Math.round((done / items.length) * 100), completedCount: done, totalCount: items.length };
  }, [employee]);

  if (!employee || completionPct === 100) return null;

  const progressColor = completionPct >= 60 ? 'var(--positive-color)' : completionPct >= 40 ? 'var(--warning-color-hover)' : 'var(--negative-color)';

  return (
    <div
      className="mx-2 mb-1 px-3 py-2 cursor-pointer transition-colors"
      style={{
        borderRadius: 'var(--border-radius-small)',
        background: 'var(--allgrey-background-color)',
        border: '1px solid var(--layout-border-color)',
      }}
      onClick={() => navigate('/profile')}
      title={t('sidebar.profileCompletion')}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--primary-background-hover-color)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--allgrey-background-color)')}
    >
      {collapsed ? (
        <div className="flex items-center justify-center">
          <div className="relative w-7 h-7">
            <svg className="w-7 h-7 -rotate-90" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="13" fill="none" stroke="var(--ui-background-color)" strokeWidth="3" />
              <circle
                cx="16" cy="16" r="13" fill="none" stroke={progressColor}
                strokeWidth="3" strokeDasharray={`${(completionPct / 100) * 81.68} 81.68`} strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold" style={{ color: 'var(--secondary-text-color)' }}>{completionPct}%</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--secondary-text-color)' }}>{t('sidebar.profileCompletion')}</span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--icon-color)' }} data-mono>{completedCount}/{totalCount}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--ui-background-color)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${completionPct}%`, background: progressColor, transitionDuration: 'var(--motion-expressive-short)' }} />
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--icon-color)' }}>{completionPct}% {t('sidebar.complete')}</p>
        </>
      )}
    </div>
  );
}
