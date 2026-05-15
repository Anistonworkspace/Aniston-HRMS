import { useState } from 'react';
import { Clock, CheckCircle, XCircle, Loader2, RefreshCw, Repeat, Building2, MapPin, Home, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useGetShiftChangeRequestsQuery, useReviewShiftChangeRequestMutation } from '../workforce/workforceApi';
import { cn, formatDate } from '../../lib/utils';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const SHIFT_ICON: Record<string, React.ElementType> = {
  OFFICE: Building2,
  FIELD: MapPin,
  HYBRID: Home,
};

export default function ShiftChangeRequestsTab() {
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [reviewRemarks, setReviewRemarks] = useState<Record<string, string>>({});
  const [effectiveDates, setEffectiveDates] = useState<Record<string, string>>({});
  const { data: res, isLoading, refetch } = useGetShiftChangeRequestsQuery(statusFilter ? { status: statusFilter } : undefined);
  const [reviewRequest, { isLoading: reviewing }] = useReviewShiftChangeRequestMutation();

  const requests: any[] = res?.data || [];

  const todayStr = new Date().toISOString().split('T')[0];

  const handleReview = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    try {
      await reviewRequest({
        id,
        action,
        reviewRemarks: reviewRemarks[id]?.trim() || undefined,
        effectiveDate: action === 'APPROVED' ? (effectiveDates[id] || todayStr) : undefined,
      }).unwrap();
      toast.success(
        action === 'APPROVED'
          ? `Shift change approved — effective ${effectiveDates[id] || 'today'}`
          : 'Shift change request rejected'
      );
      setReviewRemarks(prev => { const n = { ...prev }; delete n[id]; return n; });
      setEffectiveDates(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to update request');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-display font-semibold text-gray-900">Shift Change Requests</h2>
          <p className="text-sm text-gray-400 mt-0.5">Review and approve employee shift change requests</p>
        </div>
        <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <RefreshCw size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              statusFilter === s ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            )}
            style={statusFilter === s ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
          >
            {s === '' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
        </div>
      ) : requests.length === 0 ? (
        <div className="layer-card p-10 text-center">
          <Repeat size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No {statusFilter.toLowerCase() || ''} shift change requests</p>
          <p className="text-xs text-gray-300 mt-1">Employees submit shift requests from the Attendance page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: any, i: number) => {
            const ToIcon = SHIFT_ICON[req.toShift?.shiftType] || Clock;
            const FromIcon = req.fromShift ? (SHIFT_ICON[req.fromShift.shiftType] || Clock) : Clock;
            return (
              <motion.div
                key={req.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="layer-card p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                      {(req.employee?.firstName?.[0] || '') + (req.employee?.lastName?.[0] || '')}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {req.employee?.firstName} {req.employee?.lastName}
                        <span className="text-gray-400 text-xs font-normal ml-2">{req.employee?.employeeCode}</span>
                        {req.employee?.department?.name && (
                          <span className="text-gray-400 text-xs font-normal ml-1">· {req.employee.department.name}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-xs">
                        {req.fromShift ? (
                          <span className="flex items-center gap-1 text-gray-500">
                            <FromIcon size={11} className="text-gray-400" />
                            {req.fromShift.name}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-[11px]">No current shift</span>
                        )}
                        <span className="text-gray-300">→</span>
                        {req.toShift && (
                          <span className="flex items-center gap-1 text-indigo-600 font-medium">
                            <ToIcon size={11} className="text-indigo-400" />
                            {req.toShift.name}
                          </span>
                        )}
                      </div>
                      {req.reason && (
                        <p className="text-[11px] text-gray-400 mt-1 italic">"{req.reason}"</p>
                      )}
                      <p className="text-[11px] text-gray-300 mt-1">{formatDate(req.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={cn('badge text-xs px-2 py-0.5 rounded-full', STATUS_STYLE[req.status])}>
                      {req.status}
                    </span>
                    {req.status === 'PENDING' && (
                      <div className="flex flex-col gap-1.5 w-full sm:w-56">
                        {/* Effective date picker */}
                        <div>
                          <label className="text-[10px] text-gray-400 flex items-center gap-1 mb-0.5">
                            <CalendarDays size={10} /> Effective date
                          </label>
                          <input
                            type="date"
                            min={todayStr}
                            value={effectiveDates[req.id] || todayStr}
                            onChange={(e) => setEffectiveDates(prev => ({ ...prev, [req.id]: e.target.value }))}
                            className="input-glass text-xs py-1.5 px-2 w-full"
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Remarks (optional)"
                          value={reviewRemarks[req.id] || ''}
                          onChange={(e) => setReviewRemarks(prev => ({ ...prev, [req.id]: e.target.value }))}
                          className="input-glass text-xs py-1.5 px-2 w-full"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleReview(req.id, 'APPROVED')}
                            disabled={reviewing}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-60"
                          >
                            {reviewing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                            Approve
                          </button>
                          <button
                            onClick={() => handleReview(req.id, 'REJECTED')}
                            disabled={reviewing}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-60"
                          >
                            <XCircle size={11} />
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                    {req.status !== 'PENDING' && req.reviewRemarks && (
                      <p className="text-[11px] text-gray-400 italic text-right max-w-[200px]">"{req.reviewRemarks}"</p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
