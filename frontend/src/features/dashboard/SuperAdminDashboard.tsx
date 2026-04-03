import { memo, useMemo, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import {
  Users, TrendingDown, IndianRupee, Briefcase, UserPlus,
  AlertTriangle, Building2, Cake, UserCheck, ClipboardList,
  BarChart3, Settings,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../app/store';
import { useGetSuperAdminStatsQuery } from './dashboardApi';
import { formatDate, formatCurrency } from '../../lib/utils';
import {
  KPICard, AlertBanner, DashboardSection, QuickActionGrid,
  EmployeeListWidget, SkeletonLoader, MobileStickyActions,
} from './components';
import type { SuperAdminDashboardStats } from '@aniston/shared';

// Lazy-load chart components to improve initial render
const TrendCharts = lazy(() => import('./sections/TrendCharts'));

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const MOBILE_STICKY_ACTIONS = [
  { label: 'Approvals', path: '/pending-approvals', icon: ClipboardList, color: 'text-amber-600' },
  { label: 'Employees', path: '/employees', icon: Users, color: 'text-blue-600' },
  { label: 'Payroll', path: '/payroll', icon: IndianRupee, color: 'text-purple-600' },
  { label: 'Settings', path: '/settings', icon: Settings, color: 'text-gray-600' },
];

const QUICK_NAV = [
  { label: 'Employees', path: '/employees', icon: '👥' },
  { label: 'Attendance', path: '/attendance', icon: '📊' },
  { label: 'Leave Approvals', path: '/pending-approvals', icon: '✅' },
  { label: 'Recruitment', path: '/recruitment', icon: '🎯' },
  { label: 'Payroll', path: '/payroll', icon: '💰' },
  { label: 'Reports', path: '/reports', icon: '📈' },
  { label: 'Exit Mgmt', path: '/exit-management', icon: '🚪' },
  { label: 'Settings', path: '/settings', icon: '⚙️' },
];

function SuperAdminDashboard() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { data: response, isLoading, isError } = useGetSuperAdminStatsQuery(undefined, {
    pollingInterval: 300000,
  });
  const stats = response?.data;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const kpis = useMemo(() => {
    if (!stats) return [];
    return [
      { label: 'Total Employees', value: stats.totalEmployees, icon: Users, color: 'bg-blue-500', sub: `${stats.activeEmployees} active`, onClick: () => navigate('/employees') },
      { label: 'New Hires', value: stats.newHiresThisMonth, icon: UserPlus, color: 'bg-emerald-500', sub: 'this month', onClick: () => navigate('/employees?status=ACTIVE&sortBy=joiningDate') },
      { label: 'Attrition Rate', value: `${stats.attritionRate}%`, icon: TrendingDown, color: stats.attritionRate > 15 ? 'bg-red-500' : 'bg-amber-500', sub: 'last 12 months', onClick: () => navigate('/exit-management') },
      { label: 'Payroll Cost', value: formatCurrency(stats.monthlyPayrollCost), icon: IndianRupee, color: 'bg-purple-500', sub: 'last month net', onClick: () => navigate('/payroll') },
      { label: 'Open Positions', value: stats.openPositions, icon: Briefcase, color: 'bg-indigo-500', sub: 'hiring', onClick: () => navigate('/recruitment') },
      { label: 'Active Employees', value: stats.activeEmployees, icon: UserCheck, color: 'bg-teal-500', sub: 'currently working', onClick: () => navigate('/employees?status=ACTIVE') },
    ];
  }, [stats]);

  // === LOADING ===
  if (isLoading) return <SkeletonLoader variant="full-page" />;

  // === ERROR ===
  if (isError || !stats) {
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

  return (
    <div className="page-container pb-20 md:pb-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting}, {user?.firstName || 'Admin'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Company analytics overview — {formatDate(new Date(), 'long')}
        </p>
      </motion.div>

      {/* KPI Grid */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </motion.div>

      {/* Alerts */}
      <AlertBanner alerts={stats.alerts} />

      {/* Trend Charts — lazy loaded */}
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
          hiringTrend={stats.hiringTrend}
          attendanceTrend={stats.attendanceTrend}
          leaveTrend={stats.leaveTrend}
        />
      </Suspense>

      {/* Bottom Row: Department + Recent Activity + Birthdays */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Department Breakdown */}
        <DashboardSection title="Department Headcount" icon={Building2} iconColor="text-indigo-500">
          <DepartmentBreakdown departments={stats.departmentBreakdown} total={stats.totalEmployees} />
        </DashboardSection>

        {/* Recent Activity */}
        <DashboardSection title="Recent Activity" icon={UserPlus} iconColor="text-emerald-500">
          {stats.recentHires.length === 0 && stats.recentExits.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No recent activity</p>
          ) : (
            <>
              <EmployeeListWidget items={stats.recentHires.slice(0, 3)} type="hire" />
              <EmployeeListWidget items={stats.recentExits.slice(0, 2)} type="exit" />
            </>
          )}
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

      {/* Quick Navigation */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
        initial="hidden"
        animate="show"
        className="mt-6 layer-card p-5 hidden md:block"
      >
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Navigation</h3>
        <QuickActionGrid actions={QUICK_NAV} columns="grid-cols-2 md:grid-cols-4 lg:grid-cols-6" />
      </motion.div>

      {/* Mobile Sticky Actions */}
      <MobileStickyActions actions={MOBILE_STICKY_ACTIONS} />
    </div>
  );
}

// Memoized sub-component for department breakdown
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

export default memo(SuperAdminDashboard);
