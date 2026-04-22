import { useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Clock, FileText, MessageSquare, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { useGetPendingRegularizationsQuery, useHandleRegularizationMutation } from '../attendanceApi';
import { onSocketEvent, offSocketEvent } from '../../../lib/socket';
import { cn, formatDate, getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';

function getRegType(r: any): { label: string; class: string; icon: any } {
  if (r.requestedCheckIn && r.requestedCheckOut) {
    return { label: 'Full Correction', class: 'bg-purple-50 text-purple-700', icon: RefreshCw };
  }
  if (r.requestedCheckIn && !r.requestedCheckOut) {
    return { label: 'Missed Check-In', class: 'bg-amber-50 text-amber-700', icon: LogIn };
  }
  if (!r.requestedCheckIn && r.requestedCheckOut) {
    return { label: 'Missed Check-Out', class: 'bg-orange-50 text-orange-700', icon: LogOut };
  }
  return { label: 'Time Correction', class: 'bg-blue-50 text-blue-700', icon: Clock };
}

const STATUS_BADGE: Record<string, { class: string; label: string }> = {
  PENDING:           { class: 'bg-amber-100 text-amber-700',  label: 'Pending' },
  MANAGER_REVIEWED:  { class: 'bg-blue-100 text-blue-700',    label: 'Manager Reviewed' },
  APPROVED:          { class: 'bg-emerald-100 text-emerald-700', label: 'Approved' },
  REJECTED:          { class: 'bg-red-100 text-red-700',      label: 'Rejected' },
};

export default function RegularizationTab() {
  const { data: res, isLoading, refetch } = useGetPendingRegularizationsQuery();
  const [handleReg, { isLoading: processing }] = useHandleRegularizationMutation();
  const [remarkId, setRemarkId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const regularizations = res?.data || [];

  // Live updates: refresh whenever attendance changes or a new regularization is submitted
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:regularization-submitted', handler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:regularization-submitted', handler);
    };
  }, []);

  const handleAction = async (id: string, action: string) => {
    setProcessingId(id);
    try {
      await handleReg({ id, action, remarks: remarkId === id ? remarks : undefined }).unwrap();
      toast.success(`Regularization ${action.toLowerCase()}`);
      setRemarkId(null);
      setRemarks('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to process regularization');
    } finally {
      setProcessingId(null);
    }
  };

  const formatTime = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="layer-card p-3 space-y-2">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="w-32 h-3 bg-gray-100 rounded animate-pulse" />
                <div className="w-48 h-2.5 bg-gray-50 rounded animate-pulse" />
              </div>
              <div className="w-16 h-5 bg-amber-100 rounded-full animate-pulse" />
            </div>
            <div className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
              <div className="w-full h-3 bg-gray-100 rounded animate-pulse" />
              <div className="w-2/3 h-3 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (regularizations.length === 0) {
    return (
      <div className="layer-card p-8 text-center">
        <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
        <p className="text-sm text-gray-400">No pending regularization requests</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-gray-400">{regularizations.length} pending request(s)</p>

      {regularizations.map((r: any) => {
        const att = r.attendance || {};
        const emp = att.employee || r.employee || { firstName: 'Unknown', lastName: '', employeeCode: '—' };
        const regType = getRegType(r);
        const TypeIcon = regType.icon;
        const statusBadge = STATUS_BADGE[r.status] || STATUS_BADGE.PENDING;

        return (
          <div key={r.id} className="layer-card p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-semibold text-brand-700 flex-shrink-0">
                {getInitials(emp.firstName, emp.lastName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                  <span className="text-[10px] text-gray-400 font-mono" data-mono>{emp.employeeCode}</span>
                  {/* Regularization type badge */}
                  <span className={cn('flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full', regType.class)}>
                    <TypeIcon size={9} />
                    {regType.label}
                  </span>
                  {/* Status badge */}
                  <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-auto', statusBadge.class)}>
                    {statusBadge.label}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Date: {formatDate(att.date)} | Original: {formatTime(att.checkIn)} → {formatTime(att.checkOut)}
                </p>
              </div>
            </div>

            {/* Correction details */}
            <div className="bg-gray-50 rounded-lg p-2.5 space-y-1">
              <div className="flex flex-wrap items-center gap-4 text-[11px]">
                {r.requestedCheckIn && (
                  <>
                    <span className="text-gray-500">Requested Check-In:</span>
                    <span className="font-mono text-gray-700 font-medium" data-mono>{formatTime(r.requestedCheckIn)}</span>
                  </>
                )}
                {r.requestedCheckOut && (
                  <>
                    <span className="text-gray-500">Requested Check-Out:</span>
                    <span className="font-mono text-gray-700 font-medium" data-mono>{formatTime(r.requestedCheckOut)}</span>
                  </>
                )}
              </div>
              <div className="flex items-start gap-1">
                <FileText size={11} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-gray-600">{r.reason}</p>
              </div>
              {/* Manager remarks if MANAGER_REVIEWED */}
              {r.status === 'MANAGER_REVIEWED' && r.managerRemarks && (
                <div className="mt-1 pt-1 border-t border-gray-200">
                  <p className="text-[10px] text-blue-600 font-medium">Manager: {r.managerRemarks}</p>
                </div>
              )}
            </div>

            {/* Remarks input */}
            {remarkId === r.id && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Add remarks (optional)..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="input-glass text-xs py-1.5 flex-1"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={() => handleAction(r.id, 'APPROVED')}
                disabled={processingId === r.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle size={13} /> {processingId === r.id ? 'Processing...' : 'Approve'}
              </button>
              <button
                onClick={() => handleAction(r.id, 'REJECTED')}
                disabled={processingId === r.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <XCircle size={13} /> Reject
              </button>
              {r.status === 'PENDING' && (
                <button
                  onClick={() => handleAction(r.id, 'MANAGER_REVIEWED')}
                  disabled={processingId === r.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Clock size={13} /> Mark Reviewed
                </button>
              )}
              <button
                onClick={() => setRemarkId(remarkId === r.id ? null : r.id)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <MessageSquare size={12} /> Remarks
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
