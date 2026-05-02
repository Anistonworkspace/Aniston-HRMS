import { useState } from 'react';
import { X, Loader2, CheckCircle, XCircle, AlertTriangle, Clock, Shield, AlertCircle, Star, BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import { useGetHrReviewQuery, useHandleLeaveActionMutation } from '../leaveApi';
import { useGetPerformanceSummaryQuery } from '../../performance/performanceApi';
import TaskAuditPanel from './TaskAuditPanel';
import HandoverSection from './HandoverSection';
import { formatDate, getInitials, getUploadUrl, cn } from '../../../lib/utils';
import toast from 'react-hot-toast';

interface HRReviewPanelProps {
  leaveId: string;
  onClose: () => void;
}

export default function HRReviewPanel({ leaveId, onClose }: HRReviewPanelProps) {
  const { data: res, isLoading } = useGetHrReviewQuery(leaveId);
  const [handleAction, { isLoading: acting }] = useHandleLeaveActionMutation();
  const [remarks, setRemarks] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [showCondition, setShowCondition] = useState(false);
  const [showPerfSnapshot, setShowPerfSnapshot] = useState(true);

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
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl w-full max-w-2xl p-8 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-brand-600" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const audit = data.taskAudits?.[0] || null;
  const isHighRisk = data.riskLevel === 'HIGH' || data.riskLevel === 'CRITICAL';
  const { compliance } = data;
  const employeeId = data.employeeId as string | undefined;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl" style={{ maxHeight: 'min(90dvh, calc(100dvh - 1rem))' }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-base font-display font-bold text-gray-900">HR Review</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5">
          {/* Employee Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm overflow-hidden">
              {data.employee?.avatar
                ? <img src={getUploadUrl(data.employee.avatar)} className="w-full h-full object-cover" />
                : getInitials(data.employee?.firstName, data.employee?.lastName)}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{data.employee?.firstName} {data.employee?.lastName}</p>
              <p className="text-xs text-gray-400">{data.employee?.employeeCode} · {data.employee?.department?.name || ''}</p>
            </div>
          </div>

          {/* Performance Snapshot */}
          {employeeId && (
            <PerformanceSnapshot
              employeeId={employeeId}
              leaveTypeName={data.leaveType?.name}
              expanded={showPerfSnapshot}
              onToggle={() => setShowPerfSnapshot((v) => !v)}
            />
          )}

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
              <div className="mt-3 pt-3 border-t border-gray-100 text-xs">
                <span className="text-gray-500">Reason:</span> <span className="text-gray-700">{data.reason}</span>
              </div>
            )}
          </div>

          {/* Policy Compliance Strip */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              compliance?.noticeMet ? 'bg-emerald-50 text-emerald-700' : compliance?.noticeMet === false ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'
            }`}>
              <Clock size={13} />
              Notice: {data.noticeHours != null ? `${data.noticeHours}h` : '—'}
              {compliance?.noticeMet === false && ' (short notice)'}
            </div>
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              compliance?.shortNoticeCount >= compliance?.shortNoticeThreshold ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'
            }`}>
              <AlertCircle size={13} />
              Short-notice leaves (90d): {compliance?.shortNoticeCount || 0}
              {compliance?.shortNoticeCount >= compliance?.shortNoticeThreshold && ' (pattern detected)'}
            </div>
          </div>

          {/* Manager Decision */}
          {data.managerDecision ? (
            <div className={`layer-card p-4 ${
              data.managerDecision.action === 'APPROVED' || data.managerDecision.action === 'MANAGER_APPROVED'
                ? 'border-l-4 border-l-emerald-500'
                : data.managerDecision.action === 'REJECTED'
                ? 'border-l-4 border-l-red-500'
                : 'border-l-4 border-l-amber-500'
            }`}>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">Manager Decision</h4>
              <p className="text-xs text-gray-600">
                <span className="font-medium">{data.managerDecision.action?.replace(/_/g, ' ')}</span>
                {data.managerDecision.comment && <span> — {data.managerDecision.comment}</span>}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                {formatDate(data.managerDecision.createdAt)}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
              <Clock size={13} />
              Awaiting manager review — this request has not yet been reviewed by a manager.
            </div>
          )}

          {/* Task Risk */}
          {audit && (
            <div className="layer-card p-4">
              <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Shield size={13} className="text-purple-500" /> Task Impact
              </h4>
              <TaskAuditPanel auditData={audit} compact />
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

          {/* Remarks */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              HR Remarks {isHighRisk && <span className="text-red-500">* (required for high-risk)</span>}
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="input-glass w-full text-sm"
              rows={2}
              placeholder="Add HR review comments..."
            />
          </div>

          {showCondition && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Condition Note *</label>
              <textarea
                value={conditionNote}
                onChange={(e) => setConditionNote(e.target.value)}
                className="input-glass w-full text-sm"
                rows={2}
                placeholder="Specify condition..."
              />
            </div>
          )}
        </div>

        {/* Actions — status-aware */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2 shrink-0 flex-wrap">
          {(data.status === 'APPROVED' || data.status === 'APPROVED_WITH_CONDITION') ? (
            /* ── Revoke mode: leave already approved, HR can revoke it ── */
            <>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle size={13} /> This leave is <strong>Approved</strong>. You can revoke it below.
                </p>
              </div>
              <button
                onClick={() => {
                  if (!remarks.trim()) { toast.error('Remarks are required when revoking an approved leave'); return; }
                  onAction('REJECTED');
                }}
                disabled={acting || !remarks.trim()}
                className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium flex items-center gap-1 disabled:opacity-50"
              >
                <XCircle size={14} /> Revoke Approval
              </button>
              {acting && <Loader2 size={16} className="animate-spin text-gray-400 ml-2" />}
            </>
          ) : (
            /* ── Normal mode: PENDING or MANAGER_APPROVED ── */
            <>
              <button
                onClick={() => onAction('APPROVED')}
                disabled={acting || (isHighRisk && !remarks)}
                className="btn-primary text-sm flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle size={14} /> Approve
              </button>
              <button
                onClick={() => onAction('REJECTED')}
                disabled={acting}
                className="text-sm px-4 py-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-medium flex items-center gap-1"
              >
                <XCircle size={14} /> Reject
              </button>
              <button
                onClick={() => {
                  if (!showCondition) { setShowCondition(true); return; }
                  if (!conditionNote) { toast.error('Condition note required'); return; }
                  onAction('APPROVED_WITH_CONDITION');
                }}
                disabled={acting}
                className="text-sm px-4 py-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium flex items-center gap-1"
              >
                <AlertTriangle size={14} /> {showCondition ? 'Confirm' : 'Conditional'}
              </button>
              {acting && <Loader2 size={16} className="animate-spin text-gray-400 ml-2" />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Performance Snapshot (inside HR Review) ───────────────────────────
function PerformanceSnapshot({
  employeeId, leaveTypeName, expanded, onToggle,
}: { employeeId: string; leaveTypeName?: string; expanded: boolean; onToggle: () => void }) {
  const { data: perfRes, isLoading } = useGetPerformanceSummaryQuery(
    { employeeId },
    { skip: !employeeId }
  );
  const perf = perfRes?.data;

  const scoreColor = !perf ? '' :
    perf.scores.overall >= 75 ? 'text-emerald-600' :
    perf.scores.overall >= 60 ? 'text-amber-600' : 'text-red-500';

  // Find the balance for the specific leave type being requested
  const requestedBalance = leaveTypeName && perf
    ? (perf.leaves.byType as any[]).find((b: any) =>
        b.typeName?.toLowerCase() === leaveTypeName.toLowerCase()
      )
    : null;

  return (
    <div className="layer-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-brand-500" />
          <span className="text-xs font-semibold text-gray-700">Employee Performance Snapshot</span>
          {isLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
          {perf && (
            <span className={cn('text-xs font-bold font-mono ml-1', scoreColor)} data-mono>
              {perf.scores.overall}/100
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {expanded && perf && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
          {/* Rating */}
          <div className="flex items-center gap-3 pt-3">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star key={s} size={14}
                  className={s <= perf.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'} />
              ))}
            </div>
            <span className="text-xs font-medium text-gray-600">{perf.ratingLabel}</span>
          </div>

          {/* Score grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Goal Completion', sub: `${perf.goals.completed}/${perf.goals.total} goals`, value: perf.scores.goalCompletion, color: 'text-brand-600' },
              { label: 'Leave Discipline', sub: 'Notice & frequency', value: perf.scores.leaveDiscipline, color: 'text-emerald-600' },
              { label: 'Work Continuity', sub: 'Attendance consistency', value: perf.scores.workContinuity, color: 'text-blue-600' },
              { label: 'Task Health', sub: perf.tasks.configured ? `${perf.tasks.overdue} overdue` : 'Integration off', value: perf.scores.taskHealth, color: 'text-amber-600' },
            ].map(({ label, sub, value, color }) => (
              <div key={label} className="bg-gray-50 rounded-lg p-2">
                <p className="text-[10px] text-gray-500">{label}</p>
                <p className={cn('text-base font-bold font-mono', color)} data-mono>{value}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Requested leave type balance — highlighted */}
          {requestedBalance ? (
            <div className="bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-brand-700">{requestedBalance.typeName} balance</span>
                <span className={cn('font-bold font-mono', requestedBalance.remaining > 0 ? 'text-emerald-600' : 'text-red-500')} data-mono>
                  {requestedBalance.remaining} days left
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span>Allocated: {requestedBalance.allocated}</span>
                <span>Used: {requestedBalance.used}</span>
                {requestedBalance.pending > 0 && <span>Pending: {requestedBalance.pending}</span>}
                {requestedBalance.carriedForward > 0 && <span>Carried fwd: {requestedBalance.carriedForward}</span>}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <span>Leaves taken ({new Date().getFullYear()})</span>
              <span className="font-bold font-mono text-gray-700" data-mono>
                {perf.leaves.totalUsed} / {perf.leaves.totalAllocated} days
              </span>
            </div>
          )}

          {/* All leave types compact list */}
          {(perf.leaves.byType as any[]).length > 0 && (
            <div className="space-y-1">
              {(perf.leaves.byType as any[]).map((b: any) => (
                <div key={b.typeId} className="flex items-center justify-between text-[10px] text-gray-500 px-1">
                  <span>{b.typeName}</span>
                  <span className="font-mono" data-mono>
                    {b.used} used · <span className={b.remaining > 0 ? 'text-emerald-600' : 'text-red-500'}>{b.remaining} left</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Task integration status */}
          {!perf.tasks.configured ? (
            <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
              <AlertCircle size={11} />
              <span>Task integration not configured — set up in Settings</span>
            </div>
          ) : perf.tasks.fetchError ? (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle size={11} />
              <span>Could not fetch tasks — check integration config in Settings</span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <span className="flex items-center gap-1">
                Active tasks
                {perf.tasks.provider && (
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-1 py-0.5 rounded font-mono capitalize">{perf.tasks.provider}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold font-mono text-gray-700" data-mono>{perf.tasks.total}</span>
                {perf.tasks.overdue > 0 && (
                  <span className="text-red-500 text-[10px]">{perf.tasks.overdue} overdue</span>
                )}
                {perf.tasks.total === 0 && (
                  <span className="text-gray-400 text-[10px]">none found for this employee</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
