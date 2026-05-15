import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../app/store';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  FileText, User, CheckCircle, XCircle, AlertTriangle, Clock,
  Eye, RefreshCw, ArrowLeft, ChevronDown, ChevronUp, MessageSquare,
  Shield, Download, Cpu, Server, ClipboardList, Award, Briefcase,
  GraduationCap, Flag, Info, Scan, Loader2, Calendar, Copy,
  Users, History, ExternalLink, Search,
} from 'lucide-react';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import {
  useGetKycStatsQuery,
  useGetPendingKycQuery,
  useGetKycHrReviewQuery,
  useVerifyKycMutation,
  useRejectKycMutation,
  useRequestReuploadMutation,
  useUpdateHrNotesMutation,
  useRetriggerOcrMutation,
  useReclassifyCombinedPdfMutation,
  useRevokeKycAccessMutation,
  useGetKycAuditLogQuery,
  useCheckDuplicateDocumentMutation,
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
  PENDING_HR_REVIEW: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Pending HR Review' },
  REUPLOAD_REQUIRED: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Re-upload Required' },
  VERIFIED:          { bg: 'bg-green-100', text: 'text-green-700', label: 'Verified' },
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

// ─── DOB Cross-Verification Panel (Category 4 item 16) ───────────────────────
function DobCrossVerification({ data }: { data: any }) {
  if (!data || data.status === 'INSUFFICIENT_DATA') return null;
  const isPass = data.status === 'MATCH';
  const isMismatch = data.status === 'MISMATCH' || data.status === 'PARTIAL';
  return (
    <div className={`p-4 rounded-xl border mb-3 ${isPass ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Calendar className={`w-4 h-4 ${isPass ? 'text-green-600' : 'text-red-600'}`} />
        <span className={`text-sm font-semibold ${isPass ? 'text-green-800' : 'text-red-800'}`}>
          Date of Birth Cross-Verification: {data.status}
        </span>
        {isPass ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
      </div>
      <p className={`text-xs mb-2 ${isPass ? 'text-green-700' : 'text-red-700'}`}>{data.message}</p>
      {data.dobs_found && Object.entries(data.dobs_found).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.dobs_found).map(([docType, dob]: [string, any]) => (
            <span key={docType} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5">
              <span className="font-mono text-indigo-700">{docType.replace(/_/g, ' ')}</span>
              <span className="text-slate-500 mx-1">→</span>
              <span className="font-semibold text-slate-800">{dob}</span>
            </span>
          ))}
        </div>
      )}
      {isMismatch && (data.mismatches || []).length > 0 && (
        <div className="mt-2 space-y-1">
          {data.mismatches.map((m: any, i: number) => (
            <p key={i} className="text-xs text-red-700 flex items-start gap-1">
              <span className="shrink-0">•</span>
              <span><strong>{m.doc_type?.replace(/_/g, ' ')}</strong>: {m.message}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Document Expiry Warning (Category 4 item 17) ─────────────────────────────
function ExpiryWarnings({ documents }: { documents: any[] }) {
  const expiredDocs = (documents || []).filter((doc: any) => {
    const extraFields = doc.ocrVerification?.llmExtractedData?.extra_fields || {};
    return extraFields.is_expired === true;
  });
  const expiringDocs = (documents || []).filter((doc: any) => {
    const extraFields = doc.ocrVerification?.llmExtractedData?.extra_fields || {};
    const days = extraFields.days_to_expiry;
    return !extraFields.is_expired && typeof days === 'number' && days <= 90 && days >= 0;
  });

  if (expiredDocs.length === 0 && expiringDocs.length === 0) return null;

  return (
    <div className="layer-card p-4 mb-4">
      <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-orange-500" />
        Document Expiry Alerts
      </p>
      {expiredDocs.map((doc: any) => {
        const expiryDate = doc.ocrVerification?.llmExtractedData?.extra_fields?.expiry_date;
        return (
          <div key={doc.id} className="p-3 bg-red-50 border border-red-200 rounded-lg mb-2 flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">EXPIRED: {doc.type?.replace(/_/g, ' ')}</p>
              {expiryDate && <p className="text-xs text-red-700">Expired on {expiryDate} — cannot be accepted for KYC</p>}
            </div>
          </div>
        );
      })}
      {expiringDocs.map((doc: any) => {
        const extra = doc.ocrVerification?.llmExtractedData?.extra_fields || {};
        return (
          <div key={doc.id} className="p-3 bg-orange-50 border border-orange-200 rounded-lg mb-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Expiring Soon: {doc.type?.replace(/_/g, ' ')}</p>
              <p className="text-xs text-orange-700">Expires {extra.expiry_date} ({extra.days_to_expiry} days remaining)</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Inline Document Viewer — secure, no-download (user request) ─────────────
function InlineDocViewer({
  employeeId,
  docId,
  name,
  onClose,
}: {
  employeeId: string;
  docId: string;
  name: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobMime, setBlobMime] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const accessToken = useSelector((s: RootState) => s.auth.accessToken);
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

  useEffect(() => {
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);

    const fetchDoc = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/onboarding/kyc/${employeeId}/document/${docId}/view`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const blob = await res.blob();
        setBlobMime(blob.type);
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err: any) {
        setError(err.message || 'Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchDoc();

    // Revoke blob URL on unmount to free memory
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [employeeId, docId, accessToken, API_BASE]);

  const nameLower = name.toLowerCase();
  const isPdf = blobMime.includes('pdf') || nameLower.endsWith('.pdf');
  // HEIC stream endpoint converts to JPEG server-side, so blobMime will be image/jpeg for new requests.
  // Keep detection for edge cases where conversion failed (e.g., no libvips HEIC support).
  const isHeic = (blobMime.includes('heic') || blobMime.includes('heif') || nameLower.match(/\.(heic|heif)$/) !== null) && !blobMime.includes('jpeg');
  const isOffice = blobMime.includes('word') || blobMime.includes('spreadsheet') || blobMime.includes('presentation') ||
    blobMime.includes('excel') || blobMime.includes('powerpoint') || blobMime.includes('msword') ||
    nameLower.match(/\.(doc|docx|xls|xlsx|ppt|pptx)$/) !== null;
  const isText = blobMime.startsWith('text/') || nameLower.match(/\.(txt|csv|rtf)$/) !== null;
  const isImage = !isPdf && !isHeic && !isOffice && (blobMime.startsWith('image/') || nameLower.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/) !== null);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden"
        style={{ height: 'min(90vh, 900px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — no "Open in new tab" link */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            <span className="font-semibold text-slate-800 text-sm truncate max-w-xs">{name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Shield className="w-3 h-3" /> View only
            </span>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 ml-2">
              <XCircle className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative bg-slate-100">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-sm text-slate-500">Loading document securely…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8">
              <XCircle className="w-10 h-10 text-red-400" />
              <p className="text-sm text-red-600 text-center">{error}</p>
              <p className="text-xs text-slate-400">Try closing and reopening, or ask IT if the issue persists.</p>
            </div>
          )}
          {blobUrl && !loading && !error && (
            isPdf ? (
              <iframe
                src={`${blobUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                className="w-full h-full"
                title={name}
                sandbox="allow-scripts allow-same-origin"
                tabIndex={-1}
              />
            ) : isImage ? (
              // Standard image formats — disable right-click and drag
              <div
                className="flex items-center justify-center h-full p-6 select-none"
                onContextMenu={e => e.preventDefault()}
                onDragStart={e => e.preventDefault()}
              >
                <img
                  src={blobUrl}
                  alt={name}
                  className="max-w-full max-h-full object-contain rounded-lg shadow pointer-events-none"
                  draggable={false}
                />
              </div>
            ) : isOffice || isText ? (
              // Office/text — served as blob so Google Viewer can't access it; offer download
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8 select-none">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <FileText className="w-7 h-7 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700 mb-1">
                    {isText ? 'Text / CSV File' : 'Office Document'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs">
                    {isText ? 'Text and CSV files cannot be previewed here.' : 'Word, Excel, and PowerPoint files cannot be previewed in this secure viewer.'}
                    {' '}Download to open in the appropriate application.
                  </p>
                </div>
                <a href={blobUrl} download={name} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                  <Download className="w-4 h-4" /> Download to View
                </a>
              </div>
            ) : isHeic ? (
              // HEIC/HEIF — fallback if server-side conversion was unavailable
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8 select-none">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <FileText className="w-7 h-7 text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700 mb-1">iPhone HEIC Format</p>
                  <p className="text-xs text-slate-500 max-w-xs">This file is in HEIC format from an iPhone. Download to view on your device.</p>
                </div>
                <a href={blobUrl} download={name} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                  <Download className="w-4 h-4" /> Download to View
                </a>
              </div>
            ) : (
              // Unknown format — generic download
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                <FileText className="w-12 h-12 text-slate-300" />
                <p className="text-sm font-medium text-slate-600">{name}</p>
                <p className="text-xs text-slate-500">This file format cannot be previewed in the browser.</p>
                <a href={blobUrl} download={name} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                  <Download className="w-4 h-4" /> Download File
                </a>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── KYC Audit Log Panel (Category 4 item 15) ────────────────────────────────
function KycAuditLog({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useGetKycAuditLogQuery(employeeId);
  const logs: any[] = data?.data || [];

  const ACTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    KYC_VERIFIED:      { bg: 'bg-green-100', text: 'text-green-700', label: 'Approved' },
    KYC_REJECTED:      { bg: 'bg-red-100', text: 'text-red-700', label: 'Rejected' },
    KYC_REVOKED:       { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Revoked' },
    KYC_REUPLOAD:      { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Re-upload Requested' },
    KYC_SUBMITTED:     { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Submitted by Employee' },
    DOCUMENT_DELETED:  { bg: 'bg-red-100', text: 'text-red-700', label: 'Document Deleted' },
    DOCUMENT_UPLOADED: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Document Uploaded' },
  };

  if (isLoading) return <div className="text-xs text-slate-400 py-4 text-center">Loading audit log…</div>;
  if (logs.length === 0) return <p className="text-xs text-slate-400 py-4 text-center">No actions recorded yet.</p>;

  return (
    <div className="space-y-2">
      {logs.map((log: any) => {
        const s = ACTION_STYLES[log.action] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: log.action };
        return (
          <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-white/50">
            <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${s.bg.replace('bg-', 'bg-').replace('100', '400')}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
                {log.user && (
                  <span className="text-xs text-slate-500">by {log.user.name || log.user.email}</span>
                )}
              </div>
              {log.details?.reason && (
                <p className="text-xs text-slate-600 mt-1">Reason: {log.details.reason}</p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
                {new Date(log.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Duplicate Document Alert (Category 2 item 8) ────────────────────────────
function DuplicateDocAlert({ duplicateData }: { duplicateData: any }) {
  if (!duplicateData?.hasDuplicates) return null;
  return (
    <div className="layer-card p-4 mb-4 border border-red-300 bg-red-50">
      <div className="flex items-center gap-2 mb-2">
        <Copy className="w-4 h-4 text-red-600" />
        <span className="text-sm font-bold text-red-800">Duplicate Document Numbers Detected</span>
      </div>
      <div className="space-y-2">
        {(duplicateData.duplicates || []).map((dup: any, i: number) => (
          <div key={i} className="p-2.5 bg-white border border-red-200 rounded-lg">
            <p className="text-xs text-red-700">
              <strong>{dup.field}</strong> number <span className="font-mono">{dup.value}</span> is already registered to{' '}
              <strong>{dup.conflictEmployeeName}</strong> ({dup.conflictCode}).
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              This may indicate document sharing or fraud. Verify that documents belong to this employee only.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SlaBadge — shows how long a submission has been waiting ─────────────────
function SlaBadge({ submittedAt }: { submittedAt?: string }) {
  if (!submittedAt) return null;
  const hours = Math.round((Date.now() - new Date(submittedAt).getTime()) / 36e5);
  if (hours < 24) return <span className="text-[10px] text-emerald-600">⏱ {hours}h</span>;
  if (hours < 48) return <span className="text-[10px] text-amber-600 font-medium">⚠ {hours}h waiting</span>;
  return <span className="text-[10px] text-red-600 font-medium animate-pulse">🔴 {hours}h — SLA breach</span>;
}

// ─── KYC Scorecard — consolidated metrics for an employee's KYC submission ────
function KycScorecard({ reviewData }: { reviewData: any }) {
  const docs: any[] = reviewData?.documents || [];
  const gate = reviewData?.gate;
  const crossVal = reviewData?.crossValidation;

  const avgScore = docs.length > 0
    ? Math.round(docs.reduce((s: number, d: any) => s + (d.ocrVerification?.kycScore || 0), 0) / docs.length)
    : 0;

  const faceMatch = gate?.faceMatchScore;
  const suspicionFlags = docs.flatMap((d: any) => d.ocrVerification?.suspicionFlags || []);
  const expiredCount = docs.filter((d: any) => d.ocrVerification?.llmExtractedData?.extra_fields?.is_expired).length;
  const nameStatus = crossVal?.details?.find((d: any) => d.field?.toLowerCase().includes('name'))?.match ? 'PASS' : crossVal?.status === 'PASS' ? 'PASS' : crossVal?.status === 'FAIL' ? 'FAIL' : 'PARTIAL';
  const dobStatus = crossVal?.details?.find((d: any) => d.field?.toLowerCase().includes('dob') || d.field?.toLowerCase().includes('birth'))?.match ? 'MATCH' : crossVal?.status === 'PASS' ? 'MATCH' : 'MISMATCH';

  const grade = avgScore >= 90 ? 'A' : avgScore >= 75 ? 'B' : avgScore >= 60 ? 'C' : 'D';
  const gradeColor = grade === 'A' ? 'text-emerald-600' : grade === 'B' ? 'text-green-600' : grade === 'C' ? 'text-amber-600' : 'text-red-600';

  // Only show scorecard when there's meaningful data
  if (avgScore === 0 && suspicionFlags.length === 0 && faceMatch == null) return null;

  return (
    <div className="layer-card p-4 mb-4 border border-slate-200">
      <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide">KYC Summary</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {/* Overall Grade */}
        <div className="col-span-1 text-center">
          <div className={`text-3xl font-display font-black ${gradeColor}`}>{grade}</div>
          <div className="text-[10px] text-slate-500">{avgScore}/100</div>
          <div className="text-[10px] text-slate-400">Overall</div>
        </div>
        {/* Name Match */}
        <div className="text-center">
          <div className={`text-sm font-bold ${nameStatus === 'PASS' ? 'text-emerald-600' : nameStatus === 'FAIL' ? 'text-red-600' : 'text-amber-600'}`}>
            {nameStatus === 'PASS' ? '✓ Match' : nameStatus === 'FAIL' ? '✗ Mismatch' : '~ Partial'}
          </div>
          <div className="text-[10px] text-slate-400">Name Match</div>
        </div>
        {/* DOB Match */}
        <div className="text-center">
          <div className={`text-sm font-bold ${dobStatus === 'MATCH' ? 'text-emerald-600' : 'text-red-600'}`}>
            {dobStatus === 'MATCH' ? '✓ Match' : dobStatus === 'MISMATCH' ? '✗ Mismatch' : '—'}
          </div>
          <div className="text-[10px] text-slate-400">DOB Match</div>
        </div>
        {/* Face Match */}
        <div className="text-center">
          <div className={`text-sm font-bold ${faceMatch != null && faceMatch >= 0.8 ? 'text-emerald-600' : faceMatch != null ? 'text-red-600' : 'text-slate-400'}`}>
            {faceMatch != null ? `${Math.round(faceMatch * 100)}%` : '—'}
          </div>
          <div className="text-[10px] text-slate-400">Face Match</div>
        </div>
        {/* Suspicious Flags */}
        <div className="text-center">
          <div className={`text-sm font-bold ${suspicionFlags.length === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {suspicionFlags.length === 0 ? 'None' : `${suspicionFlags.length} found`}
          </div>
          <div className="text-[10px] text-slate-400">Flags</div>
        </div>
        {/* Expired Docs */}
        <div className="text-center">
          <div className={`text-sm font-bold ${expiredCount === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {expiredCount === 0 ? 'None' : `${expiredCount} doc${expiredCount > 1 ? 's' : ''}`}
          </div>
          <div className="text-[10px] text-slate-400">Expired</div>
        </div>
      </div>
    </div>
  );
}

// ─── Real-time OCR Progress Bar (Category 5 item 20) ─────────────────────────
function OcrLiveProgress({ employeeId }: { employeeId: string }) {
  const [progress, setProgress] = useState<{ page: number; total: number; pct: number; docType: string } | null>(null);

  const handleProgress = useCallback((data: any) => {
    if (data.employeeId !== employeeId) return;
    setProgress({ page: data.page, total: data.total, pct: data.pct, docType: data.docType });
  }, [employeeId]);

  useEffect(() => {
    onSocketEvent('ocr:page-processed', handleProgress);
    return () => offSocketEvent('ocr:page-processed', handleProgress);
  }, [handleProgress]);

  if (!progress) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-3 p-3 bg-indigo-50 border border-indigo-200 rounded-xl"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-indigo-800 flex items-center gap-1.5">
          <Scan className="w-3.5 h-3.5" />
          OCR Processing — Page {progress.page} of {progress.total}
        </span>
        <span className="text-xs font-mono text-indigo-600">{progress.pct}%</span>
      </div>
      <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-indigo-500 rounded-full"
          animate={{ width: `${progress.pct}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      {progress.docType && (
        <p className="text-xs text-indigo-600 mt-1">
          Detected: <span className="font-medium">{progress.docType.replace(/_/g, ' ')}</span>
        </p>
      )}
    </motion.div>
  );
}

// ─── HR Review Detail Panel ───────────────────────────────────────────────────
function HrReviewDetail({ employeeId, onBack }: { employeeId: string; onBack: () => void }) {
  const { data, isLoading, refetch } = useGetKycHrReviewQuery(employeeId);
  const [verifyKyc, { isLoading: verifying }] = useVerifyKycMutation();

  // Auto-poll while PROCESSING so HR sees the result appear without refreshing
  const kycStatusForPolling = data?.data?.gate?.kycStatus;
  useEffect(() => {
    if (kycStatusForPolling !== 'PROCESSING') return;
    const timer = setInterval(() => refetch(), 5000);
    return () => clearInterval(timer);
  }, [kycStatusForPolling, refetch]);
  const [rejectKyc, { isLoading: rejecting }] = useRejectKycMutation();
  const [requestReupload, { isLoading: reuploading }] = useRequestReuploadMutation();
  const [updateHrNotes] = useUpdateHrNotesMutation();
  const [retriggerOcr, { isLoading: retriggering }] = useRetriggerOcrMutation();
  const [reclassifyCombinedPdf, { isLoading: reclassifying }] = useReclassifyCombinedPdfMutation();
  const [revokeKyc, { isLoading: revoking }] = useRevokeKycAccessMutation();
  const [checkDuplicate] = useCheckDuplicateDocumentMutation();

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showReuploadModal, setShowReuploadModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reuploadDocTypes, setReuploadDocTypes] = useState<string[]>([]);
  const [reuploadReasons, setReuploadReasons] = useState<Record<string, string>>({});
  const [hrNotes, setHrNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<{ docId: string; name: string } | null>(null);
  const [processingElapsed, setProcessingElapsed] = useState(0);

  // Elapsed-time ticker while OCR is PROCESSING
  const kycStatus = data?.data?.gate?.kycStatus;
  useEffect(() => {
    if (kycStatus !== 'PROCESSING') { setProcessingElapsed(0); return; }
    const t = setInterval(() => setProcessingElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [kycStatus]);

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

  const { gate, documents, crossValidation, analysis: docAnalysis, separateModeDobCrossVerification } = review;
  const employee = gate?.employee;
  const employeeName = [employee?.firstName, employee?.lastName].filter(Boolean).join(' ') || employee?.name || 'Unknown';
  const combinedAnalysis = gate?.combinedPdfAnalysis;
  const docRejectReasons = gate?.documentRejectReasons || {};

  const handleApprove = async () => {
    // Block HIGH risk (>=50) — require explicit override confirmation
    const suspicionScore = combinedAnalysis?.suspicion_score ?? combinedAnalysis?.suspicionScore ?? 0;
    if (suspicionScore >= 50) {
      if (!confirm(
        `⛔ HIGH FRAUD RISK — Score ${suspicionScore}/100\n\n` +
        `The AI classifier flagged this submission with a high fraud risk score.\n` +
        `Common causes: screenshot of document, duplicate pages, wrong document type, expiry date.\n\n` +
        `Approving a high-risk submission may violate compliance policy.\n\n` +
        `Type OK only if you have physically verified the original documents.`
      )) return;
    }

    // Auto-run duplicate check before approving — warn HR if duplicates found
    try {
      const ocrDocs = documents?.filter((d: any) => d.ocrVerification?.extractedDocNumber);
      const aadhaarDoc = ocrDocs?.find((d: any) => d.type === 'AADHAAR');
      const panDoc = ocrDocs?.find((d: any) => d.type === 'PAN');
      const passportDoc = ocrDocs?.find((d: any) => d.type === 'PASSPORT');
      if (aadhaarDoc || panDoc || passportDoc) {
        const dupResult = await checkDuplicate({
          employeeId,
          ...(aadhaarDoc ? { aadhaarNumber: aadhaarDoc.ocrVerification.extractedDocNumber } : {}),
          ...(panDoc ? { panNumber: panDoc.ocrVerification.extractedDocNumber } : {}),
          ...(passportDoc ? { passportNumber: passportDoc.ocrVerification.extractedDocNumber } : {}),
        }).unwrap();
        const duplicates = dupResult?.data?.duplicates ?? [];
        if (duplicates.length > 0) {
          const dupNames = duplicates.map((d: any) => `${d.employeeName} (${d.docType})`).join(', ');
          if (!confirm(`⚠️ Duplicate document detected!\n\nThe same document number is already registered for:\n${dupNames}\n\nDo you still want to approve KYC for ${employeeName}?`)) return;
        }
      }
    } catch { /* duplicate check failure is non-blocking — proceed with approval */ }

    if (!confirm(`Approve KYC for ${employeeName}? This will:\n• Unlock their dashboard immediately\n• Auto-fill profile fields from OCR data\n• Send a congratulations email to the employee`)) return;
    try {
      await verifyKyc(employeeId).unwrap();
      toast.success(`KYC approved for ${employeeName} — profile fields auto-filled from OCR data. Congratulations email sent.`, { duration: 5000 });
      onBack();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Approval failed — please try again');
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectKyc({ employeeId, reason: rejectReason }).unwrap();
      toast.success('KYC rejected — employee has been notified');
      setShowRejectModal(false);
      onBack();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Rejection failed — please try again');
    }
  };

  const handleReupload = async () => {
    if (reuploadDocTypes.length === 0) return;
    try {
      await requestReupload({ employeeId, docTypes: reuploadDocTypes, reasons: reuploadReasons }).unwrap();
      toast.success('Re-upload request sent to employee');
      setShowReuploadModal(false);
      onBack();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to request re-upload');
    }
  };

  const handleSaveNotes = async () => {
    try {
      await updateHrNotes({ employeeId, notes: hrNotes }).unwrap();
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch { /* ignore */ }
  };

  const handleRevoke = async () => {
    if (!confirm(`Revoke KYC access for ${employeeName}? They will be locked out immediately and their KYC status will return to "Needs Review".`)) return;
    try {
      await revokeKyc(employeeId).unwrap();
      toast.success('KYC access revoked — employee will be locked out immediately');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to revoke KYC access');
    }
  };

  const handleRetriggerOcr = async () => {
    const tid = toast.loading('Re-running OCR on all documents…');
    try {
      const res = await retriggerOcr(employeeId).unwrap();
      toast.success(`OCR queued for ${res?.data?.triggered ?? 0} document(s)`, { id: tid });
      setTimeout(() => refetch(), 2500);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'OCR re-trigger failed', { id: tid });
    }
  };

  const handleReclassify = async () => {
    const tid = toast.loading('Re-classifying combined PDF via AI… this may take up to 2 minutes');
    try {
      const res = await reclassifyCombinedPdf(employeeId).unwrap();
      const src = res?.data?.source === 'python' ? 'Python AI' : 'Node.js fallback';
      const pages = res?.data?.totalPages ?? 0;
      const detected = (res?.data?.detectedDocs ?? []).join(', ') || 'none';
      toast.success(`Reclassified via ${src} — ${pages} pages, detected: ${detected}`, { id: tid, duration: 6000 });
      setTimeout(() => refetch(), 500);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Reclassification failed', { id: tid });
    }
  };

  // Memoize derived lists to avoid re-running on every render (Cat 5 item 24)
  const docTypes: string[] = documents
    ? [...new Set<string>(documents.map((d: any) => d.type).filter((t: string) => t !== 'OTHER'))]
    : [];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 mb-4">
        <div className="flex items-start gap-3 flex-1">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/50 transition-colors shrink-0 mt-0.5">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900 font-sora">
              KYC Review — {employeeName}
            </h1>
            <p className="text-sm text-slate-500">{employee?.employeeCode} · {employee?.email}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <StatusBadge status={gate?.kycStatus} />
              <ProcessingModeBadge mode={gate?.processingMode} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            onClick={handleRetriggerOcr}
            disabled={retriggering || reclassifying}
            className="btn-secondary flex items-center gap-1.5 text-sm py-1.5 px-3"
          >
            {retriggering
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Re-run OCR
          </button>
          <button
            onClick={handleReclassify}
            disabled={reclassifying || retriggering}
            className="btn-secondary flex items-center gap-1.5 text-sm py-1.5 px-3"
          >
            {reclassifying
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Scan className="w-3.5 h-3.5" />}
            Re-classify PDF
          </button>
          <a
            href={`${(import.meta.env.VITE_API_URL || 'http://localhost:4000/api')}/onboarding/kyc/${employeeId}/documents/zip`}
            download
            className="btn-secondary flex items-center gap-1.5 text-sm py-1.5 px-3"
            title="Download all KYC documents as ZIP"
          >
            <Download className="w-3.5 h-3.5" />
            Download ZIP
          </a>
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

      {/* Risk Assessment Card — shows tamper score, risk level, OCR match status from combinedPdfAnalysis */}
      {combinedAnalysis && (() => {
        const suspicionScore = combinedAnalysis.suspicion_score ?? combinedAnalysis.suspicionScore ?? 0;
        const riskLevel = combinedAnalysis.risk_level ?? combinedAnalysis.riskLevel ?? 'LOW';
        const ocrMatchStatus = combinedAnalysis.ocr_match_status ?? combinedAnalysis.ocrMatchStatus ?? null;
        const tamperNotes: string[] = combinedAnalysis.tamper_notes ?? combinedAnalysis.tamperNotes ?? combinedAnalysis.suspicion_flags ?? combinedAnalysis.suspicionFlags ?? [];
        const riskColors: Record<string, { bg: string; border: string; text: string; bar: string }> = {
          LOW:    { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  bar: 'bg-green-500' },
          MEDIUM: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', bar: 'bg-yellow-500' },
          HIGH:   { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-800',    bar: 'bg-red-500' },
        };
        const rc = riskColors[riskLevel] ?? riskColors.LOW;
        return (
          <div className={`layer-card p-4 mb-4 border ${rc.border} ${rc.bg}`}>
            <div className="flex items-center gap-2 mb-3">
              <Shield className={`w-4 h-4 ${rc.text}`} />
              <span className={`text-sm font-bold ${rc.text}`}>Risk Assessment</span>
              <RiskBadge level={riskLevel} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              {/* Suspicion Score */}
              <div className="bg-white/70 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Suspicion Score</p>
                <p className={`text-2xl font-bold font-mono ${
                  suspicionScore >= 50 ? 'text-red-700' : suspicionScore >= 20 ? 'text-orange-700' : 'text-green-700'
                }`}>{suspicionScore}<span className="text-sm font-normal text-slate-400">/100</span></p>
                {/* Score bar */}
                <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${rc.bar} transition-all`} style={{ width: `${suspicionScore}%` }} />
                </div>
              </div>
              {/* Risk Level */}
              <div className="bg-white/70 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Risk Level</p>
                <p className={`text-sm font-bold ${rc.text}`}>{riskLevel}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {riskLevel === 'LOW' ? 'Documents appear genuine' : riskLevel === 'MEDIUM' ? 'Some anomalies detected' : 'High fraud indicators'}
                </p>
              </div>
              {/* OCR Match Status */}
              <div className="bg-white/70 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">OCR Match Status</p>
                {ocrMatchStatus ? (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    ocrMatchStatus === 'PASS' || ocrMatchStatus === 'pass' ? 'bg-green-100 text-green-700' :
                    ocrMatchStatus === 'PARTIAL' || ocrMatchStatus === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {(ocrMatchStatus === 'PASS' || ocrMatchStatus === 'pass') ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {String(ocrMatchStatus).toUpperCase()}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">N/A</span>
                )}
              </div>
              {/* Tamper Flags Count */}
              <div className="bg-white/70 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Tamper Flags</p>
                <p className={`text-2xl font-bold font-mono ${tamperNotes.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {tamperNotes.length}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{tamperNotes.length === 0 ? 'No flags' : 'issue(s) detected'}</p>
              </div>
            </div>
            {/* Tamper Detection Notes */}
            {tamperNotes.length > 0 && (
              <div className="bg-white/60 rounded-lg p-3 border border-red-200">
                <p className="text-xs font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                  <Flag className="w-3 h-3" /> Tamper Detection Notes
                </p>
                <ul className="space-y-1">
                  {tamperNotes.map((note: string, i: number) => (
                    <li key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                      <span className="shrink-0 mt-px">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      {/* Duplicate Document Alert — cross-employee fraud detection (Category 2 item 8) */}
      <DuplicateDocAlert duplicateData={combinedAnalysis?.duplicateDetection} />

      {/* Real-time page-by-page OCR progress (Cat 5 item 20) */}
      {gate?.kycStatus === 'PROCESSING' && <OcrLiveProgress employeeId={employeeId} />}

      {/* PROCESSING — professional scanning animation */}
      {gate?.kycStatus === 'PROCESSING' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 layer-card p-5 border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50"
        >
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <Scan className="w-5 h-5 text-indigo-600" />
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full animate-ping" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-indigo-900">AI Document Scanner Running</p>
              <p className="text-xs text-indigo-700 mt-0.5">
                The Python OCR engine is scanning every page of the combined PDF and identifying document types.
                This typically takes 30–120 seconds depending on file size.
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-indigo-600">
                <span className="font-mono font-semibold">
                  {Math.floor(processingElapsed / 60)}:{String(processingElapsed % 60).padStart(2, '0')} elapsed
                </span>
                <span>·</span>
                <span>{Math.min(99, Math.round((processingElapsed / 90) * 100))}% estimated</span>
              </div>
              {/* Animated scan lines */}
              <div className="mt-3 space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="h-1.5 rounded-full bg-indigo-200 overflow-hidden"
                    initial={{ width: '100%' }}
                  >
                    <motion.div
                      className="h-full bg-indigo-500 rounded-full"
                      animate={{ x: ['-100%', '100%'] }}
                      transition={{ duration: 1.4 + i * 0.3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }}
                    />
                  </motion.div>
                ))}
              </div>
            </div>
            <button
              onClick={handleReclassify}
              disabled={reclassifying}
              className="shrink-0 text-xs text-indigo-700 border border-indigo-300 rounded-lg px-3 py-1.5 hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
            >
              {reclassifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Force Re-classify
            </button>
          </div>
        </motion.div>
      )}

      {/* KYC Scorecard — consolidated metrics overview */}
      <KycScorecard reviewData={review} />

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

      {/* Verified Action Bar — shown when KYC is already approved; allows HR to revoke access */}
      {gate?.kycStatus === 'VERIFIED' && (
        <div className="layer-card p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 flex-1">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-semibold text-green-700">KYC Verified — Portal Access Granted</span>
          </div>
          <button
            onClick={handleRevoke}
            disabled={revoking}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
          >
            {revoking ? (
              <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
            ) : <XCircle className="w-4 h-4" />}
            Revoke Access
          </button>
        </div>
      )}

      {/* Cross-Validation Matrix — reads actual service shape: { status, details[] } */}
      {crossValidation && crossValidation.status !== 'PENDING' && (
        <Section title="Cross-Document Validation">
          {/* DOB cross-verification from separate-mode OCR records */}
          {separateModeDobCrossVerification && (
            <DobCrossVerification data={separateModeDobCrossVerification} />
          )}
          {/* Overall verdict badge */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${
              crossValidation.status === 'PASS'    ? 'bg-green-100 text-green-800' :
              crossValidation.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-800' :
              crossValidation.status === 'ERROR'   ? 'bg-gray-100 text-gray-700' :
                                                     'bg-red-100 text-red-800'
            }`}>
              {crossValidation.status === 'PASS'
                ? <CheckCircle className="w-4 h-4" />
                : crossValidation.status === 'PARTIAL'
                  ? <AlertTriangle className="w-4 h-4" />
                  : crossValidation.status === 'ERROR'
                    ? <AlertTriangle className="w-4 h-4" />
                    : <XCircle className="w-4 h-4" />}
              Cross-validation: {crossValidation.status}
            </span>
            {crossValidation.status !== 'ERROR' && (
              <RiskBadge level={
                crossValidation.status === 'PASS' ? 'LOW' :
                crossValidation.status === 'PARTIAL' ? 'MEDIUM' : 'HIGH'
              } />
            )}
          </div>

          {/* ERROR state — validation was unavailable, show actionable guidance */}
          {crossValidation.status === 'ERROR' && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Validation Unavailable
              </p>
              <p className="text-sm text-amber-700">{crossValidation.message}</p>
              {crossValidation.manualReviewRequired && (
                <p className="text-xs text-amber-600 border-t border-amber-200 pt-2">
                  <strong>Manual check required:</strong> Open each document and confirm that the name,
                  date of birth, and document number are consistent across Aadhaar, PAN, and any other
                  identity documents submitted.
                </p>
              )}
            </div>
          )}

          {/* Per-field breakdown — only for PASS / PARTIAL / FAIL */}
          {crossValidation.status !== 'ERROR' && (
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
          )}

          {/* Action flags — only for fields with mismatches */}
          {crossValidation.status !== 'ERROR' && (crossValidation.details || []).some((d: any) => !d.match) && (
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
            // Infrastructure warning: set by Python when all pages fail OCR due to system issue
            const ocrInfrastructureWarning: string | null = combinedAnalysis.ocr_infrastructure_warning ?? combinedAnalysis.ocrInfrastructureWarning ?? null;
            return (
              <>
                {/* Infrastructure warning banner — shown instead of blank-page spam */}
                {ocrInfrastructureWarning && (
                  <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex gap-2">
                    <span className="text-orange-500 text-base shrink-0">⚠</span>
                    <div>
                      <p className="text-xs font-semibold text-orange-700 mb-0.5">OCR Infrastructure Warning</p>
                      <p className="text-xs text-orange-600">{ocrInfrastructureWarning}</p>
                      <p className="text-xs text-orange-500 mt-1">
                        The document may be valid. Please download and review it manually before making a decision.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 mb-4">
                  <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-2xl font-bold font-mono text-slate-800">{totalPages ?? '—'}</p>
                    <p className="text-xs text-slate-500">Total Pages</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-2xl font-bold font-mono text-slate-800">{detectedDocs.length}</p>
                    <p className="text-xs text-slate-500">Doc Types Found</p>
                  </div>
                  {/* Required docs progress */}
                  {(() => {
                    const reqTotal = (combinedAnalysis.present_docs?.length ?? 0) + (missingDocs.length ?? 0);
                    const reqFound = combinedAnalysis.present_docs?.length ?? 0;
                    return reqTotal > 0 ? (
                      <div className="bg-slate-50 rounded-lg px-3 py-2 text-center min-w-[80px]">
                        <p className={`text-2xl font-bold font-mono ${reqFound === reqTotal ? 'text-green-600' : 'text-orange-600'}`}>
                          {reqFound}/{reqTotal}
                        </p>
                        <p className="text-xs text-slate-500">Required Docs</p>
                      </div>
                    ) : null;
                  })()}
                  <div className={`rounded-lg px-3 py-2 text-center ${
                    suspicionScore >= 50 ? 'bg-red-50' : suspicionScore >= 20 ? 'bg-orange-50' : 'bg-green-50'
                  }`}>
                    <p className={`text-2xl font-bold font-mono ${
                      suspicionScore >= 50 ? 'text-red-700' : suspicionScore >= 20 ? 'text-orange-700' : 'text-green-700'
                    }`}>{suspicionScore}/100</p>
                    <p className={`text-xs ${
                      suspicionScore >= 50 ? 'text-red-500' : suspicionScore >= 20 ? 'text-orange-500' : 'text-green-500'
                    }`}>Fraud Risk Score</p>
                  </div>
                  {riskLevel && !ocrInfrastructureWarning && <RiskBadge level={riskLevel} />}
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

                {/* Only show suspicion flags if OCR infrastructure is healthy */}
                {suspicionFlags.length > 0 && !ocrInfrastructureWarning && (
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

                {/* Duplicate document detection across employees (cross-employee fraud) */}
                {(() => {
                  const dups = combinedAnalysis.duplicate_detection ?? combinedAnalysis.duplicateDetection;
                  if (!dups || !Array.isArray(dups) || dups.length === 0) return null;
                  return (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-xs font-bold text-red-700 mb-2 flex items-center gap-1.5">
                        <span>🔴</span> Duplicate Document Detection — {dups.length} match{dups.length !== 1 ? 'es' : ''} found
                      </p>
                      <div className="space-y-1.5">
                        {dups.map((dup: any, i: number) => (
                          <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-red-700 bg-red-100 rounded px-2 py-1">
                            <span className="font-semibold">{dup.docType || dup.doc_type}</span>
                            <span>·</span>
                            <span className="font-mono">{dup.maskedNumber || dup.masked_number || dup.docNumber || dup.doc_number}</span>
                            <span>·</span>
                            <span>also registered to <strong>{dup.employeeName || dup.employee_name}</strong></span>
                            {(dup.employeeCode || dup.employee_code) && (
                              <span className="text-red-500">({dup.employeeCode || dup.employee_code})</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-red-600 mt-2">⚠ Verify originals before approving. Cross-reference with the duplicate employee's HR record.</p>
                    </div>
                  );
                })()}

                {/* DOB Cross-Verification from AI batch analysis (Category 1 item 1 + Category 4 item 16) */}
                {combinedAnalysis?.dobCrossVerification && combinedAnalysis.dobCrossVerification.status !== 'INSUFFICIENT_DATA' && (
                  <div className="mt-3">
                    <DobCrossVerification data={combinedAnalysis.dobCrossVerification} />
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
        {/* Expiry warnings — shown above the list for immediate visibility (Category 4 item 17) */}
        <ExpiryWarnings documents={documents || []} />
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
                    <button
                      onClick={() => setViewerDoc({ docId: doc.id, name: doc.name || doc.type })}
                      className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                      title="View document inline"
                    >
                      <Eye className="w-4 h-4 text-slate-500" />
                    </button>
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
                // Aadhaar masking: UIDAI mandate — show only last 4 digits in UI
                const docNum = ocr.extractedDocNumber;
                const maskedDocNum = doc.type === 'AADHAAR' && docNum && /^\d{12}$/.test(docNum.replace(/\s/g, ''))
                  ? `XXXX XXXX ${docNum.replace(/\s/g, '').slice(8)}`
                  : docNum;
                const fields: Record<string, string | null> = {
                  Name: ocr.extractedName,
                  'Date of Birth': ocr.extractedDob,
                  'Doc Number': maskedDocNum ?? null,
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
              {(((doc.ocrVerification?.suspicionFlags ?? doc.ocrData?.suspicionFlags) as string[] | undefined) ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(doc.ocrVerification?.suspicionFlags ?? doc.ocrData?.suspicionFlags as string[]).map((f: string, i: number) => (
                    <span key={i} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{f}</span>
                  ))}
                </div>
              )}

              {/* Per-doc OCR retry button — shown when confidence is very low or OCR absent (Cat 5 item 23) */}
              {(!doc.ocrVerification || (doc.ocrVerification.confidence != null && doc.ocrVerification.confidence < 0.3)) && (
                <div className="mt-2 p-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    {!doc.ocrVerification ? 'OCR not run yet' : 'Low confidence OCR result'}
                  </span>
                  <button
                    onClick={handleRetriggerOcr}
                    disabled={retriggering}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                  >
                    {retriggering ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Retry OCR
                  </button>
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

      {/* KYC Audit Log — full action history for this employee (Category 4 item 15) */}
      <Section title="KYC Action History" defaultOpen={false}>
        <KycAuditLog employeeId={employeeId} />
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

      {/* Inline Document Viewer modal (Category 4 item 18) */}
      {viewerDoc && (
        <InlineDocViewer
          employeeId={employeeId}
          docId={viewerDoc.docId}
          name={viewerDoc.name}
          onClose={() => setViewerDoc(null)}
        />
      )}

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
  const { data: statsData } = useGetKycStatsQuery();
  const stats = statsData?.data;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchRejectModal, setShowBatchRejectModal] = useState(false);
  const [batchRejectReason, setBatchRejectReason] = useState('');
  const [batchProcessing, setBatchProcessing] = useState(false);
  const { data, isLoading, isFetching } = useGetPendingKycQuery({ page });
  const [verifyKyc] = useVerifyKycMutation();
  const [rejectKyc] = useRejectKycMutation();

  // Backend returns OnboardingDocumentGate records with nested employee relation
  const gates: any[] = data?.data || [];
  const meta = data?.meta;
  const allSelected = gates.length > 0 && gates.every((g: any) => selectedIds.has(g.employeeId));

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    // Only select employees that are in an approvable state — skip already-VERIFIED
    else setSelectedIds(new Set(
      gates.filter((g: any) => g.kycStatus !== 'VERIFIED').map((g: any) => g.employeeId)
    ));
  };

  const handleBatchApprove = async () => {
    // Filter out already-VERIFIED employees — re-verifying them is a no-op and wastes time
    const approvableIds = [...selectedIds].filter(id => {
      const gate = gates.find((g: any) => g.employeeId === id);
      return gate && gate.kycStatus !== 'VERIFIED';
    });
    if (approvableIds.length === 0) {
      toast.error('All selected employees are already verified.');
      return;
    }
    if (!confirm(`Approve KYC for ${approvableIds.length} employee(s)? This will unlock their dashboards immediately.`)) return;
    setBatchProcessing(true);
    let approved = 0;
    for (const id of approvableIds) {
      try { await verifyKyc(id).unwrap(); approved++; } catch { /* skip failed */ }
    }
    setBatchProcessing(false);
    setSelectedIds(new Set());
    toast.success(`Approved ${approved} of ${approvableIds.length} submissions`);
  };

  const handleBatchReject = async () => {
    if (!batchRejectReason.trim()) return;
    setBatchProcessing(true);
    let rejected = 0;
    for (const id of selectedIds) {
      try { await rejectKyc({ employeeId: id, reason: batchRejectReason }).unwrap(); rejected++; } catch { /* skip */ }
    }
    setBatchProcessing(false);
    setSelectedIds(new Set());
    setShowBatchRejectModal(false);
    setBatchRejectReason('');
    toast.success(`Rejected ${rejected} of ${selectedIds.size} submissions`);
  };

  if (selectedEmployeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4 md:p-6">
        <HrReviewDetail
          key={selectedEmployeeId}
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

          {/* KYC Stats Bar */}
          {stats && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Awaiting Review', value: stats.pending, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                { label: 'Processing', value: stats.processing, color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
                { label: 'Re-upload Required', value: stats.reuploadRequired, color: 'bg-orange-50 border-orange-200 text-orange-700' },
                { label: 'Verified Total', value: stats.verified, color: 'bg-green-50 border-green-200 text-green-700' },
                { label: 'Verified This Month', value: stats.verifiedThisMonth, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              ].map(s => (
                <div key={s.label} className={`p-3 rounded-xl border ${s.color} text-center`}>
                  <p className="text-2xl font-bold font-mono">{s.value ?? 0}</p>
                  <p className="text-xs font-medium mt-0.5 leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Batch action bar — visible when at least one submission is selected (Category 4 item 19) */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-3 flex-wrap">
            <Users className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="text-sm font-medium text-indigo-800">{selectedIds.size} submission{selectedIds.size > 1 ? 's' : ''} selected</span>
            <div className="flex gap-2 ml-auto">
              <button onClick={() => setSelectedIds(new Set())} className="btn-secondary text-sm">Clear</button>
              <button
                onClick={() => setShowBatchRejectModal(true)}
                disabled={batchProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 text-sm font-medium transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                Batch Reject
              </button>
              <button
                onClick={handleBatchApprove}
                disabled={batchProcessing}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {batchProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Batch Approve
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="layer-card overflow-x-auto">
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
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 accent-indigo-600 cursor-pointer"
                      title="Select all"
                    />
                  </th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Employee</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Dept.</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Mode</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden lg:table-cell">OCR Score</th>
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
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(gate.employeeId)}
                        onChange={e => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(gate.employeeId);
                          else next.delete(gate.employeeId);
                          setSelectedIds(next);
                        }}
                        className="w-4 h-4 accent-indigo-600 cursor-pointer"
                      />
                    </td>
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
                      <div className="flex flex-col gap-1">
                        {gate.uploadMode ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${
                            gate.uploadMode === 'COMBINED' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {gate.uploadMode === 'COMBINED' ? 'Combined PDF' : 'Separate'}
                          </span>
                        ) : <span className="text-slate-400 text-xs">—</span>}
                        {/* AI / Fallback engine indicator */}
                        {gate.combinedPdfAnalysis?.ocrEngine && (
                          <span className={`text-xs px-1.5 py-0.5 rounded w-fit font-mono ${
                            gate.combinedPdfAnalysis.ocrEngine === 'AI'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : gate.combinedPdfAnalysis.ocrEngine === 'FALLBACK'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-50 text-slate-500 border border-slate-200'
                          }`}>
                            {gate.combinedPdfAnalysis.ocrEngine === 'AI' ? '🤖 AI' : gate.combinedPdfAnalysis.ocrEngine === 'FALLBACK' ? '⚙ Fallback' : gate.combinedPdfAnalysis.ocrEngine}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={gate.kycStatus} />
                        {/* SLA warning — flag if waiting > 48h */}
                        {gate.updatedAt && (() => {
                          const ageHours = (Date.now() - new Date(gate.updatedAt).getTime()) / 3_600_000;
                          if (ageHours >= 72) return (
                            <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium w-fit">
                              ⚠ {Math.floor(ageHours / 24)}d overdue
                            </span>
                          );
                          if (ageHours >= 48) return (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium w-fit">
                              ⏱ {Math.floor(ageHours)}h waiting
                            </span>
                          );
                          return null;
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {gate.ocrSummary?.scannedCount > 0 ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-bold font-mono ${
                              (gate.ocrSummary.avgScore ?? 0) >= 80 ? 'text-green-700' :
                              (gate.ocrSummary.avgScore ?? 0) >= 60 ? 'text-amber-700' :
                              'text-red-700'
                            }`}>
                              {gate.ocrSummary.avgScore ?? '—'}
                            </span>
                            <span className="text-xs text-slate-400">/100</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {gate.ocrSummary.flaggedCount > 0 && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
                                {gate.ocrSummary.flaggedCount} flagged
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400">{gate.ocrSummary.scannedCount} scanned</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Not scanned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-slate-500">
                          {gate.updatedAt ? new Date(gate.updatedAt).toLocaleDateString('en-IN') : '—'}
                        </span>
                        <SlaBadge submittedAt={gate.submittedAt || gate.updatedAt} />
                      </div>
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

      {/* Batch Reject Modal (Category 4 item 19) */}
      <AnimatePresence>
        {showBatchRejectModal && (
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
              <h2 className="text-lg font-bold text-slate-900 mb-1">Batch Reject — {selectedIds.size} Submission{selectedIds.size > 1 ? 's' : ''}</h2>
              <p className="text-sm text-slate-500 mb-4">All selected employees will be notified with this rejection reason.</p>
              <textarea
                rows={4}
                value={batchRejectReason}
                onChange={e => setBatchRejectReason(e.target.value)}
                placeholder="Reason for rejection (shown to all selected employees)…"
                className="input-glass w-full text-sm resize-none mb-4"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowBatchRejectModal(false)} className="btn-secondary">Cancel</button>
                <button
                  onClick={handleBatchReject}
                  disabled={!batchRejectReason.trim() || batchProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {batchProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm Batch Rejection
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
