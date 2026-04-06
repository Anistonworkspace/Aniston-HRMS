import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Loader2, CheckCircle, CalendarDays, Save } from 'lucide-react';
import {
  useSaveDraftMutation,
  useSubmitDraftMutation,
  useUpdateHandoverMutation,
  usePreviewLeaveMutation,
} from '../leaveApi';
import { useAuditTasksForLeaveMutation } from '../../task-integration/taskIntegrationApi';
import TaskAuditPanel from './TaskAuditPanel';
import HandoverSection from './HandoverSection';
import AcknowledgementSection from './AcknowledgementSection';
import { formatCurrency } from '../../../lib/utils';
import toast from 'react-hot-toast';

const LEAVE_ICONS: Record<string, string> = {
  CL: '🏖️', EL: '✨', SL: '🤒', PL: '🌴', LWP: '📋',
};

interface LeaveApplyWizardProps {
  leaveTypes: any[];
  balances: any[];
  onClose: () => void;
}

const STEPS = ['Leave Details', 'Task Impact', 'Handover', 'Confirm & Submit'];

export default function LeaveApplyWizard({ leaveTypes, balances, onClose }: LeaveApplyWizardProps) {
  const [step, setStep] = useState(0);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [leaveMode, setLeaveMode] = useState<'single' | 'multiple' | 'half'>('single');
  const [formData, setFormData] = useState({
    leaveTypeId: '',
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
  const [auditTasks, { isLoading: auditLoading }] = useAuditTasksForLeaveMutation();

  // Derived state
  const [preview, setPreview] = useState<any>(null);
  const [taskAudit, setTaskAudit] = useState<any>(null);
  const [acknowledgements, setAcknowledgements] = useState({
    reviewedTasks: false,
    assignedHandover: false,
    acceptedVisibility: false,
  });

  const selectedType = leaveTypes.find((t: any) => t.id === formData.leaveTypeId);
  const typeCode = selectedType?.code?.toUpperCase() || '';
  const isSickLeave = typeCode === 'SL' || typeCode === 'SICK';
  const isHalfDay = leaveMode === 'half';
  const effectiveEndDate = leaveMode === 'single' || leaveMode === 'half' ? formData.startDate : formData.endDate;
  const balance = balances.find((b: any) => b.leaveType?.id === formData.leaveTypeId);

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

  // Step 1 → Step 2: save draft & run task audit
  const handleNextFromDetails = async () => {
    if (!formData.leaveTypeId || !formData.startDate || !effectiveEndDate) {
      toast.error('Please fill all required fields');
      return;
    }

    try {
      // Save draft
      const draftRes = await saveDraft({
        leaveTypeId: formData.leaveTypeId,
        startDate: formData.startDate,
        endDate: effectiveEndDate,
        isHalfDay,
        halfDaySession: isHalfDay ? formData.halfDaySession : undefined,
        reason: formData.reason || '',
      }).unwrap();

      setDraftId(draftRes.data.id);

      // Run task audit
      const auditRes = await auditTasks({
        startDate: formData.startDate,
        endDate: effectiveEndDate,
        leaveType: typeCode,
      }).unwrap();
      setTaskAudit(auditRes.data);

      setStep(1);
    } catch (err: any) {
      toast.error(err.data?.error?.message || 'Failed to save draft');
    }
  };

  // Step 3 → Step 4: validate handover
  const handleNextFromHandover = () => {
    if (isSickLeave) {
      setAcknowledgements({ reviewedTasks: true, assignedHandover: true, acceptedVisibility: false });
    }
    setStep(3);
  };

  // Final submit
  const handleSubmit = async () => {
    if (!draftId) return;
    if (!formData.reason || formData.reason.length < 5) {
      toast.error('Reason must be at least 5 characters');
      return;
    }

    try {
      // Update reason on draft if changed
      await saveDraft({
        leaveTypeId: formData.leaveTypeId,
        startDate: formData.startDate,
        endDate: effectiveEndDate,
        isHalfDay,
        reason: formData.reason,
      }).unwrap().catch(() => {});

      await submitDraft({
        id: draftId,
        acknowledgements,
      }).unwrap();

      setSubmitted(true);
      toast.success('Leave request submitted!');
    } catch (err: any) {
      toast.error(err.data?.error?.message || 'Failed to submit leave request');
    }
  };

  // Success screen
  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.2 }}
            className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4"
          >
            <CheckCircle size={32} className="text-emerald-600" />
          </motion.div>
          <h3 className="text-lg font-display font-bold text-gray-900 mb-2">Leave Request Submitted</h3>
          <p className="text-sm text-gray-500 mb-1">
            {preview?.days || '—'} day(s) of {selectedType?.name || 'Leave'}
          </p>
          <p className="text-xs text-gray-400 mb-6">
            {taskAudit?.riskLevel && taskAudit.riskLevel !== 'LOW' && (
              <span className={`font-medium ${taskAudit.riskLevel === 'CRITICAL' ? 'text-red-600' : taskAudit.riskLevel === 'HIGH' ? 'text-orange-600' : 'text-amber-600'}`}>
                Risk: {taskAudit.riskLevel}
              </span>
            )}
          </p>
          <button onClick={onClose} className="btn-primary text-sm">Done</button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-display font-bold text-gray-900">Apply for Leave</h2>
            <p className="text-xs text-gray-400 mt-0.5">{STEPS[step]}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 flex gap-1 shrink-0">
          {STEPS.map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-brand-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="step0" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }} className="space-y-4">
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
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-colors ${
                        leaveMode === m.key ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>

                {/* Leave Type */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Leave Type *</label>
                  <select
                    value={formData.leaveTypeId}
                    onChange={(e) => setFormData(prev => ({ ...prev, leaveTypeId: e.target.value }))}
                    className="input-glass w-full text-sm"
                  >
                    <option value="">Select leave type...</option>
                    {leaveTypes.map((lt: any) => {
                      const bal = balances.find((b: any) => b.leaveType?.id === lt.id);
                      return (
                        <option key={lt.id} value={lt.id}>
                          {LEAVE_ICONS[lt.code] || '📋'} {lt.name} — {bal ? `${bal.remaining} days left` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">{leaveMode === 'multiple' ? 'Start Date *' : 'Date *'}</label>
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                      className="input-glass w-full text-sm"
                    />
                  </div>
                  {leaveMode === 'multiple' && (
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">End Date *</label>
                      <input
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
                      <label className="text-xs text-gray-500 mb-1 block">Session *</label>
                      <select
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

                {/* Preview */}
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

                {/* Reason */}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Reason *</label>
                  <textarea
                    value={formData.reason}
                    onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                    className="input-glass w-full text-sm"
                    rows={2}
                    placeholder="Why are you taking leave? (min 5 characters)"
                  />
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="step1" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }} className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">Task Impact Assessment</h3>
                {auditLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={24} className="animate-spin text-brand-600" />
                    <span className="ml-2 text-sm text-gray-500">Analyzing task impact...</span>
                  </div>
                ) : taskAudit ? (
                  <>
                    <TaskAuditPanel auditData={taskAudit} />
                    {(taskAudit.riskLevel === 'HIGH' || taskAudit.riskLevel === 'CRITICAL') && !isSickLeave && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                        <strong>Warning:</strong> Your leave overlaps with critical tasks. A backup assignment is required before submission.
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">No task audit data available.</p>
                )}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}>
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
                      toast.error(err.data?.error?.message || 'Failed to save handover');
                    }
                  }}
                />
                {isSickLeave && (
                  <p className="text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg mt-4">
                    Sick leave: Handover assignment is optional. You can proceed without it.
                  </p>
                )}
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }} className="space-y-4">
                {/* Summary */}
                <div className="layer-card p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Leave Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-gray-500">Type:</span> <span className="font-medium">{selectedType?.name}</span></div>
                    <div><span className="text-gray-500">Duration:</span> <span className="font-medium font-mono" data-mono>{preview?.days || '—'} day(s)</span></div>
                    <div><span className="text-gray-500">From:</span> <span className="font-medium">{formData.startDate}</span></div>
                    <div><span className="text-gray-500">To:</span> <span className="font-medium">{effectiveEndDate}</span></div>
                    {taskAudit && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Risk Level:</span>{' '}
                        <span className={`font-semibold ${
                          taskAudit.riskLevel === 'CRITICAL' ? 'text-red-600' :
                          taskAudit.riskLevel === 'HIGH' ? 'text-orange-600' :
                          taskAudit.riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'
                        }`}>{taskAudit.riskLevel}</span>
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
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
            className="btn-secondary text-sm flex items-center gap-1"
          >
            {step === 0 ? 'Cancel' : <><ChevronLeft size={14} /> Back</>}
          </button>
          <div className="flex gap-2">
            {step === 0 && (
              <button
                onClick={handleNextFromDetails}
                disabled={savingDraft || auditLoading || !formData.leaveTypeId || !formData.startDate}
                className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {savingDraft || auditLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                Next <ChevronRight size={14} />
              </button>
            )}
            {step === 1 && (
              <button onClick={() => setStep(2)} className="btn-primary text-sm flex items-center gap-1">
                Next <ChevronRight size={14} />
              </button>
            )}
            {step === 2 && (
              <button onClick={handleNextFromHandover} className="btn-primary text-sm flex items-center gap-1">
                Next <ChevronRight size={14} />
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleSubmit}
                disabled={submitting || !acknowledgements.acceptedVisibility || (!isSickLeave && (!acknowledgements.reviewedTasks || !acknowledgements.assignedHandover))}
                className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Submit Leave
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
