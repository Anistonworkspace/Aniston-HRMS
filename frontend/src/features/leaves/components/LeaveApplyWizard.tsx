import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Loader2, CheckCircle, SkipForward, Info } from 'lucide-react';
import {
  useSaveDraftMutation,
  useSubmitDraftMutation,
  useUpdateHandoverMutation,
  usePreviewLeaveMutation,
  useCancelLeaveMutation,
} from '../leaveApi';
import { useAuditTasksForLeaveMutation } from '../../task-integration/taskIntegrationApi';
import TaskAuditPanel from './TaskAuditPanel';
import HandoverSection from './HandoverSection';
import AcknowledgementSection from './AcknowledgementSection';
import toast from 'react-hot-toast';

const LEAVE_ICONS: Record<string, string> = {
  CL: '🏖️', EL: '✨', SL: '🤒', PL: '🌴', LWP: '📋',
};

interface LeaveApplyWizardProps {
  leaveTypes: any[];
  balances: any[];
  onClose: () => void;
  initialLeaveTypeId?: string;
}

const STEPS = ['Leave Details', 'Task Impact', 'Handover', 'Confirm & Submit'];

export default function LeaveApplyWizard({ leaveTypes, balances, onClose, initialLeaveTypeId }: LeaveApplyWizardProps) {
  const prefersReducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Monthly quota exceeded — prompt to switch to LWP
  const [lwpSwitchPrompt, setLwpSwitchPrompt] = useState<string | null>(null);

  // Form state
  const [leaveMode, setLeaveMode] = useState<'single' | 'multiple' | 'half'>('single');
  const [formData, setFormData] = useState({
    leaveTypeId: initialLeaveTypeId || '',
    startDate: '',
    endDate: '',
    halfDaySession: 'FIRST_HALF',
    reason: '',
    attachmentUrl: '',
  });

  // API hooks
  const [saveDraft, { isLoading: savingDraft }] = useSaveDraftMutation();
  const [submitDraft, { isLoading: submitting }] = useSubmitDraftMutation();
  const [updateHandover] = useUpdateHandoverMutation();
  const [previewLeave] = usePreviewLeaveMutation();
  const [cancelLeave] = useCancelLeaveMutation();
  const [auditTasks, { isLoading: auditLoading }] = useAuditTasksForLeaveMutation();

  // Derived state
  const [preview, setPreview] = useState<any>(null);
  const [taskAudit, setTaskAudit] = useState<any>(null);
  const [acknowledgements, setAcknowledgements] = useState({
    reviewedTasks: false,
    assignedHandover: true, // always pre-accepted — handover is never mandatory
    acceptedVisibility: false,
  });

  const selectedType = leaveTypes.find((t: any) => t.id === formData.leaveTypeId);
  const typeCode = selectedType?.code?.toUpperCase() || '';

  // Minimum allowed start date based on notice days (e.g. 3 notice days → must apply 3 days ahead)
  const minStartDate = (() => {
    const noticeDays = selectedType?.noticeDays ?? 0;
    if (noticeDays <= 0 || selectedType?.allowSameDay) return '';
    const d = new Date();
    d.setDate(d.getDate() + noticeDays);
    return d.toISOString().split('T')[0];
  })();
  const isHalfDay = leaveMode === 'half';
  const effectiveEndDate = leaveMode === 'single' || leaveMode === 'half' ? formData.startDate : formData.endDate;
  const taskIntegrationNotConfigured =
    !taskAudit ||
    taskAudit.integrationStatus === 'NOT_CONFIGURED' ||
    taskAudit.integrationStatus === 'ERROR' ||
    taskAudit.integrationStatus === 'DISABLED';

  // Auto-preview when dates/type change
  useEffect(() => {
    if (formData.leaveTypeId && formData.startDate && effectiveEndDate) {
      previewLeave({
        leaveTypeId: formData.leaveTypeId,
        startDate: formData.startDate,
        endDate: effectiveEndDate,
        isHalfDay,
        halfDaySession: isHalfDay ? formData.halfDaySession : undefined,
      }).unwrap().then(res => setPreview(res.data)).catch(() => {});
    }
  }, [formData.leaveTypeId, formData.startDate, effectiveEndDate, isHalfDay, formData.halfDaySession]);

  // Step 0 → Step 1: save draft & run task audit
  const handleNextFromDetails = async () => {
    if (!formData.leaveTypeId || !formData.startDate || !effectiveEndDate) {
      toast.error('Please fill all required fields');
      return;
    }
    if (!formData.reason || formData.reason.length < 5) {
      toast.error('Reason must be at least 5 characters');
      return;
    }

    try {
      const draftRes = await saveDraft({
        leaveTypeId: formData.leaveTypeId,
        startDate: formData.startDate,
        endDate: effectiveEndDate,
        isHalfDay,
        halfDaySession: isHalfDay ? formData.halfDaySession : undefined,
        reason: formData.reason,
      }).unwrap();

      setDraftId(draftRes.data.id);

      // Run task audit — non-blocking, errors are handled gracefully
      try {
        const auditRes = await auditTasks({
          startDate: formData.startDate,
          endDate: effectiveEndDate,
          leaveType: typeCode,
        }).unwrap();
        setTaskAudit(auditRes.data);
      } catch {
        // Task audit failure does NOT block leave — just show not configured state
        setTaskAudit({ integrationStatus: 'NOT_CONFIGURED', riskLevel: 'LOW', riskScore: 0, items: [] });
      }

      setStep(1);
    } catch (err: any) {
      const msg = err?.data?.error?.message || err?.message || 'Failed to save leave draft. Please try again.';
      // Monthly limit exceeded → offer LWP switch instead of hard error
      const isMonthlyLimit = msg.toLowerCase().includes('monthly paid leave limit') || msg.toLowerCase().includes('monthly quota');
      const lwpType = leaveTypes.find((lt: any) => !lt.isPaid);
      if (isMonthlyLimit && lwpType && selectedType?.isPaid) {
        setLwpSwitchPrompt(msg);
      } else {
        toast.error(msg, { duration: 6000 });
      }
    }
  };

  // Step 2 → Step 3: handover is always optional, never blocks
  const handleNextFromHandover = () => {
    setAcknowledgements(prev => ({ ...prev, assignedHandover: true }));
    setStep(3);
  };

  // Final submit — only blocked by visibility acknowledgement, never by backup/risk
  const handleSubmit = async () => {
    if (!draftId) return;

    try {
      await submitDraft({
        id: draftId,
        acknowledgements,
      }).unwrap();

      setSubmitted(true);
      toast.success('Leave request submitted successfully!');
    } catch (err: any) {
      // Show exact backend validation message (from leave type settings)
      const msg = err?.data?.error?.message || err?.message || 'Failed to submit leave request. Please try again.';
      toast.error(msg, { duration: 6000 });
    }
  };

  // Success screen
  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: prefersReducedMotion ? 1 : 0.9, opacity: prefersReducedMotion ? 1 : 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
          className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center"
        >
          <motion.div
            initial={{ scale: prefersReducedMotion ? 1 : 0 }}
            animate={{ scale: 1 }}
            transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', delay: 0.2 }}
            className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4"
          >
            <CheckCircle size={32} className="text-emerald-600" />
          </motion.div>
          <h3 className="text-lg font-display font-bold text-gray-900 mb-2">Leave Request Submitted</h3>
          <p className="text-sm text-gray-500 mb-1">
            {preview?.days || '—'} day(s) of {selectedType?.name || 'Leave'}
          </p>
          {taskAudit?.riskLevel && taskAudit.riskLevel !== 'LOW' && !taskIntegrationNotConfigured && (
            <p className={`text-xs font-medium mb-2 ${
              taskAudit.riskLevel === 'CRITICAL' ? 'text-red-600' :
              taskAudit.riskLevel === 'HIGH' ? 'text-orange-600' : 'text-amber-600'
            }`}>
              Task Risk: {taskAudit.riskLevel}
            </p>
          )}
          <p className="text-xs text-gray-400 mb-6">Your manager will review and approve your request.</p>
          <button onClick={onClose} className="btn-primary text-sm">Done</button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: prefersReducedMotion ? 1 : 0.95, opacity: prefersReducedMotion ? 1 : 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col" style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-display font-bold text-gray-900">Apply for Leave</h2>
            <p className="text-xs text-gray-400 mt-0.5">{STEPS[step]}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* Step Indicator */}
        <div className="px-4 sm:px-6 py-3 flex gap-1 shrink-0">
          {STEPS.map((s, i) => (
            <div key={s} className="h-1 flex-1 rounded-full transition-colors" style={{ background: i <= step ? 'var(--primary-color)' : 'var(--ui-background-color)' }} />
          ))}
        </div>

        {/* Content */}
        <div className="px-4 sm:px-6 py-4 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">

            {/* ── Step 0: Leave Details ── */}
            {step === 0 && (
              <motion.div key="step0" initial={{ x: prefersReducedMotion ? 0 : 20, opacity: prefersReducedMotion ? 1 : 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: prefersReducedMotion ? 0 : -20, opacity: prefersReducedMotion ? 1 : 0 }} className="space-y-4">
                {/* Leave Mode */}
                <div className="flex gap-2">
                  {[
                    { key: 'single', label: '1 Day', icon: '1️⃣' },
                    { key: 'multiple', label: 'Multiple', icon: '📅' },
                    { key: 'half', label: 'Half Day', icon: '½' },
                  ].map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setLeaveMode(m.key as any)}
                      className="flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-colors"
                      style={leaveMode === m.key
                        ? { borderColor: 'var(--primary-color)', background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }
                        : { borderColor: 'var(--ui-border-color)', color: 'var(--secondary-text-color)' }
                      }
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>

                {/* Leave Type */}
                <div>
                  <label htmlFor="leave-type-select" className="text-xs text-gray-500 mb-1 block">Leave Type *</label>
                  <select
                    id="leave-type-select"
                    value={formData.leaveTypeId}
                    onChange={(e) => setFormData(prev => ({ ...prev, leaveTypeId: e.target.value }))}
                    className="input-glass w-full text-sm"
                  >
                    <option value="">Select leave type...</option>
                    {leaveTypes
                      .filter((lt: any) => !lt.isPaid || balances.some((b: any) => (b.leaveType?.id ?? b.leaveTypeId) === lt.id))
                      .map((lt: any) => {
                        const bal = balances.find((b: any) => (b.leaveType?.id ?? b.leaveTypeId) === lt.id);
                        return (
                          <option key={lt.id} value={lt.id}>
                            {LEAVE_ICONS[lt.code] || '📋'} {lt.name}{bal ? ` — ${bal.remaining} days left` : lt.isPaid ? '' : ' — Unpaid (no limit)'}
                          </option>
                        );
                      })}
                  </select>
                  {selectedType && !selectedType.isPaid && (
                    <p className="mt-1.5 text-[11px] text-amber-600 font-medium">Unpaid leave</p>
                  )}
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="leave-start-date" className="text-xs text-gray-500 mb-1 block">{leaveMode === 'multiple' ? 'Start Date *' : 'Date *'}</label>
                    <input
                      id="leave-start-date"
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                      className="input-glass w-full text-sm"
                      min={minStartDate || undefined}
                    />
                    {minStartDate && (
                      <p className="text-[10px] text-amber-600 mt-0.5">⏰ {selectedType?.noticeDays}d notice required — earliest: {minStartDate}</p>
                    )}
                  </div>
                  {leaveMode === 'multiple' && (
                    <div>
                      <label htmlFor="leave-end-date" className="text-xs text-gray-500 mb-1 block">End Date *</label>
                      <input
                        id="leave-end-date"
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                        className="input-glass w-full text-sm"
                        min={formData.startDate}
                      />
                    </div>
                  )}
                  {leaveMode === 'half' && (
                    <div>
                      <label htmlFor="leave-session-select" className="text-xs text-gray-500 mb-1 block">Session *</label>
                      <select
                        id="leave-session-select"
                        value={formData.halfDaySession}
                        onChange={(e) => setFormData(prev => ({ ...prev, halfDaySession: e.target.value }))}
                        className="input-glass w-full text-sm"
                      >
                        <option value="FIRST_HALF">First Half</option>
                        <option value="SECOND_HALF">Second Half</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Live Preview */}
                {preview && (
                  <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold font-mono text-gray-900" data-mono>{preview.days}</p>
                      <p className="text-[10px] text-gray-500">Days</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold font-mono text-gray-900" data-mono>{preview.balance?.available ?? '—'}</p>
                      <p className="text-[10px] text-gray-500">Available</p>
                    </div>
                    <div>
                      <p className={`text-lg font-bold font-mono ${(preview.balance?.remainingAfter ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`} data-mono>
                        {preview.balance?.remainingAfter ?? '—'}
                      </p>
                      <p className="text-[10px] text-gray-500">Remaining</p>
                    </div>
                  </div>
                )}
                {/* Monthly quota warning — shows proactively when preview signals willExceed */}
                {selectedType?.isPaid && preview?.monthlyQuota?.willExceed && (() => {
                  const lwpType = leaveTypes.find((lt: any) => !lt.isPaid);
                  return (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-orange-700 mb-1">⚠ Monthly Paid Leave Quota</p>
                      <p className="text-[11px] text-orange-700">
                        You've used {preview.monthlyQuota.usedThisMonth} of {preview.monthlyQuota.maxPerMonth} paid days allowed this month.
                        Excess days will be counted as unpaid leave.
                      </p>
                      {lwpType && (
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, leaveTypeId: lwpType.id }))}
                          className="mt-2 text-[11px] font-medium text-orange-800 underline hover:no-underline"
                        >
                          Switch to Unpaid Leave instead →
                        </button>
                      )}
                    </div>
                  );
                })()}
                {/* Split preview — shows paid/unpaid breakdown when auto-split will occur */}
                {preview?.splitPreview && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-amber-700 mb-1.5">⚡ Leave Split Preview</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                        ✓ {preview.splitPreview.paidDays} paid day{preview.splitPreview.paidDays !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[11px] text-gray-400">+</span>
                      <span className="flex items-center gap-1 text-[11px] text-amber-700 font-medium bg-amber-100 px-2 py-0.5 rounded-full">
                        ⚠ {preview.splitPreview.unpaidDays} unpaid day{preview.splitPreview.unpaidDays !== 1 ? 's' : ''} (LWP)
                      </span>
                    </div>
                    {preview.splitPreview.reason && (
                      <p className="text-[10px] text-amber-600 mt-1.5">{preview.splitPreview.reason}</p>
                    )}
                  </div>
                )}
                {preview?.warnings?.filter((w: string) =>
                  !w.toLowerCase().includes('monthly paid leave limit')
                ).length > 0 && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
                    {preview.warnings
                      .filter((w: string) => !w.toLowerCase().includes('monthly paid leave limit'))
                      .map((w: string, i: number) => <p key={i}>⚠ {w}</p>)}
                  </div>
                )}
                {selectedType?.isPaid && preview !== null && (preview.balance?.remainingAfter ?? 0) < 0 && !preview?.monthlyQuota?.willExceed && (
                  <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <span className="text-red-500 mt-0.5">✕</span>
                    <p><strong>Insufficient leave balance.</strong> You need {Math.abs(preview.balance.remainingAfter)} more day(s) to apply for this leave. Contact HR to adjust your balance.</p>
                  </div>
                )}
                {/* 0-day guard — shown when selected dates contain no working days */}
                {preview !== null && Number(preview.days) <= 0 && formData.startDate && effectiveEndDate && (
                  <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <span className="text-red-500 mt-0.5">✕</span>
                    <p><strong>No working days selected.</strong> Selected dates contain no working days. Please select dates within working days.</p>
                  </div>
                )}

                {/* Reason */}
                <div>
                  <label htmlFor="leave-reason" className="text-xs text-gray-500 mb-1 block">Reason *</label>
                  <textarea
                    id="leave-reason"
                    value={formData.reason}
                    onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                    className="input-glass w-full text-sm"
                    rows={2}
                    placeholder="Why are you taking leave? (min 5 characters)"
                  />
                </div>
              </motion.div>
            )}

            {/* ── Step 1: Task Impact ── */}
            {step === 1 && (
              <motion.div key="step1" initial={{ x: prefersReducedMotion ? 0 : 20, opacity: prefersReducedMotion ? 1 : 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: prefersReducedMotion ? 0 : -20, opacity: prefersReducedMotion ? 1 : 0 }} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Task Impact Assessment</h3>
                  <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">informational only</span>
                </div>

                {auditLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                    <span className="ml-2 text-sm text-gray-500">Checking task impact...</span>
                  </div>
                ) : taskIntegrationNotConfigured ? (
                  // No task integration connected — show info state, never block
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      <Info size={20} className="text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 mb-1">No Task Integration Connected</p>
                    <p className="text-xs text-gray-400">
                      Task impact analysis requires a connected project management tool (Jira, Linear, ClickUp, etc.).<br />
                      Your leave can still be submitted without it.
                    </p>
                    <p className="text-[11px] mt-2" style={{ color: 'var(--primary-color)' }}>Contact your admin to configure task integration in Settings.</p>
                  </div>
                ) : (
                  <>
                    <TaskAuditPanel auditData={taskAudit} />
                    {(taskAudit.riskLevel === 'HIGH' || taskAudit.riskLevel === 'CRITICAL') && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
                        <span>⚠</span>
                        <div>
                          <p className="font-medium mb-0.5">High-impact leave detected</p>
                          <p className="text-amber-700">You have critical tasks during this period. Consider assigning a backup in the next step. <strong>This is informational — your leave will not be blocked.</strong></p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* ── Step 2: Handover (fully optional) ── */}
            {step === 2 && (
              <motion.div key="step2" initial={{ x: prefersReducedMotion ? 0 : 20, opacity: prefersReducedMotion ? 1 : 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: prefersReducedMotion ? 0 : -20, opacity: prefersReducedMotion ? 1 : 0 }} className="space-y-3">
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex gap-2 text-xs text-blue-700">
                  <span>ℹ</span>
                  <span>Backup assignment is <strong>completely optional</strong> for all leave types. You can skip this step and still submit your leave.</span>
                </div>
                <HandoverSection
                  handovers={[]}
                  editable
                  auditItems={taskAudit?.items || []}
                  onUpdate={async (data) => {
                    if (!draftId) return;
                    try {
                      await updateHandover({ id: draftId, ...data }).unwrap();
                      toast.success('Handover plan saved');
                    } catch (err: any) {
                      toast.error(err?.data?.error?.message || 'Failed to save handover');
                    }
                  }}
                />
              </motion.div>
            )}

            {/* ── Step 3: Confirm & Submit ── */}
            {step === 3 && (
              <motion.div key="step3" initial={{ x: prefersReducedMotion ? 0 : 20, opacity: prefersReducedMotion ? 1 : 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: prefersReducedMotion ? 0 : -20, opacity: prefersReducedMotion ? 1 : 0 }} className="space-y-4">
                {/* Summary */}
                <div className="layer-card p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Leave Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-gray-500">Type:</span> <span className="font-medium">{selectedType?.name}</span></div>
                    <div><span className="text-gray-500">Duration:</span> <span className="font-medium font-mono" data-mono>{preview?.days || '—'} day(s)</span></div>
                    <div><span className="text-gray-500">From:</span> <span className="font-medium">{formData.startDate}</span></div>
                    <div><span className="text-gray-500">To:</span> <span className="font-medium">{effectiveEndDate}</span></div>
                    {taskAudit && !taskIntegrationNotConfigured && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Risk Level:</span>{' '}
                        <span className={`font-semibold ${
                          taskAudit.riskLevel === 'CRITICAL' ? 'text-red-600' :
                          taskAudit.riskLevel === 'HIGH' ? 'text-orange-600' :
                          taskAudit.riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'
                        }`}>{taskAudit.riskLevel || 'LOW'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Acknowledgements */}
                <AcknowledgementSection
                  acknowledgements={acknowledgements}
                  onChange={setAcknowledgements}
                  leaveTypeCode={typeCode}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <button
            onClick={() => {
              if (step === 0) {
                onClose();
              } else if (step === 1 && draftId) {
                // Cancel the orphan draft so re-apply from Step 0 doesn't hit overlap errors
                cancelLeave(draftId);
                setDraftId(null);
                setStep(0);
              } else {
                setStep(step - 1);
              }
            }}
            className="btn-secondary text-sm flex items-center gap-1"
          >
            {step === 0 ? 'Cancel' : <><ChevronLeft size={14} /> Back</>}
          </button>

          <div className="flex gap-2 items-center">
            {/* Step 0 → 1 */}
            {step === 0 && (
              <button
                onClick={handleNextFromDetails}
                disabled={
                  savingDraft || auditLoading || !formData.leaveTypeId || !formData.startDate ||
                  // Block if paid leave and balance would go negative
                  (selectedType?.isPaid && preview !== null && (preview.balance?.remainingAfter ?? 0) < 0) ||
                  // Block if selected dates contain no working days
                  (preview !== null && Number(preview.days) <= 0 && !!formData.startDate && !!effectiveEndDate)
                }
                className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {savingDraft || auditLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                Next <ChevronRight size={14} />
              </button>
            )}

            {/* Step 1 → 2: always allowed */}
            {step === 1 && (
              <button onClick={() => setStep(2)} className="btn-primary text-sm flex items-center gap-1">
                Next <ChevronRight size={14} />
              </button>
            )}

            {/* Step 2 → 3: skip or proceed (handover is optional) */}
            {step === 2 && (
              <>
                <button
                  onClick={handleNextFromHandover}
                  className="btn-secondary text-sm flex items-center gap-1 text-gray-500"
                >
                  <SkipForward size={14} /> Skip
                </button>
                <button onClick={handleNextFromHandover} className="btn-primary text-sm flex items-center gap-1">
                  Next <ChevronRight size={14} />
                </button>
              </>
            )}

            {/* Step 3 → Submit: only visibility ack required */}
            {step === 3 && (
              <button
                onClick={handleSubmit}
                disabled={submitting || !acknowledgements.acceptedVisibility}
                className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Submit Leave
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Monthly quota exceeded — LWP switch prompt */}
      <AnimatePresence>
        {lwpSwitchPrompt && (() => {
          const lwpType = leaveTypes.find((lt: any) => !lt.isPaid);
          if (!lwpType) return null;
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
            >
              <motion.div
                initial={{ opacity: 0, y: 60 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 60 }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md mx-auto p-6 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <span className="text-lg">⚠️</span>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Monthly Paid Leave Limit Reached</h3>
                    <p className="text-xs text-gray-500 mt-0.5">You have used your maximum paid leaves for this month.</p>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-relaxed">
                  {lwpSwitchPrompt}
                </div>

                <div className="bg-gray-50 rounded-xl p-3 flex items-center gap-3">
                  <span className="text-2xl">📋</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{lwpType.name} (Unpaid)</p>
                    <p className="text-xs text-gray-500 mt-0.5">Apply as unpaid leave — no balance limit. Will impact payroll.</p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setLwpSwitchPrompt(null)}
                    className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, leaveTypeId: lwpType.id }));
                      setLwpSwitchPrompt(null);
                    }}
                    className="flex-1 py-2.5 text-sm bg-amber-600 text-white rounded-xl hover:bg-amber-700 font-medium transition-colors"
                  >
                    Switch to Unpaid Leave
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
