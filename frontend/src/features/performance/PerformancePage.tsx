import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target, TrendingUp, Star, Plus, CheckCircle, Clock, AlertCircle,
  X, Loader2, ChevronRight, Zap, AlertTriangle, BarChart2,
  CalendarDays, Award, ShieldCheck, Activity, Users, Briefcase,
  ArrowUp, ArrowDown, Minus, ExternalLink, ListTodo,
} from 'lucide-react';
import {
  useGetPerformanceSummaryQuery,
  useGetGoalsQuery,
  useCreateGoalMutation,
  useUpdateGoalMutation,
  useGetReviewsQuery,
  useGetCyclesQuery,
} from './performanceApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { useAppSelector } from '../../app/store';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

// Gauge color thresholds — mapped to Tailwind token equivalents
// emerald-500 / amber-500 / orange-500 / red-500 / gray-200
const GAUGE_TRACK = '#e5e7eb'; // gray-200
const gaugeColor = (score: number) =>
  score >= 75 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 45 ? '#f97316' : '#ef4444';

// ── Circular Score Gauge ──────────────────────────────────────────────
function ScoreGauge({ score, size = 140 }: { score: number; size?: number }) {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * (score / 100);

  return (
    <svg width={size} height={size} className="rotate-[-90deg]" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={GAUGE_TRACK} strokeWidth={12} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={gaugeColor(score)} strokeWidth={12} strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        className="transition-all duration-700"
      />
    </svg>
  );
}

// ── Star Rating ───────────────────────────────────────────────────────
function StarRating({ rating, size = 18 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          className={cn(
            'transition-colors',
            s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'
          )}
        />
      ))}
    </div>
  );
}

// ── Score Badge ───────────────────────────────────────────────────────
function ScoreBadge({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? 'text-emerald-600 bg-emerald-50' : score >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
  return (
    <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold', color)}>
      <span data-mono className="font-mono text-base font-bold">{score}</span>
      <span className="text-[10px] font-medium leading-tight">{label}</span>
    </div>
  );
}

// ── Priority badge ────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority?: string }) {
  const p = (priority || '').toLowerCase();
  const map: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    urgent: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    highest: 'bg-orange-100 text-orange-700',
    medium: 'bg-amber-100 text-amber-700',
    normal: 'bg-blue-100 text-blue-700',
    low: 'bg-gray-100 text-gray-500',
    lowest: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize', map[p] || 'bg-gray-100 text-gray-500')}>
      {priority || 'Normal'}
    </span>
  );
}

