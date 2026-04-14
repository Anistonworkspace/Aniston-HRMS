import { useState, useEffect, useCallback } from 'react';
import { X, Calendar, User, Clock, Loader2, MapPin, Video, Mail, MessageCircle, RefreshCw, AlertTriangle, Send, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useScheduleInterviewMutation, usePreviewScheduleMessageMutation } from '../public-apply/publicApplyApi';
import { useGetWhatsAppStatusQuery } from '../whatsapp/whatsappApi';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  applicationId: string;
  candidateName?: string;
  jobTitle?: string;
  companyName?: string;
}

export default function InterviewScheduleModal({ isOpen, onClose, applicationId, candidateName, jobTitle, companyName = 'Aniston Technologies LLP' }: Props) {
  const [showPreview, setShowPreview] = useState(false); // mobile: preview collapsed by default
  const [form, setForm] = useState({
    interviewerName: '',
    date: '',
    time: '',
    location: '',
    isVideoCall: false,
    notes: '',
    sendVia: { whatsapp: true, email: true } as { whatsapp: boolean; email: boolean },
  });

  const [scheduleInterview, { isLoading: scheduling }] = useScheduleInterviewMutation();
  const [previewMessage, { isLoading: previewing }] = usePreviewScheduleMessageMutation();
  const { data: whatsappStatus } = useGetWhatsAppStatusQuery(undefined);
  const isWhatsAppConnected = whatsappStatus?.data?.isConnected;

  const [preview, setPreview] = useState<{ whatsappDraft?: string; emailSubject?: string; emailBody?: string } | null>(null);

  // Debounced AI preview
  const fetchPreview = useCallback(async () => {
    if (!form.date || !form.time || !form.interviewerName) return;
    try {
      const result = await previewMessage({
        applicationId,
        data: {
          scheduledAt: `${form.date}T${form.time}`,
          location: form.isVideoCall ? 'Video Call (link will be shared)' : form.location,
          interviewerName: form.interviewerName,
          jobTitle: jobTitle || 'Open Position',
          companyName,
          candidateName: candidateName || 'Candidate',
        },
      }).unwrap();
      setPreview(result.data || result);
    } catch {
      // Silently fail preview — not critical
    }
  }, [form.date, form.time, form.interviewerName, form.location, form.isVideoCall, applicationId, jobTitle, companyName, candidateName, previewMessage]);

  useEffect(() => {
    const timer = setTimeout(fetchPreview, 500);
    return () => clearTimeout(timer);
  }, [fetchPreview]);

  const handleSubmit = async () => {
    const messageType = form.sendVia.whatsapp && form.sendVia.email ? 'both'
      : form.sendVia.whatsapp ? 'whatsapp'
      : form.sendVia.email ? 'email' : 'both';

    try {
      await scheduleInterview({
        applicationId,
        data: {
          scheduledAt: `${form.date}T${form.time}`,
          location: form.isVideoCall ? 'Video Call' : form.location,
          interviewerName: form.interviewerName,
          notes: form.notes,
          messageType,
        },
      }).unwrap();
      toast.success('Interview scheduled & notifications sent');
      onClose();
    } catch {
      toast.error('Failed to schedule interview');
    }
  };

  const canSubmit = form.date && form.time && form.interviewerName && (form.isVideoCall || form.location);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden flex flex-col" style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-display font-bold text-gray-900">Schedule Interview</h3>
                {candidateName && <p className="text-sm text-gray-500 mt-0.5">for {candidateName} — {jobTitle}</p>}
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Body — stacks on mobile, side-by-side on md+ */}
            <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
              {/* LEFT — Form */}
              <div className="w-full md:w-1/2 p-4 sm:p-6 overflow-y-auto md:border-r border-gray-100 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Interviewer Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={form.interviewerName}
                      onChange={e => setForm({ ...form, interviewerName: e.target.value })}
                      className="input-glass w-full pl-10" placeholder="e.g. Jyoti Bhayana" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <div className="relative">
                      <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="date" value={form.date}
                        onChange={e => setForm({ ...form, date: e.target.value })}
                        className="input-glass w-full pl-10" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                    <div className="relative">
                      <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="time" value={form.time}
                        onChange={e => setForm({ ...form, time: e.target.value })}
                        className="input-glass w-full pl-10" />
                    </div>
                  </div>
                </div>

                {/* Location / Video Call toggle */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">Location</label>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, isVideoCall: !form.isVideoCall, location: '' })}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors ${
                        form.isVideoCall ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      Video Call
                    </button>
                  </div>
                  {!form.isVideoCall ? (
                    <div className="relative">
                      <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input value={form.location}
                        onChange={e => setForm({ ...form, location: e.target.value })}
                        className="input-glass w-full pl-10" placeholder="e.g. 207B, Jacksons Crown Heights, Rohini" />
                    </div>
                  ) : (
                    <p className="text-sm text-brand-600 bg-brand-50 rounded-lg px-3 py-2">Video call link will be shared with the candidate</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                  <input value={companyName} disabled className="input-glass w-full bg-gray-50 text-gray-500" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes for Candidate (optional)</label>
                  <textarea value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="input-glass w-full h-16 resize-none" placeholder="Additional instructions..." />
                </div>

                {/* Send via toggles */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Send Notification Via</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, sendVia: { ...form.sendVia, whatsapp: !form.sendVia.whatsapp } })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        form.sendVia.whatsapp ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 text-gray-400'
                      }`}
                    >
                      <MessageCircle className="w-4 h-4" />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, sendVia: { ...form.sendVia, email: !form.sendVia.email } })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        form.sendVia.email ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      Email
                    </button>
                  </div>

                  {/* Warnings */}
                  {form.sendVia.whatsapp && !isWhatsAppConnected && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      WhatsApp not connected — go to Settings to connect
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT — AI Preview (full width below form on mobile, half on desktop) */}
              <div className="w-full md:w-1/2 bg-gray-50/50 border-t md:border-t-0 border-gray-100">
                {/* Mobile: collapsible toggle */}
                <button
                  type="button"
                  onClick={() => setShowPreview(v => !v)}
                  className="md:hidden w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700"
                >
                  <span>AI Message Preview</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${showPreview ? 'rotate-180' : ''}`} />
                </button>

                <div className={`md:block p-4 sm:p-6 space-y-4 overflow-y-auto ${showPreview ? 'block' : 'hidden'}`}
                  style={{ maxHeight: 'inherit' }}>
                <div className="hidden md:flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-700">AI Message Preview</h4>
                  <button onClick={fetchPreview} disabled={previewing}
                    className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700">
                    {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Regenerate
                  </button>
                </div>
                {/* Mobile regenerate button */}
                <div className="flex md:hidden justify-end">
                  <button onClick={fetchPreview} disabled={previewing}
                    className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700">
                    {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Regenerate
                  </button>
                </div>

                {!form.date || !form.time || !form.interviewerName ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Fill in interviewer, date & time to see AI-generated message preview
                  </div>
                ) : previewing ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
                    <span className="ml-2 text-sm text-gray-500">Generating preview...</span>
                  </div>
                ) : preview ? (
                  <div className="space-y-4">
                    {/* WhatsApp Preview */}
                    {form.sendVia.whatsapp && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <MessageCircle className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-xs font-medium text-green-700">WhatsApp Message</span>
                        </div>
                        <div className="bg-[#dcf8c6] rounded-xl p-3 text-sm text-gray-800 whitespace-pre-wrap shadow-sm" style={{ overflowWrap: 'anywhere' }}>
                          {preview.whatsappDraft || 'Preview not available'}
                        </div>
                      </div>
                    )}

                    {/* Email Preview */}
                    {form.sendVia.email && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Mail className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-xs font-medium text-blue-700">Email</span>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                          <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-500">
                            Subject: <span className="text-gray-800 font-medium">{preview.emailSubject || 'Interview Confirmation'}</span>
                          </div>
                          <div className="p-3 text-sm text-gray-700 whitespace-pre-wrap" style={{ overflowWrap: 'anywhere' }}>
                            {preview.emailBody || 'Preview not available'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Click "Regenerate" or update form fields to see preview
                  </div>
                )}
                </div>{/* end collapsible inner */}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50/30">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={handleSubmit} disabled={scheduling || !canSubmit}
                className="btn-primary flex items-center gap-2">
                {scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Confirm & Send
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
