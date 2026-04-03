import { motion } from 'framer-motion';
import {
  Users, TrendingDown, IndianRupee, Briefcase, UserPlus,
  AlertTriangle, ArrowUpRight, Building2, Cake, LogOut,
  Loader2, UserCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../app/store';
import { useGetSuperAdminStatsQuery } from './dashboardApi';
import { formatDate, formatCurrency, getInitials } from '../../lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, AreaChart, Area,
} from 'recharts';
import type { SuperAdminDashboardStats, DashboardAlert } from '@aniston/shared';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { data: response, isLoading, isError } = useGetSuperAdminStatsQuery(undefined, {
    pollingInterval: 300000, // refresh every 5 min
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
        <div className="mb-8">
          <div className="h-8 bg-gray-200 rounded-lg w-72 mb-2 animate-pulse" />
          <div className="h-4 bg-gray-100 rounded w-48 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="stat-card">
              <div className="h-4 bg-gray-100 rounded w-16 mb-3 animate-pulse" />
              <div className="h-7 bg-gray-200 rounded w-12 mb-1 animate-pulse" />
              <div className="h-3 bg-gray-100 rounded w-20 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="layer-card p-6 h-64 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-32 mb-4" />
              <div className="h-40 bg-gray-100 rounded" />
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
          <p className="text-red-500 font-medium">Failed to load dashboard data</p>
          <p className="text-sm text-gray-400 mt-1">Please refresh the page or try again later</p>
        </div>
      </div>
    );
  }

  const kpis = [
    { label: 'Total Employees', value: stats.totalEmployees, icon: Users, color: 'bg-blue-500', sub: `${stats.activeEmployees} active` },
    { label: 'New Hires', value: stats.newHiresThisMonth, icon: UserPlus, color: 'bg-emerald-500', sub: 'this month' },
    { label: 'Attrition Rate', value: `${stats.attritionRate}%`, icon: TrendingDown, color: stats.attritionRate > 15 ? 'bg-red-500' : 'bg-amber-500', sub: 'last 12 months' },
    { label: 'Payroll Cost', value: formatCurrency(stats.monthlyPayrollCost), icon: IndianRupee, color: 'bg-purple-500', sub: 'last month net' },
    { label: 'Open Positions', value: stats.openPositions, icon: Briefcase, color: 'bg-indigo-500', sub: 'hiring' },
    { label: 'Active Employees', value: stats.activeEmployees, icon: UserCheck, color: 'bg-teal-500', sub: 'currently working' },
  ];

  return (
    <div className="page-container">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting()}, {user?.firstName || 'Admin'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Company analytics overview — {formatDate(new Date(), 'long')}
        </p>
      </motion.div>

      {/* KPI Grid — always visible including mobile */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map((kpi) => (
          <motion.div key={kpi.label} variants={item} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${kpi.color}/10`}>
                <kpi.icon size={16} className={kpi.color.replace('bg-', 'text-')} />
              </div>
            </div>
            <p className="text-xl md:text-2xl font-bold font-mono text-gray-900 truncate" data-mono>
              {kpi.value}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{kpi.label}</p>
            <p className="text-[10px] text-gray-400">{kpi.sub}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Alerts Panel */}
      {stats.alerts.length > 0 && (
        <motion.div variants={item} initial="hidden" animate="show" className="mb-6">
          <div className="space-y-2">
            {stats.alerts.map((alert: DashboardAlert, i: number) => (
              <div
                key={i}
                onClick={() => alert.action && navigate(alert.action)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${
                  alert.type === 'danger'
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : alert.type === 'warning'
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}
              >
                <AlertTriangle size={16} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs opacity-80">{alert.message}</p>
                </div>
                {alert.action && <ArrowUpRight size={14} className="shrink-0 opacity-60" />}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Charts Row */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Hiring Trend */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Hiring vs Exits</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.hiringTrend} barSize={14} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
              <Bar dataKey="hires" fill="#10b981" radius={[4,4,0,0]} name="Hires" />
              <Bar dataKey="exits" fill="#ef4444" radius={[4,4,0,0]} name="Exits" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Attendance Trend */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Attendance %</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.attendanceTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" domain={[0, 100]} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                formatter={(v: number) => `${v}%`}
              />
              <defs>
                <linearGradient id="attendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="avgPercentage" stroke="#6366f1" fill="url(#attendGrad)" strokeWidth={2} name="Avg %" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Leave Trend */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Leave Days Used</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={stats.leaveTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="totalDays" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} name="Days" />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </motion.div>

      {/* Bottom Row: Department + Recent Activity + Birthdays */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Department Breakdown */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Building2 size={15} className="text-indigo-500" />
            Department Headcount
          </h3>
          {stats.departmentBreakdown.length > 0 ? (
            <div className="space-y-2">
              {stats.departmentBreakdown.map((dept) => (
                <div key={dept.name} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-600 truncate mr-2">{dept.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${Math.min((dept.count / Math.max(stats.totalEmployees, 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-gray-500 w-6 text-right" data-mono>{dept.count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No departments</p>
          )}
        </motion.div>

        {/* Recent Hires & Exits */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <UserPlus size={15} className="text-emerald-500" />
            Recent Activity
          </h3>
          <div className="space-y-2">
            {stats.recentHires.length === 0 && stats.recentExits.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No recent activity</p>
            ) : (
              <>
                {stats.recentHires.slice(0, 3).map((hire) => (
                  <div
                    key={hire.id}
                    onClick={() => navigate(`/employees/${hire.id}`)}
                    className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-xs">
                      {getInitials(hire.firstName, hire.lastName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{hire.firstName} {hire.lastName}</p>
                      <p className="text-[10px] text-gray-400">{hire.department || 'No dept'}</p>
                    </div>
                    <span className="badge badge-success text-[10px]">Joined</span>
                  </div>
                ))}
                {stats.recentExits.slice(0, 2).map((ex) => (
                  <div
                    key={ex.id}
                    onClick={() => navigate(`/employees/${ex.id}`)}
                    className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-700 font-semibold text-xs">
                      {getInitials(ex.firstName, ex.lastName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{ex.firstName} {ex.lastName}</p>
                      <p className="text-[10px] text-gray-400">{ex.department || 'No dept'}</p>
                    </div>
                    <span className="badge badge-danger text-[10px]">Exited</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </motion.div>

        {/* Upcoming Birthdays */}
        <motion.div variants={item} className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Cake size={15} className="text-pink-500" />
            Upcoming Birthdays
          </h3>
          {stats.upcomingBirthdays.length > 0 ? (
            <div className="space-y-2">
              {stats.upcomingBirthdays.map((bday) => (
                <div key={bday.id} className="flex items-center gap-3 py-2">
                  <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center text-pink-700 font-semibold text-xs">
                    {getInitials(bday.firstName, bday.lastName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{bday.firstName} {bday.lastName}</p>
                    <p className="text-[10px] text-gray-400 font-mono" data-mono>
                      {bday.dateOfBirth ? new Date(bday.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No upcoming birthdays</p>
          )}
        </motion.div>
      </motion.div>

      {/* Quick Navigation */}
      <motion.div variants={item} initial="hidden" animate="show" className="mt-6 layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Navigation</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {[
            { label: 'Employees', path: '/employees', icon: '👥' },
            { label: 'Attendance', path: '/attendance', icon: '📊' },
            { label: 'Leave Approvals', path: '/pending-approvals', icon: '✅' },
            { label: 'Recruitment', path: '/recruitment', icon: '🎯' },
            { label: 'Payroll', path: '/payroll', icon: '💰' },
            { label: 'Reports', path: '/reports', icon: '📈' },
            { label: 'Exit Mgmt', path: '/exit-management', icon: '🚪' },
            { label: 'Settings', path: '/settings', icon: '⚙️' },
          ].map((nav) => (
            <button
              key={nav.label}
              onClick={() => navigate(nav.path)}
              className="flex items-center gap-2 p-3 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-left"
            >
              <span className="text-lg">{nav.icon}</span>
              <span className="text-xs font-medium text-gray-700">{nav.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
