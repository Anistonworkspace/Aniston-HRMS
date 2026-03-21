import { motion } from 'framer-motion';
import { Users, UserCheck, CalendarOff, Briefcase, TrendingUp, Clock } from 'lucide-react';
import { useAppSelector } from '../../app/store';
import { useGetDashboardStatsQuery } from './dashboardApi';
import { formatDate, getInitials } from '../../lib/utils';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function DashboardPage() {
  const user = useAppSelector((state) => state.auth.user);
  const { data: statsResponse, isLoading } = useGetDashboardStatsQuery();
  const stats = statsResponse?.data;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const statCards = [
    { label: 'Total Employees', value: stats?.totalEmployees ?? 0, icon: Users, color: 'bg-blue-500', change: '+3 this month' },
    { label: 'Present Today', value: stats?.presentToday ?? 0, icon: UserCheck, color: 'bg-emerald-500', change: 'of active' },
    { label: 'On Leave', value: stats?.onLeaveToday ?? 0, icon: CalendarOff, color: 'bg-amber-500', change: 'today' },
    { label: 'Open Positions', value: stats?.openPositions ?? 0, icon: Briefcase, color: 'bg-purple-500', change: 'hiring' },
  ];

  return (
    <div className="page-container">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-2xl md:text-3xl font-display font-bold text-gray-900">
          {greeting()}, {user?.firstName || 'Admin'} 👋
        </h1>
        <p className="text-gray-500 mt-1">
          Here&apos;s what&apos;s happening at Aniston today — {formatDate(new Date(), 'long')}
        </p>
      </motion.div>

      {/* Stat cards */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        {statCards.map((card) => (
          <motion.div key={card.label} variants={item} className="stat-card">
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2.5 rounded-lg ${card.color}/10`}>
                <card.icon size={20} className={card.color.replace('bg-', 'text-')} />
              </div>
            </div>
            <p className="text-2xl font-bold font-mono text-gray-900" data-mono>
              {isLoading ? '—' : card.value}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">{card.label}</p>
            <p className="text-xs text-gray-400 mt-1">{card.change}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Two column layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Quick actions */}
        <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-brand-500" />
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Check In', icon: '⏰', path: '/attendance' },
              { label: 'Apply Leave', icon: '🏖️', path: '/leaves' },
              { label: 'View Payslip', icon: '💰', path: '/payroll' },
              { label: 'Raise Ticket', icon: '🎫', path: '/helpdesk' },
            ].map((action) => (
              <button
                key={action.label}
                className="flex items-center gap-3 p-3 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-left"
              >
                <span className="text-xl">{action.icon}</span>
                <span className="text-sm font-medium text-gray-700">{action.label}</span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Recent hires */}
        <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-500" />
            Recent Hires
          </h2>
          {stats?.recentHires && stats.recentHires.length > 0 ? (
            <div className="space-y-3">
              {stats.recentHires.map((hire) => (
                <div key={hire.id} className="flex items-center gap-3 py-2">
                  <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm">
                    {getInitials(hire.firstName, hire.lastName)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {hire.firstName} {hire.lastName}
                    </p>
                    <p className="text-xs text-gray-400">
                      Joined {formatDate(hire.joiningDate)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No recent hires</p>
          )}
        </motion.div>

        {/* Upcoming birthdays */}
        <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">
            🎂 Upcoming Birthdays
          </h2>
          {stats?.upcomingBirthdays && stats.upcomingBirthdays.length > 0 ? (
            <div className="space-y-3">
              {stats.upcomingBirthdays.map((bday) => (
                <div key={bday.id} className="flex items-center gap-3 py-2">
                  <div className="w-9 h-9 rounded-lg bg-pink-100 flex items-center justify-center text-pink-700 font-semibold text-sm">
                    {getInitials(bday.firstName, bday.lastName)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {bday.firstName} {bday.lastName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {bday.dateOfBirth ? formatDate(bday.dateOfBirth, 'short') : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No upcoming birthdays</p>
          )}
        </motion.div>

        {/* Pending approvals */}
        <motion.div variants={item} initial="hidden" animate="show" className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">
            📋 Pending Approvals
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2.5 px-3 bg-amber-50 rounded-lg border border-amber-100">
              <div className="flex items-center gap-2">
                <CalendarOff size={16} className="text-amber-600" />
                <span className="text-sm text-amber-800">Leave Requests</span>
              </div>
              <span className="badge badge-warning font-mono" data-mono>
                {stats?.pendingLeaves ?? 0}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
