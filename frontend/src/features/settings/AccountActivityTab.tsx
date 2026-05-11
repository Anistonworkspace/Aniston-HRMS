import { useState } from 'react';
import { Activity, Trash2, X, Lock, Calendar, ChevronLeft, ChevronRight, CheckSquare, Square, Loader2 } from 'lucide-react';
import { useGetAccountActivityQuery, useDeleteActivityLogsMutation } from './settingsApi';
import { useAppSelector } from '../../app/store';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const ACTION_COLOR: Record<string, string> = {
  CREATE: 'bg-emerald-50 text-emerald-700',
  UPDATE: 'bg-blue-50 text-blue-700',
  DELETE: 'bg-red-50 text-red-700',
  APPROVE: 'bg-indigo-50 text-indigo-700',
  REJECT: 'bg-orange-50 text-orange-700',
};

function ActivityDetailModal({ log, onClose }: { log: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-brand-50 flex items-center justify-center">
              <Activity size={16} className="text-brand-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-800">Activity Detail</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <DetailRow label="Actor" value={log.actor?.name || log.actor?.email || 'Unknown'} />
          <DetailRow label="Email" value={log.actor?.email || '—'} mono />
          <DetailRow label="Action">
            <span className={cn('text-xs font-bold px-2 py-1 rounded-md', ACTION_COLOR[log.action] || 'bg-gray-100 text-gray-600')}>
              {log.action}
            </span>
          </DetailRow>
          <DetailRow label="Entity" value={log.entity} />
          {log.entityId && <DetailRow label="Entity ID" value={log.entityId} mono />}
          <DetailRow label="Time" value={new Date(log.createdAt).toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'medium' })} mono />
          {log.ipAddress && <DetailRow label="IP Address" value={log.ipAddress} mono />}
          {log.newValue && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Changed Data</p>
              <pre className="text-[11px] bg-gray-50 rounded-lg p-3 text-gray-700 overflow-x-auto font-mono leading-relaxed max-h-36 overflow-y-auto">
                {JSON.stringify(log.newValue, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <button onClick={onClose} className="mt-5 w-full btn-secondary text-sm">Close</button>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <p className="text-xs font-medium text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</p>
      {children || (
        <p className={cn('text-sm text-gray-800 break-all', mono && 'font-mono text-xs')}>{value}</p>
      )}
    </div>
  );
}

function DeleteGuardModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Lock size={22} className="text-red-500" />
        </div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Permission Denied</h3>
        <p className="text-sm text-gray-500 mb-5">Only a <span className="font-semibold text-purple-700">Super Admin</span> can delete activity logs.</p>
        <button onClick={onClose} className="btn-primary w-full text-sm">Got it</button>
      </div>
    </div>
  );
}

