import { useState, useRef } from 'react';
import {
  FileText, Download, Shield, GraduationCap, Briefcase,
  Loader2, AlertTriangle, CheckCircle2, Clock, XCircle, ChevronDown,
  Mail, Eye, Lock, Upload, Plus, Scan,
} from 'lucide-react';
import { useGetMyDocumentsQuery, useUploadMyDocumentMutation } from './myDocumentsApi';
import { useGetMyLettersQuery } from '../policies/letterApi';
import { cn } from '../../lib/utils';
import SecureDocumentViewer from '../policies/SecureDocumentViewer';
import toast from 'react-hot-toast';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Types that come from onboarding — employee cannot re-upload these */
const ONBOARDING_LOCKED_TYPES = new Set([
  'AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE',
  'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE',
  'RESIDENCE_PROOF', 'BANK_STATEMENT', 'CANCELLED_CHEQUE',
  'OFFER_LETTER_DOC', 'JOINING_LETTER', 'EXPERIENCE_LETTER',
  'RELIEVING_LETTER', 'SALARY_SLIP_DOC', 'PHOTO',
]);

/** Types employees can upload post-onboarding (self-serve) */
const SELF_UPLOAD_OPTIONS: { value: string; label: string }[] = [
  { value: 'POST_GRADUATION_CERTIFICATE', label: 'Post Graduation Certificate' },
  { value: 'PROFESSIONAL_CERTIFICATION', label: 'Professional Certification' },
  { value: 'OTHER', label: 'Other Achievement / Document' },
];

const ID_TYPES = ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE', 'RESIDENCE_PROOF'];
const EMPLOYMENT_TYPES = [
  'OFFER_LETTER_DOC', 'JOINING_LETTER', 'EXPERIENCE_LETTER',
  'RELIEVING_LETTER', 'SALARY_SLIP_DOC',
];
const EDUCATION_OTHER_TYPES = [
  'DEGREE_CERTIFICATE', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE',
  'POST_GRADUATION_CERTIFICATE', 'PROFESSIONAL_CERTIFICATION',
  'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'OTHER',
];

interface Category {
  key: string;
  label: string;
  icon: React.ElementType;
  types: string[];
  color: string;
  iconBg: string;
}

