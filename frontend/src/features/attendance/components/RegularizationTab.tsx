import { useState } from 'react';
import { CheckCircle, XCircle, Clock, FileText, MessageSquare } from 'lucide-react';
import { useGetPendingRegularizationsQuery, useHandleRegularizationMutation } from '../attendanceApi';
import { cn, formatDate, getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';

export default function RegularizationTab() {
  const { data: res, isLoading } = useGetPendingRegularizationsQuery();
  const [handleReg] = useHandleRegularizationMutation();
  const [remarkId, setRemarkId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');

  const regularizations = res?.data || [];

  const handleAction = async (id: string, action: string) => {
    try {
      await handleReg({ id, action, remarks: remarkId === id ? remarks : undefined }).unwrap();
      toast.success(`Regularization ${action.toLowerCase()}`);
      setRemarkId(null);
      setRemarks('');
    } catch { toast.error('Failed to process'); }
  };

  const formatTime = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
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
        const emp = att.employee || r.employee || {};
        return (
          <div key={r.id} className="layer-card p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-semibold text-brand-700 flex-shrink-0">
                {getInitials(emp.firstName, emp.lastName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                  <span className="text-[10px] text-gray-400 font-mono" data-mono>{emp.employeeCode}</span>
                  <span className="badge badge-warning text-[9px] ml-auto">PENDING</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Date: {formatDate(att.date)} | Original: {formatTime(att.checkIn)} → {formatTime(att.checkOut)}
                </p>
              </div>
            </div>

            {/* Correction details */}
            <div className="bg-gray-50 rounded-lg p-2.5 space-y-1">
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-gray-500">Requested Check-In:</span>
                <span className="font-mono text-gray-700 font-medium" data-mono>{formatTime(r.requestedCheckIn)}</span>
                <span className="text-gray-500">Requested Check-Out:</span>
                <span className="font-mono text-gray-700 font-medium" data-mono>{formatTime(r.requestedCheckOut)}</span>
              </div>
              <div className="flex items-start gap-1">
                <FileText size={11} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-gray-600">{r.reason}</p>
              </div>
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
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleAction(r.id, 'APPROVED')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <CheckCircle size={13} /> Approve
              </button>
              <button
                onClick={() => handleAction(r.id, 'REJECTED')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
              >
                <XCircle size={13} /> Reject
              </button>
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
