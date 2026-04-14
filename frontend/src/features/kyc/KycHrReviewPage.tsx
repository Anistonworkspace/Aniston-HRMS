import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, User, CheckCircle, XCircle, AlertTriangle, Clock,
  Eye, RefreshCw, ArrowLeft, ChevronDown, ChevronUp, MessageSquare,
  Shield, Download, Cpu, Server, ClipboardList,
} from 'lucide-react';
import {
  useGetPendingKycQuery,
  useGetKycHrReviewQuery,
  useVerifyKycMutation,
  useRejectKycMutation,
  useRequestReuploadMutation,
  useUpdateHrNotesMutation,
  useRetriggerOcrMutation,
} from './kycApi';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PendingEmployee {
  id: string;
  name: string;
  employeeCode: string;
  email: string;
  department?: string;
  kycStatus: string;
  submittedAt?: string;
  uploadMode?: string;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:           { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pending' },
  SUBMITTED:         { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Submitted' },
  PROCESSING:        { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Processing' },
  PENDING_HR_REVIEW: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Needs Review' },
  REUPLOAD_REQUIRED: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Re-upload Requested' },
  VERIFIED:          { bg: 'bg-green-100', text: 'text-green-700', label: 'Approved' },
  REJECTED:          { bg: 'bg-red-100', text: 'text-red-700', label: 'Rejected' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: status };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── Risk Level Badge ─────────────────────────────────────────────────────────
function RiskBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    LOW: 'bg-green-100 text-green-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    HIGH: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[level] ?? 'bg-slate-100 text-slate-600'}`}>
      <Shield className="w-3 h-3" />
      {level} RISK
    </span>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="layer-card mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/30 transition-colors"
      >
        <span className="font-semibold text-slate-800 text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Processing Mode Badge ─────────────────────────────────────────────────────
function ProcessingModeBadge({ mode }: { mode?: string | null }) {
  if (!mode) return null;
  const configs: Record<string, { icon: any; bg: string; text: string; label: string }> = {
    PYTHON_ADVANCED:     { icon: Cpu,          bg: 'bg-indigo-50', text: 'text-indigo-700', label: 'Python AI Advanced' },
    NODE_FALLBACK:       { icon: Server,        bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Node.js Fallback' },
    MANUAL_REVIEW_ONLY:  { icon: ClipboardList, bg: 'bg-red-50',    text: 'text-red-700',    label: 'Manual Review Only' },
    python_advanced:     { icon: Cpu,          bg: 'bg-indigo-50', text: 'text-indigo-700', label: 'Python AI Advanced' },
    node_fallback:       { icon: Server,        bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Node.js Fallback' },
    manual_review:       { icon: ClipboardList, bg: 'bg-red-50',    text: 'text-red-700',    label: 'Manual Review Only' },
  };
  const c = configs[mode];
  if (!c) return null;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      <Icon className="w-3 h-3" />
      OCR: {c.label}
    </span>
  );
}

// ─── HR Review Detail Panel ───────────────────────────────────────────────────
function HrReviewDetail({ employeeId, onBack }: { employeeId: string; onBack: () => void }) {
  const { data, isLoading, refetch } = useGetKycHrReviewQuery(employeeId);
  const [verifyKyc, { isLoading: verifying }] = useVerifyKycMutation();
  const [rejectKyc, { isLoading: rejecting }] = useRejectKycMutation();
  const [requestReupload, { isLoading: reuploading }] = useRequestReuploadMutation();
  const [updateHrNotes] = useUpdateHrNotesMutation();
  const [retriggerOcr, { isLoading: retriggering }] = useRetriggerOcrMutation();

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showReuploadModal, setShowReuploadModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reuploadDocTypes, setReuploadDocTypes] = useState<string[]>([]);
  const [reuploadReasons, setReuploadReasons] = useState<Record<string, string>>({});
  const [hrNotes, setHrNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-slate-500 text-sm">Loading KYC data…</p>
      </div>
    );
  }

  const review = data?.data;
  if (!review) return <p className="text-slate-500">No data available.</p>;

  const { gate, employee, documents, crossValidation } = review;
  const analysis = gate?.combinedPdfAnalysis;
  const docRejectReasons = gate?.documentRejectReasons || {};

  const handleApprove = async () => {
    if (!confirm(`Approve KYC for ${employee?.name}? This will unlock their dashboard and auto-fill verified profile fields.`)) return;
    try {
      await verifyKyc(employeeId).unwrap();
      onBack();
    } catch (err: any) {
      alert(err?.data?.error?.message || 'Approval failed');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectKyc({ employeeId, reason: rejectReason }).unwrap();
      setShowRejectModal(false);
      onBack();
    } catch (err: any) {
      alert(err?.data?.error?.message || 'Rejection failed');
    }
  };

  const handleReupload = async () => {
    if (reuploadDocTypes.length === 0) return;
    try {
      await requestReupload({ employeeId, docTypes: reuploadDocTypes, reasons: reuploadReasons }).unwrap();
      setShowReuploadModal(false);
      onBack();
    } catch (err: any) {
      alert(err?.data?.error?.message || 'Failed to request re-upload');
    }
  };

  const handleSaveNotes = async () => {
    try {
      await updateHrNotes({ employeeId, notes: hrNotes }).unwrap();
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch { /* ignore */ }
  };

  const handleRetriggerOcr = async () => {
    try {
      await retriggerOcr(employeeId).unwrap();
      setTimeout(() => refetch(), 2000);
    } catch { /* ignore */ }
  };

  const docTypes = documents?.map((d: any) => d.type).filter((t: string) => t !== 'OTHER');

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/50 transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 font-sora">
            KYC Review — {employee?.name}
          </h1>
          <p className="text-sm text-slate-500">{employee?.employeeCode} · {employee?.email}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusBadge status={gate?.kycStatus} />
            <ProcessingModeBadge mode={gate?.processingMode} />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRetriggerOcr}
            disabled={retriggering}
            className="btn-secondary flex items-center gap-1.5 text-sm py-1.5 px-3"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retriggering ? 'animate-spin' : ''}`} />
            Re-run OCR
          </button>
        </div>
      </div>

      {/* Fallback warning — shown when Python AI was unavailable and Node.js processed instead */}
      {gate?.fallbackUsed && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {gate?.processingMode === 'MANUAL_REVIEW_ONLY'
                ? 'OCR unavailable — manual review required'
                : 'Processed by Node.js fallback (Python AI was offline)'}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {gate?.processingMode === 'MANUAL_REVIEW_ONLY'
                ? 'Both the Python AI service and Node.js OCR failed to process this document. Please review all pages manually.'
                : 'The primary Python AI service was unavailable. Node.js OCR was used as fallback — accuracy may be lower than usual. Please verify key fields manually.'}
            </p>
          </div>
        </div>
      )}

      {/* Action Bar */}
      {['SUBMITTED', 'PENDING_HR_REVIEW', 'PROCESSING'].includes(gate?.kycStatus) && (
        <div className="layer-card p-4 mb-6 flex flex-wrap gap-3 items-center">
          <span className="text-sm text-slate-600 font-medium flex-1">Take action on this submission:</span>
          <button
            onClick={() => setShowReuploadModal(true)}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            Request Re-upload
          </button>
          <button
            onClick={() => setShowRejectModal(true)}
            disabled={rejecting}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
          >
            <XCircle className="w-4 h-4" />
            Reject
          </button>
          <button
            onClick={handleApprove}
            disabled={verifying}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {verifying ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : <CheckCircle className="w-4 h-4" />}
            Approve KYC
          </button>
        </div>
      )}

      {/* Cross-Validation Matrix */}
      {crossValidation && (
        <Section title="Cross-Document Validation">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Name Matches</p>
              {Object.entries(crossValidation.nameMatches || {}).map(([pair, result]: [string, any]) => (
                <div key={pair} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-sm text-slate-600">{pair.replace('_vs_', ' vs ')}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    result.verdict === 'PASS' ? 'bg-green-100 text-green-700' :
                    result.verdict === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {result.verdict} ({Math.round((result.score || 0) * 100)}%)
                  </span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">DOB Matches</p>
              {Object.entries(crossValidation.dobMatches || {}).map(([pair, result]: [string, any]) => (
                <div key={pair} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-sm text-slate-600">{pair.replace('_vs_', ' vs ')}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    result === 'MATCH' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>{result}</span>
                </div>
              ))}
              {crossValidation.overallRisk && (
                <div className="mt-3">
                  <RiskBadge level={crossValidation.overallRisk} />
                </div>
              )}
            </div>
          </div>
          {crossValidation.flags?.length > 0 && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg">
              <p className="text-xs font-semibold text-red-700 mb-1">Flags:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {crossValidation.flags.map((f: string, i: number) => (
                  <li key={i} className="text-xs text-red-600">{f}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Combined PDF Analysis */}
      {analysis && (
        <Section title="Combined PDF Analysis">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <p className="text-2xl font-bold font-mono text-slate-800">{analysis.total_pages}</p>
              <p className="text-xs text-slate-500">Total Pages</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <p className="text-2xl font-bold font-mono text-slate-800">{analysis.detected_docs?.length ?? 0}</p>
              <p className="text-xs text-slate-500">Doc Types Found</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
              <p className="text-2xl font-bold font-mono text-slate-800">{analysis.suspicion_score ?? 0}</p>
              <p className="text-xs text-slate-500">Suspicion Score</p>
            </div>
            {analysis.risk_level && <RiskBadge level={analysis.risk_level} />}
          </div>

          {analysis.detected_docs?.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Detected Documents</p>
              <div className="flex flex-wrap gap-2">
                {analysis.detected_docs.map((d: string) => (
                  <span key={d} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{d}</span>
                ))}
              </div>
            </div>
          )}

          {analysis.suspicion_flags?.length > 0 && (
            <div className="p-3 bg-red-50 rounded-lg">
              <p className="text-xs font-semibold text-red-700 mb-1">Suspicion Flags:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {analysis.suspicion_flags.map((f: string, i: number) => (
                  <li key={i} className="text-xs text-red-600">{f}</li>
                ))}
              </ul>
            </div>
          )}

          {analysis.missing_from_required?.length > 0 && (
            <div className="p-3 bg-orange-50 rounded-lg mt-2">
              <p className="text-xs font-semibold text-orange-700 mb-1">Missing Required Docs:</p>
              <div className="flex flex-wrap gap-2">
                {analysis.missing_from_required.map((d: string) => (
                  <span key={d} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{d}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Documents */}
      <Section title={`Uploaded Documents (${documents?.length ?? 0})`}>
        {(!documents || documents.length === 0) && (
          <p className="text-slate-500 text-sm">No documents uploaded yet.</p>
        )}
        <div className="space-y-3">
          {documents?.map((doc: any) => (
            <div key={doc.id} className="border border-slate-200 rounded-xl p-4 bg-white/50">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-slate-800 text-sm">{doc.name}</p>
                  <p className="text-xs text-slate-500">{doc.type} · {new Date(doc.createdAt).toLocaleDateString('en-IN')}</p>
                </div>
                <div className="flex items-center gap-2">
                  {doc.verificationStatus && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      doc.verificationStatus === 'VERIFIED' ? 'bg-green-100 text-green-700' :
                      doc.verificationStatus === 'SUSPICIOUS' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{doc.verificationStatus}</span>
                  )}
                  {doc.fileUrl && (
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      title="View document"
                    >
                      <Eye className="w-4 h-4 text-slate-500" />
                    </a>
                  )}
                </div>
              </div>

              {/* OCR Extracted Fields */}
              {doc.ocrData?.extractedFields && Object.keys(doc.ocrData.extractedFields).length > 0 && (
                <div className="mt-2 p-2 bg-slate-50 rounded-lg">
                  <p className="text-xs font-semibold text-slate-600 mb-1.5">OCR Extracted Fields:</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(doc.ocrData.extractedFields as Record<string, string | number | boolean | null>).map(([k, v]) => v != null && (
                      <div key={k} className="flex gap-1">
                        <span className="text-xs text-slate-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}:</span>
                        <span className="text-xs font-medium text-slate-700 font-mono">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suspicion flags */}
              {doc.ocrData?.suspicionFlags?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {doc.ocrData.suspicionFlags.map((f: string, i: number) => (
                    <span key={i} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{f}</span>
                  ))}
                </div>
              )}

              {/* Per-doc reject reason */}
              {docRejectReasons[doc.type] && (
                <div className="mt-2 p-2 bg-orange-50 rounded-lg text-xs text-orange-700">
                  <span className="font-semibold">Re-upload reason: </span>{docRejectReasons[doc.type]}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* HR Notes */}
      <Section title="Internal HR Notes" defaultOpen={false}>
        <textarea
          rows={4}
          value={hrNotes || gate?.hrReviewNotes || ''}
          onChange={e => setHrNotes(e.target.value)}
          placeholder="Internal notes (not visible to employee)…"
          className="input-glass w-full text-sm resize-none"
        />
        <div className="flex justify-end mt-2">
          <button onClick={handleSaveNotes} className="btn-secondary text-sm flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            {notesSaved ? 'Saved!' : 'Save Notes'}
          </button>
        </div>
      </Section>

      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md"
            >
              <h2 className="text-lg font-bold text-slate-900 mb-1">Reject KYC</h2>
              <p className="text-sm text-slate-500 mb-4">This will notify the employee and block dashboard access.</p>
              <textarea
                rows={4}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (shown to employee)…"
                className="input-glass w-full text-sm resize-none mb-4"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowRejectModal(false)} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || rejecting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {rejecting && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Confirm Rejection
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Re-upload Modal */}
      <AnimatePresence>
        {showReuploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
            >
              <h2 className="text-lg font-bold text-slate-900 mb-1">Request Re-upload</h2>
              <p className="text-sm text-slate-500 mb-4">Select which documents need to be re-uploaded and provide a reason for each.</p>

              <div className="space-y-3 mb-4">
                {docTypes?.map((type: string) => (
                  <div key={type} className="border border-slate-200 rounded-lg p-3">
                    <label className="flex items-center gap-3 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={reuploadDocTypes.includes(type)}
                        onChange={e => {
                          if (e.target.checked) setReuploadDocTypes(p => [...p, type]);
                          else setReuploadDocTypes(p => p.filter(t => t !== type));
                        }}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      <span className="text-sm font-medium text-slate-700">{type.replace(/_/g, ' ')}</span>
                    </label>
                    {reuploadDocTypes.includes(type) && (
                      <input
                        type="text"
                        value={reuploadReasons[type] || ''}
                        onChange={e => setReuploadReasons(p => ({ ...p, [type]: e.target.value }))}
                        placeholder="Reason (shown to employee)…"
                        className="input-glass w-full text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowReuploadModal(false)} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleReupload}
                  disabled={reuploadDocTypes.length === 0 || reuploading}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  {reuploading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Send Request
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main HR KYC Review Page ──────────────────────────────────────────────────
export default function KycHrReviewPage() {
  const [page, setPage] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const { data, isLoading, isFetching } = useGetPendingKycQuery({ page });

  const employees: PendingEmployee[] = data?.data || [];
  const meta = data?.meta;

  if (selectedEmployeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4 md:p-6">
        <HrReviewDetail
          employeeId={selectedEmployeeId}
          onBack={() => setSelectedEmployeeId(null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 font-sora">KYC Review Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Review and approve employee KYC submissions. Approved submissions unlock dashboard access and auto-fill profile fields.
          </p>
        </div>

        {/* Table */}
        <div className="layer-card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <CheckCircle className="w-12 h-12 text-green-400 mb-3" />
              <p className="text-slate-700 font-medium">All caught up!</p>
              <p className="text-slate-400 text-sm mt-1">No pending KYC submissions.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Employee</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Dept.</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Mode</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Submitted</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp: PendingEmployee) => (
                  <tr
                    key={emp.id}
                    className="border-b border-slate-100 hover:bg-indigo-50/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedEmployeeId(emp.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{emp.name}</p>
                          <p className="text-xs text-slate-500">{emp.employeeCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-slate-600">{emp.department || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {emp.uploadMode ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          emp.uploadMode === 'COMBINED' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {emp.uploadMode === 'COMBINED' ? 'Combined PDF' : 'Separate'}
                        </span>
                      ) : <span className="text-slate-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={emp.kycStatus} /></td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-slate-500">
                        {emp.submittedAt ? new Date(emp.submittedAt).toLocaleDateString('en-IN') : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 text-xs font-medium transition-colors">
                        <Eye className="w-3.5 h-3.5" />
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-slate-500">
              Page {meta.page} of {meta.totalPages} · {meta.total} total submissions
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => p - 1)}
                disabled={!meta.hasPrev || isFetching}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!meta.hasNext || isFetching}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
