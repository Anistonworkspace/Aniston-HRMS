import { useState } from 'react';
import { X, Loader2, CheckCircle, XCircle, Clock, Shield } from 'lucide-react';
import { useGetManagerReviewQuery, useHandleLeaveActionMutation } from '../leaveApi';
import TaskAuditPanel from './TaskAuditPanel';
import HandoverSection from './HandoverSection';
import { formatDate, getInitials, getUploadUrl } from '../../../lib/utils';
import toast from 'react-hot-toast';

interface ManagerReviewPanelProps {
  leaveId: string;
  onClose: () => void;
}

export default function ManagerReviewPanel({ leaveId, onClose }: ManagerReviewPanelProps) {
  const { data: res, isLoading } = useGetManagerReviewQuery(leaveId);
  const [handleAction, { isLoading: acting }] = useHandleLeaveActionMutation();
  const [remarks, setRemarks] = useState('');
  const [conditionNote, setConditionNote] = useState('');

  const data = res?.data;

  const onAction = async (action: string) => {
    try {
      await handleAction({
        id: leaveId,
        action,
        remarks: remarks || undefined,
        conditionNote: action === 'APPROVED_WITH_CONDITION' ? conditionNote : undefined,
      }).unwrap();
      toast.success(`Leave ${action.toLowerCase().replace(/_/g, ' ')}`);
      onClose();
    } catch (err: any) {
      toast.error(err.data?.error?.message || 'Action failed');
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[90vh] p-8 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-brand-600" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const audit = data.taskAudits?.[0] || null;
  const isHighRisk = data.riskLevel === 'HIGH' || data.riskLevel === 'CRITICAL';

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl" style={{ maxHeight: 'min(90dvh, calc(100dvh - 1rem))' }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-base font-display font-bold text-gray-900">Manager Review</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5">
          {/* Employee Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
              {data.employee?.avatar ? (
                <img src={getUploadUrl(data.employee.avatar)} className="w-full h-full object-cover rounded-xl" />
              ) : (
                getInitials(data.employee?.firstName, data.employee?.lastName)
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{data.employee?.firstName} {data.employee?.lastName}</p>
              <p className="text-xs text-gray-400">{data.employee?.employeeCode} · {data.employee?.department?.name || ''}</p>
            </div>
          </div>

          {/* Leave Summary */}
          <div className="layer-card p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-gray-500">Leave Type</p>
                <p className="font-semibold text-gray-800">{data.leaveType?.name}</p>
              </div>
              <div>
                <p className="text-gray-500">Duration</p>
                <p className="font-semibold text-gray-800 font-mono" data-mono>{Number(data.days)} day(s)</p>
              </div>
              <div>
                <p className="text-gray-500">From</p>
                <p className="font-semibold text-gray-800">{formatDate(data.startDate)}</p>
              </div>
              <div>
                <p className="text-gray-500">To</p>
                <p className="font-semibold text-gray-800">{formatDate(data.endDate)}</p>
              </div>
            </div>
            {data.reason && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">Reason</p>
                <p className="text-xs text-gray-700 mt-1">{data.reason}</p>
              </div>
            )}
          </div>

          {/* Notice Compliance */}
          {data.noticeHours !== null && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              data.noticeHours >= 48 ? 'bg-emerald-50 text-emerald-700' :
              data.noticeHours >= 24 ? 'bg-amber-50 text-amber-700' :
              'bg-red-50 text-red-700'
            }`}>
              <Clock size={13} />
              Applied {data.noticeHours} hours before leave start
              {data.noticeHours < 24 && ' (short notice)'}
            </div>
          )}

          {/* Leave Balance */}
          {data.balances?.length > 0 && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-700 mb-2">Current Balances</h4>
              <div className="flex flex-wrap gap-3">
                {data.balances.slice(0, 6).map((b: any) => (
                  <div key={b.id} className="text-xs">
                    <span className="text-gray-500">{b.leaveType?.name}:</span>{' '}
                    <span className="font-mono font-semibold" data-mono>{b.remaining}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Task Risk */}
          {audit && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Shield size={13} className="text-purple-500" /> Task Impact Assessment
              </h4>
              <TaskAuditPanel auditData={audit} />
            </div>
          )}

          {/* Handover */}
          <div className="layer-card p-4">
            <HandoverSection
              handovers={data.handovers || []}
              editable={false}
              backupEmployeeId={data.backupEmployeeId}
              handoverNotes={data.handoverNotes}
            />
          </div>

          {/* Recent Leave History */}
          {data.recentLeaves?.length > 0 && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-700 mb-2">Recent Leave History (6 months)</h4>
              <div className="space-y-1">
                {data.recentLeaves.slice(0, 5).map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                    <span className="text-gray-600">{l.leaveType?.name}</span>
                    <span className="text-gray-400">{formatDate(l.startDate)} — {formatDate(l.endDate)}</span>
                    <span className="font-mono text-gray-700" data-mono>{Number(l.days)}d</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remarks */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Remarks {isHighRisk && <span className="text-red-500">* (required for high-risk approval)</span>}
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="input-glass w-full text-sm"
              rows={2}
              placeholder="Add your review comments..."
            />
          </div>

        </div>

        {/* Action Bar — managers can only do first-step approval or rejection */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => onAction('MANAGER_APPROVED')}
            disabled={acting || (isHighRisk && !remarks)}
            className="btn-primary text-sm flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle size={14} /> Approve & Forward to HR
          </button>
          <button
            onClick={() => onAction('REJECTED')}
            disabled={acting}
            className="text-sm px-4 py-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-medium flex items-center gap-1"
          >
            <XCircle size={14} /> Reject
          </button>
          {acting && <Loader2 size={16} className="animate-spin text-gray-400 ml-2" />}
        </div>
      </div>
    </div>
  );
}
