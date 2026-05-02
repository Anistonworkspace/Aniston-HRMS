import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Camera, Upload, CheckCircle2, Clock, XCircle, Loader2,
  AlertTriangle, Info, GraduationCap, ShieldCheck, CreditCard,
  Home, Briefcase, Image, ArrowRight, ArrowLeft, RefreshCw,
  ChevronDown, ChevronUp, LayoutDashboard, Banknote,
} from 'lucide-react';
import { useAppSelector } from '../../app/store';
import {
  useGetMyKycStatusQuery,
  useSaveKycConfigMutation,
  useUploadKycDocumentMutation,
  useUploadKycPhotoMutation,
  useUploadPhotoFileMutation,
  useSubmitKycMutation,
} from './kycApi';
import CameraCapture from './CameraCapture';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { getUploadUrl } from '../../lib/utils';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadMode = 'SEPARATE' | null;
type Experience = 'FRESHER' | 'EXPERIENCED' | null;
type Qualification = 'NONE' | 'TENTH' | 'TWELFTH' | 'DIPLOMA' | 'GRADUATION' | 'POST_GRADUATION' | 'PHD' | null;

type FlowStep =
  | 'SEPARATE_UPLOAD' // Step 1: Separate docs
  | 'STATUS';         // Final: submission status

// ─── Document requirement engine (mirrors backend logic) ──────────────────────

const QUALIFICATION_ORDER = ['TENTH', 'TWELFTH', 'GRADUATION', 'POST_GRADUATION', 'PHD'];

interface RequiredDoc {
  type: string;
  label: string;
  hint?: string;
  required: boolean;
  acceptsAnyOf?: string[];  // "any one of these types satisfies this requirement"
}

const IDENTITY_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
const EMPLOYMENT_TYPES = ['EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'OFFER_LETTER_DOC', 'SALARY_SLIP_DOC'];

function computeRequiredDocs(experience: Experience, qualification: Qualification): RequiredDoc[] {
  const docs: RequiredDoc[] = [];

  // Education chain — skip entirely for NONE (no formal education)
  if (qualification !== 'NONE') {
    // DIPLOMA requires same certs as GRADUATION (10th + 12th + Degree)
    const normalizedQual = qualification === 'DIPLOMA' ? 'GRADUATION' : qualification;
    const qualIdx = normalizedQual ? QUALIFICATION_ORDER.indexOf(normalizedQual) : 2; // default GRADUATION when null
    if (qualIdx >= 0) docs.push({ type: 'TENTH_CERTIFICATE', label: '10th Marksheet / Certificate', required: true });
    if (qualIdx >= 1) docs.push({ type: 'TWELFTH_CERTIFICATE', label: '12th Marksheet / Certificate', required: true });
    if (qualIdx >= 2) docs.push({ type: 'DEGREE_CERTIFICATE', label: 'Graduation / Degree Certificate', required: true });
    if (qualIdx >= 3) docs.push({ type: 'POST_GRADUATION_CERTIFICATE', label: 'Post-Graduation Certificate', required: true });
    if (qualIdx >= 4) docs.push({ type: 'POST_GRADUATION_CERTIFICATE', label: 'PhD / Doctorate Certificate', hint: 'Upload your PhD completion certificate', required: true });
  }

  // Identity (any one)
  docs.push({
    type: 'IDENTITY_PROOF',
    label: 'Identity Proof (any one)',
    hint: 'Aadhaar Card, Passport, Driving License, or Voter ID',
    required: true,
    acceptsAnyOf: IDENTITY_TYPES,
  });

  // PAN
  docs.push({ type: 'PAN', label: 'PAN Card', required: true });

  // Residence proof
  docs.push({ type: 'RESIDENCE_PROOF', label: 'Residence Proof', hint: 'Utility bill, rent agreement, or address proof', required: true });

  // Employment proof — REQUIRED for EXPERIENCED employees
  if (experience === 'EXPERIENCED') {
    docs.push({
      type: 'EMPLOYMENT_PROOF',
      label: 'Previous Employment Proof (any one)',
      hint: 'Experience Letter, Relieving Letter, Appointment Letter, or Salary Slips',
      required: true, // mandatory for experienced employees
      acceptsAnyOf: EMPLOYMENT_TYPES,
    });
  }

  // Cancelled Cheque — mandatory for all employees for payroll processing
  docs.push({
    type: 'CANCELLED_CHEQUE',
    label: 'Cancelled Cheque',
    hint: 'Upload a cancelled cheque of your salary account — the same bank account you entered in your bank details',
    required: true,
  });

  // Photo
  docs.push({ type: 'PHOTO', label: 'Passport Size Photograph', required: true });

  return docs;
}

function isDocTypeSubmitted(docSpec: RequiredDoc, submittedTypes: string[]): boolean {
  if (docSpec.acceptsAnyOf) {
    return docSpec.acceptsAnyOf.some(t => submittedTypes.includes(t));
  }
  if (docSpec.type === 'PHOTO') {
    return submittedTypes.includes('PHOTO');
  }
  return submittedTypes.includes(docSpec.type);
}

// ─── Status config ─────────────────────────────────────────────────────────────

const KYC_STATUS_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string; title: string; subtitle: string }> = {
  PENDING: {
    icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
    title: 'Pending — Upload your documents',
    subtitle: 'Upload all required documents below to continue.',
  },
  SUBMITTED: {
    icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200',
    title: 'Submitted — Under HR Review',
    subtitle: 'Your documents have been submitted. HR will review and verify them.',
  },
  PROCESSING: {
    icon: Loader2, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200',
    title: 'Processing',
    subtitle: 'Documents are being processed. This may take a few minutes.',
  },
  PENDING_HR_REVIEW: {
    icon: Clock, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200',
    title: 'Pending HR Review',
    subtitle: 'HR will review your documents shortly.',
  },
  REUPLOAD_REQUIRED: {
    icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200',
    title: 'Re-upload Required',
    subtitle: 'HR has flagged some documents. Please re-upload the highlighted documents.',
  },
  VERIFIED: {
    icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
    title: 'KYC Verified',
    subtitle: 'Your documents have been verified by HR. You now have full access.',
  },
  REJECTED: {
    icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200',
    title: 'Submission Rejected',
    subtitle: 'Your KYC submission was rejected. Please see the reason below and re-submit.',
  },
};