function ActivityList({ role }: { role: 'HR' | 'EMPLOYEE' }) {
  const user = useAppSelector(s => s.auth.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [detailLog, setDetailLog] = useState<any>(null);
  const [showDeleteGuard, setShowDeleteGuard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<'selected' | 'range' | null>(null);

  const { data: res, isFetching, refetch } = useGetAccountActivityQuery({ role, page, limit: 20 });
  const [deleteActivityLogs, { isLoading: deleting }] = useDeleteActivityLogsMutation();
  const logs: any[] = res?.data || [];
  const meta = res?.meta;

  const allSelected = logs.length > 0 && logs.every(l => selectedIds.has(l.id));
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => { const n = new Set(prev); logs.forEach(l => n.delete(l.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); logs.forEach(l => n.add(l.id)); return n; });
    }
  };
  const toggleOne = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleDeleteAttempt = (type: 'selected' | 'range') => {
    if (!isSuperAdmin) { setShowDeleteGuard(true); return; }
    setConfirmDelete(type);
  };

  const handleDeleteConfirm = async () => {
    try {
      if (confirmDelete === 'selected') {
        await deleteActivityLogs({ ids: Array.from(selectedIds) }).unwrap();
        toast.success(`Deleted ${selectedIds.size} log${selectedIds.size !== 1 ? 's' : ''}`);
        setSelectedIds(new Set());
      } else {
        await deleteActivityLogs({ fromDate: fromDate || undefined, toDate: toDate || undefined }).unwrap();
        toast.success('Logs deleted for selected date range');
        setFromDate(''); setToDate('');
      }
      setConfirmDelete(null);
      refetch();
    } catch {
      toast.error('Failed to delete logs');
      setConfirmDelete(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-1 focus:ring-brand-300 focus:border-brand-400"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-1 focus:ring-brand-300 focus:border-brand-400"
          />
          {(fromDate || toDate) && (
            <button
              onClick={() => handleDeleteAttempt('range')}
              disabled={deleting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={12} />
              Delete Range
            </button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <button
            onClick={() => handleDeleteAttempt('selected')}
            disabled={deleting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50 ml-auto"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Delete Selected ({selectedIds.size})
          </button>
        )}

        {!isSuperAdmin && (
          <p className="text-[10px] text-gray-400 ml-auto italic">Delete requires Super Admin</p>
        )}
      </div>

      {isFetching && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isFetching && logs.length === 0 && (
        <div className="text-center py-12">
          <Activity size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No activity recorded yet</p>
        </div>
      )}

      {!isFetching && logs.length > 0 && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-100">
            <button onClick={toggleSelectAll} className="flex-shrink-0 text-gray-400 hover:text-brand-600">
              {allSelected ? <CheckSquare size={15} className="text-brand-600" /> : <Square size={15} />}
            </button>
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Actor</span>
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide ml-auto">Action / Entity</span>
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide w-32 text-right">Time</span>
          </div>

          {logs.map((log: any) => (
            <div
              key={log.id}
              onClick={() => setDetailLog(log)}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 border-b border-gray-50 last:border-0 cursor-pointer transition-colors"
            >
              <button
                onClick={e => { e.stopPropagation(); toggleOne(log.id); }}
                className="flex-shrink-0 text-gray-300 hover:text-brand-500"
              >
                {selectedIds.has(log.id)
                  ? <CheckSquare size={15} className="text-brand-600" />
                  : <Square size={15} />}
              </button>
              <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center flex-shrink-0">
                <Activity size={12} className="text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">
                  {log.actor?.name || log.actor?.email || 'Unknown'}
                </p>
                <p className="text-[10px] text-gray-400 truncate">{log.actor?.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md', ACTION_COLOR[log.action] || 'bg-gray-50 text-gray-500')}>
                  {log.action}
                </span>
                <span className="text-xs text-gray-500 hidden sm:block max-w-[100px] truncate">{log.entity}</span>
              </div>
              <p className="text-[10px] text-gray-400 font-mono w-32 text-right flex-shrink-0" data-mono>
                {new Date(log.createdAt).toLocaleString('en-IN')}
              </p>
            </div>
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-400">{meta.total} total · page {meta.page} of {meta.totalPages}</p>
          <div className="flex gap-1.5">
            <button
              disabled={!meta.hasPrev}
              onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={!meta.hasNext}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {detailLog && <ActivityDetailModal log={detailLog} onClose={() => setDetailLog(null)} />}
      {showDeleteGuard && <DeleteGuardModal onClose={() => setShowDeleteGuard(false)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 size={20} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Confirm Delete</h3>
                <p className="text-xs text-gray-500">
                  {confirmDelete === 'selected'
                    ? `Permanently delete ${selectedIds.size} selected log${selectedIds.size !== 1 ? 's' : ''}?`
                    : `Permanently delete all logs${fromDate ? ` from ${fromDate}` : ''}${toDate ? ` to ${toDate}` : ''}?`}
                </p>
              </div>
            </div>
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 text-sm px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AccountActivityTab() {
  const [activeRole, setActiveRole] = useState<'HR' | 'EMPLOYEE'>('HR');

  return (
    <div className="layer-card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
          <Activity size={18} className="text-brand-600" />
        </div>
        <div>
          <h2 className="text-lg font-display font-semibold text-gray-800">Account Activity</h2>
          <p className="text-xs text-gray-500">Track actions performed by HR and Employee accounts</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 p-1 bg-gray-100 rounded-xl w-fit">
        <button
          onClick={() => setActiveRole('HR')}
          className={cn(
            'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
            activeRole === 'HR' ? 'bg-white text-brand-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          HR Activity
        </button>
        <button
          onClick={() => setActiveRole('EMPLOYEE')}
          className={cn(
            'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
            activeRole === 'EMPLOYEE' ? 'bg-white text-brand-700 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Employee Activity
        </button>
      </div>

      <ActivityList key={activeRole} role={activeRole} />
    </div>
  );
}
