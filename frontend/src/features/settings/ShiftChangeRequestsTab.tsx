import { useState } from 'react';
import { Clock, CheckCircle2, XCircle, Loader2, RefreshCw, ChevronDown, User } from 'lucide-react';
import { useGetShiftChangeRequestsQuery, useReviewShiftChangeRequestMutation } from '../workforce/workforceApi';
import { cn, getInitials, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

const SHIFT_TYPE_STYLE: Record<string, string> = {
  OFFICE: 'bg-blue-50 text-blue-700',
  FIELD: 'bg-green-50 text-green-700',
  HYBRID: 'bg-purple-50 text-purple-700',
};

export default function ShiftChangeRequestsTab() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [showRemarksFor, setShowRemarksFor] = useState<string | null>(null);

  const { data: res, isLoading, refetch } = useGetShiftChangeRequestsQuery(statusFilter ? { status: statusFilter } : undefined);
  const [reviewRequest, { isLoading: reviewing }] = useReviewShiftChangeRequestMutation();
  const requests: any[] = res?.data || [];

  const handleReview = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    try {
      setReviewingId(id);
      await reviewRequest({ id, action, reviewRemarks: remarks || undefined }).unwrap();
      toast.success(action === 'APPROVED' ? 'Shift change approved and applied' : 'Request rejected');
      setShowRemarksFor(null);
      setRemarks('');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Action failed');
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Clock size={18} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-800">Shift Change Requests</h2>
            <p className="text-xs text-gray-500">Review and approve shift change requests from HR and employees</p>
          </div>
        </div>
        <button onClick={() => refetch()} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-1 mb-5 p-1 bg-gray-100 rounded-xl w-fit">
        {[['', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            style={statusFilter === val ? { color: 'var(--primary-color)' } : undefined}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              statusFilter === val ? 'bg-white shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && requests.length === 0 && (
        <div className="text-center py-12">
          <Clock size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No shift change requests found</p>
        </div>
      )}

      {!isLoading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req: any) => (
            <div key={req.id} className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 overflow-hidden" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                  {req.employee?.avatar
                    ? <img src={getUploadUrl(req.employee.avatar)} alt="" className="w-full h-full object-cover" />
                    : getInitials(`${req.employee?.firstName} ${req.employee?.lastName}`)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold text-gray-800">
                      {req.employee?.firstName} {req.employee?.lastName}
                    </p>
                    <span className="text-xs text-gray-400">{req.employee?.employeeCode}</span>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border', STATUS_STYLE[req.status] || 'bg-gray-100 text-gray-600')}>
                      {req.status}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-auto">
                      {new Date(req.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <span>Requesting shift:</span>
                    <span className={cn('px-1.5 py-0.5 rounded-md font-medium', SHIFT_TYPE_STYLE[req.toShift?.shiftType] || 'bg-gray-100 text-gray-600')}>
                      {req.toShift?.name}
                    </span>
                    <span className="text-gray-400">({req.toShift?.startTime}–{req.toShift?.endTime})</span>
                  </div>

                  {req.reason && (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-1.5 mt-1">
                      <span className="font-medium text-gray-600">Reason: </span>{req.reason}
                    </p>
                  )}

                  <p className="text-[10px] text-gray-400 mt-1">
                    Requested by: <span className="font-medium">{req.requestedByRole}</span>
                  </p>

                  {req.reviewRemarks && (
                    <p className="text-xs text-gray-500 mt-1">
                      <span className="font-medium">Review note: </span>{req.reviewRemarks}
                    </p>
                  )}
                </div>

                {/* Actions — only for PENDING */}
                {req.status === 'PENDING' && (
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setShowRemarksFor(showRemarksFor === req.id ? null : req.id)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      Add note <ChevronDown size={11} className={cn('transition-transform', showRemarksFor === req.id && 'rotate-180')} />
                    </button>
                    <button
                      onClick={() => handleReview(req.id, 'APPROVED')}
                      disabled={reviewing && reviewingId === req.id}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {reviewing && reviewingId === req.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                      Approve
                    </button>
                    <button
                      onClick={() => handleReview(req.id, 'REJECTED')}
                      disabled={reviewing && reviewingId === req.id}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      <XCircle size={11} /> Reject
                    </button>
                  </div>
                )}
              </div>

              {/* Remarks input */}
              {showRemarksFor === req.id && req.status === 'PENDING' && (
                <div className="mt-3 pl-12">
                  <textarea
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    placeholder="Optional review note..."
                    rows={2}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
