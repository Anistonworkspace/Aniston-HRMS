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
  Send,
  FileCog,
  CheckCircle2,
  ShieldCheck,
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

// Paths visible to ADMIN role (system account) — everything else is hidden
const ADMIN_ALLOWED_PATHS = new Set(['/dashboard', '/activity-tracking', '/exit-management', '/assets', '/announcements', '/settings', '/profile']);

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
  { nameKey: 'nav.kycReview', path: '/kyc-review', icon: ShieldCheck, roles: ['SUPER_ADMIN', 'HR'] },
  { nameKey: 'nav.employeeExit', path: '/exit-management', icon: UserMinus, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { nameKey: 'nav.interviewTasks', path: '/interview-assignments', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'GUEST_INTERVIEWER'] },
  { nameKey: 'nav.assets', managementNameKey: 'nav.assetManagement', path: '/assets', icon: Monitor, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { nameKey: 'nav.myAssets', path: '/my-assets', icon: Laptop, roles: ['HR', 'MANAGER', 'EMPLOYEE', 'INTERN'] },
  { nameKey: 'nav.myDocuments', path: '/my-documents', icon: FileCheck, roles: ['EMPLOYEE', 'INTERN', 'MANAGER', 'HR'], exitAccessKey: 'canViewDocuments', permissionKey: 'canViewDocuments' },
  { nameKey: 'nav.performance', path: '/performance', icon: BarChart3, roles: ['EMPLOYEE', 'INTERN', 'MANAGER'], permissionKey: 'canViewPerformance' },
  { nameKey: 'nav.policies', path: '/policies', icon: FileText, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'], permissionKey: 'canViewPolicies' },
  { nameKey: 'nav.announcements', path: '/announcements', icon: Megaphone, exitAccessKey: 'canViewAnnouncements', permissionKey: 'canViewAnnouncements' },
  { nameKey: 'nav.helpdesk', path: '/helpdesk', icon: HelpCircle, roles: ['SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN'], exitAccessKey: 'canViewHelpdesk', permissionKey: 'canRaiseHelpdeskTickets' },
  { nameKey: 'nav.sendBulkEmail', path: '/send-bulk-email', icon: Send, roles: ['SUPER_ADMIN', 'HR'] },
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
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="hidden md:flex flex-col bg-white border-r border-gray-200 h-full z-40"
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-100">
        <img src="/logo.png" alt="Aniston" className="flex-shrink-0 w-9 h-9 object-contain" />
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="text-gray-900 font-display font-semibold text-lg whitespace-nowrap"
            >
              Aniston
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto custom-scrollbar py-4 px-2 space-y-1">
        {filteredItems.map((item) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          const label = isManagement && item.managementNameKey ? t(item.managementNameKey) : t(item.nameKey);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative',
                isActive
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-brand-600 rounded-r-full"
                />
              )}
              <item.icon
                size={20}
                className={cn('flex-shrink-0', isActive ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-600')}
              />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm whitespace-nowrap flex-1"
                  >
                    {label}
                  </motion.span>
                )}
              </AnimatePresence>
              {item.path === '/whatsapp' && whatsAppUnreadCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center flex-shrink-0">
                  {whatsAppUnreadCount > 99 ? '99+' : whatsAppUnreadCount}
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
      <div className="px-2 py-3 border-t border-gray-100 space-y-1">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
        >
          <LogOut size={18} className="flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs font-medium">
                {t('nav.logout')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs">
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

  const barColor = completionPct >= 60 ? 'bg-emerald-500' : completionPct >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div
      className="mx-2 mb-1 px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors"
      onClick={() => navigate('/profile')}
      title={t('sidebar.profileCompletion')}
    >
      {collapsed ? (
        <div className="flex items-center justify-center">
          <div className="relative w-8 h-8">
            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="13" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle
                cx="16" cy="16" r="13" fill="none" stroke={completionPct >= 60 ? '#22c55e' : completionPct >= 40 ? '#f59e0b' : '#ef4444'}
                strokeWidth="3" strokeDasharray={`${(completionPct / 100) * 81.68} 81.68`} strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-gray-600">{completionPct}%</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-gray-600">{t('sidebar.profileCompletion')}</span>
            <span className="text-[10px] font-mono text-gray-400" data-mono>{completedCount}/{totalCount}</span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${completionPct}%` }} />
          </div>
          <p className="text-[10px] text-gray-400 mt-1">{completionPct}% {t('sidebar.complete')}</p>
        </>
      )}
    </div>
  );
}