const CATEGORIES: Category[] = [
  { key: 'id',         label: 'ID Documents',       icon: Shield,       types: ID_TYPES,             color: 'text-blue-600',    iconBg: 'bg-blue-50 text-blue-600' },
  { key: 'employment', label: 'Employment Letters',  icon: Briefcase,    types: EMPLOYMENT_TYPES,     color: 'text-indigo-600',  iconBg: 'bg-indigo-50 text-indigo-600' },
  { key: 'education',  label: 'Education & Other',   icon: GraduationCap, types: EDUCATION_OTHER_TYPES, color: 'text-emerald-600', iconBg: 'bg-emerald-50 text-emerald-600' },
];

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; classes: string }> = {
  PENDING:    { label: 'Pending',    icon: Clock,         classes: 'bg-amber-50 text-amber-700' },
  VERIFIED:   { label: 'Verified',   icon: CheckCircle2,  classes: 'bg-emerald-50 text-emerald-700' },
  REJECTED:   { label: 'Rejected',   icon: XCircle,       classes: 'bg-red-50 text-red-700' },
  FLAGGED:    { label: 'Flagged',    icon: AlertTriangle, classes: 'bg-orange-50 text-orange-700' },
  ISSUED:     { label: 'Issued',     icon: Briefcase,     classes: 'bg-blue-50 text-blue-700' },
  EXPIRED:    { label: 'Expired',    icon: AlertTriangle, classes: 'bg-gray-100 text-gray-500' },
  PROCESSING: { label: 'Processing', icon: Scan,          classes: 'bg-indigo-50 text-indigo-700' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.classes)}>
      {status === 'PROCESSING' ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/*  Document Card                                                      */
/* ------------------------------------------------------------------ */

function DocumentCard({ doc, locked, canDownload = true }: { doc: any; locked: boolean; canDownload?: boolean }) {
  const isCombinedPdf = doc.type === 'OTHER' &&
    (doc.name?.toLowerCase().includes('combined') || doc.name?.toLowerCase().includes('kyc'));

  return (
    <div className={cn('layer-card p-4 flex flex-col gap-3', locked && 'opacity-95')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="font-semibold text-gray-900 truncate">
              {doc.name || formatType(doc.type)}
            </h4>
            {locked && (
              <span title="Submitted during onboarding — cannot be re-uploaded">
                <Lock size={12} className="text-gray-400 shrink-0" />
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {isCombinedPdf ? 'Combined KYC PDF' : formatType(doc.type)}
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400 text-xs">
          Uploaded {formatDate(doc.createdAt)}
        </span>
        {doc.fileUrl && canDownload && (
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-600 text-xs font-medium hover:bg-brand-100 transition-colors"
          >
            <Download size={14} />
            Download
          </a>
        )}
        {doc.fileUrl && !canDownload && (
          <PermDenied action="download documents" inline />
        )}
      </div>

      {doc.status === 'REJECTED' && doc.rejectionReason && (
        <div className="flex items-start gap-2 bg-red-50 rounded-lg p-2.5 text-xs text-red-600">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <span>{doc.rejectionReason}</span>
        </div>
      )}

      {doc.status === 'FLAGGED' && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-2.5 text-xs text-orange-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">This document has been flagged.</span>
            {doc.rejectionReason && <p className="mt-0.5">{doc.rejectionReason}</p>}
            <p className="mt-1 text-orange-600">Please contact HR for assistance.</p>
          </div>
        </div>
      )}

      {doc.status === 'PENDING' && !locked && (
        <div className="flex items-start gap-2 bg-amber-50 rounded-lg p-2.5 text-xs text-amber-700">
          <Scan size={14} className="mt-0.5 shrink-0" />
          <span>Under OCR verification — HR will review shortly.</span>
        </div>
      )}

      {doc.tamperDetected && doc.status !== 'FLAGGED' && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Possible tampering detected.</span>
            {doc.tamperDetails && <p className="mt-0.5">{doc.tamperDetails}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category section                                                   */
/* ------------------------------------------------------------------ */

function CategorySection({ category, documents }: { category: Category; documents: any[] }) {
  const [open, setOpen] = useState(true);
  const Icon = category.icon;

  return (
    <div className="layer-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors"
      >
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', category.iconBg)}>
          <Icon size={18} />
        </div>
        <h3 className={cn('text-base font-semibold flex-1 text-left', category.color)}>
          {category.label}
        </h3>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
          {documents.length}
        </span>
        <ChevronDown size={18} className={cn('text-gray-400 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          {documents.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No documents in this category</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc: any) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  locked={ONBOARDING_LOCKED_TYPES.has(doc.type)}
                  canDownload={perms.canDownloadDocuments}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Upload Additional Documents Panel                                  */
/* ------------------------------------------------------------------ */

function UploadPanel({ existingTypes, onUploaded }: { existingTypes: string[]; onUploaded: () => void }) {
  const [uploadMyDocument, { isLoading: uploading }] = useUploadMyDocumentMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('');
  const [docName, setDocName] = useState('');
  const [justUploaded, setJustUploaded] = useState(false);

  // Filter out types already uploaded
  const availableOptions = SELF_UPLOAD_OPTIONS.filter(
    (opt) => !existingTypes.includes(opt.value) || opt.value === 'OTHER',
  );

  const handleUpload = async (file: File) => {
    if (!docType) { toast.error('Please select a document type first'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', docType);
    fd.append('name', docName.trim() || SELF_UPLOAD_OPTIONS.find((o) => o.value === docType)?.label || docType);
    try {
      await uploadMyDocument(fd).unwrap();
      toast.success('Document uploaded — OCR verification started');
      setDocType('');
      setDocName('');
      setJustUploaded(true);
      onUploaded();
      setTimeout(() => setJustUploaded(false), 5000);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
  };

  if (availableOptions.length === 0) {
    return (
      <div className="layer-card p-5 border border-dashed border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">All additional documents uploaded</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Post-graduation and certifications are already on file.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layer-card p-5 border border-dashed border-indigo-200 bg-indigo-50/30">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
          <Plus size={20} className="text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Upload Additional Document</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Upload post-graduation certificates, professional certifications, or other achievement documents.
            OCR verification runs automatically and HR is notified.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-gray-500 mb-1">Document Type *</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="input-glass text-sm w-full"
          >
            <option value="">Select type...</option>
            {availableOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-gray-500 mb-1">Document Name (optional)</label>
          <input
            type="text"
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            placeholder="e.g. MBA Certificate 2025"
            className="input-glass text-sm w-full"
          />
        </div>

        <div className="shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic,.heif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => { if (!docType) { toast.error('Select a document type first'); return; } fileRef.current?.click(); }}
            disabled={uploading}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>

      {justUploaded && (
        <div className="mt-3 flex items-center gap-2 bg-indigo-100 rounded-lg px-3 py-2 text-xs text-indigo-700">
          <Scan size={14} className="animate-pulse shrink-0" />
          OCR verification in progress — you'll see the status update shortly.
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400 flex items-center gap-1">
        <Lock size={11} />
        Documents submitted during onboarding (ID proofs, education certificates) cannot be edited from here.
        Contact HR for corrections.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MyDocumentsPage() {
  const { perms } = useEmpPerms();
  const { data: res, isLoading, isError, refetch } = useGetMyDocumentsQuery(undefined, { skip: !perms.canViewDocuments });
  const documents: any[] = res?.data || [];

  // All types already uploaded by this employee
  const uploadedTypes = documents.map((d: any) => d.type);

  // Uncategorised docs go into Education & Other
  const uncategorised = documents.filter(
    (d: any) =>
      !ID_TYPES.includes(d.type) &&
      !EMPLOYMENT_TYPES.includes(d.type) &&
      !EDUCATION_OTHER_TYPES.includes(d.type),
  );

  function getDocsForCategory(types: string[]) {
    return documents.filter((d: any) => types.includes(d.type));
  }

  if (!perms.canViewDocuments) return <PermDenied action="view documents" />;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
          <FileText className="text-brand-600" size={28} />
          My Documents
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          View and download your documents. Upload new certifications or achievements.
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="layer-card p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">Failed to load documents</p>
          <p className="text-gray-400 text-sm mt-1">Please try again later</p>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-4">
          {/* Upload panel — only for additional docs */}
          <UploadPanel existingTypes={uploadedTypes} onUploaded={refetch} />

          {/* Categories */}
          {CATEGORIES.map((cat) => {
            const docs =
              cat.key === 'education'
                ? [...getDocsForCategory(cat.types), ...uncategorised]
                : getDocsForCategory(cat.types);
            return <CategorySection key={cat.key} category={cat} documents={docs} />;
          })}

          {/* My Letters */}
          <MyLettersSection />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  My Letters Section                                                 */
/* ------------------------------------------------------------------ */

function MyLettersSection() {
  const { data: lettersRes, isLoading } = useGetMyLettersQuery();
  const [open, setOpen] = useState(true);
  const [viewLetter, setViewLetter] = useState<any>(null);

  const assignments = lettersRes?.data || [];

  const LETTER_TYPE_LABELS: Record<string, string> = {
    OFFER_LETTER: 'Offer Letter',
    JOINING_LETTER: 'Joining Letter',
    EXPERIENCE_LETTER: 'Experience Letter',
    RELIEVING_LETTER: 'Relieving Letter',
    SALARY_SLIP_LETTER: 'Salary Slip',
    PROMOTION_LETTER: 'Promotion Letter',
    WARNING_LETTER: 'Warning Letter',
    APPRECIATION_LETTER: 'Appreciation',
    CUSTOM: 'Custom Letter',
  };

  return (
    <>
      <div className="layer-card overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-purple-50 text-purple-600">
            <Mail size={18} />
          </div>
          <h3 className="text-base font-semibold flex-1 text-left text-purple-600">My Letters</h3>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
            {assignments.length}
          </span>
          <ChevronDown size={18} className={cn('text-gray-400 transition-transform duration-200', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="px-5 pb-5">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-purple-500" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-8">
                <Mail className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No letters assigned to you yet</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {assignments.map((a: any) => (
                  <div key={a.id} className="layer-card p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-gray-900 truncate">{a.letter.title}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {LETTER_TYPE_LABELS[a.letter.type] || a.letter.type.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                        <Mail size={12} /> Letter
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400 text-xs">
                        Issued {new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setViewLetter(a)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 text-xs font-medium hover:bg-purple-100 transition-colors"
                        >
                          <Eye size={14} /> View
                        </button>
                        {!a.downloadAllowed && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Download restricted by HR">
                            <Lock size={12} />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {viewLetter && (
        <SecureDocumentViewer
          streamUrl={`/letters/${viewLetter.letter.id}/stream`}
          title={viewLetter.letter.title}
          downloadAllowed={viewLetter.downloadAllowed}
          downloadUrl={`/letters/${viewLetter.letter.id}/download`}
          onClose={() => setViewLetter(null)}
        />
      )}
    </>
  );
}