export default function PerformancePage() {
  const { perms } = useEmpPerms();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [showCreateGoal, setShowCreateGoal] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'leaves' | 'goals' | 'reviews'>('overview');
  const user = useAppSelector((s) => s.auth.user);
  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  if (!isAdmin && !perms.canViewPerformance) return <PermDenied action="view performance" />;

  const summaryParams = selectedEmployeeId ? { employeeId: selectedEmployeeId } : undefined;
  const { data: summaryRes, isLoading, isError, refetch } = useGetPerformanceSummaryQuery(summaryParams as any);
  const { data: goalsRes } = useGetGoalsQuery(summaryParams, { skip: !isAdmin });
  const { data: reviewsRes } = useGetReviewsQuery(summaryParams, { skip: !isAdmin });
  const { data: cyclesRes } = useGetCyclesQuery(undefined, { skip: !isAdmin });
  const [updateGoal] = useUpdateGoalMutation();

  const { data: employeesRes } = useGetEmployeesQuery({ limit: 200 }, { skip: !isAdmin });
  const employees = employeesRes?.data || [];

  const summary = summaryRes?.data;
  const goals = goalsRes?.data || [];
  const reviews = reviewsRes?.data || [];
  const cycles = cyclesRes?.data || [];

  const selectedEmployee = employees.find((e: any) => e.id === selectedEmployeeId);
  const viewingName = selectedEmployee
    ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}`
    : summary?.employee?.name || 'You';

  const handleGoalStatus = async (id: string, status: string) => {
    try {
      await updateGoal({ id, data: { status } }).unwrap();
      toast.success(`Goal marked as ${status.toLowerCase().replace('_', ' ')}`);
    } catch { toast.error('Failed to update'); }
  };

  if (isLoading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading performance data...</p>
        </div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="page-container flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-sm text-gray-400">Failed to load performance data.</p>
          <button onClick={refetch} className="btn-secondary text-xs">Retry</button>
        </div>
      </div>
    );
  }

  // Admin sees all tabs; employees see only task-focused tabs
  const tabs = isAdmin
    ? [
        { key: 'overview', label: 'Overview', icon: BarChart2 },
        { key: 'tasks', label: `Tasks${summary.tasks.total > 0 ? ` (${summary.tasks.total})` : ''}`, icon: Briefcase },
        { key: 'leaves', label: 'Leaves', icon: CalendarDays },
        { key: 'goals', label: `Goals (${summary.goals.total})`, icon: Target },
        { key: 'reviews', label: 'Reviews', icon: Star },
      ] as const
    : [
        { key: 'overview', label: 'Overview', icon: BarChart2 },
        { key: 'tasks', label: `Tasks${summary.tasks.total > 0 ? ` (${summary.tasks.total})` : ''}`, icon: Briefcase },
      ] as const;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Performance</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {isAdmin ? `Viewing: ${viewingName}` : 'Your task health & performance'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="input-glass text-sm max-w-[200px]"
              >
                <option value="">Myself (default)</option>
                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={() => setShowCreateGoal(true)}
                className="btn-primary flex items-center gap-2 text-sm">
                <Plus size={16} /> Add Goal
              </motion.button>
            </>
          )}
        </div>
      </div>

      {/* Hero Card — task-focused for employees, full score for admins */}
      {isAdmin ? (
        <div className="layer-card p-6 mb-5 bg-gradient-to-br from-indigo-50/60 via-white to-emerald-50/40">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
            <div className="relative flex-shrink-0">
              <ScoreGauge score={summary.scores.overall} size={148} />
              <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                <span className="text-3xl font-bold font-mono text-gray-900" data-mono>
                  {summary.scores.overall}
                </span>
                <span className="text-xs text-gray-400 font-medium">/100</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <StarRating rating={summary.rating} size={22} />
                <span className="text-lg font-semibold text-gray-800">{summary.ratingLabel}</span>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                {summary.employee.designation && `${summary.employee.designation} · `}
                {summary.employee.department && `${summary.employee.department} · `}
                {new Date().getFullYear()} performance score
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <ScoreBreakdownCard label="Goals" score={summary.scores.goalCompletion} icon={<Target size={13} />} color="brand" />
                <ScoreBreakdownCard label="Leave Discipline" score={summary.scores.leaveDiscipline} icon={<ShieldCheck size={13} />} color="emerald" />
                <ScoreBreakdownCard label="Work Continuity" score={summary.scores.workContinuity} icon={<Activity size={13} />} color="blue" />
                <ScoreBreakdownCard label="Task Health" score={summary.scores.taskHealth} icon={<Zap size={13} />} color="amber" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <EmployeeTaskHeroCard summary={summary} />
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 overflow-x-auto no-scrollbar">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
              activeTab === key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'overview' && (
            isAdmin
              ? <OverviewTab summary={summary} goals={goals} reviews={reviews} cycles={cycles} />
              : <EmployeeOverviewTab summary={summary} />
          )}
          {activeTab === 'tasks' && <TasksTab tasks={summary.tasks} />}
          {activeTab === 'leaves' && isAdmin && <LeavesTab leaves={summary.leaves} />}
          {activeTab === 'goals' && isAdmin && (
            <GoalsTab goals={goals} summary={summary.goals} onStatusChange={handleGoalStatus} />
          )}
          {activeTab === 'reviews' && isAdmin && <ReviewsTab reviews={reviews} cycles={cycles} />}
        </motion.div>
      </AnimatePresence>

      {/* Create Goal Modal — admin only */}
      <AnimatePresence>
        {showCreateGoal && isAdmin && (
          <CreateGoalModal
            onClose={() => setShowCreateGoal(false)}
            employeeId={summary?.employee?.id || ''}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Employee Task Hero Card ───────────────────────────────────────────
function EmployeeTaskHeroCard({ summary }: { summary: any }) {
  const score = summary.scores.taskHealth;
  const scoreColor = score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-500';
  const scoreBg = score >= 75
    ? 'from-emerald-50/70 via-white to-emerald-50/30'
    : score >= 50
    ? 'from-amber-50/70 via-white to-amber-50/30'
    : 'from-red-50/70 via-white to-red-50/30';
  const gaugeColor = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className={cn('layer-card p-6 mb-5 bg-gradient-to-br', scoreBg)}>
      <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
        {/* Gauge — task health only */}
        <div className="relative flex-shrink-0">
          <ScoreGauge score={score} size={148} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn('text-3xl font-bold font-mono', scoreColor)} data-mono>{score}</span>
            <span className="text-xs text-gray-400 font-medium">/100</span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={18} className="text-amber-500" />
            <span className="text-lg font-semibold text-gray-800">Task Health Score</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            {summary.employee.designation && `${summary.employee.designation} · `}
            {summary.employee.department && `${summary.employee.department} · `}
            {new Date().getFullYear()}
          </p>

          {/* Task summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="bg-white/70 rounded-xl p-3 border border-white/80">
              <p className="text-xs text-gray-500 mb-0.5">Active Tasks</p>
              <p className="text-xl font-bold font-mono text-blue-600" data-mono>{summary.tasks.total}</p>
            </div>
            <div className="bg-white/70 rounded-xl p-3 border border-white/80">
              <p className="text-xs text-gray-500 mb-0.5">Overdue</p>
              <p className={cn('text-xl font-bold font-mono', summary.tasks.overdue > 0 ? 'text-red-600' : 'text-emerald-600')} data-mono>
                {summary.tasks.overdue}
              </p>
            </div>
            <div className="bg-white/70 rounded-xl p-3 border border-white/80">
              <p className="text-xs text-gray-500 mb-0.5">Critical</p>
              <p className={cn('text-xl font-bold font-mono', summary.tasks.critical > 0 ? 'text-red-600' : 'text-emerald-600')} data-mono>
                {summary.tasks.critical}
              </p>
            </div>
          </div>

          {/* Integration badge */}
          {summary.tasks.configured && summary.tasks.provider && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/60 border border-gray-200 px-2.5 py-1 rounded-full">
              <ExternalLink size={10} />
              Connected via <span className="font-medium capitalize">{summary.tasks.provider}</span>
            </div>
          )}
          {!summary.tasks.configured && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">
              <AlertCircle size={10} />
              No task manager connected — ask admin to configure in Settings
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Employee Overview Tab (task-focused only) ─────────────────────────
function EmployeeOverviewTab({ summary }: { summary: any }) {
  const tasks = summary.tasks;

  return (
    <div className="space-y-4">
      {/* Task stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Tasks', value: tasks.total, sub: 'in your task manager', color: 'text-blue-600', trend: 'neutral' as const },
          { label: 'Overdue', value: tasks.overdue, sub: tasks.overdue === 0 ? 'all on track' : 'need attention', color: tasks.overdue > 0 ? 'text-red-600' : 'text-emerald-600', trend: tasks.overdue === 0 ? 'up' as const : 'down' as const },
          { label: 'Blocked', value: tasks.blocked, sub: tasks.blocked === 0 ? 'none blocked' : 'blockers present', color: tasks.blocked > 0 ? 'text-orange-600' : 'text-emerald-600', trend: tasks.blocked === 0 ? 'up' as const : 'down' as const },
          { label: 'Critical', value: tasks.critical, sub: tasks.critical === 0 ? 'none critical' : 'high priority', color: tasks.critical > 0 ? 'text-red-600' : 'text-emerald-600', trend: tasks.critical === 0 ? 'up' as const : 'down' as const },
        ].map(({ label, value, sub, color, trend }) => (
          <div key={label} className="stat-card">
            <p className={cn('text-2xl font-bold font-mono mt-1', color)} data-mono>{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {trend === 'up' ? <ArrowUp size={12} className="text-emerald-500" /> : trend === 'down' ? <ArrowDown size={12} className="text-red-400" /> : <Minus size={12} className="text-gray-400" />}
              <span className="text-[10px] text-gray-400">{sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Task Health breakdown */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Zap size={15} className="text-amber-500" /> Task Health Breakdown
          {tasks.configured && tasks.provider && (
            <span className="ml-auto text-[10px] text-gray-400 flex items-center gap-1 capitalize">
              <ExternalLink size={10} /> {tasks.provider}
            </span>
          )}
        </h3>
        {!tasks.configured ? (
          <div className="text-center py-6">
            <Briefcase size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-400">No task manager connected</p>
            <p className="text-[10px] text-gray-300 mt-0.5">Ask your admin to configure in Settings → External Integrations</p>
          </div>
        ) : tasks.fetchError ? (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-3">
            <AlertTriangle size={14} />
            Could not fetch tasks — check integration config in Settings
          </div>
        ) : (
          <div className="space-y-3">
            {[
              { label: 'Active Tasks', value: tasks.total, max: Math.max(tasks.total, 1), color: 'bg-blue-500', textColor: 'text-blue-600' },
              { label: 'Overdue', value: tasks.overdue, max: Math.max(tasks.total, 1), color: 'bg-red-500', textColor: tasks.overdue > 0 ? 'text-red-600' : 'text-emerald-600' },
              { label: 'Blocked', value: tasks.blocked, max: Math.max(tasks.total, 1), color: 'bg-orange-500', textColor: tasks.blocked > 0 ? 'text-orange-600' : 'text-emerald-600' },
              { label: 'Critical', value: tasks.critical, max: Math.max(tasks.total, 1), color: 'bg-red-600', textColor: tasks.critical > 0 ? 'text-red-700' : 'text-emerald-600' },
            ].map(({ label, value, max, color, textColor }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-24">{label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all duration-500', color)}
                    style={{ width: `${(value / max) * 100}%` }} />
                </div>
                <span className={cn('text-xs font-bold font-mono w-6 text-right', textColor)} data-mono>{value}</span>
              </div>
            ))}

            {/* Task health score */}
            <div className="pt-3 mt-1 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Task Health Score</span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', summary.scores.taskHealth >= 75 ? 'bg-emerald-500' : summary.scores.taskHealth >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${summary.scores.taskHealth}%` }}
                  />
                </div>
                <span className={cn('text-sm font-bold font-mono', summary.scores.taskHealth >= 75 ? 'text-emerald-600' : summary.scores.taskHealth >= 50 ? 'text-amber-600' : 'text-red-600')} data-mono>
                  {summary.scores.taskHealth}/100
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Overdue tasks quick list */}
      {tasks.configured && tasks.overdue > 0 && tasks.items?.length > 0 && (
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-red-600 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} /> Overdue Tasks
          </h3>
          <div className="space-y-2">
            {tasks.items
              .filter((t: any) => t.dueDate && new Date(t.dueDate) < new Date())
              .slice(0, 5)
              .map((t: any) => <TaskRow key={t.externalTaskId} task={t} isOverdue />)}
          </div>
          {tasks.overdue > 5 && (
            <p className="text-[11px] text-gray-400 mt-2 text-center">
              +{tasks.overdue - 5} more — see Tasks tab for full list
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Score Breakdown Card ──────────────────────────────────────────────
function ScoreBreakdownCard({ label, score, icon, color }: {
  label: string; score: number; icon: React.ReactNode;
  color: 'brand' | 'emerald' | 'blue' | 'amber';
}) {
  const colorMap = {
    brand: { bar: 'bg-brand-500', text: 'text-brand-600', bg: 'bg-brand-50' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50' },
    blue: { bar: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50' },
    amber: { bar: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-50' },
  };
  const c = colorMap[color];
  return (
    <div className={cn('rounded-xl p-3', c.bg)}>
      <div className={cn('flex items-center gap-1 text-xs font-medium mb-1.5', c.text)}>
        {icon} {label}
      </div>
      <div className="flex items-end justify-between">
        <span className={cn('text-xl font-bold font-mono', c.text)} data-mono>{score}</span>
        <span className="text-[10px] text-gray-400">/100</span>
      </div>
      <div className="mt-1.5 h-1.5 bg-white/60 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', c.bar)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ── Overview Tab (admin) ──────────────────────────────────────────────
function OverviewTab({ summary, goals, reviews, cycles }: any) {
  const now = new Date();
  const overdueGoals = goals.filter((g: any) =>
    g.dueDate && new Date(g.dueDate) < now && g.status !== 'COMPLETED'
  );
  const completedBeforeDeadline = goals.filter((g: any) =>
    g.status === 'COMPLETED' && g.dueDate && g.completedAt && new Date(g.completedAt) <= new Date(g.dueDate)
  );

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Quick Stats Row */}
      <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickStatCard
          icon={<Target size={18} className="text-brand-500" />}
          value={summary.goals.total}
          label="Total Goals"
          sub={`${summary.goals.completed} completed`}
          trend={summary.goals.completionRate >= 70 ? 'up' : 'down'}
        />
        <QuickStatCard
          icon={<CalendarDays size={18} className="text-indigo-500" />}
          value={`${summary.leaves.totalUsed}`}
          label="Leaves Taken"
          sub={`${summary.leaves.totalAllocated} allocated`}
          trend={summary.leaves.totalUsed <= summary.leaves.totalAllocated * 0.7 ? 'up' : 'neutral'}
        />
        <QuickStatCard
          icon={<Briefcase size={18} className="text-emerald-500" />}
          value={summary.tasks.total}
          label="Active Tasks"
          sub={`${summary.tasks.overdue} overdue`}
          trend={summary.tasks.overdue === 0 ? 'up' : summary.tasks.overdue < 3 ? 'neutral' : 'down'}
        />
        <QuickStatCard
          icon={<Award size={18} className="text-amber-500" />}
          value={`${summary.rating}/5`}
          label="Rating"
          sub={summary.ratingLabel}
          trend={summary.rating >= 4 ? 'up' : summary.rating === 3 ? 'neutral' : 'down'}
        />
      </div>

      {/* Goals Summary */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Target size={15} className="text-brand-500" /> Goals Progress
        </h3>
        <div className="space-y-2">
          {[
            { label: 'Completed', count: summary.goals.completed, color: 'bg-emerald-500', textColor: 'text-emerald-600' },
            { label: 'In Progress', count: summary.goals.inProgress, color: 'bg-blue-500', textColor: 'text-blue-600' },
            { label: 'Not Started', count: summary.goals.notStarted, color: 'bg-gray-300', textColor: 'text-gray-500' },
            { label: 'On Hold', count: summary.goals.onHold, color: 'bg-amber-400', textColor: 'text-amber-600' },
          ].map(({ label, count, color, textColor }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-20">{label}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full', color)}
                  style={{ width: summary.goals.total > 0 ? `${(count / summary.goals.total) * 100}%` : '0%' }} />
              </div>
              <span className={cn('text-xs font-bold font-mono w-5 text-right', textColor)} data-mono>{count}</span>
            </div>
          ))}
        </div>
        {overdueGoals.length > 0 && (
          <div className="mt-3 p-2 rounded-lg bg-red-50 flex items-start gap-2">
            <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700">
              {overdueGoals.length} overdue {overdueGoals.length === 1 ? 'goal' : 'goals'} — action needed
            </p>
          </div>
        )}
        {completedBeforeDeadline.length > 0 && (
          <div className="mt-2 p-2 rounded-lg bg-emerald-50 flex items-start gap-2">
            <CheckCircle size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-emerald-700">
              {completedBeforeDeadline.length} {completedBeforeDeadline.length === 1 ? 'goal' : 'goals'} completed before deadline
            </p>
          </div>
        )}
      </div>

      {/* Leave Summary */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <CalendarDays size={15} className="text-indigo-500" /> Leave Balance
        </h3>
        <div className="space-y-2.5">
          {summary.leaves.byType.slice(0, 4).map((lt: any) => {
            const usedPct = lt.allocated > 0 ? (lt.used / lt.allocated) * 100 : 0;
            const barColor = usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
            return (
              <div key={lt.typeId}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-gray-600 font-medium">{lt.typeName}</span>
                  <span className="text-xs text-gray-500 font-mono" data-mono>
                    {lt.used}/{lt.allocated} days
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', barColor)}
                    style={{ width: `${Math.min(usedPct, 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>Total used: <strong className="text-gray-700 font-mono" data-mono>{summary.leaves.totalUsed}</strong> days</span>
          <span>Remaining: <strong className="text-emerald-600 font-mono" data-mono>
            {summary.leaves.totalAllocated - summary.leaves.totalUsed}
          </strong> days</span>
        </div>
      </div>

      {/* Task Health */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Briefcase size={15} className="text-emerald-500" /> Task Health
          {summary.tasks.configured && (
            <span className="ml-auto text-[10px] text-gray-400 flex items-center gap-1">
              <ExternalLink size={10} /> {summary.tasks.provider || 'External'}
            </span>
          )}
        </h3>
        {!summary.tasks.configured ? (
          <div className="text-center py-4">
            <Briefcase size={28} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-400">No task manager connected</p>
            <p className="text-[10px] text-gray-300 mt-0.5">Configure in Settings → External Integrations</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[
              { label: 'Active Tasks', value: summary.tasks.total, color: 'text-blue-600' },
              { label: 'Overdue', value: summary.tasks.overdue, color: summary.tasks.overdue > 0 ? 'text-red-600' : 'text-emerald-600' },
              { label: 'Blocked', value: summary.tasks.blocked, color: summary.tasks.blocked > 0 ? 'text-orange-600' : 'text-emerald-600' },
              { label: 'Critical', value: summary.tasks.critical, color: summary.tasks.critical > 0 ? 'text-red-600' : 'text-emerald-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-500">{label}</span>
                <span className={cn('text-sm font-bold font-mono', color)} data-mono>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Review */}
      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Star size={15} className="text-amber-500" /> Latest Review
        </h3>
        {!summary.recentReview ? (
          <div className="text-center py-4">
            <Star size={28} className="mx-auto text-gray-200 mb-2" />
            <p className="text-xs text-gray-400">No reviews yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{summary.recentReview.cycleName}</span>
              <span className={cn('badge text-[10px]',
                summary.recentReview.status === 'REVIEWED' ? 'badge-success' : 'badge-warning')}>
                {summary.recentReview.status}
              </span>
            </div>
            {[
              { label: 'Self Rating', value: summary.recentReview.selfRating },
              { label: 'Manager Rating', value: summary.recentReview.managerRating },
              { label: 'Overall Rating', value: summary.recentReview.overallRating, highlight: true },
            ].map(({ label, value, highlight }) => value !== null && (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className={cn('text-xs font-bold font-mono', highlight ? 'text-brand-600' : 'text-gray-700')} data-mono>
                    {value}/5
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', highlight ? 'bg-brand-500' : 'bg-amber-400')}
                    style={{ width: `${((value as number) / 5) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick Stat Card ───────────────────────────────────────────────────
function QuickStatCard({ icon, value, label, sub, trend }: {
  icon: React.ReactNode; value: string | number; label: string; sub: string;
  trend: 'up' | 'down' | 'neutral';
}) {
  const trendIcon = trend === 'up'
    ? <ArrowUp size={12} className="text-emerald-500" />
    : trend === 'down'
    ? <ArrowDown size={12} className="text-red-400" />
    : <Minus size={12} className="text-gray-400" />;
  return (
    <div className="stat-card">
      {icon}
      <p className="text-xl font-bold font-mono text-gray-900 mt-1" data-mono>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      <div className="flex items-center gap-1 mt-0.5">
        {trendIcon}
        <span className="text-[10px] text-gray-400">{sub}</span>
      </div>
    </div>
  );
}

// ── Tasks Tab ─────────────────────────────────────────────────────────
function TasksTab({ tasks }: { tasks: any }) {
  const now = new Date();
  if (!tasks.configured) {
    return (
      <div className="layer-card p-12 text-center">
        <Briefcase size={40} className="mx-auto text-gray-200 mb-3" />
        <h3 className="text-sm font-semibold text-gray-600 mb-1">No Task Manager Connected</h3>
        <p className="text-xs text-gray-400">
          Connect your task management tool in{' '}
          <strong>Settings → External API Integrations</strong>
        </p>
      </div>
    );
  }

  if (tasks.items.length === 0) {
    return (
      <div className="layer-card p-12 text-center">
        <CheckCircle size={40} className="mx-auto text-emerald-200 mb-3" />
        <h3 className="text-sm font-semibold text-gray-600">No active tasks</h3>
        <p className="text-xs text-gray-400 mt-1">All caught up!</p>
      </div>
    );
  }

  const overdue = tasks.items.filter((t: any) => t.dueDate && new Date(t.dueDate) < now);
  const onTrack = tasks.items.filter((t: any) => !t.dueDate || new Date(t.dueDate) >= now);

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: tasks.total, color: 'text-gray-700' },
          { label: 'Overdue', value: tasks.overdue, color: tasks.overdue > 0 ? 'text-red-600' : 'text-emerald-600' },
          { label: 'Blocked', value: tasks.blocked, color: tasks.blocked > 0 ? 'text-orange-600' : 'text-emerald-600' },
          { label: 'Critical', value: tasks.critical, color: tasks.critical > 0 ? 'text-red-600' : 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="layer-card p-4 text-center">
            <p className={cn('text-2xl font-bold font-mono', color)} data-mono>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Overdue section */}
      {overdue.length > 0 && (
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-red-600 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} /> Overdue Tasks ({overdue.length})
          </h3>
          <div className="space-y-2">
            {overdue.map((t: any) => <TaskRow key={t.externalTaskId} task={t} isOverdue />)}
          </div>
        </div>
      )}

      {/* Active tasks */}
      {onTrack.length > 0 && (
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Activity size={14} className="text-blue-500" /> Active Tasks ({onTrack.length})
          </h3>
          <div className="space-y-2">
            {onTrack.map((t: any) => <TaskRow key={t.externalTaskId} task={t} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, isOverdue }: { task: any; isOverdue?: boolean }) {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null;
  const daysLeft = dueDate
    ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className={cn(
      'flex items-start justify-between p-3 rounded-lg border gap-3',
      isOverdue ? 'border-red-100 bg-red-50/50' : 'border-gray-100 bg-gray-50/50',
      task.blockerFlag && 'border-orange-200 bg-orange-50/40'
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-800 truncate">{task.taskTitle}</p>
          {task.blockerFlag && (
            <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-semibold">BLOCKED</span>
          )}
        </div>
        {task.projectName && (
          <p className="text-xs text-gray-400 mt-0.5">{task.projectName}</p>
        )}
        {task.currentStatus && (
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded mt-1 inline-block">
            {task.currentStatus}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <PriorityBadge priority={task.priority} />
        {dueDate && (
          <span className={cn(
            'text-[10px] font-mono',
            isOverdue ? 'text-red-600 font-bold' : daysLeft !== null && daysLeft <= 3 ? 'text-amber-600' : 'text-gray-400'
          )} data-mono>
            {isOverdue
              ? `${Math.abs(daysLeft!)}d overdue`
              : daysLeft === 0 ? 'Due today'
              : `${daysLeft}d left`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Leaves Tab ────────────────────────────────────────────────────────
function LeavesTab({ leaves }: { leaves: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Used', value: leaves.totalUsed, sub: `of ${leaves.totalAllocated} days`, color: 'text-gray-900' },
          { label: 'Pending Approval', value: leaves.pendingRequests, sub: 'requests', color: 'text-amber-600' },
          { label: 'Remaining', value: leaves.totalAllocated - leaves.totalUsed, sub: 'days available', color: 'text-emerald-600' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="layer-card p-5 text-center">
            <p className={cn('text-3xl font-bold font-mono', color)} data-mono>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            <p className="text-[10px] text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <CalendarDays size={14} className="text-indigo-500" /> Leave Balance by Type
        </h3>
        {leaves.byType.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No leave types configured</p>
        ) : (
          <div className="space-y-3">
            {leaves.byType.map((lt: any) => {
              const usedPct = lt.allocated > 0 ? (lt.used / (lt.allocated + lt.carriedForward)) * 100 : 0;
              const barColor = usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
              const statusBg = usedPct >= 90 ? 'bg-red-50 border-red-100' : usedPct >= 70 ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100';
              return (
                <div key={lt.typeId} className={cn('p-3 rounded-xl border', statusBg)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">{lt.typeName}</span>
                      {lt.isPaid
                        ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Paid</span>
                        : <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Unpaid</span>}
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold font-mono text-gray-800" data-mono>{lt.used}</span>
                      <span className="text-xs text-gray-400 font-mono" data-mono>/{lt.allocated + lt.carriedForward}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-white/60 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', barColor)}
                      style={{ width: `${Math.min(usedPct, 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-500">
                    <span>{lt.remaining} days remaining</span>
                    {lt.pending > 0 && <span className="text-amber-600">{lt.pending} pending</span>}
                    {lt.carriedForward > 0 && <span className="text-blue-500">+{lt.carriedForward} carried fwd</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="layer-card p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Leave Requests ({new Date().getFullYear()})</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-lg bg-emerald-50">
            <p className="text-xl font-bold font-mono text-emerald-600" data-mono>{leaves.approvedRequests}</p>
            <p className="text-xs text-gray-500 mt-0.5">Approved</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-50">
            <p className="text-xl font-bold font-mono text-amber-600" data-mono>{leaves.pendingRequests}</p>
            <p className="text-xs text-gray-500 mt-0.5">Pending</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50">
            <p className="text-xl font-bold font-mono text-gray-500" data-mono>{leaves.rejectedRequests}</p>
            <p className="text-xs text-gray-500 mt-0.5">Rejected</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Goals Tab ─────────────────────────────────────────────────────────
function GoalsTab({ goals, summary, onStatusChange }: { goals: any[]; summary: any; onStatusChange: (id: string, s: string) => void }) {
  const now = new Date();
  const STATUS_ICONS: Record<string, React.ReactNode> = {
    NOT_STARTED: <Clock size={13} className="text-gray-400" />,
    IN_PROGRESS: <Activity size={13} className="text-blue-500" />,
    COMPLETED: <CheckCircle size={13} className="text-emerald-500" />,
    ON_HOLD: <Clock size={13} className="text-amber-500" />,
  };

  if (goals.length === 0) {
    return (
      <div className="layer-card p-12 text-center">
        <Target size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">No goals set yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {goals.map((goal: any) => {
        const isOverdue = goal.dueDate && new Date(goal.dueDate) < now && goal.status !== 'COMPLETED';
        const isEarlyComplete = goal.status === 'COMPLETED' && goal.dueDate && goal.completedAt
          && new Date(goal.completedAt) <= new Date(goal.dueDate);
        const progress = goal.targetValue
          ? Math.min((Number(goal.currentValue || 0) / Number(goal.targetValue)) * 100, 100)
          : goal.status === 'COMPLETED' ? 100 : 0;

        return (
          <div key={goal.id} className={cn(
            'layer-card p-4 border',
            isOverdue ? 'border-red-100' : isEarlyComplete ? 'border-emerald-100' : 'border-transparent'
          )}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                {STATUS_ICONS[goal.status] || STATUS_ICONS.NOT_STARTED}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800">{goal.title}</p>
                    {isEarlyComplete && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                        <CheckCircle size={9} /> On Time
                      </span>
                    )}
                    {isOverdue && (
                      <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                        <AlertTriangle size={9} /> Overdue
                      </span>
                    )}
                  </div>
                  {goal.description && <p className="text-xs text-gray-400 mt-0.5">{goal.description}</p>}
                  {goal.dueDate && (
                    <p className={cn('text-[10px] mt-0.5', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                      Due: {new Date(goal.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                  {goal.targetValue && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                        <span>Progress</span>
                        <span className="font-mono" data-mono>
                          {Number(goal.currentValue || 0)} / {Number(goal.targetValue)} {goal.unit || ''}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all',
                            goal.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-brand-500'
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <select
                value={goal.status}
                onChange={(e) => onStatusChange(goal.id, e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 flex-shrink-0"
              >
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Reviews Tab ───────────────────────────────────────────────────────
function ReviewsTab({ reviews, cycles }: { reviews: any[]; cycles: any[] }) {
  if (reviews.length === 0) {
    return (
      <div className="layer-card p-12 text-center">
        <Star size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">No performance reviews yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review: any) => (
        <div key={review.id} className="layer-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">{review.reviewCycle?.name}</p>
              <p className="text-xs text-gray-400">{review.reviewCycle?.type}</p>
            </div>
            <span className={cn('badge text-xs', review.status === 'REVIEWED' ? 'badge-success' : 'badge-warning')}>
              {review.status}
            </span>
          </div>
          <div className="space-y-2.5">
            {[
              { label: 'Self Rating', value: review.selfRating ? Number(review.selfRating) : null, color: 'bg-blue-400' },
              { label: 'Manager Rating', value: review.managerRating ? Number(review.managerRating) : null, color: 'bg-amber-400' },
              { label: 'Overall Rating', value: review.overallRating ? Number(review.overallRating) : null, color: 'bg-brand-500' },
            ].map(({ label, value, color }) => value !== null && (
              <div key={label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-gray-500">{label}</span>
                  <div className="flex items-center gap-2">
                    <StarRating rating={Math.round(value)} size={13} />
                    <span className="text-xs font-bold font-mono text-gray-700" data-mono>{value}/5</span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', color)} style={{ width: `${(value / 5) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {cycles.length > 0 && (
        <div className="layer-card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Review Cycles</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {cycles.map((cycle: any) => (
              <div key={cycle.id} className="p-3 bg-surface-2 rounded-lg">
                <p className="text-xs font-semibold text-gray-800">{cycle.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {cycle.type} · {cycle.status} · {cycle._count?.reviews || 0} reviews
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create Goal Modal ─────────────────────────────────────────────────
function CreateGoalModal({ onClose, employeeId }: { onClose: () => void; employeeId: string }) {
  const [createGoal, { isLoading }] = useCreateGoalMutation();
  const [form, setForm] = useState({ title: '', description: '', targetValue: '', unit: '', dueDate: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createGoal({
        employeeId,
        title: form.title,
        description: form.description || undefined,
        targetValue: form.targetValue ? Number(form.targetValue) : undefined,
        unit: form.unit || undefined,
        dueDate: form.dueDate || undefined,
      }).unwrap();
      toast.success('Goal created!');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Create Goal</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Goal Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input-glass w-full" required placeholder="e.g. Complete Q2 Sales Target" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-glass w-full h-16 resize-none" placeholder="Optional details..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Target</label>
              <input type="number" value={form.targetValue}
                onChange={(e) => setForm({ ...form, targetValue: e.target.value })}
                className="input-glass w-full" placeholder="100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Unit</label>
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="input-glass w-full" placeholder="%" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Due Date</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="input-glass w-full" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <Loader2 size={16} className="animate-spin" />} Create Goal
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
