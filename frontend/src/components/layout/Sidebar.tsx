import { useState } from 'react';
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { cn } from '../../lib/utils';
import { useGetWhatsAppStatusQuery, useGetWhatsAppChatsQuery } from '../../features/whatsapp/whatsappApi';

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

interface NavItem {
  name: string;
  managementName?: string;
  path: string;
  icon: React.ElementType;
  roles?: string[];
  exitAccessKey?: string; // Key in ExitAccessInfo to check for exiting employees
  permissionKey?: string; // Key in FeaturePermissions to check for active employees
}

const navItems: NavItem[] = [
  { name: 'Dashboard', path: '/dashboard', icon: Home, exitAccessKey: 'canViewDashboard', permissionKey: 'canViewDashboardStats' },
  { name: 'Employees', managementName: 'Manage Employees', path: '/employees', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },
  { name: 'Attendance', managementName: 'Attendance Management', path: '/attendance', icon: Clock, exitAccessKey: 'canViewAttendance', permissionKey: 'canViewAttendanceHistory' },
  { name: 'Activity Tracking', path: '/activity-tracking', icon: Activity, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'Leave', managementName: 'Leave Management', path: '/leaves', icon: CalendarDays, exitAccessKey: 'canViewLeaveBalance', permissionKey: 'canViewLeaveBalance' },
  { name: 'Payroll', path: '/payroll', icon: DollarSign, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], exitAccessKey: 'canViewPayslips' },
  { name: 'Payslips', path: '/payroll', icon: DollarSign, roles: ['EMPLOYEE', 'INTERN', 'MANAGER'], permissionKey: 'canViewPayslips' },
  { name: 'Roster', path: '/roster', icon: CalendarDays, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { name: 'Recruitment', path: '/recruitment', icon: Briefcase, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },
  { name: 'Employee Exit', path: '/exit-management', icon: UserMinus, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { name: 'Interview Tasks', path: '/interview-assignments', icon: ClipboardCheck },
  { name: 'Assets', managementName: 'Asset Management', path: '/assets', icon: Monitor, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { name: 'My Assets', path: '/my-assets', icon: Laptop, roles: ['HR', 'MANAGER', 'EMPLOYEE', 'INTERN'] },
  { name: 'My Documents', path: '/my-documents', icon: FileCheck, roles: ['EMPLOYEE', 'INTERN', 'MANAGER', 'HR'], exitAccessKey: 'canViewDocuments', permissionKey: 'canViewDocuments' },
  { name: 'Performance', path: '/performance', icon: BarChart3, permissionKey: 'canViewPerformance' },
  { name: 'Policies', path: '/policies', icon: FileText, permissionKey: 'canViewPolicies' },
  { name: 'Announcements', path: '/announcements', icon: Megaphone, exitAccessKey: 'canViewAnnouncements', permissionKey: 'canViewAnnouncements' },
  { name: 'Helpdesk', path: '/helpdesk', icon: HelpCircle, exitAccessKey: 'canViewHelpdesk', permissionKey: 'canRaiseHelpdeskTickets' },
  { name: 'Send Bulk Email', path: '/send-bulk-email', icon: Send, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { name: 'WhatsApp', path: '/whatsapp', icon: MessageCircle, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { name: 'Org Chart', path: '/org-chart', icon: Network, permissionKey: 'canViewOrgChart' },
  { name: 'Reports', path: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] },
  { name: 'Settings', path: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { name: 'Profile', path: '/profile', icon: Users, exitAccessKey: 'canViewProfile', permissionKey: 'canViewEditProfile' },
];

export default function Sidebar() {
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

  const handleLogout = () => {
    dispatch({ type: 'auth/logout' });
    navigate('/login');
  };

  const isManagement = user?.role ? MANAGEMENT_ROLES.includes(user.role) : false;

  const exitAccess = user?.exitAccess;

  const featurePermissions = (user as any)?.featurePermissions;

  const filteredItems = navItems.filter((item) => {
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
      className="hidden md:flex flex-col bg-white border-r border-gray-200 h-screen sticky top-0 z-40"
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
                    {isManagement && item.managementName ? item.managementName : item.name}
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
                Logout
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
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>

    </>
  );
}
