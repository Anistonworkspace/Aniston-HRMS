import { useState } from 'react';
import {
  FileText, Download, Shield, GraduationCap, Briefcase,
  Loader2, AlertTriangle, CheckCircle2, Clock, XCircle, ChevronDown,
} from 'lucide-react';
import { useGetMyDocumentsQuery } from './myDocumentsApi';
import { cn } from '../../lib/utils';

/* ------------------------------------------------------------------ */
/*  Document type → category mapping                                   */
/* ------------------------------------------------------------------ */

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
  {
    key: 'id',
    label: 'ID Documents',
    icon: Shield,
    types: ID_TYPES,
    color: 'text-blue-600',
    iconBg: 'bg-blue-50 text-blue-600',
  },
  {
    key: 'employment',
    label: 'Employment Letters',
    icon: Briefcase,
    types: EMPLOYMENT_TYPES,
    color: 'text-indigo-600',
    iconBg: 'bg-indigo-50 text-indigo-600',
  },
  {
    key: 'education',
    label: 'Education & Other',
    icon: GraduationCap,
    types: EDUCATION_OTHER_TYPES,
    color: 'text-emerald-600',
    iconBg: 'bg-emerald-50 text-emerald-600',
  },
];

/* ------------------------------------------------------------------ */
/*  Status badge config                                                */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; classes: string }> = {
  PENDING: {
    label: 'Pending',
    icon: Clock,
    classes: 'bg-amber-50 text-amber-700',
  },
  VERIFIED: {
    label: 'Verified',
    icon: CheckCircle2,
    classes: 'bg-emerald-50 text-emerald-700',
  },
  REJECTED: {
    label: 'Rejected',
    icon: XCircle,
    classes: 'bg-red-50 text-red-700',
  },
  ISSUED: {
    label: 'Issued',
    icon: Briefcase,
    classes: 'bg-blue-50 text-blue-700',
  },
  EXPIRED: {
    label: 'Expired',
    icon: AlertTriangle,
    classes: 'bg-gray-100 text-gray-500',
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        cfg.classes,
      )}
    >
      <Icon size={12} />
      {cfg.label}
    </span>
  );
}

function DocumentCard({ doc }: { doc: any }) {
  return (
    <div className="layer-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-gray-900 truncate">
            {doc.name || formatType(doc.type)}
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">{formatType(doc.type)}</p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">
          Uploaded {formatDate(doc.createdAt)}
        </span>

        {doc.fileUrl && (
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
      </div>

      {doc.status === 'REJECTED' && doc.remarks && (
        <div className="flex items-start gap-2 bg-red-50 rounded-lg p-2.5 text-xs text-red-600">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <span>{doc.remarks}</span>
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category,
  documents,
}: {
  category: Category;
  documents: any[];
}) {
  const [open, setOpen] = useState(true);
  const Icon = category.icon;

  return (
    <div className="layer-card overflow-hidden">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors"
      >
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
            category.iconBg,
          )}
        >
          <Icon size={18} />
        </div>
        <h3 className={cn('text-base font-semibold flex-1 text-left', category.color)}>
          {category.label}
        </h3>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
          {documents.length}
        </span>
        <ChevronDown
          size={18}
          className={cn(
            'text-gray-400 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Documents grid */}
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
                <DocumentCard key={doc.id} doc={doc} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MyDocumentsPage() {
  const { data: res, isLoading, isError } = useGetMyDocumentsQuery();
  const documents: any[] = res?.data || [];

  // Bucket docs into categories; uncategorised docs go to Education & Other
  function getDocsForCategory(types: string[]) {
    return documents.filter((d: any) => types.includes(d.type));
  }

  const uncategorised = documents.filter(
    (d: any) =>
      !ID_TYPES.includes(d.type) &&
      !EMPLOYMENT_TYPES.includes(d.type) &&
      !EDUCATION_OTHER_TYPES.includes(d.type),
  );

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
          <FileText className="text-brand-600" size={28} />
          My Documents
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          View and download your documents
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

      {/* Categories */}
      {!isLoading && !isError && (
        <div className="space-y-4">
          {CATEGORIES.map((cat) => {
            const docs =
              cat.key === 'education'
                ? [...getDocsForCategory(cat.types), ...uncategorised]
                : getDocsForCategory(cat.types);
            return (
              <CategorySection key={cat.key} category={cat} documents={docs} />
            );
          })}
        </div>
      )}
    </div>
  );
}
