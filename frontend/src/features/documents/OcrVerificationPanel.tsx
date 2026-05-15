import { useState, useEffect, lazy, Suspense } from 'react';
import {
  Shield, Loader2, RotateCcw, AlertTriangle, CheckCircle2, XCircle,
  ScanLine, Eye, Check, FileText, Ban, Info, ChevronDown, ChevronUp, Zap, Download,
  History, UserCheck, UserX, ChevronRight, Pencil, Save,
} from 'lucide-react';
import { useGetDocumentOcrQuery, useTriggerDocumentOcrMutation, useUpdateDocumentOcrMutation, useDeepRecheckDocumentMutation, useReprocessDocumentMutation, useGetDocumentOcrHistoryQuery, useHrApproveDocumentMutation, useHrRejectDocumentMutation } from './documentOcrApi';
import { useVerifyDocumentMutation } from './documentApi';
import { useGetKycHrReviewQuery, useReclassifyCombinedPdfMutation, useRequestReuploadMutation } from '../kyc/kycApi';
import toast from 'react-hot-toast';
import { cn, getUploadUrl } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
const SecureDocumentViewer = lazy(() => import('../policies/SecureDocumentViewer'));

interface Props {
  documentId: string;
  documentName: string;
  documentType: string;
  documentStatus?: string;
  rejectionReason?: string;
  employeeId?: string;
  fileUrl?: string;
  onClose: () => void;
  onStatusChange?: () => void;
}

type FieldKey = 'extractedName' | 'extractedDob' | 'extractedFatherName' | 'extractedMotherName' | 'extractedDocNumber' | 'extractedGender' | 'extractedAddress';

type FieldDef = { key: FieldKey; label: string };

// Per-document-type field definitions — only relevant fields shown for each doc type
const DOC_TYPE_FIELDS: Record<string, FieldDef[]> = {
  AADHAAR: [
    { key: 'extractedName', label: 'Name' },
    { key: 'extractedDob', label: 'Date of Birth' },
    { key: 'extractedGender', label: 'Gender' },
    { key: 'extractedAddress', label: 'Address' },
    { key: 'extractedDocNumber', label: 'Aadhaar Number' },
  ],
  PAN: [
    { key: 'extractedName', label: 'Name' },
    { key: 'extractedFatherName', label: "Father's Name" },
    { key: 'extractedDob', label: 'Date of Birth' },
    { key: 'extractedDocNumber', label: 'PAN Number' },
  ],
  PASSPORT: [
    { key: 'extractedName', label: 'Name' },
    { key: 'extractedDob', label: 'Date of Birth' },
    { key: 'extractedGender', label: 'Gender' },
    { key: 'extractedDocNumber', label: 'Passport Number' },
    { key: 'extractedAddress', label: 'Place of Birth / Nationality' },
  ],
  VOTER_ID: [
    { key: 'extractedName', label: 'Name' },
    { key: 'extractedFatherName', label: "Father's Name" },
    { key: 'extractedDob', label: 'Date of Birth' },
    { key: 'extractedGender', label: 'Gender' },
    { key: 'extractedAddress', label: 'Address' },
    { key: 'extractedDocNumber', label: 'EPIC Number' },
  ],
  DRIVING_LICENSE: [
    { key: 'extractedName', label: 'Name' },
    { key: 'extractedDob', label: 'Date of Birth' },
    { key: 'extractedDocNumber', label: 'DL Number' },
    { key: 'extractedAddress', label: 'Address' },
  ],
  BANK_STATEMENT: [
    { key: 'extractedName', label: 'Account Holder Name' },
    { key: 'extractedDocNumber', label: 'Account Number' },
  ],
  CANCELLED_CHEQUE: [
    { key: 'extractedName', label: 'Account Holder Name' },
    { key: 'extractedDocNumber', label: 'Account Number' },
  ],
  TENTH_CERTIFICATE: [
    { key: 'extractedName', label: 'Student Name' },
    { key: 'extractedDocNumber', label: 'Roll Number' },
  ],
  TWELFTH_CERTIFICATE: [
    { key: 'extractedName', label: 'Student Name' },
    { key: 'extractedDocNumber', label: 'Roll Number' },
  ],
  DEGREE_CERTIFICATE: [
    { key: 'extractedName', label: 'Student Name' },
    { key: 'extractedDocNumber', label: 'Roll / Enrollment Number' },
  ],
  POST_GRADUATION_CERTIFICATE: [
    { key: 'extractedName', label: 'Student Name' },
    { key: 'extractedDocNumber', label: 'Roll / Enrollment Number' },
  ],
  RESIDENCE_PROOF: [
    { key: 'extractedName', label: 'Name' },
    { key: 'extractedAddress', label: 'Address' },
  ],
  EXPERIENCE_LETTER: [
    { key: 'extractedName', label: 'Employee Name' },
    { key: 'extractedDocNumber', label: 'Employee ID' },
  ],
  SALARY_SLIP_DOC: [
    { key: 'extractedName', label: 'Employee Name' },
    { key: 'extractedDocNumber', label: 'Employee ID' },
  ],
  OFFER_LETTER_DOC: [
    { key: 'extractedName', label: 'Candidate Name' },
    { key: 'extractedDocNumber', label: 'Employee ID' },
  ],
  RELIEVING_LETTER: [
    { key: 'extractedName', label: 'Employee Name' },
    { key: 'extractedDocNumber', label: 'Employee ID' },
  ],
};

const DEFAULT_OCR_FIELDS: FieldDef[] = [
  { key: 'extractedName', label: 'Name' },
  { key: 'extractedDob', label: 'Date of Birth' },
  { key: 'extractedFatherName', label: "Father's Name" },
  { key: 'extractedMotherName', label: "Mother's Name" },
  { key: 'extractedDocNumber', label: 'Document Number' },
  { key: 'extractedGender', label: 'Gender' },
  { key: 'extractedAddress', label: 'Address' },
];

function getDocFields(docType: string): FieldDef[] {
  return DOC_TYPE_FIELDS[docType] ?? DEFAULT_OCR_FIELDS;
}

// Aadhaar: UIDAI mandate — mask first 8 digits in display (XXXX XXXX 1234)
function maskAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) return value;
  return `XXXX XXXX ${digits.slice(8)}`;
}

function renderFieldValue(docType: string, fieldKey: FieldKey, value: string): string {
  if (fieldKey === 'extractedDocNumber' && docType === 'AADHAAR') return maskAadhaar(value);
  return value;
}

// ─── Per-field confidence badge ───────────────────────────────────────────────
function FieldConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  if (pct >= 90) return <span className="text-[10px] text-emerald-600 font-medium">({pct}%)</span>;
  if (pct >= 70) return <span className="text-[10px] text-amber-600 font-medium">({pct}% — check)</span>;
  return <span className="text-[10px] text-red-600 font-medium">({pct}% — low)</span>;
}

// Map FieldKey → which llmExtractedData keys to look up for confidence
function getFieldConfidence(fieldKey: FieldKey, docType: string, llmData: any): number | undefined {
  if (!llmData) return undefined;
  switch (fieldKey) {
    case 'extractedName':
      return llmData.full_name?.confidence ?? llmData.student_name?.confidence ?? llmData.employee_name?.confidence;
    case 'extractedDob':
      return llmData.dob?.confidence;
    case 'extractedDocNumber':
      if (docType === 'AADHAAR') return llmData.aadhaar_number?.confidence;
      if (docType === 'PAN') return llmData.pan_number?.confidence;
      if (docType === 'PASSPORT') return llmData.passport_number?.confidence;
      return llmData.document_number?.confidence;
    case 'extractedFatherName':
      return llmData.father_name?.confidence;
    case 'extractedGender':
      return llmData.gender?.confidence;
    case 'extractedAddress':
      return llmData.address?.confidence;
    default:
      return undefined;
  }
}

// ─── Confidence badge helper ──────────────────────────────────────────────────
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round((confidence || 0) * 100);
  const isFlagged = pct < 60;
  const isWarn = pct >= 60 && pct < 75;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold',
      isFlagged ? 'bg-red-100 text-red-700 ring-1 ring-red-300' :
      isWarn ? 'bg-amber-100 text-amber-700' :
      'bg-emerald-100 text-emerald-700'
    )}>
      {isFlagged && <AlertTriangle size={11} />}
      Confidence: {pct}%{isFlagged ? ' — FLAGGED' : ''}
    </span>
  );
}

