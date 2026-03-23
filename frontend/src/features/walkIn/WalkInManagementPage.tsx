import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Users, Search, Clock, UserCheck, UserX, Loader2, ChevronRight,
  AlertCircle, CheckCircle2, PauseCircle, XCircle,
} from 'lucide-react';
import { useGetTodayWalkInsQuery } from './walkInApi';

const STATUS_CONFIG: Record<string, { label: string; color: string; badge: string; icon: any }> = {
  WAITING:      { label: 'Waiting',      color: 'text-amber-600',   badge: 'bg-amber-50 text-amber-700 border-amber-200',   icon: Clock },
  IN_INTERVIEW: { label: 'In Interview', color: 'text-blue-600',    badge: 'bg-blue-50 text-blue-700 border-blue-200',       icon: Users },
  ON_HOLD:      { label: 'On Hold',      color: 'text-orange-600',  badge: 'bg-orange-50 text-orange-700 border-orange-200', icon: PauseCircle },
  SELECTED:     { label: 'Selected',     color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  REJECTED:     { label: 'Rejected',     color: 'text-red-600',     badge: 'bg-red-50 text-red-700 border-red-200',          icon: XCircle },
  COMPLETED:    { label: 'Completed',    color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  NO_SHOW:      { label: 'No Show',      color: 'text-red-600',     badge: 'bg-red-50 text-red-700 border-red-200',          icon: UserX },
};

export default function WalkInManagementPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const navigate = useNavigate();

  const { data, isLoading, refetch } = useGetTodayWalkInsQuery({
    search: search || undefined,
    status: statusFilter || undefined,
    date: dateFilter || undefined,
    limit: 50,
  });

  const candidates = data?.data || [];

  // Stats
  const stats = {
    total: candidates.length,
    waiting: candidates.filter((c: any) => c.status === 'WAITING').length,
    inInterview: candidates.filter((c: any) => c.status === 'IN_INTERVIEW').length,
    selected: candidates.filter((c: any) => c.status === 'SELECTED').length,
    completed: candidates.filter((c: any) => c.status === 'COMPLETED').length,
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Walk-In Candidates</h1>
          <p className="text-sm text-gray-400 mt-0.5">Today's walk-in interview registrations</p>
        </div>
        <button onClick={() => refetch()} className="btn-secondary text-sm">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        <StatMini icon={Users} label="Total Today" value={stats.total} color="text-gray-600" bg="bg-gray-50" />
        <StatMini icon={Clock} label="Waiting" value={stats.waiting} color="text-amber-600" bg="bg-amber-50" />
        <StatMini icon={AlertCircle} label="In Interview" value={stats.inInterview} color="text-blue-600" bg="bg-blue-50" />
        <StatMini icon={CheckCircle2} label="Selected" value={stats.selected} color="text-emerald-600" bg="bg-emerald-50" />
        <StatMini icon={UserCheck} label="Completed" value={stats.completed} color="text-emerald-600" bg="bg-green-50" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, or token..."
            className="input-glass w-full pl-10"
          />
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="input-glass w-full sm:w-44"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-glass w-full sm:w-48">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </div>

      {/* Candidate Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-16 layer-card">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No walk-in candidates{statusFilter ? ` with status "${STATUS_CONFIG[statusFilter]?.label}"` : ''}</p>
          <p className="text-gray-400 text-sm mt-1">Candidates will appear here when they register via the kiosk</p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate: any, index: number) => {
            const sc = STATUS_CONFIG[candidate.status] || STATUS_CONFIG.WAITING;
            const StatusIcon = sc.icon;
            const roundsCompleted = candidate.interviewRounds?.filter((r: any) => r.status === 'COMPLETED').length || 0;
            const totalRounds = candidate.totalRounds || 1;

            return (
              <motion.div
                key={candidate.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => navigate(`/walk-in-management/${candidate.id}`)}
                className="layer-card p-4 cursor-pointer hover:shadow-layer-md transition-all group"
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-brand-600">
                      {candidate.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{candidate.fullName}</h3>
                      <span className="text-xs font-mono text-gray-400 shrink-0" data-mono>{candidate.tokenNumber}</span>
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {candidate.jobOpening?.title || 'No position selected'}
                      {candidate.jobOpening?.department ? ` · ${candidate.jobOpening.department}` : ''}
                    </p>
                  </div>

                  {/* Round Progress */}
                  {candidate.status !== 'WAITING' && candidate.status !== 'NO_SHOW' && (
                    <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                      <div className="flex gap-0.5">
                        {Array.from({ length: totalRounds }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full ${
                              i < roundsCompleted ? 'bg-emerald-400' :
                              i === roundsCompleted ? 'bg-blue-400 animate-pulse' :
                              'bg-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">
                        {roundsCompleted}/{totalRounds}
                      </span>
                    </div>
                  )}

                  {/* Status Badge */}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 ${sc.badge}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {sc.label}
                  </div>

                  {/* Arrow */}
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 transition-colors shrink-0" />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatMini({ icon: Icon, label, value, color, bg }: {
  icon: any; label: string; value: number; color: string; bg: string;
}) {
  return (
    <div className="stat-card flex items-center gap-3">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-2xl font-display font-bold text-gray-900" data-mono>{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    </div>
  );
}