const QUAL_LABELS: Record<string, string> = {
  NONE: 'None — No formal education',
  TENTH: '10th / SSLC',
  TWELFTH: '12th / Intermediate / PUC',
  DIPLOMA: 'Diploma',
  GRADUATION: 'Graduation / Bachelor\'s Degree',
  POST_GRADUATION: 'Post-Graduation / Master\'s Degree',
  PHD: 'PhD / Doctorate',
};

// ─── Main component ────────────────────────────────────────────────────────────

export default function KycGatePage() {
  const user = useAppSelector(s => s.auth.user);
  const { data: kycRes, isLoading, refetch } = useGetMyKycStatusQuery();
  const [saveKycConfig, { isLoading: savingConfig }] = useSaveKycConfigMutation();
  const [uploadDoc] = useUploadKycDocumentMutation();
  const [uploadPhoto] = useUploadKycPhotoMutation();
  const [uploadPhotoFile] = useUploadPhotoFileMutation();
  const [submitKyc, { isLoading: submitting }] = useSubmitKycMutation();

  // Derive kyc state early so useEffects below can reference kycStatus
  const kyc = kycRes?.data;
  const kycStatus: string = kyc?.kycStatus || 'PENDING';

  // Real-time: refetch when HR verifies/rejects
  useEffect(() => {
    const handler = () => { refetch(); };
    onSocketEvent('kyc:status-changed', handler);
    return () => { offSocketEvent('kyc:status-changed', handler); };
  }, [refetch]);

  // Real-time: clear scanning indicator when OCR finishes for this employee's doc
  useEffect(() => {
    const handler = (data: { employeeId: string; docType: string }) => {
      if (data.employeeId === user?.employeeId) {
        setScanningDocs(prev => {
          const next = new Set(prev);
          next.delete(data.docType);
          return next;
        });
      }
    };
    onSocketEvent('ocr:document-processed', handler);
    return () => { offSocketEvent('ocr:document-processed', handler); };
  }, [user?.employeeId]);

  // Polling while combined PDF is being classified (PROCESSING state, ~5s interval, max 5 min)
  useEffect(() => {
    if (kycStatus !== 'PROCESSING') return;
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // 60 × 5s = 5 minutes
    const timer = setInterval(() => {
      attempts++;
      refetch();
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
        toast.error(
          'Document scanning is taking longer than expected. Please refresh the page or contact HR if the issue persists.',
          { duration: 8000 }
        );
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [kycStatus, refetch]);

  // Local flow state — skip PROFILE_INFO, start directly at upload
  const [flowStep, setFlowStep] = useState<FlowStep>('SEPARATE_UPLOAD');
  const [uploadMode, setUploadMode] = useState<UploadMode>('SEPARATE');
  const [experience, setExperience] = useState<Experience>(null);
  const [qualification, setQualification] = useState<Qualification>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [scanningDocs, setScanningDocs] = useState<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [incompleteSubmission, setIncompleteSubmission] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const photoFileRef = useRef<HTMLInputElement | null>(null);

  const submittedDocs: string[] = (kyc?.submittedDocs || []) as string[];
  const photoUrl: string | null = kyc?.photoUrl || null;
  const rejectionReason: string | null = kyc?.rejectionReason || null;
  const reuploadDocTypes: string[] = (kyc?.reuploadDocTypes || []) as string[];
  const documentRejectReasons: Record<string, string> = (kyc?.documentRejectReasons || {}) as Record<string, string>;

  // Restore saved config from gate OR employee profile (for page reload)
  useEffect(() => {
    const exp = (kyc?.fresherOrExperienced || ((kyc as any)?.employeeExperienceLevel === 'EXPERIENCED' ? 'EXPERIENCED' : null)) as Experience;
    const qual = (kyc?.highestQualification || (kyc as any)?.employeeQualification || null) as Qualification;
    if (exp) setExperience(exp);
    if (qual) setQualification(qual);

    if (kycStatus === 'SUBMITTED') {
      // Detect employees who reached SUBMITTED with missing docs (old COMBINED-mode bypass)
      // and send them back to the upload screen instead of the waiting screen
      const submitted = (kyc?.submittedDocs || []) as string[];
      const hasPhoto = !!kyc?.photoUrl || submitted.includes('PHOTO');
      const reqDocs = computeRequiredDocs(exp, qual);
      const missingAny = reqDocs.some(d =>
        d.required && (d.type === 'PHOTO' ? !hasPhoto : !isDocTypeSubmitted(d, submitted))
      );
      if (missingAny) {
        setIncompleteSubmission(true);
        setFlowStep('SEPARATE_UPLOAD');
      } else {
        setIncompleteSubmission(false);
        setFlowStep('STATUS');
      }
    } else if (['PENDING_HR_REVIEW', 'VERIFIED', 'REJECTED'].includes(kycStatus)) {
      setIncompleteSubmission(false);
      setFlowStep('STATUS');
    } else {
      setIncompleteSubmission(false);
      setFlowStep('SEPARATE_UPLOAD');
    }
  }, [kyc, kycStatus]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  // NOTE: ALL hooks must be declared before any conditional early returns.
  // useCallback is a hook and must be here, not below the isLoading guard.

  const handleSaveConfig = async (): Promise<boolean> => {
    if (!experience || !qualification) {
      toast.error('Please select your experience level and qualification');
      return false;
    }
    if (!user?.employeeId) {
      toast.error('Employee profile not linked. Please contact HR.');
      return false;
    }
    try {
      await saveKycConfig({
        employeeId: user.employeeId,
        uploadMode: 'SEPARATE',
        fresherOrExperienced: experience,
        highestQualification: qualification,
      }).unwrap();
      setFlowStep('SEPARATE_UPLOAD');
      refetch();
      return true;
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save configuration');
      return false;
    }
  };

  const handleFileUpload = useCallback(async (docType: string, file: File, docName?: string) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File is too large. Maximum size is 10MB. Please compress the file and try again.');
      return;
    }
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', docType);
      formData.append('name', docName || docType.replace(/_/g, ' '));
      formData.append('employeeId', user.employeeId);
      await uploadDoc({ employeeId: user.employeeId, formData }).unwrap();
      toast.success(`${(docName || docType).replace(/_/g, ' ')} uploaded`);
      setScanningDocs(prev => new Set([...prev, docType]));
      refetch();
    } catch (err: any) {
      if (err?.status === 'FETCH_ERROR') {
        toast.error('Upload failed — please check your connection and try again.');
      } else {
        toast.error(err?.data?.error?.message || 'Upload failed');
      }
    } finally {
      setUploading(null);
    }
  }, [user, uploadDoc, refetch]);

  // ── All hooks declared above. Early return is safe here. ────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-1">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading KYC status...</p>
        </div>
      </div>
    );
  }

  const handlePhotoCapture = async (blob: Blob) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    if (blob.size > 5 * 1024 * 1024) {
      toast.error('Photo is too large. Maximum size is 5MB. Please try again with a lower resolution.');
      return;
    }
    setShowCamera(false);
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('photo', blob, 'kyc-photo.jpg');
      await uploadPhoto({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Photo captured successfully');
      setScanningDocs(prev => new Set([...prev, 'PHOTO']));
      refetch();
    } catch (err: any) {
      if (err?.status === 'FETCH_ERROR') {
        toast.error('Upload failed — please check your connection and try again.');
      } else {
        toast.error(err?.data?.error?.message || 'Photo upload failed');
      }
    } finally {
      setUploading(null);
    }
  };

  const handlePhotoFileUpload = async (file: File) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo is too large. Maximum size is 5MB. Please choose a smaller image.');
      return;
    }
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await uploadPhotoFile({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Photo uploaded successfully');
      setScanningDocs(prev => new Set([...prev, 'PHOTO']));
      refetch();
    } catch (err: any) {
      if (err?.status === 'FETCH_ERROR') {
        toast.error('Upload failed — please check your connection and try again.');
      } else {
        toast.error(err?.data?.error?.message || 'Photo upload failed');
      }
    } finally {
      setUploading(null);
    }
  };

  const handleSubmitKyc = async () => {
    if (!user?.employeeId) return;
    try {
      await submitKyc(user.employeeId).unwrap();
      toast.success('KYC submitted for HR review');
      setFlowStep('STATUS');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Submission failed');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="h-[100dvh] overflow-y-auto bg-surface-1">
      <div className="max-w-2xl mx-auto py-8 px-4 pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+2rem))]">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-50 mb-3">
            <FileText size={26} className="text-brand-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Document Verification</h1>
          <p className="text-gray-500 text-sm mt-1">
            Upload your pre-joining documents for HR review
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator flowStep={flowStep} />

        <AnimatePresence mode="wait">
          {/* ── STEP 1: SEPARATE DOCUMENT UPLOAD ────────────────────────────────── */}
          {flowStep === 'SEPARATE_UPLOAD' && (
            <motion.div key="separate-upload" {...fadeSlide}>
              <SeparateUploadScreen
                experience={experience}
                qualification={qualification}
                submittedDocs={submittedDocs}
                photoUrl={photoUrl}
                uploading={uploading}
                scanningDocs={scanningDocs}
                showCamera={showCamera}
                fileInputRefs={fileInputRefs}
                photoFileRef={photoFileRef}
                reuploadDocTypes={reuploadDocTypes}
                documentRejectReasons={documentRejectReasons}
                openSections={openSections}
                incompleteSubmission={incompleteSubmission}
                onToggleSection={(id: string) => setOpenSections(p => ({ ...p, [id]: !p[id] }))}
                onShowCamera={() => setShowCamera(true)}
                onHideCamera={() => setShowCamera(false)}
                onFileChange={(docType: string, file: File, label: string) => handleFileUpload(docType, file, label)}
                onPhotoFileChange={(file: File) => handlePhotoFileUpload(file)}
                onPhotoCapture={handlePhotoCapture}
                onBack={() => {}}
                onSubmit={handleSubmitKyc}
                submitting={submitting}
                onExperienceChange={setExperience}
                onQualificationChange={setQualification}
                onSaveConfig={handleSaveConfig}
                savingConfig={savingConfig}
              />
            </motion.div>
          )}

          {/* ── STATUS VIEW ──────────────────────────────────────────────────────── */}
          {flowStep === 'STATUS' && (
            <motion.div key="status" {...fadeSlide}>
              <StatusScreen
                kycStatus={kycStatus}
                rejectionReason={rejectionReason}
                reuploadDocTypes={reuploadDocTypes}
                documentRejectReasons={documentRejectReasons}
                experience={experience || (kyc?.fresherOrExperienced as Experience)}
                qualification={qualification || (kyc?.highestQualification as Qualification)}
                submittedDocs={submittedDocs}
                photoUrl={photoUrl}
                onStartReupload={() => {
                  setUploadMode('SEPARATE');
                  if (kyc?.fresherOrExperienced) setExperience(kyc.fresherOrExperienced as Experience);
                  if (kyc?.highestQualification) setQualification(kyc.highestQualification as Qualification);
                  setFlowStep('SEPARATE_UPLOAD');
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Animations ────────────────────────────────────────────────────────────────

const fadeSlide = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18 },
};

// ─── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ flowStep }: { flowStep: FlowStep }) {
  const steps = [
    { id: 'SEPARATE_UPLOAD', label: 'Upload Docs' },
    { id: 'STATUS', label: 'Review' },
  ];

  const currentIdx = steps.findIndex(s => s.id === flowStep);

  return (
    <div className="flex items-center justify-center mb-8 gap-1">
      {steps.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step.id} className="flex items-center">
            <div className={cn(
              'flex flex-col items-center gap-1',
            )}>
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                done ? 'bg-emerald-500 text-white' :
                active ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                'bg-gray-200 text-gray-400'
              )}>
                {done ? <CheckCircle2 size={16} /> : idx + 1}
              </div>
              <span className={cn('text-[9px] sm:text-[10px] whitespace-nowrap', active ? 'text-brand-600 font-medium' : 'text-gray-400')}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn('w-10 h-0.5 mx-1 mb-4', done ? 'bg-emerald-400' : 'bg-gray-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Profile Info ───────────────────────────────────────────────────────

function ProfileInfoScreen({ experience, qualification, onExperienceChange, onQualificationChange, onNext, saving }: {
  experience: Experience; qualification: Qualification;
  onExperienceChange: (e: Experience) => void;
  onQualificationChange: (q: Qualification) => void;
  onNext: () => void; saving: boolean;
}) {
  const qualOptions: Array<{ value: Qualification; label: string }> = [
    { value: 'TENTH', label: '10th / SSLC' },
    { value: 'TWELFTH', label: '12th / Intermediate / PUC' },
    { value: 'GRADUATION', label: 'Graduation / Bachelor\'s Degree' },
    { value: 'POST_GRADUATION', label: 'Post-Graduation / Master\'s Degree' },
    { value: 'PHD', label: 'PhD / Doctorate' },
  ];

  return (
    <div className="layer-card p-8">
      <h2 className="text-lg font-display font-bold text-gray-900 mb-1">Tell us about your background</h2>
      <p className="text-sm text-gray-500 mb-6">This helps us show you the exact documents you need to upload.</p>

      {/* Fresher / Experienced */}
      <div className="mb-5">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Are you a fresher or do you have work experience?</label>
        <div className="grid grid-cols-2 gap-3">
          {(['FRESHER', 'EXPERIENCED'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => onExperienceChange(opt)}
              className={cn(
                'py-3 rounded-xl border-2 text-sm font-medium transition-all',
                experience === opt ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300'
              )}
            >
              {opt === 'FRESHER' ? '🎓 Fresher / First Job' : '💼 Experienced'}
            </button>
          ))}
        </div>
      </div>

      {/* Highest Qualification */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Highest qualification</label>
        <div className="space-y-2">
          {qualOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onQualificationChange(opt.value)}
              className={cn(
                'w-full text-left py-3 px-4 rounded-xl border-2 text-sm transition-all flex items-center justify-between',
                qualification === opt.value ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300'
              )}
            >
              <span>{opt.label}</span>
              {qualification === opt.value && <CheckCircle2 size={16} className="text-brand-500" />}
            </button>
          ))}
        </div>
      </div>

      {/* Document preview based on selection */}
      {experience && qualification && (
        <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-xs font-semibold text-gray-600 mb-2">Documents you'll need to upload:</p>
          <div className="space-y-1">
            {computeRequiredDocs(experience, qualification).map(doc => (
              <div key={doc.type} className="flex items-center gap-2 text-xs text-gray-600">
                <div className={cn('w-1.5 h-1.5 rounded-full', doc.required ? 'bg-brand-500' : 'bg-gray-400')} />
                <span>{doc.label}</span>
                {!doc.required && <span className="text-gray-400">(if applicable)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onNext}
        disabled={!experience || !qualification || saving}
        className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : null}
        Go to Document Checklist
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

// ─── Step 3B: Separate Upload ───────────────────────────────────────────────────

function SubmitConfirmDialog({
  requiredDocs, submittedDocs, hasPhoto, onConfirm, onCancel, submitting,
}: {
  requiredDocs: RequiredDoc[];
  submittedDocs: string[];
  hasPhoto: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center">
              <CheckCircle2 size={18} className="text-brand-600" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Submit for HR Review?</p>
              <p className="text-xs text-gray-500">Please confirm all documents below are correct</p>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 max-h-72 overflow-y-auto space-y-1.5">
          {requiredDocs.map(doc => {
            const submitted = doc.type === 'PHOTO' ? hasPhoto : isDocTypeSubmitted(doc, submittedDocs);
            const label = doc.label.replace(' (any one)', '');
            return (
              <div key={doc.type} className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                submitted ? 'bg-emerald-50' : doc.required ? 'bg-red-50' : 'bg-gray-50',
              )}>
                {submitted
                  ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                  : doc.required
                  ? <XCircle size={14} className="text-red-400 shrink-0" />
                  : <Info size={14} className="text-gray-300 shrink-0" />}
                <span className={cn('flex-1', submitted ? 'text-gray-700' : doc.required ? 'text-red-600' : 'text-gray-400')}>
                  {label}
                </span>
                <span className={cn('text-xs font-medium', submitted ? 'text-emerald-600' : doc.required ? 'text-red-500' : 'text-gray-400')}>
                  {submitted ? 'Ready' : doc.required ? 'Missing' : 'Skipped'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="px-5 pb-5 pt-3 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Go Back
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            Confirm Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Config Section ────────────────────────────────────────────────────

function ProfileConfigSection({
  experience, qualification, saving, onExperienceChange, onQualificationChange, onSave,
}: {
  experience: Experience; qualification: Qualification; saving: boolean;
  onExperienceChange: (e: Experience) => void;
  onQualificationChange: (q: Qualification) => void;
  onSave: () => Promise<boolean>;
}) {
  const needsSetup = !experience || !qualification;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (needsSetup) setEditing(true);
  }, [needsSetup]);

  const qualOptions: Array<{ value: Qualification; label: string }> = [
    { value: 'NONE', label: 'None — No formal education' },
    { value: 'TENTH', label: '10th / SSLC' },
    { value: 'TWELFTH', label: '12th / Intermediate / PUC' },
    { value: 'GRADUATION', label: "Graduation / Bachelor's Degree" },
    { value: 'POST_GRADUATION', label: "Post-Graduation / Master's Degree" },
    { value: 'PHD', label: 'PhD / Doctorate' },
  ];

  if (!editing) {
    return (
      <div className="layer-card p-4 border border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Your Profile</p>
          <p className="text-sm font-semibold text-gray-800">
            {experience === 'EXPERIENCED' ? '💼 Experienced' : '🎓 Fresher'}{' '}·{' '}
            {QUAL_LABELS[qualification!] || qualification}
          </p>
        </div>
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 font-medium underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="layer-card p-5 border-2 border-brand-200">
      <p className="text-sm font-bold text-gray-900 mb-4">
        {needsSetup ? 'Tell us about yourself to continue' : 'Update your profile'}
      </p>

      <div className="mb-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">Your work experience</p>
        <div className="grid grid-cols-2 gap-2">
          {(['FRESHER', 'EXPERIENCED'] as const).map(opt => (
            <button key={opt} onClick={() => onExperienceChange(opt)}
              className={cn('py-2.5 rounded-xl border-2 text-sm font-medium transition-all',
                experience === opt
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-600 hover:border-brand-300'
              )}>
              {opt === 'FRESHER' ? '🎓 Fresher / First Job' : '💼 Experienced'}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-600 mb-2">Highest qualification</p>
        <div className="space-y-1.5">
          {qualOptions.map(opt => (
            <button key={String(opt.value)} onClick={() => onQualificationChange(opt.value)}
              className={cn('w-full text-left py-2.5 px-4 rounded-xl border-2 text-sm transition-all flex items-center justify-between',
                qualification === opt.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:border-brand-300'
              )}>
              {opt.label}
              {qualification === opt.value && <CheckCircle2 size={15} className="text-brand-500 shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {experience && qualification && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs font-semibold text-blue-700 mb-1.5">Documents you'll need to upload:</p>
          <div className="space-y-0.5">
            {computeRequiredDocs(experience, qualification).map(doc => (
              <div key={doc.type} className="flex items-center gap-2 text-xs text-blue-700">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                {doc.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!needsSetup && (
          <button onClick={() => setEditing(false)}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        )}
        <button
          onClick={async () => { const ok = await onSave(); if (ok) setEditing(false); }}
          disabled={!experience || !qualification || saving}
          className="flex-1 btn-primary text-sm py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {needsSetup ? 'Continue to Upload' : 'Save & Update'}
        </button>
      </div>
    </div>
  );
}

// ─── Separate Upload Screen ─────────────────────────────────────────────────────

function SeparateUploadScreen({
  experience, qualification, submittedDocs, photoUrl, uploading, scanningDocs, showCamera,
  fileInputRefs, photoFileRef, reuploadDocTypes, documentRejectReasons,
  openSections, onToggleSection, onShowCamera, onHideCamera,
  onFileChange, onPhotoFileChange, onPhotoCapture,
  onBack, onSubmit, submitting,
  incompleteSubmission,
  onExperienceChange, onQualificationChange, onSaveConfig, savingConfig,
}: any) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const hasPhoto = !!photoUrl || submittedDocs.includes('PHOTO');
  const requiredDocs = computeRequiredDocs(experience, qualification);

  const mandatoryComplete = requiredDocs
    .filter(d => d.required)
    .every(d => d.type === 'PHOTO' ? hasPhoto : isDocTypeSubmitted(d, submittedDocs));

  const completedCount = requiredDocs.filter(d => d.type === 'PHOTO' ? hasPhoto : isDocTypeSubmitted(d, submittedDocs)).length;

  const canSubmit = mandatoryComplete;
  const needsConfig = !experience || !qualification;

  // Group docs into sections
  const sections = [
    {
      id: 'education',
      title: 'Education Certificates',
      icon: GraduationCap,
      docs: requiredDocs.filter(d => ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'].includes(d.type)),
    },
    {
      id: 'identity',
      title: 'Identity Proof (any one)',
      icon: ShieldCheck,
      docs: requiredDocs.filter(d => d.type === 'IDENTITY_PROOF'),
      expanded: true,
    },
    {
      id: 'pan',
      title: 'PAN Card',
      icon: CreditCard,
      docs: requiredDocs.filter(d => d.type === 'PAN'),
    },
    {
      id: 'residence',
      title: 'Residence Proof',
      icon: Home,
      docs: requiredDocs.filter(d => d.type === 'RESIDENCE_PROOF'),
    },
    ...(experience === 'EXPERIENCED' ? [{
      id: 'employment',
      title: 'Previous Employment Proof',
      icon: Briefcase,
      docs: requiredDocs.filter(d => d.type === 'EMPLOYMENT_PROOF'),
    }] : []),
    {
      id: 'bank',
      title: 'Bank Document (Cancelled Cheque)',
      icon: Banknote,
      docs: requiredDocs.filter(d => d.type === 'CANCELLED_CHEQUE'),
    },
    {
      id: 'photo',
      title: 'Passport Size Photo',
      icon: Image,
      isPhotoSection: true,
      docs: requiredDocs.filter(d => d.type === 'PHOTO'),
    },
  ].filter(s => s.docs.length > 0);

  return (
    <div className="space-y-4">
      {/* Profile config — always shown at top; auto-expands when not yet set */}
      <ProfileConfigSection
        experience={experience}
        qualification={qualification}
        saving={savingConfig}
        onExperienceChange={onExperienceChange}
        onQualificationChange={onQualificationChange}
        onSave={onSaveConfig}
      />

      {/* Warning: employee was in SUBMITTED state but with missing docs (old bypass victims) */}
      {incompleteSubmission && !needsConfig && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-500" />
          <div>
            <p className="font-semibold">Your previous submission is incomplete</p>
            <p className="text-xs mt-0.5 text-red-600">
              Some required documents are missing. Upload them below, then re-submit for HR review.
            </p>
          </div>
        </div>
      )}

      {/* Doc sections only shown after profile is configured */}
      {needsConfig ? (
        <div className="text-center py-10 text-gray-400">
          <FileText size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Set your profile above to see your required documents</p>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="layer-card p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">{completedCount}/{requiredDocs.length} documents uploaded</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', mandatoryComplete ? 'bg-emerald-500' : 'bg-brand-500')}
                style={{ width: requiredDocs.length > 0 ? `${Math.round((completedCount / requiredDocs.length) * 100)}%` : '0%' }}
              />
            </div>
          </div>

          {/* Document sections */}
          {sections.map(section => {
        const isOpen = openSections[section.id] !== false; // default open
        const SectionIcon = section.icon;
        const sectionComplete = section.isPhotoSection
          ? hasPhoto
          : section.docs.every(d => isDocTypeSubmitted(d, submittedDocs));

        const sectionNeedsReupload = section.docs.some(d => {
          if (d.acceptsAnyOf) return d.acceptsAnyOf.some(t => reuploadDocTypes.includes(t));
          return reuploadDocTypes.includes(d.type);
        });

        return (
          <div key={section.id} className={cn('layer-card border overflow-hidden',
            sectionNeedsReupload ? 'border-orange-300' : sectionComplete ? 'border-emerald-200' : 'border-gray-200'
          )}>
            <button
              onClick={() => onToggleSection(section.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50/50"
            >
              <div className="flex items-center gap-3">
                {sectionComplete ? (
                  <CheckCircle2 size={20} className="text-emerald-500" />
                ) : sectionNeedsReupload ? (
                  <AlertTriangle size={20} className="text-orange-500" />
                ) : (
                  <SectionIcon size={20} className="text-gray-400" />
                )}
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-800">{section.title}</p>
                  {sectionNeedsReupload && <p className="text-xs text-orange-600">Re-upload required</p>}
                </div>
              </div>
              {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>

            <AnimatePresence>
              {isOpen && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-4 space-y-3">
                    {section.isPhotoSection ? (
                      <PhotoUploadSection
                        hasPhoto={hasPhoto} photoUrl={photoUrl} uploading={uploading}
                        isScanning={scanningDocs?.has('PHOTO')}
                        showCamera={openSections._camera} onShowCamera={() => onShowCamera()}
                        onHideCamera={() => onHideCamera()} photoFileRef={photoFileRef}
                        onPhotoFileChange={onPhotoFileChange} onPhotoCapture={onPhotoCapture}
                      />
                    ) : (
                      section.docs.map(doc => (
                        <DocUploadRow
                          key={doc.type}
                          doc={doc}
                          submittedDocs={submittedDocs}
                          uploading={uploading}
                          scanningDocs={scanningDocs}
                          fileInputRefs={fileInputRefs}
                          reuploadDocTypes={reuploadDocTypes}
                          documentRejectReasons={documentRejectReasons}
                          onFileChange={onFileChange}
                        />
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowConfirmDialog(true)}
              disabled={!canSubmit || submitting || uploading !== null}
              className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {incompleteSubmission ? 'Re-submit for HR Review' : 'Submit for HR Review'}
            </button>
          </div>
          {!canSubmit && (
            <p className="text-xs text-center text-amber-600 flex items-center justify-center gap-1">
              <AlertTriangle size={12} /> Upload all required documents marked with * to submit
            </p>
          )}

          {/* Confirmation dialog — employee reviews document list before final submit */}
          {showConfirmDialog && (
            <SubmitConfirmDialog
              requiredDocs={requiredDocs}
              submittedDocs={submittedDocs}
              hasPhoto={hasPhoto}
              onConfirm={() => { setShowConfirmDialog(false); onSubmit(); }}
              onCancel={() => setShowConfirmDialog(false)}
              submitting={submitting}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Doc Upload Row ─────────────────────────────────────────────────────────────

function DocUploadRow({ doc, submittedDocs, uploading, scanningDocs, fileInputRefs, reuploadDocTypes, documentRejectReasons, onFileChange }: any) {
  const isSubmitted = isDocTypeSubmitted(doc, submittedDocs);
  const needsReupload = doc.acceptsAnyOf
    ? doc.acceptsAnyOf.some((t: string) => reuploadDocTypes.includes(t))
    : reuploadDocTypes.includes(doc.type);

  // For identity/employment proof: show individual identity type buttons
  if (doc.acceptsAnyOf) {
    const typeLabels: Record<string, string> = {
      AADHAAR: 'Aadhaar Card', PASSPORT: 'Passport',
      DRIVING_LICENSE: 'Driving License', VOTER_ID: 'Voter ID',
      EXPERIENCE_LETTER: 'Experience Letter', RELIEVING_LETTER: 'Relieving Letter',
      OFFER_LETTER_DOC: 'Appointment Letter', SALARY_SLIP_DOC: 'Salary Slips',
    };

    const submittedOne = doc.acceptsAnyOf.find((t: string) => submittedDocs.includes(t));
    const anyScanningAnyOf = doc.acceptsAnyOf.some((t: string) => scanningDocs?.has(t));

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-700">{doc.label} {doc.required && <span className="text-red-400">*</span>}</p>
          {isSubmitted && <CheckCircle2 size={14} className="text-emerald-500" />}
          {anyScanningAnyOf && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-600 font-medium">
              <Loader2 size={10} className="animate-spin" /> Scanning…
            </span>
          )}
        </div>
        {doc.hint && <p className="text-xs text-gray-400">{doc.hint}</p>}

        {isSubmitted && submittedOne && (
          <p className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 size={12} /> {typeLabels[submittedOne] || submittedOne} submitted
          </p>
        )}

        {needsReupload && (
          <ReuploadBanner reason={documentRejectReasons[submittedOne] || 'Re-upload requested by HR'} />
        )}

        <div className="grid grid-cols-2 gap-2">
          {doc.acceptsAnyOf.map((type: string) => {
            const isTypeSubmitted = submittedDocs.includes(type);
            const isUploading = uploading === type;
            const isTypeScanning = scanningDocs?.has(type);
            return (
              <div key={type} className={cn('relative rounded-lg border p-2.5 text-xs flex items-center justify-between',
                isTypeSubmitted ? 'border-emerald-200 bg-emerald-50' : isTypeScanning ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white'
              )}>
                <span className={isTypeSubmitted ? 'text-emerald-700 font-medium' : isTypeScanning ? 'text-indigo-700 font-medium' : 'text-gray-600'}>
                  {typeLabels[type] || type}
                </span>
                {isTypeScanning ? (
                  <span className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700 shrink-0 ml-1">
                    <Loader2 size={9} className="animate-spin" /> Scanning
                  </span>
                ) : (
                  <label className={cn('cursor-pointer px-2 py-1 rounded text-[10px] font-medium shrink-0 ml-1',
                    isTypeSubmitted ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
                  )}>
                    {isUploading ? <Loader2 size={10} className="animate-spin inline" /> : isTypeSubmitted ? 'Replace' : 'Upload'}
                    <input type="file" className="hidden" accept="image/*,.pdf"
                      onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(type, f, typeLabels[type]); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const isUploading = uploading === doc.type;
  const isScanning = scanningDocs?.has(doc.type);

  return (
    <div>
      <div className={cn('p-3 rounded-xl border flex items-center justify-between',
        isSubmitted ? 'border-emerald-200 bg-emerald-50/50' :
        needsReupload ? 'border-orange-200 bg-orange-50/50' :
        isScanning ? 'border-indigo-200 bg-indigo-50/50' :
        'border-gray-100 bg-gray-50/30'
      )}>
        <div className="flex items-center gap-3 min-w-0">
          {isScanning ? <Loader2 size={16} className="text-indigo-500 shrink-0 animate-spin" /> :
           isSubmitted ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> :
           needsReupload ? <AlertTriangle size={16} className="text-orange-500 shrink-0" /> :
           <FileText size={16} className="text-gray-400 shrink-0" />}
          <div>
            <p className="text-sm font-medium text-gray-700">
              {doc.label} {doc.required && <span className="text-red-400">*</span>}
            </p>
            {isScanning
              ? <p className="text-xs text-indigo-500 animate-pulse">AI scanning document…</p>
              : doc.hint && <p className="text-xs text-gray-400">{doc.hint}</p>
            }
          </div>
        </div>
        {isScanning ? (
          <span className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 bg-indigo-100 text-indigo-600">
            <Loader2 size={11} className="animate-spin" /> Scanning
          </span>
        ) : (
          <label className={cn('shrink-0 text-xs cursor-pointer px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-all',
            isSubmitted ? 'bg-emerald-100 text-emerald-700' : 'btn-primary'
          )}>
            {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {isUploading ? 'Uploading' : isSubmitted ? 'Replace' : 'Upload'}
            <input ref={el => { fileInputRefs.current[doc.type] = el; }} type="file" className="hidden"
              accept="image/*,.pdf" disabled={isUploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(doc.type, f, doc.label); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {needsReupload && <ReuploadBanner reason={documentRejectReasons[doc.type] || 'Re-upload requested by HR'} />}
    </div>
  );
}

function ReuploadBanner({ reason }: { reason: string }) {
  return (
    <div className="mt-1 flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-2.5 text-xs text-orange-700">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <div><span className="font-medium">Re-upload required:</span> {reason}</div>
    </div>
  );
}

// ─── Photo Upload Section ───────────────────────────────────────────────────────

function PhotoUploadSection({ hasPhoto, photoUrl, uploading, isScanning, showCamera, onShowCamera, onHideCamera, photoFileRef, onPhotoFileChange, onPhotoCapture }: any) {
  return (
    <div>
      <div className={cn('p-4 rounded-xl border',
        isScanning ? 'border-indigo-200 bg-indigo-50/30' :
        hasPhoto ? 'border-emerald-200 bg-emerald-50/30' :
        'border-gray-100 bg-gray-50/30'
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isScanning ? <Loader2 size={18} className="text-indigo-500 animate-spin" /> :
             hasPhoto ? <CheckCircle2 size={18} className="text-emerald-500" /> :
             <Camera size={18} className="text-gray-400" />}
            <div>
              <p className="text-sm font-medium text-gray-700">Passport Size Photo <span className="text-red-400">*</span></p>
              {isScanning
                ? <p className="text-xs text-indigo-500 animate-pulse">AI scanning photo…</p>
                : <p className="text-xs text-gray-400">Clear, front-facing, plain background</p>
              }
            </div>
          </div>
          {photoUrl && (
            <img src={getUploadUrl(photoUrl)} alt="KYC Photo" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input ref={photoFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="hidden"
            disabled={uploading === 'PHOTO'}
            onChange={e => { const f = e.target.files?.[0]; if (f) onPhotoFileChange(f); e.target.value = ''; }} />
          <button onClick={() => photoFileRef.current?.click()} disabled={uploading === 'PHOTO'}
            className="text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 btn-primary disabled:opacity-50">
            {uploading === 'PHOTO' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload Photo
          </button>
          <button onClick={onShowCamera} disabled={uploading === 'PHOTO'}
            className="text-xs px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
            <Camera size={12} /> Capture
          </button>
        </div>
        {showCamera && (
          <div className="mt-3">
            <CameraCapture onCapture={onPhotoCapture} onCancel={onHideCamera} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Status Screen ──────────────────────────────────────────────────────────────

function StatusScreen({
  kycStatus, rejectionReason, reuploadDocTypes, documentRejectReasons,
  experience, qualification, submittedDocs, photoUrl, onStartReupload,
}: any) {
  const navigate = useNavigate();
  const cfg = KYC_STATUS_CONFIG[kycStatus] || KYC_STATUS_CONFIG.PENDING;
  const StatusIcon = cfg.icon;
  const hasPhoto = !!photoUrl || (submittedDocs || []).includes('PHOTO');

  const canReupload = ['REUPLOAD_REQUIRED', 'REJECTED'].includes(kycStatus);

  return (
    <div className="space-y-4">
      {/* Main status banner */}
      <div className={cn('layer-card p-5 border flex items-start gap-4', cfg.bg, cfg.border)}>
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', cfg.bg)}>
          <StatusIcon size={22} className={cn(cfg.color, kycStatus === 'PROCESSING' && 'animate-spin')} />
        </div>
        <div>
          <p className={cn('font-bold text-sm', cfg.color)}>{cfg.title}</p>
          <p className="text-xs text-gray-600 mt-0.5">{cfg.subtitle}</p>
          {rejectionReason && ['REJECTED', 'REUPLOAD_REQUIRED'].includes(kycStatus) && (
            <p className="text-xs text-red-600 mt-1.5 font-medium">Reason: {rejectionReason}</p>
          )}
        </div>
      </div>

      {/* Document summary */}
      <div className="layer-card p-5 border border-gray-200">
        <p className="text-sm font-semibold text-gray-700 mb-3">Documents Submitted</p>

        <div className="space-y-1.5">
            {computeRequiredDocs(experience, qualification).map(doc => {
              const submitted = isDocTypeSubmitted(doc, submittedDocs);
              const needsReupload = doc.acceptsAnyOf
                ? doc.acceptsAnyOf.some(t => reuploadDocTypes.includes(t))
                : reuploadDocTypes.includes(doc.type);
              const hasDoc = doc.type === 'PHOTO' ? hasPhoto : submitted;

              return (
                <div key={doc.type} className={cn(
                  'flex items-center gap-3 py-1.5 px-3 rounded-lg',
                  needsReupload ? 'bg-orange-50' : hasDoc ? 'bg-emerald-50' : doc.required ? 'bg-red-50' : 'bg-gray-50'
                )}>
                  {needsReupload ? (
                    <AlertTriangle size={14} className="text-orange-500 shrink-0" />
                  ) : hasDoc ? (
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle size={14} className={doc.required ? 'text-red-400 shrink-0' : 'text-gray-300 shrink-0'} />
                  )}
                  <span className="text-xs text-gray-700 flex-1">{doc.label}</span>
                  <span className={cn('text-[10px] font-medium', needsReupload ? 'text-orange-600' : hasDoc ? 'text-emerald-600' : doc.required ? 'text-red-500' : 'text-gray-400')}>
                    {needsReupload ? 'Re-upload' : hasDoc ? 'Submitted' : doc.required ? 'Missing' : 'Optional'}
                  </span>
                </div>
              );
            })}
        </div>

        {/* Per-doc rejection reasons */}
        {reuploadDocTypes.length > 0 && Object.keys(documentRejectReasons).length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold text-orange-700">Documents needing attention:</p>
            {Object.entries(documentRejectReasons).map(([docType, reason]) => (
              <div key={docType} className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg p-2 text-xs text-orange-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <div><span className="font-medium">{docType.replace(/_/g, ' ')}:</span> {reason as string}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-document re-upload tips — helps employee fix the issue on first try */}
      {canReupload && reuploadDocTypes?.length > 0 && (
        <div className="layer-card p-4 space-y-2 border border-orange-100 bg-orange-50/30">
          <p className="text-xs font-semibold text-orange-800 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Tips for re-uploading your documents
          </p>
          {(reuploadDocTypes as string[]).map((dt: string) => {
            const tips: Record<string, string> = {
              AADHAAR: 'Photograph all 4 corners clearly. Both sides if required. Use original government-issued card — not a photocopy.',
              PAN: 'Upload the full PAN card. Ensure your name, DOB, and PAN number are clearly readable.',
              PASSPORT: 'Upload the bio-data page (with photo). Ensure passport number and expiry date are visible.',
              VOTER_ID: 'Upload both front and back. Ensure your EPIC number is fully visible.',
              DRIVING_LICENSE: 'Upload both sides. Ensure your licence number and validity date are clear.',
              PHOTO: 'Plain white or light background. Front-facing, clear face, no sunglasses. JPEG or PNG, under 5MB.',
              TENTH_CERTIFICATE: 'Upload your marksheet — not just the passing certificate. Student name and roll number must be visible.',
              TWELFTH_CERTIFICATE: 'Upload your marksheet — not just the passing certificate. Student name and roll number must be visible.',
              DEGREE_CERTIFICATE: 'Upload the final degree certificate. Your full name and enrollment number must be readable.',
              RESIDENCE_PROOF: 'Upload a utility bill, bank statement, or rent agreement dated within the last 3 months.',
              CANCELLED_CHEQUE: 'Upload a cancelled cheque of your salary account. Account holder name and account number must match.',
            };
            const tip = tips[dt] || 'Ensure all text is clearly visible and the document is not blurry or cut off.';
            return (
              <div key={dt} className="flex items-start gap-2 text-xs text-orange-700">
                <span className="shrink-0 font-semibold mt-0.5">{dt.replace(/_/g, ' ')}:</span>
                <span>{tip}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Re-upload button */}
      {canReupload && (
        <button onClick={onStartReupload} className="w-full btn-primary flex items-center justify-center gap-2 text-sm">
          <RefreshCw size={15} /> Re-upload Documents
        </button>
      )}

      {/* Go to Dashboard — shown when KYC is VERIFIED */}
      {kycStatus === 'VERIFIED' && (
        <div className="space-y-3">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-700">All documents verified!</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Your KYC is complete. You now have full access to your Aniston HRMS dashboard.
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm transition-colors shadow-sm"
          >
            <LayoutDashboard size={16} /> Go to Dashboard
          </button>
        </div>
      )}

      {/* Dashboard access note — only when not verified */}
      {!['VERIFIED'].includes(kycStatus) && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-700">
          <Clock size={13} className="mt-0.5 shrink-0" />
          <span>Your dashboard access is held until HR completes the document verification.</span>
        </div>
      )}
    </div>
  );
}