// ─── Validation Reasons panel ─────────────────────────────────────────────────
function ValidationReasons({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(true);
  const [showAllPass, setShowAllPass] = useState(false);
  if (!reasons || reasons.length === 0) return null;

  const toStr = (r: any) => typeof r === 'string' ? r : (r?.message ?? JSON.stringify(r));
  const isFail = (s: string) => s.startsWith('✗') || s.startsWith('🚩');
  const isWarn = (s: string) => s.startsWith('⚠');
  const isPass = (s: string) => s.startsWith('✓');

  const hasFlagged = reasons.some(r => isFail(toStr(r)));
  const hasWarning = reasons.some(r => isWarn(toStr(r)));
  const issueReasons = reasons.filter(r => { const s = toStr(r); return isFail(s) || isWarn(s); });
  const passReasons = reasons.filter(r => isPass(toStr(r)));
  // Show issues always; pass items only on demand
  const displayReasons = showAllPass ? reasons : issueReasons;

  return (
    <div className={cn(
      'layer-card overflow-hidden border',
      hasFlagged ? 'border-red-200 bg-red-50/30' :
      hasWarning ? 'border-amber-200 bg-amber-50/20' :
      'border-emerald-200 bg-emerald-50/20',
    )}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className={cn(
          'text-xs font-semibold flex items-center gap-1.5',
          hasFlagged ? 'text-red-700' : hasWarning ? 'text-amber-700' : 'text-emerald-700',
        )}>
          <Shield size={13} />
          AI Findings
          {issueReasons.length > 0 ? (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-white/60 text-[10px]">
              {issueReasons.length} issue{issueReasons.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px]">
              All checks passed
            </span>
          )}
        </span>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {displayReasons.length === 0 && !showAllPass && passReasons.length > 0 && (
            <p className="text-xs text-emerald-600 px-2 py-1.5 flex items-center gap-1.5">
              <CheckCircle2 size={11} />
              All {passReasons.length} check{passReasons.length !== 1 ? 's' : ''} passed — document looks authentic
            </p>
          )}
          {displayReasons.map((reason: any, i) => {
            const reasonStr = toStr(reason);
            const isTampering = reasonStr.startsWith('✗ Tampering:');
            const fail = isFail(reasonStr);
            const warn = isWarn(reasonStr);
            const pass = isPass(reasonStr);
            return (
              <div key={i} className={cn(
                'flex items-start gap-2 text-xs px-2.5 py-1.5 rounded',
                isTampering ? 'bg-red-100 border-l-2 border-red-500 text-red-800 font-medium' :
                fail ? 'bg-red-50 text-red-700' :
                warn ? 'bg-amber-50 text-amber-700' :
                pass ? 'bg-emerald-50 text-emerald-700' :
                'bg-gray-50 text-gray-600',
              )}>
                <span className="shrink-0 mt-0.5">
                  {fail ? <XCircle size={11} /> : warn ? <AlertTriangle size={11} /> : pass ? <CheckCircle2 size={11} /> : <Info size={11} />}
                </span>
                <span className="leading-relaxed">{reasonStr}</span>
              </div>
            );
          })}
          {/* Toggle to show/hide passed checks */}
          {passReasons.length > 0 && (
            <button
              onClick={() => setShowAllPass(v => !v)}
              className="text-[10px] text-gray-400 hover:text-gray-600 mt-1 px-2 flex items-center gap-1"
            >
              {showAllPass ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {showAllPass ? 'Hide' : `Show ${passReasons.length} passed check${passReasons.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Document AI Findings Summary (always visible in popup) ─────────────────
function DocFindingsSummary({
  reasons,
  tamperingSignals,
  kycScore,
}: {
  reasons: string[];
  tamperingSignals: string[];
  kycScore: number | null;
}) {
  const allReasons: string[] = [
    ...tamperingSignals.map(t => `✗ Tampering: ${t}`),
    ...reasons,
  ];

  const isFail = (s: string) => s.startsWith('✗') || s.startsWith('🚩');
  const isWarn = (s: string) => s.startsWith('⚠');
  const isPass = (s: string) => s.startsWith('✓');

  const failCount = allReasons.filter(isFail).length;
  const warnCount = allReasons.filter(isWarn).length;
  const passCount = allReasons.filter(isPass).length;
  const issueCount = failCount + warnCount;
  const hasAnyFindings = allReasons.length > 0;

  // Sort: failures → warnings → passes
  const sorted = [...allReasons].sort((a, b) => {
    const rank = (s: string) => isFail(s) ? 0 : isWarn(s) ? 1 : 2;
    return rank(a) - rank(b);
  });

  const hasFail = failCount > 0;
  const hasWarn = warnCount > 0;

  const cardBorder = hasFail ? 'border-red-200 bg-red-50/10'
    : hasWarn ? 'border-amber-200 bg-amber-50/10'
    : hasAnyFindings ? 'border-emerald-200 bg-emerald-50/10'
    : 'border-gray-200 bg-gray-50/20';

  const headerBg = hasFail ? 'bg-red-50/60 border-red-100 text-red-700'
    : hasWarn ? 'bg-amber-50/60 border-amber-100 text-amber-700'
    : hasAnyFindings ? 'bg-emerald-50/60 border-emerald-100 text-emerald-700'
    : 'bg-gray-50 border-gray-100 text-gray-500';

  const summaryText = !hasAnyFindings
    ? 'No AI findings — run OCR to analyse'
    : issueCount > 0
    ? `${issueCount} issue${issueCount !== 1 ? 's' : ''} found`
    : `All ${passCount} check${passCount !== 1 ? 's' : ''} passed`;

  const SummaryIcon = hasFail ? XCircle : hasWarn ? AlertTriangle : hasAnyFindings ? CheckCircle2 : Info;

  return (
    <div className={cn('layer-card overflow-hidden border', cardBorder)}>
      {/* Summary header */}
      <div className={cn('flex items-center justify-between px-4 py-2.5 border-b', headerBg)}>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <SummaryIcon size={14} />
          AI Findings — {summaryText}
        </span>
        {kycScore !== null && (
          <span className={cn(
            'text-xs font-bold px-2 py-0.5 rounded-full',
            kycScore >= 85 ? 'bg-emerald-100 text-emerald-700' :
            kycScore >= 70 ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700',
          )}>
            Score {kycScore}/100
          </span>
        )}
      </div>

      {/* Individual check bullets */}
      <div className="px-4 py-3 space-y-1.5">
        {hasAnyFindings ? sorted.map((reason, i) => {
          const fail = isFail(reason);
          const warn = isWarn(reason);
          const pass = isPass(reason);
          const isTamper = reason.startsWith('✗ Tampering:');
          return (
            <div key={i} className={cn(
              'flex items-start gap-2 text-xs px-2.5 py-1.5 rounded',
              isTamper ? 'bg-red-100 border-l-2 border-red-500 text-red-800 font-medium' :
              fail ? 'bg-red-50 text-red-700' :
              warn ? 'bg-amber-50 text-amber-700' :
              pass ? 'bg-emerald-50 text-emerald-700' :
              'bg-gray-50 text-gray-600',
            )}>
              <span className="shrink-0 mt-0.5">
                {fail ? <XCircle size={11} /> : warn ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
              </span>
              <span className="leading-relaxed">{reason}</span>
            </div>
          );
        }) : (
          <p className="text-xs text-gray-400 py-1">
            OCR has not been run yet — click <strong>Re-run Full OCR Pipeline</strong> to analyse this document.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Rejection reason templates ───────────────────────────────────────────────
const REJECTION_TEMPLATES: Record<string, string[]> = {
  default: [
    'Image is blurry or unclear — please upload a sharper scan',
    'Document appears to be a screenshot — please upload original scan or photo',
    'Name on document does not match employee profile',
    'Document is expired — please upload a valid document',
    'Document number format is invalid or unreadable',
    'Key information is cut off — ensure entire document is visible',
    'Suspected digital alteration detected — please submit original',
  ],
  PHOTO: [
    'No face detected — please upload a passport-size photograph',
    'Multiple faces detected — upload a photo of the employee only',
    'Photo quality is too low — use a well-lit, clear photo',
    'Photo appears to be a screenshot — upload a physical photograph',
  ],
  AADHAAR: [
    'Aadhaar number is not clearly visible or is incomplete',
    'Name on Aadhaar does not match employee profile — use corrected Aadhaar',
    'Both sides of Aadhaar card must be uploaded',
    'QR code is obscured — ensure full document is visible',
  ],
  PAN: [
    'PAN number format is invalid (must be ABCDE1234F pattern)',
    "Father's name is not clearly visible",
    'PAN appears to be from DigiLocker — please upload physical scan',
  ],
  PASSPORT: [
    'Passport has expired — please upload a valid passport',
    'Passport expiry is within 6 months — may need renewal soon',
    'MRZ lines at bottom are not visible — ensure full data page is captured',
    'Passport number format is invalid',
  ],
};

// ─── Reject document dialog ───────────────────────────────────────────────────
function RejectDocumentDialog({
  docType, onConfirm, onCancel, loading,
}: {
  docType: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  const templates = REJECTION_TEMPLATES[docType] ?? REJECTION_TEMPLATES.default;
  return (
    <div className="layer-card p-4 border border-red-200 bg-red-50/40">
      <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
        <Ban size={14} /> Reject Document
      </p>
      <p className="text-xs text-red-600 mb-3">
        This will mark <strong>{docType.replace(/_/g, ' ')}</strong> as rejected and notify the employee to re-upload.
      </p>
      {/* Quick template buttons */}
      <div className="mb-3">
        <p className="text-xs text-slate-500 mb-1.5 font-medium">Quick reasons:</p>
        <div className="flex flex-col gap-1">
          {templates.map(t => (
            <button
              key={t}
              onClick={() => setReason(t)}
              className={`text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${reason === t ? 'bg-red-100 border-red-300 text-red-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Or type a custom reason..."
        className="input-glass text-sm w-full h-16 resize-none mb-3"
      />
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 text-sm text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={() => reason.trim() && onConfirm(reason.trim())}
          disabled={!reason.trim() || loading}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
          Confirm Rejection
        </button>
      </div>
    </div>
  );
}

// ─── Authenticity & Tampering Panel ──────────────────────────────────────────
function AuthenticityPanel({ checks, tampering }: { checks: Record<string, any> | null; tampering: string[] }) {
  const [open, setOpen] = useState(true);

  const entries: { key: string; result: string; evidence: string }[] = checks
    ? Object.entries(checks).map(([key, val]: [string, any]) => ({
        key: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        result: val?.result || 'PASS',
        evidence: val?.evidence || '',
      }))
    : [];

  const hasIssue = entries.some(e => e.result !== 'PASS') || tampering.length > 0;

  return (
    <div className={cn(
      'layer-card overflow-hidden border',
      hasIssue ? 'border-red-200 bg-red-50/20' : 'border-gray-200 bg-gray-50/20',
    )}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className={cn(
          'text-xs font-semibold flex items-center gap-1.5',
          hasIssue ? 'text-red-700' : 'text-gray-600',
        )}>
          <AlertTriangle size={13} />
          Authenticity &amp; Tampering Signals
          {hasIssue && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">
              {entries.filter(e => e.result !== 'PASS').length + tampering.length} issue{(entries.filter(e => e.result !== 'PASS').length + tampering.length) !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1.5">
          {/* Tampering signals — most prominent */}
          {tampering.map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-xs px-2.5 py-2 rounded bg-red-100 border-l-2 border-red-500 text-red-800 font-medium">
              <XCircle size={11} className="shrink-0 mt-0.5" />
              <span className="leading-relaxed">Tampering: {t}</span>
            </div>
          ))}
          {/* Authenticity check entries */}
          {entries.map((e, i) => {
            const isPass = e.result === 'PASS';
            const isFail = e.result === 'FAIL';
            return (
              <div key={i} className={cn(
                'flex items-start gap-2 text-xs px-2.5 py-1.5 rounded',
                isFail ? 'bg-red-50 text-red-700' :
                !isPass ? 'bg-amber-50 text-amber-700' :
                'bg-emerald-50 text-emerald-700',
              )}>
                <span className="shrink-0 mt-0.5">
                  {isFail ? <XCircle size={11} /> : !isPass ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{e.key}</span>
                  {e.evidence && <span className="ml-1 text-gray-500">— {e.evidence}</span>}
                </div>
                <span className={cn(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0',
                  isFail ? 'bg-red-100 text-red-700' : !isPass ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700',
                )}>{e.result}</span>
              </div>
            );
          })}
          {entries.length === 0 && tampering.length === 0 && (
            <p className="text-xs text-gray-400 px-2">No authenticity signals captured.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Profile Comparison Panel ─────────────────────────────────────────────────
function ProfileComparisonPanel({ items }: { items: any[] }) {
  const [open, setOpen] = useState(true);
  if (!items || items.length === 0) return null;

  const hasFail = items.some(i => i.result === 'FAIL');
  const hasWarn = items.some(i => i.result === 'WARNING');

  return (
    <div className={cn(
      'layer-card overflow-hidden border',
      hasFail ? 'border-red-200 bg-red-50/20' :
      hasWarn ? 'border-amber-200 bg-amber-50/10' :
      'border-blue-200 bg-blue-50/20',
    )}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className={cn(
          'text-xs font-semibold flex items-center gap-1.5',
          hasFail ? 'text-red-700' : hasWarn ? 'text-amber-700' : 'text-blue-700',
        )}>
          <Shield size={13} />
          Profile Comparison
          <span className="ml-1 px-1.5 py-0.5 rounded bg-white/60 text-[10px]">
            {items.length} field{items.length !== 1 ? 's' : ''}
          </span>
        </span>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-3">
          <div className="space-y-1.5">
            {items.map((item: any, i: number) => {
              const result: string = item.result || 'NOT_APPLICABLE';
              const isPass = result === 'PASS';
              const isFail = result === 'FAIL';
              const isNA = result === 'NOT_APPLICABLE';
              return (
                <div key={i} className={cn(
                  'grid grid-cols-[120px_1fr_1fr_60px] gap-2 items-start text-xs px-2.5 py-2 rounded',
                  isFail ? 'bg-red-50' : isPass ? 'bg-emerald-50' : isNA ? 'bg-gray-50' : 'bg-amber-50',
                )}>
                  <span className="text-gray-500 font-medium capitalize truncate">
                    {(item.field || '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-gray-400 truncate">
                    <span className="text-[10px] text-gray-400">Profile: </span>
                    <span className="text-gray-700">{item.profile_value || '—'}</span>
                  </span>
                  <span className="truncate">
                    <span className="text-[10px] text-gray-400">Doc: </span>
                    <span className="text-gray-700">{item.document_value || '—'}</span>
                  </span>
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full text-center',
                    isPass ? 'bg-emerald-100 text-emerald-700' :
                    isFail ? 'bg-red-100 text-red-700' :
                    isNA ? 'bg-gray-100 text-gray-500' :
                    'bg-amber-100 text-amber-700',
                  )}>
                    {isNA ? 'N/A' : result}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Combined PDF Review Panel ────────────────────────────────────────────────
// `optional: true` means the doc is expected / HR will look for it, but its
// absence does NOT count toward the "missing required documents" tally.
const COMBINED_PDF_REQUIRED_DOCS = [
  // Identity: any one of Aadhaar / Passport / Voter ID / Driving License satisfies this
  { type: 'IDENTITY_PROOF', label: 'Identity Proof (Aadhaar / Passport / Voter ID / DL)', group: 'identity' },
  { type: 'PAN', label: 'PAN Card', group: 'identity' },
  { type: 'TENTH_CERTIFICATE', label: '10th Certificate / Marksheet', group: 'education' },
  { type: 'TWELFTH_CERTIFICATE', label: '12th Certificate / Marksheet', group: 'education' },
  { type: 'DEGREE_CERTIFICATE', label: 'Degree / Graduation Certificate', group: 'education' },
  { type: 'RESIDENCE_PROOF', label: 'Residence Proof', group: 'other' },
  // Bank statement is strongly recommended for salary disbursement but not hard-blocked by the backend
  { type: 'BANK_STATEMENT', label: 'Bank Statement / Cancelled Cheque', group: 'other', optional: true },
  { type: 'PHOTO', label: 'Passport Size Photograph', group: 'other' },
  { type: 'EXPERIENCE_LETTER', label: 'Experience / Employment Proof', group: 'employment' },
];

// Alias table: which detected types satisfy each required doc type.
// Must mirror the backend DOC_TYPE_ALIASES and Python REQUIRED_DOC_ALIASES.
const FRONTEND_DOC_ALIASES: Record<string, string[]> = {
  // Any government-issued identity document satisfies the identity proof requirement.
  IDENTITY_PROOF: ['AADHAAR', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE'],
  RESIDENCE_PROOF: ['UTILITY_BILL', 'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'VOTER_ID', 'DRIVING_LICENSE', 'RENT_AGREEMENT'],
  BANK_STATEMENT: ['BANK_STATEMENT', 'CANCELLED_CHEQUE'],
  EXPERIENCE_LETTER: ['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC', 'OFFER_LETTER', 'SALARY_SLIP'],
  DEGREE_CERTIFICATE: ['DEGREE_CERTIFICATE', 'CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'],
  PHOTO: ['PHOTO', 'PROFILE_PHOTO'],
};

function isDocDetected(docType: string, detectedTypes: string[]): boolean {
  const aliases = FRONTEND_DOC_ALIASES[docType] || [docType];
  return aliases.some(a => detectedTypes.includes(a));
}

function getDetectedAlias(docType: string, detectedTypes: string[]): string | null {
  const aliases = FRONTEND_DOC_ALIASES[docType] || [docType];
  return aliases.find(a => detectedTypes.includes(a)) ?? null;
}

// Per-page validation accordion item
function PageValidationRow({ pv }: { pv: any }) {
  const [open, setOpen] = useState(false);
  const reasons: any[] = pv.reasons || [];
  const hasFail = reasons.some((r: any) => { const s = typeof r === 'string' ? r : (r?.message ?? ''); return s.startsWith('✗') || s.startsWith('🚩'); });
  const hasWarn = reasons.some((r: any) => { const s = typeof r === 'string' ? r : (r?.message ?? ''); return s.startsWith('⚠'); });
  const isWrong = pv.is_wrong_upload;

  const rowColor = isWrong || hasFail
    ? 'border-red-200 bg-red-50/40'
    : hasWarn
    ? 'border-amber-200 bg-amber-50/20'
    : 'border-emerald-200 bg-emerald-50/20';

  const labelColor = isWrong || hasFail ? 'text-red-700' : hasWarn ? 'text-amber-700' : 'text-emerald-700';

  return (
    <div className={cn('rounded-lg border overflow-hidden', rowColor)}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded', labelColor, 'bg-white/60')}>
            Pg {pv.page}
          </span>
          {isWrong ? (
            <span className="text-[10px] font-semibold text-red-700 flex items-center gap-1">
              <AlertTriangle size={10} /> WRONG DOCUMENT ({pv.wrong_upload_category?.replace(/_/g, ' ')})
            </span>
          ) : (
            <span className={cn('text-[10px] font-medium truncate', labelColor)}>
              {(pv.detected_type || 'UNKNOWN').replace(/_/g, ' ')} — {Math.round((pv.confidence || 0) * 100)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-gray-400">{reasons.length} check{reasons.length !== 1 ? 's' : ''}</span>
          {open ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
        </div>
      </button>
      {open && reasons.length > 0 && (
        <div className="px-3 pb-2 space-y-0.5">
          {reasons.map((r: any, i: number) => {
            const rs = typeof r === 'string' ? r : (r?.message ?? JSON.stringify(r));
            const isSep = rs.startsWith('──');
            if (isSep) return <p key={i} className="text-[10px] text-gray-400 pt-1 pb-0.5 border-t border-gray-100 mt-1">{rs}</p>;
            const isFl = rs.startsWith('✗') || rs.startsWith('🚩');
            const isWn = rs.startsWith('⚠');
            const isPa = rs.startsWith('✓');
            return (
              <div key={i} className={cn(
                'flex items-start gap-1.5 text-[10px] px-2 py-1 rounded',
                isFl ? 'bg-red-50 text-red-700' :
                isWn ? 'bg-amber-50 text-amber-700' :
                isPa ? 'bg-emerald-50 text-emerald-700' :
                'bg-gray-50 text-gray-600',
              )}>
                <span className="shrink-0 mt-0.5">
                  {isFl ? <XCircle size={9} /> : isWn ? <AlertTriangle size={9} /> : isPa ? <CheckCircle2 size={9} /> : <Info size={9} />}
                </span>
                <span className="leading-relaxed">{rs}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CombinedPdfReviewPanel({
  documentId, documentStatus, employeeId, fileUrl, ocr,
  onVerifyDoc, onRetrigger, triggering, verifyingDoc,
}: {
  documentId: string;
  documentStatus?: string;
  employeeId?: string;
  fileUrl?: string;
  ocr: any;
  onVerifyDoc: () => void;
  onRetrigger: () => void;
  triggering: boolean;
  verifyingDoc: boolean;
}) {
  const [showInlinePreview, setShowInlinePreview] = useState(false);
  const { data: hrReviewRes } = useGetKycHrReviewQuery(employeeId!, { skip: !employeeId });
  const gate = hrReviewRes?.data?.gate;
  const combinedPdfUploaded: boolean = gate?.combinedPdfUploaded || false;
  const experience: string = gate?.fresherOrExperienced || 'FRESHER';
  const qualification: string = gate?.highestQualification || 'GRADUATION';

  const QUAL_ORDER = ['TENTH', 'TWELFTH', 'GRADUATION', 'POST_GRADUATION', 'PHD'];
  const qualIdx = QUAL_ORDER.indexOf(qualification);
  const relevantDocs = COMBINED_PDF_REQUIRED_DOCS.filter(d => {
    if (d.type === 'TWELFTH_CERTIFICATE' && qualIdx < 1) return false;
    if (d.type === 'DEGREE_CERTIFICATE' && qualIdx < 2) return false;
    if (d.type === 'EXPERIENCE_LETTER' && experience !== 'EXPERIENCED') return false;
    return true;
  });

  const analysis = gate?.combinedPdfAnalysis as any;
  const detectedDocTypes: string[] = analysis?.detectedDocs || analysis?.detected_docs || [];
  const suspicionFlags: string[] = analysis?.suspicionFlags || analysis?.suspicion_flags || [];
  const suspicionScore: number = analysis?.suspicionScore || analysis?.suspicion_score || 0;
  const riskLevel: string = analysis?.riskLevel || analysis?.risk_level || 'LOW';
  const totalPages: number = analysis?.totalPages || analysis?.total_pages || 0;
  // Per-page deep validations (new field from enhanced classify_combined_pdf)
  const pageValidations: any[] = analysis?.pageValidations || analysis?.page_validations || [];
  const wrongUploadPages: number[] = analysis?.wrongUploadPages || analysis?.wrong_upload_pages || [];
  const wrongUploadCount: number = analysis?.wrongUploadCount || analysis?.wrong_upload_count || 0;

  // Only count non-optional docs as "missing required" — optional docs (e.g. bank statement)
  // are shown in the checklist but don't contribute to the missing-docs alert.
  const missingDocs = relevantDocs.filter(d => !(d as any).optional && !isDocDetected(d.type, detectedDocTypes));

  const riskColor = riskLevel === 'HIGH' ? 'text-red-700 bg-red-100'
    : riskLevel === 'MEDIUM' ? 'text-amber-700 bg-amber-100'
    : 'text-emerald-700 bg-emerald-100';

  return (
    <div className="space-y-4">
      {/* Wrong upload critical alert */}
      {wrongUploadCount > 0 && (
        <div className="layer-card p-4 border-2 border-red-400 bg-red-50/60">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700">
                Wrong Documents Detected — {wrongUploadCount} page{wrongUploadCount !== 1 ? 's' : ''} flagged
              </p>
              <p className="text-xs text-red-600 mt-1">
                Page{wrongUploadCount !== 1 ? 's' : ''} {wrongUploadPages.join(', ')} appear to contain
                non-KYC content (social media screenshots, chat logs, payment receipts, or unrelated images).
                Do NOT approve KYC. Request the employee to re-upload correct documents.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Combined PDF banner with risk badge */}
      <div className={cn(
        'layer-card p-4 border',
        riskLevel === 'HIGH' ? 'border-red-200 bg-red-50/30' :
        riskLevel === 'MEDIUM' ? 'border-amber-200 bg-amber-50/20' :
        'border-blue-200 bg-blue-50/40',
      )}>
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            riskLevel === 'HIGH' ? 'bg-red-100' : riskLevel === 'MEDIUM' ? 'bg-amber-100' : 'bg-blue-100',
          )}>
            <FileText size={18} className={
              riskLevel === 'HIGH' ? 'text-red-600' : riskLevel === 'MEDIUM' ? 'text-amber-600' : 'text-blue-600'
            } />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-800">Combined KYC PDF</p>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', riskColor)}>
                Risk: {riskLevel} ({suspicionScore}/100)
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalPages > 0 ? `${totalPages} pages` : 'Pages unknown'} — open document and verify each constituent document.
            </p>
          </div>
        </div>

        {/* Missing documents alert */}
        {missingDocs.length > 0 && (
          <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs font-medium text-red-700 mb-1 flex items-center gap-1">
              <AlertTriangle size={11} /> Missing Documents ({missingDocs.length}):
            </p>
            {missingDocs.map(d => (
              <p key={d.type} className="text-xs text-red-600 ml-3">• {d.label} — not detected</p>
            ))}
          </div>
        )}

        {/* Detected documents summary */}
        {detectedDocTypes.length > 0 && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
            <p className="text-xs font-medium text-emerald-700 mb-1 flex items-center gap-1">
              <CheckCircle2 size={11} /> Detected ({detectedDocTypes.length}):
            </p>
            <div className="flex flex-wrap gap-1 ml-1">
              {detectedDocTypes.map((t: string) => (
                <span key={t} className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                  {t.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Suspicion flags */}
        {suspicionFlags.length > 0 && (
          <div className="mt-3 p-2.5 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-xs font-medium text-orange-700 mb-1 flex items-center gap-1">
              <AlertTriangle size={11} /> Classifier Warnings ({suspicionFlags.length}):
            </p>
            {suspicionFlags.map((f: any, i: number) => (
              <p key={i} className="text-xs text-orange-600 ml-2">• {typeof f === 'string' ? f : (f?.message ?? JSON.stringify(f))}</p>
            ))}
          </div>
        )}
      </div>

      {/* Per-page deep validation results */}
      {pageValidations.length > 0 && (
        <div className="layer-card p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
            <Shield size={12} />
            Per-Page AI Validation ({pageValidations.length} page{pageValidations.length !== 1 ? 's' : ''} analysed)
          </p>
          <div className="space-y-1.5">
            {pageValidations.map((pv: any) => (
              <PageValidationRow key={pv.page} pv={pv} />
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            Click each page to expand AI validation details — Verhoeff, PAN structure, MRZ, EXIF, face detection.
          </p>
        </div>
      )}

      {/* Document preview link */}
      {fileUrl && (
        <div className="layer-card p-4">
          <p className="text-xs font-medium text-gray-500 mb-2">Document Preview</p>
          <button onClick={() => setShowInlinePreview(true)}
            className="text-sm flex items-center gap-1.5 font-medium" style={{ color: 'var(--primary-color)' }}>
            <Eye size={14} /> Open Combined PDF — Verify All Documents Inside
          </button>
        </div>
      )}

      {/* Combined PDF: secure canvas-based viewer (no download, no URL exposed) */}
      {showInlinePreview && fileUrl && (
        <Suspense fallback={null}>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99999 }}>
            <SecureDocumentViewer
              streamUrl={`/documents/${documentId}/stream`}
              title="Combined KYC Document"
              downloadAllowed={false}
              onClose={() => setShowInlinePreview(false)}
            />
          </div>
        </Suspense>
      )}

      {/* Employee KYC profile */}
      <div className="layer-card p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">Employee KYC Profile</p>
        <div className="flex gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
            {experience === 'EXPERIENCED' ? '💼 Experienced' : '🎓 Fresher'}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
            📚 {qualification.replace(/_/g, ' ')}
          </span>
          {combinedPdfUploaded && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={10} /> Combined PDF Uploaded
            </span>
          )}
        </div>
      </div>

      {/* Required document checklist */}
      <div className="layer-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-600">Required Documents Checklist</p>
          <span className="text-xs text-gray-400">
            {relevantDocs.filter(d => isDocDetected(d.type, detectedDocTypes)).length}/
            {relevantDocs.filter(d => !(d as any).optional).length} required detected
          </span>
        </div>
        <div className="space-y-2">
          {relevantDocs.map(doc => {
            const detected = isDocDetected(doc.type, detectedDocTypes);
            const isOptional = (doc as any).optional === true;
            const alias = getDetectedAlias(doc.type, detectedDocTypes);
            const aliasLabel = alias && alias !== doc.type ? alias.replace(/_/g, ' ') : null;
            return (
              <div key={doc.type} className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg border',
                detected
                  ? 'bg-emerald-50 border-emerald-200'
                  : isOptional
                  ? 'bg-gray-50 border-gray-100'
                  : 'bg-red-50 border-red-100',
              )}>
                {detected
                  ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                  : isOptional
                  ? <Info size={15} className="text-gray-400 shrink-0" />
                  : <XCircle size={15} className="text-red-400 shrink-0" />}
                <span className="text-xs text-gray-700 flex-1">{doc.label}</span>
                {isOptional && !detected ? (
                  <span className="text-[10px] font-medium text-gray-400">Recommended</span>
                ) : (
                  <span className={cn('text-[10px] font-medium', detected ? 'text-emerald-600' : 'text-red-500')}>
                    {detected ? (aliasLabel ? `via ${aliasLabel}` : 'Detected') : 'Not found'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Always verify manually before approving KYC — AI detection confirms presence, not authenticity.
        </p>
      </div>

      {/* OCR Notes */}
      {ocr.hrNotes && !ocr.hrNotes.includes('Combined KYC PDF') && (
        <div className="layer-card p-4">
          <p className="text-xs font-semibold text-gray-600 mb-1">OCR Notes</p>
          <p className="text-xs text-gray-500 whitespace-pre-line">{ocr.hrNotes}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-2">
        <button onClick={onRetrigger} disabled={triggering}
          className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
          {triggering ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Re-run AI Classifier
        </button>

        {(documentStatus === 'PENDING' || documentStatus === 'FLAGGED') && (
          <button onClick={onVerifyDoc} disabled={verifyingDoc || wrongUploadCount > 0}
            title={wrongUploadCount > 0 ? 'Cannot verify — wrong documents detected on some pages' : ''}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50">
            {verifyingDoc ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Mark Combined PDF as Verified
          </button>
        )}
        {documentStatus === 'VERIFIED' && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-700">
            <CheckCircle2 size={14} /> Combined PDF Already Verified
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main OCR Verification Panel ──────────────────────────────────────────────
export default function OcrVerificationPanel({
  documentId, documentName, documentType, documentStatus, rejectionReason: initialRejectionReason, employeeId, fileUrl, onClose, onStatusChange,
}: Props) {
  // Poll every 6s until OCR data arrives, then stop
  const [pollInterval, setPollInterval] = useState(6000);
  const { data: ocrRes, isLoading, isError, refetch } = useGetDocumentOcrQuery(documentId, {
    pollingInterval: pollInterval,
  });

  const [panelTab, setPanelTab] = useState<'analysis' | 'history'>('analysis');
  const [triggerOcr, { isLoading: triggering }] = useTriggerDocumentOcrMutation();
  const [reclassifyCombinedPdf, { isLoading: reclassifying }] = useReclassifyCombinedPdfMutation();
  const [updateOcr, { isLoading: saving }] = useUpdateDocumentOcrMutation();
  const [verifyDoc, { isLoading: verifyingDoc }] = useVerifyDocumentMutation();
  const [deepRecheck, { isLoading: deepRechecking }] = useDeepRecheckDocumentMutation();
  const [reprocessDoc, { isLoading: reprocessing }] = useReprocessDocumentMutation();
  const [requestReupload, { isLoading: requestingReupload }] = useRequestReuploadMutation();
  const [hrApprove, { isLoading: hrApproving }] = useHrApproveDocumentMutation();
  const [hrReject] = useHrRejectDocumentMutation();
  const { data: historyRes } = useGetDocumentOcrHistoryQuery(documentId, { skip: panelTab !== 'history' });

  const [editing, setEditing] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [localDocStatus, setLocalDocStatus] = useState(documentStatus || '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [hrNotes, setHrNotes] = useState('');
  const [ocrStatus, setOcrStatus] = useState('PENDING');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingDoc, setRejectingDoc] = useState(false);
  const [showInlinePreview, setShowInlinePreview] = useState(false);
  const [showSecurePdf, setShowSecurePdf] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewBlobLoading, setPreviewBlobLoading] = useState(false);
  const [previewBlobError, setPreviewBlobError] = useState<string | null>(null);
  const [showKycBreakdown, setShowKycBreakdown] = useState(false);
  const token = useAppSelector((state: any) => state.auth.accessToken);

  const { data: hrReviewRes, refetch: refetchHrReview } = useGetKycHrReviewQuery(employeeId!, { skip: !employeeId });
  const kycStatus: string = hrReviewRes?.data?.gate?.kycStatus || '';

  const ocr = ocrRes?.data;

  // Stop polling once OCR data is available
  useEffect(() => {
    if (ocr) setPollInterval(0);
  }, [ocr]);

  // Auto-run classifier when panel opens for a combined KYC PDF with no analysis yet
  useEffect(() => {
    if (!employeeId) return;
    const gate = hrReviewRes?.data?.gate;
    if (!gate) return;
    const isCombined = gate.uploadMode === 'COMBINED' || gate.combinedPdfUploaded;
    const hasAnalysis = gate.combinedPdfAnalysis && Object.keys(gate.combinedPdfAnalysis).length > 0;
    // Auto-trigger once if combined PDF is uploaded but analysis is missing
    if (isCombined && !hasAnalysis && !reclassifying) {
      reclassifyCombinedPdf(employeeId).then((res: any) => {
        const d = res?.data?.data;
        if (d?.pythonTimedOut) {
          toast.error('OCR service timed out — results are limited. Re-run manually or split the PDF.', { duration: 7000 });
        } else if (d?.fallbackUsed) {
          toast('⚠ OCR service offline — basic analysis only. Results may be limited.', { duration: 5000, icon: '⚠' });
        }
        refetchHrReview();
      }).catch(() => {
        toast.error('OCR classification failed — check the AI service status.', { duration: 6000 });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, hrReviewRes?.data?.gate?.combinedPdfUploaded]);

  useEffect(() => {
    if (ocr) {
      const f: Record<string, string> = {};
      getDocFields(documentType).forEach(({ key }) => { f[key] = ocr[key] || ''; });
      setFields(f);
      const existingNotes = ocr.hrNotes || '';
      setHrNotes(existingNotes.startsWith('AI Analysis') ? '' : existingNotes);
      setOcrStatus(ocr.ocrStatus || 'PENDING');
    }
  }, [ocr, documentType]);

  const handleTriggerOcr = async () => {
    try {
      await triggerOcr(documentId).unwrap();
      toast.success('OCR processing triggered');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'OCR failed');
    }
  };

  const handleReprocess = async () => {
    try {
      await reprocessDoc(documentId).unwrap();
      toast.success('Full OCR pipeline re-triggered — results will update shortly');
      setPollInterval(4000);
      setTimeout(() => { setPollInterval(0); refetch(); }, 30_000);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Reprocess failed');
    }
  };

  const handleReclassify = async () => {
    if (!employeeId) return;
    try {
      const result = await reclassifyCombinedPdf(employeeId).unwrap();
      const detected: string[] = result?.data?.detectedDocs ?? [];
      const pythonTimedOut: boolean = result?.data?.pythonTimedOut ?? false;
      const fallbackUsed: boolean = result?.data?.fallbackUsed ?? false;
      const crashReason: string | null = result?.data?.pythonCrashReason ?? null;

      if (pythonTimedOut) {
        toast.error(
          'OCR service timed out processing this PDF — results shown are from the Node.js fallback (limited accuracy). Try again or split the PDF into smaller files.',
          { duration: 8000 }
        );
      } else if (fallbackUsed && crashReason) {
        toast(
          `⚠ OCR service unavailable (${crashReason}) — results are from Node.js fallback (limited accuracy).`,
          { duration: 6000, icon: '⚠' }
        );
      } else if (fallbackUsed) {
        toast('⚠ OCR service offline — results shown are from Node.js fallback (limited accuracy).', { duration: 5000, icon: '⚠' });
      } else if (detected.length > 0) {
        toast.success(`Re-classification complete — ${detected.length} document type(s) detected`);
      } else {
        toast.success('Re-classification complete — results updated');
      }
      refetchHrReview();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Re-classification failed');
    }
  };

  const handleSave = async () => {
    try {
      await updateOcr({ documentId, body: { ...fields, hrNotes, ocrStatus } }).unwrap();
      toast.success('OCR data saved');
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    }
  };

  const handleSaveField = async (fieldKey: string, value: string) => {
    try {
      await updateOcr({ documentId, body: { [fieldKey]: value } }).unwrap();
      toast.success('Field updated');
      setEditingField(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save field');
    }
  };

  const handleRejectDocument = async (reason: string) => {
    setRejectingDoc(true);
    try {
      await verifyDoc({ id: documentId, status: 'REJECTED', rejectionReason: reason } as any).unwrap();
      setLocalDocStatus('REJECTED');
      refetchHrReview();
      onStatusChange?.();
      toast.success('Document rejected — employee notified to re-upload');
      setShowRejectDialog(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to reject document');
    } finally {
      setRejectingDoc(false);
    }
  };

  // Validation reasons from Python AI (stored in llmExtractedData)
  const aiData = ocr?.llmExtractedData as any;
  const validationReasons: string[] = aiData?.validation_reasons || [];
  const kycScore: number | null = (ocr as any)?.kycScore ?? null;
  // profile_comparison may be in llmExtractedData OR in the separate profileComparison column
  const profileComparison: any[] = aiData?.profile_comparison?.length > 0
    ? aiData.profile_comparison
    : ((ocr as any)?.profileComparison as any[] | null) ?? [];
  const authenticityChecks: Record<string, any> | null = aiData?.authenticity_checks || null;
  const tamperingSignals: string[] = aiData?.tampering_signals || [];
  const deepRecheckAvailable: boolean = aiData?.deepRecheckAvailable === true;
  const modelUsed: string = aiData?.modelUsed || '';
  const processingMode: string = ocr?.processingMode || '';
  const confidence = ocr?.confidence || 0;

  // KYC score breakdown components (approximated from available data)
  const kycExtraction = kycScore !== null ? Math.round(confidence * 100 * 0.30) : 0;
  const kycProfilePasses = profileComparison.filter((p: any) => p.result === 'PASS').length;
  const kycProfileTotal = profileComparison.filter((p: any) => p.result !== 'NOT_APPLICABLE').length;
  const kycProfile = kycProfileTotal > 0 ? Math.round((kycProfilePasses / kycProfileTotal) * 25) : 25;
  const kycCrossDoc = ocr?.crossValidationStatus === 'PASS' ? 20 : ocr?.crossValidationStatus === 'PARTIAL' ? 10 : ocr?.crossValidationStatus === 'FAIL' ? 0 : 20;
  const kycQuality = (ocr?.resolutionQuality === 'HIGH' ? 100 : ocr?.resolutionQuality === 'MEDIUM' ? 70 : 40) * 0.10;
  const kycAuth = kycScore !== null ? Math.max(0, (kycScore ?? 0) - kycExtraction - kycProfile - kycCrossDoc - kycQuality) : 0;

  const isCombinedPdf =
    ocr?.detectedType === 'COMBINED_PDF' ||
    (documentType === 'OTHER' && (
      documentName?.toLowerCase().includes('combined') ||
      documentName?.toLowerCase().includes('kyc')
    ));

  const isFlaggedByScore = confidence > 0 && confidence < 0.60;

  // Stale findings detection: warn HR when OCR is >30 days old or from node_fallback
  const ocrUpdatedAt = (ocr as any)?.updatedAt ? new Date((ocr as any).updatedAt) : null;
  const daysOld = ocrUpdatedAt ? Math.floor((Date.now() - ocrUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const isStale = daysOld !== null && daysOld > 30;
  const isNodeFallback = processingMode === 'node_fallback';
  const showStaleBanner = (isStale || isNodeFallback) && !isCombinedPdf;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      {/* Centered popup */}
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white shadow-2xl overflow-y-auto rounded-2xl animate-in zoom-in-95 duration-200 flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <ScanLine size={20} style={{ color: 'var(--primary-color)' }} />
            <div>
              <h2 className="text-lg font-display font-bold text-gray-900">OCR Verification</h2>
              <p className="text-xs text-gray-400">{documentName} — {documentType?.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors text-lg font-bold">&times;</button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-gray-100 bg-white sticky top-[73px] z-10">
          {(['analysis', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setPanelTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors capitalize ${
                panelTab === tab
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'history' ? <History size={13} /> : <ScanLine size={13} />}
              {tab === 'analysis' ? 'Analysis' : 'Scan History'}
            </button>
          ))}
        </div>

        {/* History tab content */}
        {panelTab === 'history' && (
          <div className="p-6">
            {!historyRes?.data?.length ? (
              <div className="text-center py-12 text-slate-400">
                <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No scan history yet</p>
                <p className="text-xs mt-1">History is captured on each re-scan after the first.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(historyRes.data as any[]).map((snap: any, i: number) => (
                  <div key={snap.id ?? i} className="layer-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-500">
                        {new Date(snap.snapshotAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      <div className="flex items-center gap-2">
                        {snap.triggerReason && (
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{snap.triggerReason}</span>
                        )}
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${snap.ocrStatus === 'VERIFIED' ? 'bg-green-100 text-green-700' : snap.ocrStatus === 'FLAGGED' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                          {snap.ocrStatus || '—'}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <p className="text-slate-400 mb-0.5">KYC Score</p>
                        <p className="font-bold font-mono text-slate-800">{snap.kycScore != null ? Math.round(snap.kycScore) : '—'}<span className="font-normal text-slate-400">/100</span></p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-0.5">Confidence</p>
                        <p className="font-bold font-mono text-slate-800">{snap.confidence != null ? `${Math.round(snap.confidence * 100)}%` : '—'}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-0.5">Mode</p>
                        <p className="font-mono text-slate-600">{snap.processingMode?.replace(/_/g, ' ') || '—'}</p>
                      </div>
                    </div>
                    {snap.extractedName && (
                      <p className="text-xs text-slate-500 mt-2">
                        <span className="font-medium">Name:</span> {snap.extractedName}
                        {snap.extractedDob && <span className="ml-3"><span className="font-medium">DOB:</span> {snap.extractedDob}</span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="p-6 space-y-5 overflow-y-auto flex-1" style={{ display: panelTab === 'analysis' ? undefined : 'none' }}>
          {/* Document Preview */}
          {fileUrl && (
            <div className="layer-card p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Document Preview</p>
              <button
                onClick={() => {
                  const ext = (fileUrl || '').split('.').pop()?.toLowerCase() || '';
                  if (ext === 'pdf') {
                    setShowSecurePdf(true);
                  } else {
                    // Fetch blob so the real /uploads/ path is never in the DOM
                    setPreviewBlobUrl(null);
                    setPreviewBlobError(null);
                    setPreviewBlobLoading(true);
                    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');
                    fetch(`${apiBase}/api/documents/${documentId}/stream`, {
                      headers: { Authorization: `Bearer ${token}` },
                    })
                      .then(r => {
                        if (!r.ok) {
                          setPreviewBlobError(r.status === 404
                            ? 'File not found on server — it may have been re-uploaded. Close and reopen the document.'
                            : 'Failed to load document. Please try again.');
                          throw new Error();
                        }
                        return r.blob();
                      })
                      .then(blob => setPreviewBlobUrl(URL.createObjectURL(blob)))
                      .catch(() => {})
                      .finally(() => { setPreviewBlobLoading(false); setShowInlinePreview(true); });
                    setShowInlinePreview(true);
                  }
                }}
                className="text-sm flex items-center gap-1.5 font-medium" style={{ color: 'var(--primary-color)' }}>
                <Eye size={14} /> View Original Document
              </button>
            </div>
          )}

          {/* PDF: secure canvas-based viewer rendered outside the panel — appears above z-[9999] panel */}
          {showSecurePdf && fileUrl && (
            <Suspense fallback={null}>
              <div style={{ position: 'fixed', inset: 0, zIndex: 99999 }}>
                <SecureDocumentViewer
                  streamUrl={`/documents/${documentId}/stream`}
                  title={documentName}
                  downloadAllowed={false}
                  onClose={() => setShowSecurePdf(false)}
                />
              </div>
            </Suspense>
          )}

          {/* Image / Office: authenticated blob URL preview — real /uploads/ path never in DOM */}
          {showInlinePreview && fileUrl && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={() => setShowInlinePreview(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-[92vw] h-[88vh] max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">{documentName}</p>
                  <button onClick={() => setShowInlinePreview(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-lg font-bold">&times;</button>
                </div>
                <div className="flex-1 overflow-hidden select-none" onContextMenu={e => e.preventDefault()}>
                  {previewBlobLoading && (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 size={32} className="animate-spin text-indigo-400" />
                    </div>
                  )}
                  {!previewBlobLoading && previewBlobUrl && (() => {
                    const urlLower = (fileUrl || '').toLowerCase();
                    if (/\.(doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf)$/.test(urlLower)) {
                      // Office docs need a public URL for Google Docs Viewer
                      const absoluteUrl = getUploadUrl(fileUrl).startsWith('http')
                        ? getUploadUrl(fileUrl)
                        : `${window.location.protocol}//${window.location.host}${getUploadUrl(fileUrl)}`;
                      return (
                        <iframe
                          src={`https://docs.google.com/gview?url=${encodeURIComponent(absoluteUrl)}&embedded=true`}
                          title={documentName}
                          className="w-full h-full border-0"
                        />
                      );
                    }
                    // Images: blob URL — pointer-events blocked, context menu blocked, no path visible
                    return (
                      <div className="relative w-full h-full">
                        <img
                          src={previewBlobUrl}
                          alt={documentName}
                          className="w-full h-full object-contain p-4"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                          draggable={false}
                        />
                        <div className="absolute inset-0" onContextMenu={e => e.preventDefault()} />
                      </div>
                    );
                  })()}
                  {!previewBlobLoading && !previewBlobUrl && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-gray-500">
                      <AlertTriangle size={20} className="text-amber-500" />
                      {previewBlobError || 'Failed to load document.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* No OCR data yet */}
          {isError && !triggering && (
            <div className="layer-card p-6 text-center">
              <ScanLine size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500 mb-4">No OCR data available for this document</p>
              <button onClick={handleTriggerOcr} disabled={triggering}
                className="btn-primary text-sm flex items-center gap-2 mx-auto">
                {triggering ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                {triggering ? 'Processing...' : 'Run OCR Scan'}
              </button>
            </div>
          )}

          {/* Loading: initial fetch */}
          {isLoading && !ocr && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-gray-400 mr-2" />
              <span className="text-sm text-gray-400">Loading OCR data...</span>
            </div>
          )}

          {/* Loading: OCR currently running */}
          {triggering && (
            <div className="layer-card flex flex-col items-center justify-center py-14 gap-3 bg-indigo-50/40 border border-indigo-100">
              <div className="relative">
                <ScanLine size={32} style={{ color: 'var(--primary-color)', opacity: 0.5 }} />
                <Loader2 size={18} className="animate-spin absolute -bottom-1 -right-1" style={{ color: 'var(--primary-color)' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--primary-color)' }}>Extracting details...</p>
              <p className="text-xs" style={{ color: 'var(--primary-color)', opacity: 0.7 }}>Scanning document with AI OCR. This may take 10–30 seconds.</p>
            </div>
          )}

          {ocr && !triggering && (
            <>
              {/* ── COMBINED PDF ── */}
              {isCombinedPdf && ocr.processingMode === 'node_fallback' && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Python OCR Was Offline</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      This document was analysed using the Node.js text fallback because the Python OCR service was unavailable.
                      Results may be inaccurate for scanned/image-based PDFs. Once the service is restored, click <strong>Re-run AI Classifier</strong> for accurate results.
                    </p>
                  </div>
                </div>
              )}
              {isCombinedPdf ? (
                <CombinedPdfReviewPanel
                  documentId={documentId}
                  documentStatus={localDocStatus}
                  employeeId={employeeId}
                  fileUrl={fileUrl}
                  ocr={ocr}
                  onVerifyDoc={async () => {
                    try {
                      await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                      setLocalDocStatus('VERIFIED');
                      onStatusChange?.();
                      toast.success('Combined PDF verified!');
                    } catch { toast.error('Failed to verify'); }
                  }}
                  onRetrigger={employeeId ? handleReclassify : handleTriggerOcr}
                  triggering={employeeId ? reclassifying : triggering}
                  verifyingDoc={verifyingDoc}
                />
              ) : (
              <>
              {/* ── Compact status row ── */}
              <div className="flex flex-wrap items-center gap-2 px-1">
                {/* Document status */}
                <span className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold',
                  ocr.ocrStatus === 'FLAGGED' || isFlaggedByScore ? 'bg-red-100 text-red-700' :
                  ocr.ocrStatus === 'REVIEWED' ? 'bg-emerald-100 text-emerald-700' :
                  'bg-amber-100 text-amber-700'
                )}>
                  {ocr.ocrStatus === 'FLAGGED' || isFlaggedByScore ? <XCircle size={11} /> :
                   ocr.ocrStatus === 'REVIEWED' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                  {ocr.ocrStatus === 'FLAGGED' || isFlaggedByScore ? 'Flagged' :
                   ocr.ocrStatus === 'REVIEWED' ? 'Reviewed OK' : 'Needs Review'}
                </span>
                {/* Confidence */}
                <span className="text-xs text-gray-500">{Math.round(confidence * 100)}% confidence</span>
                {/* Quality */}
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded bg-gray-100',
                  ocr.resolutionQuality === 'HIGH' ? 'text-emerald-700 bg-emerald-50' :
                  ocr.resolutionQuality === 'MEDIUM' ? 'text-amber-700 bg-amber-50' :
                  'text-red-700 bg-red-50'
                )}>
                  {ocr.resolutionQuality || 'Unknown'} Quality
                </span>
                {/* KYC Score — clickable to show breakdown */}
                {kycScore !== null && (
                  <button
                    onClick={() => setShowKycBreakdown(v => !v)}
                    className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer',
                      kycScore >= 85 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' :
                      kycScore >= 70 ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' :
                      'bg-red-100 text-red-700 hover:bg-red-200'
                    )}
                    title="Click to see score breakdown"
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full', kycScore >= 85 ? 'bg-emerald-500' : kycScore >= 70 ? 'bg-amber-500' : 'bg-red-500')} />
                    KYC {kycScore}
                    <Info size={9} className="opacity-60" />
                  </button>
                )}
                {/* Cross-validation badge in status row */}
                {ocr.crossValidationStatus && (
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium',
                    ocr.crossValidationStatus === 'PASS' ? 'bg-emerald-50 text-emerald-700' :
                    ocr.crossValidationStatus === 'FAIL' ? 'bg-red-50 text-red-700' :
                    'bg-amber-50 text-amber-700'
                  )}>
                    {ocr.crossValidationStatus === 'PASS' ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
                    Cross-Doc: {ocr.crossValidationStatus}
                  </span>
                )}
                {/* Screenshot or tampering warning pills */}
                {ocr.isScreenshot && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
                    <XCircle size={11} /> Screenshot Detected
                  </span>
                )}
                {(ocr.tamperingIndicators as any[])?.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    <AlertTriangle size={11} /> Tampering Detected
                  </span>
                )}
                {/* Processing mode indicator */}
                {modelUsed === 'gpt-4.1' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-purple-50 text-purple-600">
                    <Zap size={9} /> Deep Scan (gpt-4.1)
                  </span>
                ) : modelUsed === 'gpt-4.1-mini' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600">
                    <Zap size={9} /> Vision AI
                  </span>
                ) : processingMode === 'node_fallback' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-orange-50 text-orange-600">
                    <AlertTriangle size={9} /> Node.js Fallback
                  </span>
                ) : null}
              </div>

              {/* KYC Score breakdown (expandable) */}
              {kycScore !== null && showKycBreakdown && (
                <div className="layer-card p-3 text-xs">
                  <p className="font-semibold text-gray-600 mb-2">KYC Score Breakdown — {kycScore}/100</p>
                  <div className="space-y-1.5">
                    {[
                      { label: 'Extraction Confidence (30%)', value: kycExtraction, max: 30 },
                      { label: 'Profile Match (25%)', value: kycProfile, max: 25 },
                      { label: 'Cross-Document (20%)', value: kycCrossDoc, max: 20 },
                      { label: 'Authenticity (15%)', value: Math.round(kycAuth), max: 15 },
                      { label: 'Image Quality (10%)', value: Math.round(kycQuality), max: 10 },
                    ].map(({ label, value, max }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-gray-500 w-48 shrink-0">{label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                          <div
                            className={cn('h-1.5 rounded-full', value >= max * 0.8 ? 'bg-emerald-400' : value >= max * 0.5 ? 'bg-amber-400' : 'bg-red-400')}
                            style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-700 font-mono w-10 text-right">{value}/{max}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Stale findings banner ── */}
              {showStaleBanner && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-800">
                      {isNodeFallback ? 'Limited Accuracy — Node.js Fallback' : `OCR findings are ${daysOld} days old`}
                    </p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {isNodeFallback
                        ? 'Python OCR was offline when this document was scanned. Vision AI was skipped. Re-run the full pipeline for accurate extraction and AI verification.'
                        : 'These findings may not reflect the current OCR pipeline capabilities. Re-run for up-to-date analysis.'}
                    </p>
                  </div>
                  <button
                    onClick={handleReprocess}
                    disabled={reprocessing}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-colors"
                  >
                    {reprocessing ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    Re-run Now
                  </button>
                </div>
              )}

              {/* ── Extracted OCR Fields — per-field edit with confidence badges ── */}
              {(() => {
                const docFields = getDocFields(documentType);
                const hasAnyField = docFields.some(({ key }) => fields[key]);
                if (!hasAnyField) return null;
                const isHrEdited = !!(ocr as any)?.hrReviewedAt;
                return (
                  <div className="layer-card p-4">
                    <p className="text-xs font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                      <ScanLine size={12} />
                      Extracted Fields
                      {isHrEdited && (
                        <span className="ml-auto text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">Edited by HR</span>
                      )}
                    </p>
                    <div className="space-y-1.5">
                      {docFields.map(({ key, label }) => {
                        const rawValue = fields[key] || '';
                        if (!rawValue) return null;
                        const displayValue = renderFieldValue(documentType, key as FieldKey, rawValue);
                        const conf = getFieldConfidence(key as FieldKey, documentType, aiData);
                        const isLowConf = conf != null && conf < 0.70;
                        const isEditing = editingField === key;

                        return (
                          <div
                            key={key}
                            className={cn(
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs',
                              isLowConf ? 'bg-amber-50/60' : 'bg-gray-50/60',
                            )}
                          >
                            <span className="text-gray-500 shrink-0 w-28">{label}:</span>
                            {isEditing ? (
                              <>
                                <input
                                  className="input-glass flex-1 text-xs py-0.5 h-7"
                                  value={fields[key]}
                                  onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
                                  autoFocus
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveField(key, fields[key]);
                                    if (e.key === 'Escape') setEditingField(null);
                                  }}
                                />
                                <button
                                  onClick={() => handleSaveField(key, fields[key])}
                                  disabled={saving}
                                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0"
                                >
                                  {saving ? <Loader2 size={9} className="animate-spin" /> : <Save size={9} />}
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingField(null);
                                    setFields(f => ({ ...f, [key]: ocr[key] || '' }));
                                  }}
                                  className="text-[10px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 shrink-0"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="flex-1 font-medium text-gray-800 font-mono text-xs">{displayValue}</span>
                                <FieldConfidenceBadge confidence={conf} />
                                <button
                                  onClick={() => setEditingField(key)}
                                  className="ml-1 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
                                  title={`Edit ${label}`}
                                >
                                  <Pencil size={10} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── AI Findings Summary — always visible, all checks with icons ── */}
              <DocFindingsSummary
                reasons={validationReasons}
                tamperingSignals={tamperingSignals}
                kycScore={kycScore}
              />

              {/* ── Profile Cross-Verification ── */}
              {profileComparison.length > 0 && (
                <ProfileComparisonPanel items={profileComparison} />
              )}

              {/* ── Face Match Result (PHOTO / AADHAAR only) ── */}
              {(() => {
                const faceMatch = (ocr as any)?.faceMatchResult as { match: boolean; confidence: number; reason: string } | null;
                if (!faceMatch || faceMatch.confidence === 0) return null;
                const isPending = !faceMatch.match && faceMatch.confidence === 0;
                const isMatch = faceMatch.match;
                const isMismatch = !faceMatch.match && faceMatch.confidence > 0;
                return (
                  <div className={`p-4 rounded-xl border ${isMatch ? 'bg-green-50 border-green-200' : isMismatch && faceMatch.confidence >= 0.7 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {isMatch ? <UserCheck className="w-4 h-4 text-green-600" /> : isMismatch && faceMatch.confidence >= 0.7 ? <UserX className="w-4 h-4 text-red-600" /> : <UserX className="w-4 h-4 text-amber-600" />}
                      <span className={`text-sm font-semibold ${isMatch ? 'text-green-800' : isMismatch && faceMatch.confidence >= 0.7 ? 'text-red-800' : 'text-amber-800'}`}>
                        Face Comparison: {isMatch ? 'MATCH' : isMismatch && faceMatch.confidence >= 0.7 ? 'MISMATCH — FRAUD RISK' : 'LOW CONFIDENCE'}
                      </span>
                      <span className="ml-auto text-xs font-mono font-bold">{Math.round(faceMatch.confidence * 100)}%</span>
                    </div>
                    <p className={`text-xs ${isMatch ? 'text-green-700' : isMismatch && faceMatch.confidence >= 0.7 ? 'text-red-700' : 'text-amber-700'}`}>{faceMatch.reason}</p>
                    {isMismatch && faceMatch.confidence >= 0.7 && (
                      <p className="text-xs font-semibold text-red-800 mt-2">
                        The passport photo and Aadhaar card appear to show different people. Verify identity in person before approving.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Per-document actions */}
              <div className="space-y-2">
                {/* Status badge */}
                {localDocStatus === 'VERIFIED' && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-700">
                    <CheckCircle2 size={14} /> Document Approved
                  </div>
                )}
                {localDocStatus === 'REJECTED' && !showRejectDialog && (
                  <div className="flex flex-col gap-1.5 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200">
                    <div className="flex items-center gap-2 text-sm font-medium text-red-700">
                      <XCircle size={14} /> Document Rejected — Awaiting Re-upload
                    </div>
                    {initialRejectionReason && (
                      <p className="text-xs text-red-600 ml-5 italic">Reason: {initialRejectionReason}</p>
                    )}
                  </div>
                )}

                {/* Approve button: initial (PENDING/FLAGGED) or re-approve toggle (REJECTED) */}
                {(localDocStatus === 'PENDING' || localDocStatus === 'FLAGGED' || localDocStatus === 'REJECTED') && !showRejectDialog && (
                  <button onClick={async () => {
                    try {
                      await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                      setLocalDocStatus('VERIFIED');
                      onStatusChange?.();
                      toast.success('Document approved!');
                    } catch { toast.error('Failed to approve document'); }
                  }} disabled={verifyingDoc}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                    {verifyingDoc ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {localDocStatus === 'REJECTED' ? 'Re-approve This Document' : 'Approve This Document'}
                  </button>
                )}

                {/* Deep Recheck — available for images AND PDFs, hidden once already run with gpt-4.1 */}
                {deepRecheckAvailable && modelUsed !== 'gpt-4.1' && !showRejectDialog && (
                  <button
                    onClick={async () => {
                      try {
                        await deepRecheck(documentId).unwrap();
                        toast.success('Deep analysis complete — results updated');
                        refetch();
                      } catch (err: any) {
                        toast.error(err?.data?.error?.message || 'Deep analysis failed');
                      }
                    }}
                    disabled={deepRechecking}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors disabled:opacity-50"
                  >
                    {deepRechecking ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                    Deep Analysis (gpt-4.1) — Higher Accuracy
                  </button>
                )}

                {/* Per-document re-upload request — HR can target just this doc */}
                {employeeId && localDocStatus !== 'VERIFIED' && !showRejectDialog && (
                  <button
                    onClick={async () => {
                      try {
                        await requestReupload({
                          employeeId,
                          docTypes: [documentType],
                          reasons: { [documentType]: 'HR requested re-upload from document review' },
                        } as any).unwrap();
                        toast.success(`Re-upload requested for ${documentType.replace(/_/g, ' ')}`);
                        onStatusChange?.();
                      } catch (err: any) {
                        toast.error(err?.data?.error?.message || 'Failed to request re-upload');
                      }
                    }}
                    disabled={requestingReupload}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50 transition-colors disabled:opacity-50"
                  >
                    {requestingReupload ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Request Re-upload for This Document
                  </button>
                )}

                {/* Re-run Full OCR Pipeline — available for all document types */}
                {!showRejectDialog && (
                  <button
                    onClick={handleReprocess}
                    disabled={reprocessing}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {reprocessing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Re-run Full OCR Pipeline
                  </button>
                )}

                {/* Reject button: visible for PENDING/FLAGGED and VERIFIED (undo toggle), hidden when already REJECTED */}
                {!showRejectDialog && localDocStatus !== 'REJECTED' && (
                  <button onClick={() => setShowRejectDialog(true)}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                    <Ban size={14} />
                    {localDocStatus === 'VERIFIED' ? 'Undo Approval — Reject Document' : 'Reject Document & Request Re-upload'}
                  </button>
                )}

                {/* Reject dialog inline */}
                {showRejectDialog && (
                  <RejectDocumentDialog
                    docType={documentType}
                    onConfirm={handleRejectDocument}
                    onCancel={() => setShowRejectDialog(false)}
                    loading={rejectingDoc}
                  />
                )}
              </div>

              {/* HR reviewed info */}
              {ocr.hrReviewedBy && ocr.hrReviewedAt && (
                <p className="text-xs text-gray-400 text-center">
                  Last reviewed on {new Date(ocr.hrReviewedAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>
              )}
            </>
            )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
