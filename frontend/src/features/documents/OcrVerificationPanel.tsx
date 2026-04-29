import { useState, useEffect } from 'react';
import {
  Shield, Save, Loader2, RotateCcw, AlertTriangle, CheckCircle2, XCircle,
  ScanLine, Eye, Check, FileText, Ban, Info, ChevronDown, ChevronUp, Zap,
} from 'lucide-react';
import { useGetDocumentOcrQuery, useTriggerDocumentOcrMutation, useUpdateDocumentOcrMutation, useDeepRecheckDocumentMutation } from './documentOcrApi';
import { useVerifyDocumentMutation } from './documentApi';
import { useGetKycHrReviewQuery, useReclassifyCombinedPdfMutation } from '../kyc/kycApi';
import toast from 'react-hot-toast';
import { cn, getUploadUrl } from '../../lib/utils';

interface Props {
  documentId: string;
  documentName: string;
  documentType: string;
  documentStatus?: string;
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
  return (
    <div className="layer-card p-4 border border-red-200 bg-red-50/40">
      <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
        <Ban size={14} /> Reject Document
      </p>
      <p className="text-xs text-red-600 mb-3">
        This will mark <strong>{docType.replace(/_/g, ' ')}</strong> as rejected and notify the employee to re-upload.
      </p>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Enter reason for rejection (shown to employee)..."
        className="input-glass text-sm w-full h-20 resize-none mb-3"
        autoFocus
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
  documentStatus, employeeId, fileUrl, ocr,
  onVerifyDoc, onRetrigger, triggering, verifyingDoc,
}: {
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
            className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1.5 font-medium">
            <Eye size={14} /> Open Combined PDF — Verify All Documents Inside
          </button>
        </div>
      )}

      {/* Inline secure document preview */}
      {showInlinePreview && fileUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowInlinePreview(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[92vw] h-[88vh] max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-800">Combined KYC Document</p>
              <button onClick={() => setShowInlinePreview(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-lg font-bold">&times;</button>
            </div>
            <div className="flex-1 overflow-hidden select-none" onContextMenu={e => e.preventDefault()}>
              <iframe
                src={`${getUploadUrl(fileUrl)}#toolbar=0&navpanes=0&scrollbar=0`}
                title="Combined KYC Document"
                className="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts"
              />
            </div>
          </div>
        </div>
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
  documentId, documentName, documentType, documentStatus, employeeId, fileUrl, onClose, onStatusChange,
}: Props) {
  // Poll every 6s until OCR data arrives, then stop
  const [pollInterval, setPollInterval] = useState(6000);
  const { data: ocrRes, isLoading, isError, refetch } = useGetDocumentOcrQuery(documentId, {
    pollingInterval: pollInterval,
  });

  const [triggerOcr, { isLoading: triggering }] = useTriggerDocumentOcrMutation();
  const [reclassifyCombinedPdf, { isLoading: reclassifying }] = useReclassifyCombinedPdfMutation();
  const [updateOcr, { isLoading: saving }] = useUpdateDocumentOcrMutation();
  const [verifyDoc, { isLoading: verifyingDoc }] = useVerifyDocumentMutation();
  const [deepRecheck, { isLoading: deepRechecking }] = useDeepRecheckDocumentMutation();

  const [editing, setEditing] = useState(false);
  const [localDocStatus, setLocalDocStatus] = useState(documentStatus || '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [hrNotes, setHrNotes] = useState('');
  const [ocrStatus, setOcrStatus] = useState('PENDING');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingDoc, setRejectingDoc] = useState(false);
  const [showInlinePreview, setShowInlinePreview] = useState(false);

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
      setHrNotes(ocr.hrNotes || '');
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

  const isCombinedPdf =
    ocr?.detectedType === 'COMBINED_PDF' ||
    (documentType === 'OTHER' && (
      documentName?.toLowerCase().includes('combined') ||
      documentName?.toLowerCase().includes('kyc')
    ));

  const confidence = ocr?.confidence || 0;
  const isFlaggedByScore = confidence > 0 && confidence < 0.60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Centered popup */}
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white shadow-2xl overflow-y-auto rounded-2xl animate-in zoom-in-95 duration-200 flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <ScanLine size={20} className="text-brand-600" />
            <div>
              <h2 className="text-lg font-display font-bold text-gray-900">OCR Verification</h2>
              <p className="text-xs text-gray-400">{documentName} — {documentType?.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors text-lg font-bold">&times;</button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Document Preview */}
          {fileUrl && (
            <div className="layer-card p-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Document Preview</p>
              <button onClick={() => setShowInlinePreview(true)}
                className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1.5 font-medium">
                <Eye size={14} /> View Original Document
              </button>
            </div>
          )}

          {/* Inline secure document preview */}
          {showInlinePreview && fileUrl && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowInlinePreview(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-[92vw] h-[88vh] max-w-5xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">{documentName}</p>
                  <button onClick={() => setShowInlinePreview(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-lg font-bold">&times;</button>
                </div>
                <div className="flex-1 overflow-hidden select-none" onContextMenu={e => e.preventDefault()}>
                  {getUploadUrl(fileUrl).match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i) ? (
                    <img
                      src={getUploadUrl(fileUrl)}
                      alt={documentName}
                      className="w-full h-full object-contain p-4 pointer-events-none"
                      draggable={false}
                    />
                  ) : (
                    <iframe
                      src={`${getUploadUrl(fileUrl)}#toolbar=0&navpanes=0&scrollbar=0`}
                      title={documentName}
                      className="w-full h-full border-0"
                      sandbox="allow-same-origin allow-scripts"
                    />
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
                <ScanLine size={32} className="text-brand-400" />
                <Loader2 size={18} className="animate-spin text-brand-600 absolute -bottom-1 -right-1" />
              </div>
              <p className="text-sm font-semibold text-brand-700">Extracting details...</p>
              <p className="text-xs text-brand-500">Scanning document with AI OCR. This may take 10–30 seconds.</p>
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
                {/* KYC Score */}
                {kycScore !== null && (
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold',
                    kycScore >= 85 ? 'bg-emerald-100 text-emerald-700' :
                    kycScore >= 70 ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  )}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', kycScore >= 85 ? 'bg-emerald-500' : kycScore >= 70 ? 'bg-amber-500' : 'bg-red-500')} />
                    KYC {kycScore}
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
                {modelUsed === 'gpt-4.1' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-purple-50 text-purple-600">
                    <Zap size={9} /> Deep Scan
                  </span>
                )}
              </div>

              {/* ── AI Findings (Vision AI + LLM — real issues only) ── */}
              {(validationReasons.length > 0 || tamperingSignals.length > 0) && (
                <ValidationReasons
                  reasons={[
                    ...tamperingSignals.map(t => `✗ Tampering: ${t}`),
                    ...validationReasons,
                  ]}
                />
              )}

              {/* ── Profile Cross-Verification ── */}
              {profileComparison.length > 0 && (
                <ProfileComparisonPanel items={profileComparison} />
              )}

              {/* Cross-Validation Status — fixed overflow layout */}
              {ocr.crossValidationStatus && (
                <div className="layer-card p-4">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Cross-Document Validation</p>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium mb-3',
                    ocr.crossValidationStatus === 'PASS' ? 'bg-emerald-50 text-emerald-700'
                      : ocr.crossValidationStatus === 'FAIL' ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-700'
                  )}>
                    {ocr.crossValidationStatus === 'PASS' ? <CheckCircle2 size={12} /> :
                     ocr.crossValidationStatus === 'FAIL' ? <XCircle size={12} /> :
                     <AlertTriangle size={12} />}
                    {ocr.crossValidationStatus}
                  </span>
                  {ocr.crossValidationDetails && (
                    <div className="space-y-2">
                      {(ocr.crossValidationDetails as any[]).map((d: any, i: number) => (
                        <div key={i} className="flex flex-col gap-1 text-xs py-2 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-1.5">
                            {d.match
                              ? <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                              : <XCircle size={12} className="text-red-500 shrink-0" />}
                            <span className="text-gray-700 font-medium">{d.field}</span>
                            {d.similarity != null && (
                              <span className="ml-auto text-[10px] text-gray-400">
                                Similarity: {Math.round(d.similarity * 100)}%
                              </span>
                            )}
                          </div>
                          {/* Values — each in its own chip to prevent overflow */}
                          {d.values?.length > 0 && (
                            <div className="ml-4 flex flex-wrap gap-1.5">
                              {d.values.map((v: any, j: number) => (
                                <span key={j} className="bg-gray-100 px-2 py-0.5 rounded text-[10px] text-gray-700 font-mono break-all max-w-full">
                                  <span className="text-gray-400">{v.docType?.replace(/_/g, ' ')}: </span>
                                  {v.value || '—'}
                                </span>
                              ))}
                            </div>
                          )}
                          {d.matchDetail && (
                            <p className="ml-4 text-[10px] text-gray-400 italic">{d.matchDetail}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── HR Review ── */}
              <div className="layer-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <select value={ocrStatus} onChange={e => setOcrStatus(e.target.value)} className="input-glass text-sm flex-1">
                    <option value="PENDING">Pending Review</option>
                    <option value="REVIEWED">Reviewed — OK</option>
                    <option value="FLAGGED">Flagged — Issue Found</option>
                  </select>
                  <button onClick={handleTriggerOcr} disabled={triggering}
                    className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1 whitespace-nowrap">
                    {triggering ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    Re-run AI
                  </button>
                  {deepRecheckAvailable && modelUsed !== 'gpt-4.1' && (
                    <button
                      onClick={async () => {
                        try {
                          await deepRecheck(documentId).unwrap();
                          toast.success('Deep Re-check complete — findings updated with gpt-4.1');
                          refetch();
                        } catch (err: any) {
                          toast.error(err?.data?.error?.message || 'Deep Re-check failed');
                        }
                      }}
                      disabled={deepRechecking}
                      className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1 whitespace-nowrap"
                    >
                      {deepRechecking ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                      Deep Scan
                    </button>
                  )}
                </div>
                <textarea value={hrNotes} onChange={e => setHrNotes(e.target.value)}
                  className="input-glass text-sm w-full h-16 resize-none"
                  placeholder="HR notes (optional)..." />
              </div>

              {/* Save Button */}
              <button onClick={handleSave} disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : 'Save Review'}
              </button>

              {/* Per-document actions */}
              <div className="space-y-2">
                {/* Status badge */}
                {localDocStatus === 'VERIFIED' && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-700">
                    <CheckCircle2 size={14} /> Document Approved
                  </div>
                )}
                {localDocStatus === 'REJECTED' && !showRejectDialog && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm font-medium text-red-700">
                    <XCircle size={14} /> Document Rejected — Awaiting Re-upload
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
