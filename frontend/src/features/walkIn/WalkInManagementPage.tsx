import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Users, Search, Clock, UserCheck, UserX, Loader2, ChevronRight, ChevronLeft,
  AlertCircle, CheckCircle2, PauseCircle, XCircle, RefreshCw, Star,
} from 'lucide-react';
import { useGetAllWalkInsQuery, useGetWalkInStatsQuery } from './walkInApi';
import { cn } from '../../lib/utils';

const STATUS_CONFIG: Record<string, { label: string; color: string; badge: string; icon: any }> = {
  WAITING:      { label: 'Waiting',      color: 'text-amber-600',   badge: 'bg-amber-50 text-amber-700 border-amber-200',   icon: Clock },
  IN_INTERVIEW: { label: 'In Interview', color: 'text-blue-600',    badge: 'bg-blue-50 text-blue-700 border-blue-200',       icon: Users },
  ON_HOLD:      { label: 'On Hold',      color: 'text-orange-600',  badge: 'bg-orange-50 text-orange-700 border-orange-200', icon: PauseCircle },
  SELECTED:     { label: 'Selected',     color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  REJECTED:     { label: 'Rejected',     color: 'text-red-600',     badge: 'bg-red-50 text-red-700 border-red-200',          icon: XCircle },
  COMPLETED:    { label: 'Completed',    color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: UserCheck },
  NO_SHOW:      { label: 'No Show',      color: 'text-red-600',     badge: 'bg-red-50 text-red-700 border-red-200',          icon: UserX },
};

const STAT_CARDS = [
  { key: '', label: 'Total', icon: Users, color: 'text-gray-600', bg: 'bg-gray-50', ring: 'ring-gray-300' },
  { key: 'WAITING', label: 'Waiting', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-300' },
  { key: 'IN_INTERVIEW', label: 'In Interview', icon: AlertCircle, color: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-300' },
  { key: 'ON_HOLD', label: 'On Hold', icon: PauseCircle, color: 'text-orange-600', bg: 'bg-orange-50', ring: 'ring-orange-300' },
  { key: 'SELECTED', label: 'Selected', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-300' },
  { key: 'REJECTED', label: 'Rejected', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-300' },
  { key: 'COMPLETED', label: 'Completed', icon: UserCheck, color: 'text-emerald-600', bg: 'bg-green-50', ring: 'ring-green-300' },
  { key: 'NO_SHOW', label: 'No Show', icon: UserX, color: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-300' },
];

export default function WalkInManagementPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  const { data, isLoading, refetch } = useGetAllWalkInsQuery({
    search: search || undefined,
    status: statusFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 20,
  });
  const { data: statsRes } = useGetWalkInStatsQuery();

  const candidates = data?.data || [];
  const meta = data?.meta;
  const stats = statsRes?.data || {};

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Walk-In Candidates</h1>
          <p className="text-sm text-gray-400 mt-0.5">All walk-in interview registrations</p>
        </div>
        <button onClick={() => refetch()} className="btn-secondary text-sm flex items-center gap-2">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Clickable Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {STAT_CARDS.map(card => {
          const count = card.key ? (stats[card.key] || 0) : (stats.total || 0);
          const isActive = statusFilter === card.key;
          return (
            <button
              key={card.key}
              onClick={() => { setStatusFilter(card.key); setPage(1); }}
              className={cn(
                'stat-card flex items-center gap-3 cursor-pointer transition-all text-left',
                isActive && `ring-2 ${card.ring}`
              )}
            >
              <div className={`w-9 h-9 ${card.bg} rounded-lg flex items-center justify-center shrink-0`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-xl font-display font-bold text-gray-900" data-mono>{count}</p>
                <p className="text-[10px] text-gray-400 leading-tight">{card.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, email, phone, or token..."
            className="input-glass w-full pl-10"
          />
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="input-glass w-36 text-sm" placeholder="From" />
          <span className="text-gray-300">—</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="input-glass w-36 text-sm" placeholder="To" />
        </div>
        {(statusFilter || dateFrom || dateTo || search) && (
          <button onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); setSearch(''); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">Clear All</button>
        )}
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
                transition={{ delay: index * 0.02 }}
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 truncate">{candidate.fullName}</h3>
                      <span className="text-xs font-mono text-gray-400 shrink-0" data-mono>{candidate.tokenNumber}</span>
                      {candidate.aiScore && (
                        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5',
                          Number(candidate.aiScore) >= 70 ? 'bg-emerald-50 text-emerald-600' :
                          Number(candidate.aiScore) >= 50 ? 'bg-amber-50 text-amber-600' :
                          'bg-red-50 text-red-600'
                        )}>
                          <Star size={10} /> AI: {Number(candidate.aiScore).toFixed(0)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {candidate.jobOpening?.title || 'No position selected'}
                      {candidate.jobOpening?.department ? ` · ${candidate.jobOpening.department}` : ''}
                      <span className="text-xs text-gray-300 ml-2">
                        {new Date(candidate.registrationDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </p>
                  </div>

                  {/* Round Progress */}
                  {candidate.status !== 'WAITING' && candidate.status !== 'NO_SHOW' && (
                    <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                      <div className="flex gap-0.5">
                        {Array.from({ length: totalRounds }).map((_, i) => (
                          <div key={i} className={`w-2 h-2 rounded-full ${
                            i < roundsCompleted ? 'bg-emerald-400' :
                            i === roundsCompleted ? 'bg-blue-400 animate-pulse' : 'bg-gray-200'
                          }`} />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">{roundsCompleted}/{totalRounds}</span>
                    </div>
                  )}

                  {/* Status Badge */}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 ${sc.badge}`}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {sc.label}
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 transition-colors shrink-0" />
                </div>
              </motion.div>
            );
          })}

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-gray-400">
                Page {meta.page} of {meta.totalPages} ({meta.total} total)
              </p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg disabled:opacity-30 hover:bg-gray-50">
                  <ChevronLeft size={14} /> Prev
                </button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg disabled:opacity-30 hover:bg-gray-50">
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
