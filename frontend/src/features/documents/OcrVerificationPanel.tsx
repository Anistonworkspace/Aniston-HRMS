import { useState, useEffect } from 'react';
import {
  Shield, Save, Loader2, RotateCcw, AlertTriangle, CheckCircle2, XCircle,
  ScanLine, Eye, Pencil, Check, FileText, Ban, Unlock, Lock, Info, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useGetDocumentOcrQuery, useTriggerDocumentOcrMutation, useUpdateDocumentOcrMutation } from './documentOcrApi';
import { useVerifyDocumentMutation } from './documentApi';
import { useVerifyKycMutation, useRejectKycMutation, useGetKycHrReviewQuery, useReclassifyCombinedPdfMutation } from '../kyc/kycApi';
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
  if (!reasons || reasons.length === 0) return null;

  const hasFlagged = reasons.some((r: any) => { const s = typeof r === 'string' ? r : (r?.message ?? ''); return s.startsWith('🚩') || s.startsWith('✗'); });
  const hasWarning = reasons.some((r: any) => { const s = typeof r === 'string' ? r : (r?.message ?? ''); return s.startsWith('⚠'); });

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
          AI Validation Analysis
          <span className="ml-1 px-1.5 py-0.5 rounded bg-white/60 text-[10px]">
            {reasons.length} check{reasons.length !== 1 ? 's' : ''}
          </span>
        </span>
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {reasons.map((reason: any, i) => {
            const reasonStr = typeof reason === 'string' ? reason : (reason?.message ?? JSON.stringify(reason));
            const isFail = reasonStr.startsWith('✗') || reasonStr.startsWith('🚩');
            const isWarn = reasonStr.startsWith('⚠');
            const isPass = reasonStr.startsWith('✓');
            return (
              <div key={i} className={cn(
                'flex items-start gap-2 text-xs px-2.5 py-1.5 rounded',
                isFail ? 'bg-red-50 text-red-700' :
                isWarn ? 'bg-amber-50 text-amber-700' :
                isPass ? 'bg-emerald-50 text-emerald-700' :
                'bg-gray-50 text-gray-600',
              )}>
                <span className="shrink-0 mt-0.5">
                  {isFail ? <XCircle size={11} /> : isWarn ? <AlertTriangle size={11} /> : isPass ? <CheckCircle2 size={11} /> : <Info size={11} />}
                </span>
                <span className="leading-relaxed">{reasonStr}</span>
              </div>
            );
          })}
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
  onVerifyDoc, onApproveKyc, onRevokeKyc, onRetrigger, triggering, verifyingDoc, verifyingKyc, revokingKyc,
}: {
  documentStatus?: string;
  employeeId?: string;
  fileUrl?: string;
  ocr: any;
  onVerifyDoc: () => void;
  onApproveKyc: () => void;
  onRevokeKyc: () => void;
  onRetrigger: () => void;
  triggering: boolean;
  verifyingDoc: boolean;
  verifyingKyc: boolean;
  revokingKyc: boolean;
}) {
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
          <a href={getUploadUrl(fileUrl)} target="_blank" rel="noopener noreferrer"
            className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1.5 font-medium">
            <Eye size={14} /> Open Combined PDF — Verify All Documents Inside
          </a>
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

        {employeeId && gate?.kycStatus !== 'VERIFIED' && (
          <button onClick={onApproveKyc} disabled={verifyingKyc || wrongUploadCount > 0}
            title={wrongUploadCount > 0 ? 'Cannot approve KYC — wrong documents detected' : ''}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors disabled:opacity-50">
            {verifyingKyc ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {gate?.kycStatus === 'REJECTED' ? 'Restore Portal Access' : 'Approve KYC & Grant Portal Access'}
          </button>
        )}
        {employeeId && gate?.kycStatus === 'VERIFIED' && (
          <button onClick={onRevokeKyc} disabled={revokingKyc}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors bg-white">
            {revokingKyc ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            Revoke Portal Access
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main OCR Verification Panel ──────────────────────────────────────────────
export default function OcrVerificationPanel({
  documentId, documentName, documentType, documentStatus, employeeId, fileUrl, onClose,
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
  const [verifyKyc, { isLoading: verifyingKyc }] = useVerifyKycMutation();
  const [rejectKyc, { isLoading: revokingKyc }] = useRejectKycMutation();

  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [hrNotes, setHrNotes] = useState('');
  const [ocrStatus, setOcrStatus] = useState('PENDING');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingDoc, setRejectingDoc] = useState(false);

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
      await verifyDoc({ id: documentId, status: 'REJECTED' }).unwrap();
      // If employee ID exists, also set KYC to re-upload state
      if (employeeId) {
        // requestReupload is handled by the parent; just update OCR status
      }
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
  const dynamicFields: Record<string, string> = aiData?.dynamic_fields || {};
  const aiEnhanced: boolean = aiData?.ai_enhanced === true;
  const aiConfidenceNote: string | null = aiData?.ai_confidence_note || null;
  const visionScanned: boolean = aiData?.vision_scanned === true;
  const visionQualityNote: string | null = aiData?.vision_quality_note || null;

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
              <a href={getUploadUrl(fileUrl)} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1.5">
                <Eye size={14} /> View Original Document
              </a>
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
                  documentStatus={documentStatus}
                  employeeId={employeeId}
                  fileUrl={fileUrl}
                  ocr={ocr}
                  onVerifyDoc={async () => {
                    try {
                      await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                      toast.success('Combined PDF verified!');
                    } catch { toast.error('Failed to verify'); }
                  }}
                  onApproveKyc={async () => {
                    try {
                      if (documentStatus === 'PENDING' || documentStatus === 'FLAGGED') {
                        await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                      }
                      await verifyKyc(employeeId!).unwrap();
                      toast.success('KYC approved! Employee now has full portal access.');
                      refetchHrReview();
                    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to approve KYC'); }
                  }}
                  onRevokeKyc={async () => {
                    try {
                      await rejectKyc({ employeeId: employeeId!, reason: 'Portal access revoked by HR' }).unwrap();
                      toast.success('Portal access revoked.');
                      refetchHrReview();
                    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to revoke'); }
                  }}
                  onRetrigger={employeeId ? handleReclassify : handleTriggerOcr}
                  triggering={employeeId ? reclassifying : triggering}
                  verifyingDoc={verifyingDoc}
                  verifyingKyc={verifyingKyc}
                  revokingKyc={revokingKyc}
                />
              ) : (
              <>
              {/* ── Red flag banner for low-confidence docs ── */}
              {isFlaggedByScore && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5">
                  <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">Low Confidence — Manual Review Required</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      OCR confidence is {Math.round(confidence * 100)}%, below the 60% threshold.
                      The extracted data may be inaccurate. Please open the original document to verify all fields manually.
                    </p>
                  </div>
                </div>
              )}

              {/* Quality Indicators */}
              <div className="layer-card p-4">
                <p className="text-xs font-semibold text-gray-600 mb-3">Image Quality Analysis</p>
                <div className="flex flex-wrap gap-2">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.isScreenshot ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                  )}>
                    {ocr.isScreenshot ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                    {ocr.isScreenshot ? 'Screenshot Detected' : 'Not a Screenshot'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.isOriginalScan ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  )}>
                    {ocr.isOriginalScan ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {ocr.isOriginalScan ? 'Original Scan' : 'May Not Be Original'}
                  </span>
                  <span className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                    ocr.resolutionQuality === 'HIGH' ? 'bg-emerald-50 text-emerald-700'
                      : ocr.resolutionQuality === 'MEDIUM' ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                  )}>
                    Resolution: {ocr.resolutionQuality || 'Unknown'}
                  </span>
                  <ConfidenceBadge confidence={ocr.confidence} />
                  {visionScanned && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700">
                      <Eye size={11} /> Vision Scanned
                    </span>
                  )}
                  {aiEnhanced && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                      <Shield size={11} /> AI Enhanced
                    </span>
                  )}
                </div>

                {(aiConfidenceNote || visionQualityNote) && (
                  <p className="mt-2 text-xs text-indigo-600 italic">
                    {visionQualityNote || aiConfidenceNote}
                  </p>
                )}

                {/* Tampering warnings */}
                {ocr.tamperingIndicators && (ocr.tamperingIndicators as string[]).length > 0 && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs font-medium text-red-700 flex items-center gap-1.5 mb-1">
                      <AlertTriangle size={12} /> Tampering Indicators
                    </p>
                    {(ocr.tamperingIndicators as any[]).map((t: any, i: number) => (
                      <p key={i} className="text-xs text-red-600 ml-5">
                        - {typeof t === 'string' ? t : (t?.message ?? JSON.stringify(t))}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Detected Type */}
              <div className="layer-card p-4">
                <p className="text-xs font-semibold text-gray-600 mb-1">Detected Document Type</p>
                <p className="text-sm font-medium text-gray-800">{ocr.detectedType?.replace(/_/g, ' ') || 'Unknown'}</p>
              </div>

              {/* AI Validation Reasons (from Python OCR service) */}
              {validationReasons.length > 0 && (
                <ValidationReasons reasons={validationReasons} />
              )}

              {/* AI-Assisted Verification (from LLM, if available) */}
              {ocr.llmExtractedData && (ocr.llmExtractedData as any).issues?.length > 0 && (
                <div className="layer-card p-4 border border-red-100 bg-red-50/20">
                  <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                    <Shield size={12} /> AI LLM Issues Found
                    {ocr.llmConfidence != null && (
                      <span className={cn(
                        'ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium',
                        ocr.llmConfidence >= 0.7 ? 'bg-emerald-100 text-emerald-700' :
                        ocr.llmConfidence >= 0.4 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      )}>
                        LLM: {Math.round(ocr.llmConfidence * 100)}%
                      </span>
                    )}
                  </p>
                  {((ocr.llmExtractedData as any).issues as any[]).map((issue: any, i: number) => (
                    <p key={i} className="text-xs text-red-600 ml-3">• {typeof issue === 'string' ? issue : (issue?.message ?? JSON.stringify(issue))}</p>
                  ))}
                  {((ocr.llmExtractedData as any).corrections || []).map((c: any, i: number) => (
                    <p key={i} className="text-xs text-amber-600 ml-3 mt-1">↳ Correction: {typeof c === 'string' ? c : (c?.message ?? JSON.stringify(c))}</p>
                  ))}
                </div>
              )}

              {/* Extracted Fields */}
              <div className="layer-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-600">Extracted Fields</p>
                  <div className="flex gap-2">
                    <button onClick={handleTriggerOcr} disabled={triggering}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                      {triggering ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      Re-scan
                    </button>
                    <button onClick={() => setEditing(!editing)}
                      className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                      <Pencil size={12} /> {editing ? 'Cancel Edit' : 'Edit'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {getDocFields(documentType).map(({ key, label }) => (
                    <div key={key} className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0">
                      <label className="text-xs text-gray-500 w-32 flex-shrink-0 pt-0.5">{label}</label>
                      {editing ? (
                        <input
                          value={fields[key] || ''}
                          onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                          className="input-glass text-sm flex-1 ml-3"
                          placeholder={`Enter ${label.toLowerCase()}`}
                        />
                      ) : (
                        <span className={cn(
                          'text-sm font-medium min-w-0 ml-3 break-words',
                          fields[key] ? 'text-gray-800' : 'text-gray-300'
                        )}>
                          {fields[key] || '—'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Dynamic Fields (extra label:value pairs from Python AI) */}
              {Object.keys(dynamicFields).length > 0 && (
                <div className="layer-card p-4">
                  <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                    <Info size={12} /> Additional Detected Fields
                    <span className="text-[10px] text-gray-400 font-normal">— captured dynamically by AI</span>
                  </p>
                  <div className="space-y-2">
                    {Object.entries(dynamicFields).map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-xs text-gray-500 w-36 flex-shrink-0">{k}</span>
                        <span className="text-xs font-medium text-gray-700 min-w-0 ml-3 break-words">
                          {typeof v === 'string' ? v : (v != null ? JSON.stringify(v) : '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
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

              {/* HR Notes & Status */}
              <div className="layer-card p-4">
                <p className="text-xs font-semibold text-gray-600 mb-3">Review Status & Notes</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Status</label>
                    <select value={ocrStatus} onChange={e => setOcrStatus(e.target.value)} className="input-glass text-sm w-full">
                      <option value="PENDING">Pending Review</option>
                      <option value="REVIEWED">Reviewed — OK</option>
                      <option value="FLAGGED">Flagged — Issue Found</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">HR Notes</label>
                    <textarea value={hrNotes} onChange={e => setHrNotes(e.target.value)}
                      className="input-glass text-sm w-full h-20 resize-none"
                      placeholder="Add notes about this document..." />
                  </div>
                </div>
              </div>

              {/* Re-run AI Classifier */}
              <button onClick={handleTriggerOcr} disabled={triggering}
                className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors">
                {triggering ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {triggering ? 'Re-classifying...' : 'Re-run AI Classifier'}
              </button>

              {/* Save Button */}
              <button onClick={handleSave} disabled={saving}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : 'Save Review'}
              </button>

              {/* Per-document actions */}
              <div className="space-y-2">
                {/* Verify */}
                {(documentStatus === 'PENDING' || documentStatus === 'FLAGGED') && !showRejectDialog && (
                  <button onClick={async () => {
                    try {
                      await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                      toast.success('Document verified!');
                    } catch { toast.error('Failed to verify document'); }
                  }} disabled={verifyingDoc}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                    {verifyingDoc ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Approve This Document
                  </button>
                )}

                {/* Reject with reason */}
                {!showRejectDialog && documentStatus !== 'REJECTED' && (
                  <button onClick={() => setShowRejectDialog(true)}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                    <Ban size={14} /> Reject Document & Request Re-upload
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

                {/* KYC access toggle — single location, switches between Approve / Revoke / Restore */}
                {employeeId && (
                  <div className="rounded-lg border overflow-hidden">
                    {/* Status indicator */}
                    <div className={`px-3 py-2 flex items-center gap-2 text-xs font-semibold ${
                      kycStatus === 'VERIFIED' ? 'bg-green-50 text-green-700 border-b border-green-100'
                      : kycStatus === 'REJECTED' ? 'bg-red-50 text-red-700 border-b border-red-100'
                      : 'bg-slate-50 text-slate-600 border-b border-slate-100'
                    }`}>
                      {kycStatus === 'VERIFIED'
                        ? <><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Portal Access: Granted</>
                        : kycStatus === 'REJECTED'
                        ? <><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Portal Access: Revoked</>
                        : <><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Portal Access: Pending</>
                      }
                    </div>
                    {/* Action button */}
                    {kycStatus !== 'VERIFIED' && (
                      <button onClick={async () => {
                        try {
                          if (documentStatus === 'PENDING' || documentStatus === 'FLAGGED') {
                            await verifyDoc({ id: documentId, status: 'VERIFIED' }).unwrap();
                          }
                          await verifyKyc(employeeId).unwrap();
                          toast.success('KYC approved — employee can now access the portal.');
                        } catch (err: any) {
                          toast.error(err?.data?.error?.message || 'Failed to approve KYC');
                        }
                      }} disabled={verifyingKyc}
                        className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white transition-colors">
                        {verifyingKyc ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
                        {kycStatus === 'REJECTED' ? 'Restore Portal Access' : 'Approve KYC & Grant Portal Access'}
                      </button>
                    )}
                    {kycStatus === 'VERIFIED' && (
                      <button onClick={async () => {
                        try {
                          await rejectKyc({ employeeId: employeeId!, reason: 'Portal access revoked by HR' }).unwrap();
                          toast.success('Portal access revoked.');
                        } catch (err: any) {
                          toast.error(err?.data?.error?.message || 'Failed to revoke access');
                        }
                      }} disabled={revokingKyc}
                        className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 border-t border-red-100 text-red-600 hover:bg-red-50 transition-colors bg-white">
                        {revokingKyc ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                        Revoke Portal Access
                      </button>
                    )}
                  </div>
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
