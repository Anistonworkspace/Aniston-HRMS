import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, User, CheckCircle, XCircle, AlertTriangle, Clock,
  Eye, RefreshCw, ArrowLeft, ChevronDown, ChevronUp, MessageSquare,
  Shield, Download, Cpu, Server, ClipboardList, Award, Briefcase,
  GraduationCap, Flag, Info,
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

// ─── Document Score Badge (confidence-based flag) ─────────────────────────────
function DocumentScoreBadge({ confidence }: { confidence?: number | null }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);

  if (pct >= 99) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle className="w-3 h-3" />
        {pct}% — All fields correct
      </span>
    );
  }
  if (pct >= 80) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
        <CheckCircle className="w-3 h-3" />
        {pct}% — High confidence
      </span>
    );
  }
  if (pct >= 50) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
        <AlertTriangle className="w-3 h-3" />
        {pct}% — Verify key fields
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
      <XCircle className="w-3 h-3" />
      {pct}% — Manual review required
    </span>
  );
}

// ─── Validation Reasons List (AI pointers for HR) ─────────────────────────────
function ValidationReasonsList({ reasons, title }: { reasons: string[]; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!reasons || reasons.length === 0) return null;

  // Show first 4 items collapsed, all when expanded
  const PREVIEW = 4;
  const visible = expanded ? reasons : reasons.slice(0, PREVIEW);

  return (
    <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
      {title && <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1"><Info className="w-3 h-3" />{title}</p>}
      <ul className="space-y-1">
        {visible.map((r, i) => {
          const isSep = r.startsWith('──');
          const isPass = !isSep && (r.startsWith('✓'));
          const isWarn = !isSep && (r.startsWith('⚠'));
          const isFail = !isSep && (r.startsWith('✗') || r.startsWith('🚩'));
          return (
            <li
              key={i}
              className={`text-xs flex items-start gap-1.5 leading-relaxed ${
                isSep ? 'text-slate-400 font-mono pt-1 border-t border-slate-200 mt-1' :
                isPass ? 'text-green-700' :
                isWarn ? 'text-amber-700' :
                isFail ? 'text-red-700' :
                'text-slate-600'
              }`}
            >
              {!isSep && (
                <span className="shrink-0 mt-px">
                  {isPass ? '✓' : isWarn ? '⚠' : isFail ? '✗' : '·'}
                </span>
              )}
              <span>{isSep ? r : r.replace(/^[✓⚠✗🚩·]\s*/, '')}</span>
            </li>
          );
        })}
      </ul>
      {reasons.length > PREVIEW && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          {expanded ? 'Show less' : `+${reasons.length - PREVIEW} more pointers`}
        </button>
      )}
    </div>
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

  const { gate, documents, crossValidation, analysis: docAnalysis } = review;
  const employee = gate?.employee;
  const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || employee?.name || 'Unknown';
  const combinedAnalysis = gate?.combinedPdfAnalysis;
  const docRejectReasons = gate?.documentRejectReasons || {};

  const handleApprove = async () => {
    if (!confirm(`Approve KYC for ${employeeName}? This will unlock their dashboard and auto-fill verified profile fields.`)) return;
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
            KYC Review — {employeeName}
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

      {/* Cross-Validation Matrix — reads actual service shape: { status, details[] } */}
      {crossValidation && crossValidation.status !== 'PENDING' && (
        <Section title="Cross-Document Validation">
          {/* Overall verdict */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${
              crossValidation.status === 'PASS'    ? 'bg-green-100 text-green-800' :
              crossValidation.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-800' :
                                                     'bg-red-100 text-red-800'
            }`}>
              {crossValidation.status === 'PASS'
                ? <CheckCircle className="w-4 h-4" />
                : crossValidation.status === 'PARTIAL'
                  ? <AlertTriangle className="w-4 h-4" />
                  : <XCircle className="w-4 h-4" />}
              Cross-validation: {crossValidation.status}
            </span>
            <RiskBadge level={
              crossValidation.status === 'PASS' ? 'LOW' :
              crossValidation.status === 'PARTIAL' ? 'MEDIUM' : 'HIGH'
            } />
          </div>

          {/* Per-field breakdown */}
          <div className="space-y-3">
            {(crossValidation.details || []).map((detail: any, i: number) => {
              const isPass = detail.match;
              return (
                <div key={i} className={`p-3 rounded-xl border ${
                  isPass ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-700">{detail.field}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isPass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {isPass ? '✓ MATCH' : '✗ MISMATCH'}
                      {detail.similarity != null && ` · ${Math.round(detail.similarity * 100)}% similarity`}
                    </span>
                  </div>
                  {/* What each document said */}
                  <div className="space-y-1 mb-2">
                    {(detail.values || []).map((v: any, j: number) => (
                      <div key={j} className="flex items-center gap-2">
                        <span className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-mono shrink-0">
                          {String(v.docType).replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-slate-700 font-medium">{v.value || '—'}</span>
                      </div>
                    ))}
                  </div>
                  {detail.matchDetail && (
                    <p className={`text-xs ${isPass ? 'text-green-700' : 'text-red-700'}`}>
                      {detail.matchDetail}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action flags — only for failed fields */}
          {(crossValidation.details || []).some((d: any) => !d.match) && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-xs font-semibold text-red-700 mb-1.5">Action Required — Mismatches Detected:</p>
              <ul className="space-y-1">
                {(crossValidation.details || [])
                  .filter((d: any) => !d.match)
                  .map((d: any, i: number) => (
                    <li key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                      <span className="shrink-0">•</span>
                      <span>
                        <strong>{d.field}</strong>: {d.matchDetail || 'Values do not match across documents. Verify the document is genuine.'}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Combined PDF Analysis */}
      {combinedAnalysis && (
        <Section title="Combined PDF Analysis">
          {(() => {
            // Support both Python (snake_case) and Node.js fallback (camelCase) field names
            const totalPages = combinedAnalysis.total_pages ?? combinedAnalysis.totalPages;
            const detectedDocs: string[] = combinedAnalysis.detected_docs ?? combinedAnalysis.detectedDocs ?? [];
            const suspicionScore = combinedAnalysis.suspicion_score ?? combinedAnalysis.suspicionScore ?? 0;
            const riskLevel = combinedAnalysis.risk_level ?? combinedAnalysis.riskLevel;
            const suspicionFlags: string[] = combinedAnalysis.suspicion_flags ?? combinedAnalysis.suspicionFlags ?? [];
            const missingDocs: string[] = combinedAnalysis.missing_from_required ?? combinedAnalysis.missing_docs ?? combinedAnalysis.missingFromRequired ?? [];
            // Per-page validation summary from Python AI (stored in first doc's ocrVerification.llmExtractedData)
            const pageValidations: any[] = combinedAnalysis.page_validations ?? combinedAnalysis.pageValidations ?? [];
            return (
              <>
                <div className="flex flex-wrap gap-3 mb-4">
                  <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-2xl font-bold font-mono text-slate-800">{totalPages ?? '—'}</p>
                    <p className="text-xs text-slate-500">Total Pages</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-2xl font-bold font-mono text-slate-800">{detectedDocs.length}</p>
                    <p className="text-xs text-slate-500">Doc Types Found</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-2xl font-bold font-mono text-slate-800">{suspicionScore}</p>
                    <p className="text-xs text-slate-500">Suspicion Score</p>
                  </div>
                  {riskLevel && <RiskBadge level={riskLevel} />}
                </div>

                {detectedDocs.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Detected Documents</p>
                    <div className="flex flex-wrap gap-2">
                      {detectedDocs.map((d: string) => (
                        <span key={d} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{d}</span>
                      ))}
                    </div>
                  </div>
                )}

                {suspicionFlags.length > 0 && (
                  <div className="p-3 bg-red-50 rounded-lg">
                    <p className="text-xs font-semibold text-red-700 mb-1">Suspicion Flags:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {suspicionFlags.map((f: string, i: number) => (
                        <li key={i} className="text-xs text-red-600">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {missingDocs.length > 0 && (
                  <div className="p-3 bg-orange-50 rounded-lg mt-2">
                    <p className="text-xs font-semibold text-orange-700 mb-1">Missing Required Docs:</p>
                    <div className="flex flex-wrap gap-2">
                      {missingDocs.map((d: string) => (
                        <span key={d} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{d.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-page validation from Python AI */}
                {pageValidations.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Per-Page AI Validation:</p>
                    <div className="space-y-2">
                      {pageValidations.map((pv: any, i: number) => {
                        const reasons: string[] = pv.reasons || [];
                        const hasIssues = reasons.some((r: string) => r.startsWith('✗') || r.startsWith('🚩'));
                        const hasWarnings = reasons.some((r: string) => r.startsWith('⚠'));
                        const borderColor = pv.is_wrong_upload ? 'border-red-300' : hasIssues ? 'border-red-200' : hasWarnings ? 'border-yellow-200' : 'border-green-200';
                        return (
                          <div key={i} className={`p-2 rounded-lg bg-white border ${borderColor}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono font-semibold text-slate-500">Page {pv.page}</span>
                              <span className="text-xs bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                                {String(pv.detected_type).replace(/_/g, ' ')}
                              </span>
                              <span className="text-xs text-slate-400">({Math.round((pv.confidence ?? 0) * 100)}%)</span>
                              {pv.is_wrong_upload && (
                                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">
                                  ⚠ WRONG DOC: {pv.wrong_upload_category}
                                </span>
                              )}
                            </div>
                            {reasons.length > 0 && <ValidationReasonsList reasons={reasons} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </Section>
      )}

      {/* Document Requirements — computed from fresher/experienced + qualification */}
      {docAnalysis && (
        <Section title="Document Requirements">
          <div className="space-y-3">
            {/* Employee profile row */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-indigo-50 rounded-lg px-3 py-2">
                {gate?.fresherOrExperienced === 'EXPERIENCED'
                  ? <Briefcase className="w-4 h-4 text-indigo-600" />
                  : <GraduationCap className="w-4 h-4 text-indigo-600" />}
                <span className="text-sm font-semibold text-indigo-800">
                  {gate?.fresherOrExperienced === 'EXPERIENCED' ? 'Experienced' : 'Fresher'}
                </span>
              </div>
              {gate?.highestQualification && (
                <div className="flex items-center gap-2 bg-purple-50 rounded-lg px-3 py-2">
                  <Award className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-semibold text-purple-800">
                    {gate.highestQualification.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              {docAnalysis.hasPhoto && (
                <div className="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-800">Photo uploaded</span>
                </div>
              )}
            </div>

            {/* Experienced but no employment proof — prominent warning */}
            {docAnalysis.needsEmploymentProof && !docAnalysis.hasEmploymentProof && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                <Flag className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Employment proof missing</p>
                  <p className="text-xs text-red-700 mt-0.5">
                    Employee declared as EXPERIENCED but has not uploaded any employment document
                    (Experience Letter, Relieving Letter, Offer Letter, or Salary Slips).
                    HR should request re-upload before approving.
                  </p>
                </div>
              </div>
            )}

            {/* Required docs checklist */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Required Documents Checklist</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {(docAnalysis.requiredDocs || []).map((req: string) => {
                  const submitted = (gate?.submittedDocs as string[] || []).includes(req);
                  return (
                    <div
                      key={req}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
                        submitted
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-red-50 border-red-200 text-red-700'
                      }`}
                    >
                      {submitted
                        ? <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                        : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                      {req.replace(/_/g, ' ')}
                    </div>
                  );
                })}
                {/* Identity proof — at least one of */}
                <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
                  docAnalysis.hasIdentityProof
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {docAnalysis.hasIdentityProof
                    ? <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  Identity Proof (Aadhaar/PAN/Passport/DL/Voter ID)
                </div>
                {docAnalysis.needsEmploymentProof && (
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
                    docAnalysis.hasEmploymentProof
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}>
                    {docAnalysis.hasEmploymentProof
                      ? <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                    Employment Proof
                  </div>
                )}
              </div>
            </div>
          </div>
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
                  {doc.status && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      doc.status === 'VERIFIED' ? 'bg-green-100 text-green-700' :
                      doc.status === 'FLAGGED' ? 'bg-red-100 text-red-700' :
                      doc.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>{doc.status}</span>
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

              {/* Confidence score badge — color-coded flag system */}
              {doc.ocrVerification?.confidence != null && (
                <div className="mt-2">
                  <DocumentScoreBadge confidence={doc.ocrVerification.confidence} />
                </div>
              )}

              {/* OCR Extracted Fields — read from ocrVerification (Prisma relation with flat fields) */}
              {doc.ocrVerification && (() => {
                const ocr = doc.ocrVerification;
                const fields: Record<string, string | null> = {
                  Name: ocr.extractedName,
                  'Date of Birth': ocr.extractedDob,
                  'Doc Number': ocr.extractedDocNumber,
                  'Father Name': ocr.extractedFatherName,
                  'Mother Name': ocr.extractedMotherName,
                  Gender: ocr.extractedGender,
                  Address: ocr.extractedAddress,
                };
                const nonEmpty = Object.entries(fields).filter(([, v]) => v != null && v !== '');
                if (nonEmpty.length === 0) return null;
                return (
                  <div className="mt-2 p-2 bg-slate-50 rounded-lg">
                    <p className="text-xs font-semibold text-slate-600 mb-1.5">OCR Extracted Fields:</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {nonEmpty.map(([k, v]) => (
                        <div key={k} className="flex gap-1">
                          <span className="text-xs text-slate-500">{k}:</span>
                          <span className="text-xs font-medium text-slate-700 font-mono">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* AI Validation Reasons — the real pointers HR uses to decide */}
              {doc.ocrVerification && (() => {
                const llm = doc.ocrVerification.llmExtractedData as any;
                // Python AI path: validation_reasons in llmExtractedData
                const reasons: string[] = llm?.validation_reasons ?? [];
                // Node.js fallback: hrNotes contains the text — parse it into lines
                const hrNoteLines: string[] = (!reasons.length && doc.ocrVerification.hrNotes)
                  ? doc.ocrVerification.hrNotes.split('\n').filter(Boolean)
                  : [];
                const allReasons = reasons.length > 0 ? reasons : hrNoteLines;
                if (allReasons.length === 0) return null;
                return (
                  <ValidationReasonsList
                    reasons={allReasons}
                    title="AI Verification Pointers"
                  />
                );
              })()}

              {/* Suspicion flags — from ocrVerification or ocrData (combined PDF stores in ocrData.suspicionFlags) */}
              {((doc.ocrVerification?.suspicionFlags ?? doc.ocrData?.suspicionFlags) as string[] | undefined)?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(doc.ocrVerification?.suspicionFlags ?? doc.ocrData?.suspicionFlags as string[]).map((f: string, i: number) => (
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

  // Backend returns OnboardingDocumentGate records with nested employee relation
  const gates: any[] = data?.data || [];
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
          ) : gates.length === 0 ? (
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
                {gates.map((gate: any) => {
                  const emp = gate.employee;
                  const empName = [emp?.firstName, emp?.lastName].filter(Boolean).join(' ') || '—';
                  return (
                  <tr
                    key={gate.id}
                    className="border-b border-slate-100 hover:bg-indigo-50/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedEmployeeId(gate.employeeId)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{empName}</p>
                          <p className="text-xs text-slate-500">{emp?.employeeCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-slate-600">{emp?.department?.name || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {gate.uploadMode ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          gate.uploadMode === 'COMBINED' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {gate.uploadMode === 'COMBINED' ? 'Combined PDF' : 'Separate'}
                        </span>
                      ) : <span className="text-slate-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={gate.kycStatus} /></td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-slate-500">
                        {gate.updatedAt ? new Date(gate.updatedAt).toLocaleDateString('en-IN') : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 text-xs font-medium transition-colors">
                        <Eye className="w-3.5 h-3.5" />
                        Review
                      </button>
                    </td>
                  </tr>
                  );
                })}
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
