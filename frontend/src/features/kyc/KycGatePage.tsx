import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Camera, Upload, CheckCircle2, Clock, XCircle, Loader2,
  AlertTriangle, Info, FileUp, GraduationCap, ShieldCheck, CreditCard,
  Home, Briefcase, Award, Image, ArrowRight, ArrowLeft, RefreshCw,
  ChevronDown, ChevronUp, Eye,
} from 'lucide-react';
import { useAppSelector } from '../../app/store';
import {
  useGetMyKycStatusQuery,
  useSaveKycConfigMutation,
  useUploadKycDocumentMutation,
  useUploadKycPhotoMutation,
  useUploadCombinedPdfMutation,
  useUploadPhotoFileMutation,
  useSubmitKycMutation,
} from './kycApi';
import CameraCapture from './CameraCapture';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { getUploadUrl } from '../../lib/utils';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type UploadMode = 'COMBINED' | 'SEPARATE' | null;
type Experience = 'FRESHER' | 'EXPERIENCED' | null;
type Qualification = 'TENTH' | 'TWELFTH' | 'GRADUATION' | 'POST_GRADUATION' | 'PHD' | null;

type FlowStep =
  | 'MODE_SELECT'      // Step 1: Choose combined vs separate
  | 'PROFILE_INFO'     // Step 2: Fresher/experienced + qualification
  | 'COMBINED_UPLOAD'  // Step 3A: Combined PDF + photo
  | 'SEPARATE_UPLOAD'  // Step 3B: Separate docs
  | 'STATUS';          // Final: submission status

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
  const qualIdx = qualification ? QUALIFICATION_ORDER.indexOf(qualification) : 2; // default: GRADUATION

  // Education chain
  if (qualIdx >= 0) docs.push({ type: 'TENTH_CERTIFICATE', label: '10th Marksheet / Certificate', required: true });
  if (qualIdx >= 1) docs.push({ type: 'TWELFTH_CERTIFICATE', label: '12th Marksheet / Certificate', required: true });
  if (qualIdx >= 2) docs.push({ type: 'DEGREE_CERTIFICATE', label: 'Graduation / Degree Certificate', required: true });
  if (qualIdx >= 3) docs.push({ type: 'POST_GRADUATION_CERTIFICATE', label: 'Post-Graduation Certificate', required: true });
  if (qualIdx >= 4) docs.push({ type: 'POST_GRADUATION_CERTIFICATE', label: 'PhD / Doctorate Certificate', hint: 'Upload your PhD completion certificate', required: true });

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

  // Employment proof
  if (experience === 'EXPERIENCED') {
    docs.push({
      type: 'EMPLOYMENT_PROOF',
      label: 'Previous Employment Proof (any one)',
      hint: 'Experience Letter, Relieving Letter, Appointment Letter, or Salary Slips',
      required: false, // strongly expected but not hard-blocked
      acceptsAnyOf: EMPLOYMENT_TYPES,
    });
  }

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
  TENTH: '10th / SSLC',
  TWELFTH: '12th / Intermediate / PUC',
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
  const [uploadCombinedPdf] = useUploadCombinedPdfMutation();
  const [uploadPhotoFile] = useUploadPhotoFileMutation();
  const [submitKyc, { isLoading: submitting }] = useSubmitKycMutation();

  // Real-time: refetch when HR verifies/rejects
  useEffect(() => {
    const handler = () => { refetch(); };
    onSocketEvent('kyc:status-changed', handler);
    return () => { offSocketEvent('kyc:status-changed', handler); };
  }, [refetch]);

  // Polling while combined PDF is being classified (PROCESSING state, ~3s interval)
  useEffect(() => {
    if (kycStatus !== 'PROCESSING') return;
    const timer = setInterval(() => { refetch(); }, 3000);
    return () => clearInterval(timer);
  }, [kycStatus, refetch]);

  // Local flow state
  const [flowStep, setFlowStep] = useState<FlowStep>('MODE_SELECT');
  const [uploadMode, setUploadMode] = useState<UploadMode>(null);
  const [experience, setExperience] = useState<Experience>(null);
  const [qualification, setQualification] = useState<Qualification>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const combinedPdfRef = useRef<HTMLInputElement | null>(null);
  const photoFileRef = useRef<HTMLInputElement | null>(null);

  const kyc = kycRes?.data;
  const kycStatus: string = kyc?.kycStatus || 'PENDING';
  const submittedDocs: string[] = (kyc?.submittedDocs || []) as string[];
  const photoUrl: string | null = kyc?.photoUrl || null;
  const combinedPdfUploaded = kyc?.combinedPdfUploaded || false;
  const rejectionReason: string | null = kyc?.rejectionReason || null;
  const reuploadDocTypes: string[] = (kyc?.reuploadDocTypes || []) as string[];
  const documentRejectReasons: Record<string, string> = (kyc?.documentRejectReasons || {}) as Record<string, string>;

  // Restore saved mode from gate (for page reload)
  useEffect(() => {
    if (kyc?.uploadMode && !uploadMode) {
      setUploadMode(kyc.uploadMode as UploadMode);
      setExperience((kyc.fresherOrExperienced || 'FRESHER') as Experience);
      setQualification((kyc.highestQualification || 'GRADUATION') as Qualification);
      // If already configured, go to upload step
      if (kycStatus === 'PENDING' || kycStatus === 'REUPLOAD_REQUIRED') {
        setFlowStep(kyc.uploadMode === 'COMBINED' ? 'COMBINED_UPLOAD' : 'SEPARATE_UPLOAD');
      } else {
        setFlowStep('STATUS');
      }
    } else if (!kyc?.uploadMode && ['SUBMITTED', 'PROCESSING', 'PENDING_HR_REVIEW', 'VERIFIED', 'REJECTED'].includes(kycStatus)) {
      setFlowStep('STATUS');
    }
  }, [kyc, kycStatus, uploadMode]);

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

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    if (!uploadMode || !experience || !qualification) {
      toast.error('Please fill in all fields');
      return;
    }
    if (!user?.employeeId) {
      toast.error('Employee profile not linked. Please contact HR.');
      return;
    }
    try {
      await saveKycConfig({
        employeeId: user.employeeId,
        uploadMode,
        fresherOrExperienced: experience,
        highestQualification: qualification,
      }).unwrap();
      setFlowStep(uploadMode === 'COMBINED' ? 'COMBINED_UPLOAD' : 'SEPARATE_UPLOAD');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save configuration');
    }
  };

  const handleFileUpload = useCallback(async (docType: string, file: File, docName?: string) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', docType);
      formData.append('name', docName || docType.replace(/_/g, ' '));
      formData.append('employeeId', user.employeeId);
      await uploadDoc({ employeeId: user.employeeId, formData }).unwrap();
      toast.success(`${(docName || docType).replace(/_/g, ' ')} uploaded`);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
    setUploading(null);
  }, [user, uploadDoc, refetch]);

  const handleCombinedPdfUpload = async (file: File) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    setUploading('COMBINED_PDF');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await uploadCombinedPdf({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Combined PDF uploaded — OCR is processing your documents');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Upload failed');
    }
    setUploading(null);
  };

  const handlePhotoCapture = async (blob: Blob) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    setShowCamera(false);
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('photo', blob, 'kyc-photo.jpg');
      await uploadPhoto({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Photo captured successfully');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Photo upload failed');
    }
    setUploading(null);
  };

  const handlePhotoFileUpload = async (file: File) => {
    if (!user?.employeeId) { toast.error('Employee profile not linked.'); return; }
    setUploading('PHOTO');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await uploadPhotoFile({ employeeId: user.employeeId, formData }).unwrap();
      toast.success('Photo uploaded successfully');
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Photo upload failed');
    }
    setUploading(null);
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
    <div className="min-h-screen bg-surface-1 py-8 px-4">
      <div className="max-w-2xl mx-auto">

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
        <StepIndicator flowStep={flowStep} uploadMode={uploadMode} />

        <AnimatePresence mode="wait">
          {/* ── STEP 1: MODE SELECTION ───────────────────────────────────────────── */}
          {flowStep === 'MODE_SELECT' && (
            <motion.div key="mode-select" {...fadeSlide}>
              <ModeSelectScreen
                uploadMode={uploadMode}
                onSelect={(mode) => { setUploadMode(mode); setFlowStep('PROFILE_INFO'); }}
              />
            </motion.div>
          )}

          {/* ── STEP 2: PROFILE INFO ─────────────────────────────────────────────── */}
          {flowStep === 'PROFILE_INFO' && (
            <motion.div key="profile-info" {...fadeSlide}>
              <ProfileInfoScreen
                uploadMode={uploadMode!}
                experience={experience}
                qualification={qualification}
                onExperienceChange={setExperience}
                onQualificationChange={setQualification}
                onBack={() => setFlowStep('MODE_SELECT')}
                onNext={handleSaveConfig}
                saving={savingConfig}
              />
            </motion.div>
          )}

          {/* ── STEP 3A: COMBINED PDF UPLOAD ─────────────────────────────────────── */}
          {flowStep === 'COMBINED_UPLOAD' && (
            <motion.div key="combined-upload" {...fadeSlide}>
              <CombinedUploadScreen
                combinedPdfUploaded={combinedPdfUploaded}
                kycStatus={kycStatus}
                photoUrl={photoUrl}
                hasPhoto={!!photoUrl || submittedDocs.includes('PHOTO')}
                uploading={uploading}
                showCamera={showCamera}
                onShowCamera={() => setShowCamera(true)}
                onHideCamera={() => setShowCamera(false)}
                combinedPdfRef={combinedPdfRef}
                photoFileRef={photoFileRef}
                onCombinedPdfChange={(file) => handleCombinedPdfUpload(file)}
                onPhotoFileChange={(file) => handlePhotoFileUpload(file)}
                onPhotoCapture={handlePhotoCapture}
                onBack={() => setFlowStep('PROFILE_INFO')}
                onSubmit={handleSubmitKyc}
                submitting={submitting}
                experience={experience!}
                qualification={qualification!}
              />
            </motion.div>
          )}

          {/* ── STEP 3B: SEPARATE DOCUMENT UPLOAD ───────────────────────────────── */}
          {flowStep === 'SEPARATE_UPLOAD' && (
            <motion.div key="separate-upload" {...fadeSlide}>
              <SeparateUploadScreen
                experience={experience}
                qualification={qualification}
                submittedDocs={submittedDocs}
                photoUrl={photoUrl}
                uploading={uploading}
                showCamera={showCamera}
                fileInputRefs={fileInputRefs}
                photoFileRef={photoFileRef}
                reuploadDocTypes={reuploadDocTypes}
                documentRejectReasons={documentRejectReasons}
                openSections={openSections}
                onToggleSection={(id) => setOpenSections(p => ({ ...p, [id]: !p[id] }))}
                onShowCamera={() => setShowCamera(true)}
                onHideCamera={() => setShowCamera(false)}
                onFileChange={(docType, file, label) => handleFileUpload(docType, file, label)}
                onPhotoFileChange={(file) => handlePhotoFileUpload(file)}
                onPhotoCapture={handlePhotoCapture}
                onBack={() => setFlowStep('PROFILE_INFO')}
                onSubmit={handleSubmitKyc}
                submitting={submitting}
                onChangeMode={() => {
                  setFlowStep('MODE_SELECT');
                  setUploadMode(null);
                  setExperience(null);
                  setQualification(null);
                }}
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
                uploadMode={uploadMode || (kyc?.uploadMode as UploadMode)}
                combinedPdfAnalysis={kyc?.combinedPdfAnalysis}
                onStartReupload={() => {
                  const mode = (kyc?.uploadMode as UploadMode) || 'SEPARATE';
                  setUploadMode(mode);
                  setExperience((kyc?.fresherOrExperienced as Experience) || 'FRESHER');
                  setQualification((kyc?.highestQualification as Qualification) || 'GRADUATION');
                  setFlowStep(mode === 'COMBINED' ? 'COMBINED_UPLOAD' : 'SEPARATE_UPLOAD');
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

function StepIndicator({ flowStep, uploadMode }: { flowStep: FlowStep; uploadMode: UploadMode }) {
  const steps = [
    { id: 'MODE_SELECT', label: 'Upload Mode' },
    { id: 'PROFILE_INFO', label: 'Your Profile' },
    { id: uploadMode === 'COMBINED' ? 'COMBINED_UPLOAD' : 'SEPARATE_UPLOAD', label: 'Upload Docs' },
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
              <span className={cn('text-[10px] whitespace-nowrap hidden sm:block', active ? 'text-brand-600 font-medium' : 'text-gray-400')}>
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

// ─── Step 1: Mode Selection ─────────────────────────────────────────────────────

function ModeSelectScreen({ uploadMode, onSelect }: {
  uploadMode: UploadMode;
  onSelect: (mode: UploadMode) => void;
}) {
  return (
    <div className="layer-card p-8">
      <h2 className="text-lg font-display font-bold text-gray-900 mb-1">How would you like to submit your documents?</h2>
      <p className="text-sm text-gray-500 mb-6">Choose the method that works best for you.</p>

      <div className="grid gap-4">
        <ModeCard
          selected={uploadMode === 'COMBINED'}
          icon={FileUp}
          title="Upload Combined PDF"
          description="Scan all your documents into one PDF file and upload it together with your photo. Our OCR will automatically identify each document inside."
          recommended
          onSelect={() => onSelect('COMBINED')}
        />
        <ModeCard
          selected={uploadMode === 'SEPARATE'}
          icon={FileText}
          title="Upload Documents Separately"
          description="Upload each document one by one using the guided checklist. Recommended if you have individual scans for each document."
          onSelect={() => onSelect('SEPARATE')}
        />
      </div>

      <div className="mt-5 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-2 text-xs text-blue-700">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>All documents are reviewed by HR. Make sure scans are clear and complete. Avoid screenshots — use proper scans or photographs of original documents.</span>
      </div>
    </div>
  );
}

function ModeCard({ selected, icon: Icon, title, description, recommended, onSelect }: {
  selected: boolean; icon: any; title: string; description: string; recommended?: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left p-5 rounded-xl border-2 transition-all flex items-start gap-4',
        selected ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/30'
      )}
    >
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', selected ? 'bg-brand-600' : 'bg-gray-100')}>
        <Icon size={18} className={selected ? 'text-white' : 'text-gray-500'} />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-gray-900 text-sm">{title}</p>
          {recommended && <span className="text-[10px] font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">Recommended</span>}
        </div>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      </div>
      <div className={cn('w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center', selected ? 'border-brand-500 bg-brand-500' : 'border-gray-300')}>
        {selected && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>
    </button>
  );
}

// ─── Step 2: Profile Info ───────────────────────────────────────────────────────

function ProfileInfoScreen({ uploadMode, experience, qualification, onExperienceChange, onQualificationChange, onBack, onNext, saving }: {
  uploadMode: UploadMode;
  experience: Experience; qualification: Qualification;
  onExperienceChange: (e: Experience) => void;
  onQualificationChange: (q: Qualification) => void;
  onBack: () => void; onNext: () => void; saving: boolean;
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

      <div className="flex gap-3">
        <button onClick={onBack} className="btn-secondary flex items-center gap-1.5 text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!experience || !qualification || saving}
          className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : null}
          {uploadMode === 'COMBINED' ? 'Upload Combined PDF' : 'Go to Document Checklist'}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3A: Combined PDF Upload ──────────────────────────────────────────────

function CombinedUploadScreen({
  combinedPdfUploaded, kycStatus, photoUrl, hasPhoto, uploading, showCamera,
  onShowCamera, onHideCamera, combinedPdfRef, photoFileRef,
  onCombinedPdfChange, onPhotoFileChange, onPhotoCapture,
  onBack, onSubmit, submitting, experience, qualification,
}: any) {
  const isProcessing = kycStatus === 'PROCESSING';
  const isPendingHrReview = kycStatus === 'PENDING_HR_REVIEW';
  const canSubmit = combinedPdfUploaded && hasPhoto && !isProcessing && !isPendingHrReview;

  return (
    <div className="space-y-4">
      {/* PROCESSING banner — shown while backend classifies the PDF */}
      {isProcessing && (
        <div className="layer-card p-4 border border-indigo-200 bg-indigo-50 flex items-start gap-3">
          <Loader2 size={18} className="animate-spin text-indigo-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-indigo-800">Classifying your documents…</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              Our OCR engine is identifying each document in your PDF. This usually takes 30–90 seconds.
              You can leave this page — we'll notify you when it's ready.
            </p>
          </div>
        </div>
      )}

      {/* PENDING_HR_REVIEW banner — classification done, waiting for HR */}
      {isPendingHrReview && (
        <div className="layer-card p-4 border border-purple-200 bg-purple-50 flex items-start gap-3">
          <CheckCircle2 size={18} className="text-purple-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-purple-800">Documents submitted for HR review</p>
            <p className="text-xs text-purple-600 mt-0.5">
              Your documents have been classified and are pending HR review. No further action needed.
            </p>
          </div>
        </div>
      )}

      {/* Combined PDF */}
      <div className="layer-card p-6">
        <h2 className="text-base font-display font-bold text-gray-900 mb-1">Upload Combined PDF</h2>
        <p className="text-sm text-gray-500 mb-4">
          Combine all your documents (ID proof, PAN, education certificates, employment docs) into a single PDF.
          Our system will automatically identify each document inside.
        </p>

        <div className={cn(
          'border-2 border-dashed rounded-xl p-6 text-center transition-all',
          combinedPdfUploaded ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-gray-50 hover:border-brand-400'
        )}>
          {combinedPdfUploaded ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 size={32} className="text-emerald-500" />
              <p className="font-semibold text-emerald-700 text-sm">Combined PDF Uploaded</p>
              <p className="text-xs text-emerald-600">OCR is processing your documents automatically</p>
              <button
                onClick={() => combinedPdfRef.current?.click()}
                disabled={uploading === 'COMBINED_PDF'}
                className="text-xs text-emerald-600 underline mt-1"
              >
                Replace file
              </button>
            </div>
          ) : uploading === 'COMBINED_PDF' ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={28} className="animate-spin text-brand-500" />
              <p className="text-sm text-gray-600">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <FileUp size={28} className="text-gray-400" />
              <p className="text-sm font-medium text-gray-700">Drop your combined PDF here or click to browse</p>
              <p className="text-xs text-gray-400">Max 100MB · PDF only</p>
              <button onClick={() => combinedPdfRef.current?.click()} className="btn-primary text-sm">
                Select PDF
              </button>
            </div>
          )}
          <input
            ref={combinedPdfRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onCombinedPdfChange(f); e.target.value = ''; }}
          />
        </div>

        {/* Document order hint */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Recommended document order inside your PDF:</p>
          {computeRequiredDocs(experience, qualification).filter(d => d.type !== 'PHOTO').map((d, i) => (
            <p key={d.type}>{i + 1}. {d.label}</p>
          ))}
        </div>
      </div>

      {/* Photo upload */}
      <div className="layer-card p-6">
        <h2 className="text-base font-display font-bold text-gray-900 mb-1">
          Passport Size Photograph <span className="text-red-500">*</span>
        </h2>
        <p className="text-sm text-gray-500 mb-4">Upload separately — do not include in the combined PDF.</p>

        <PhotoUploadSection
          hasPhoto={hasPhoto} photoUrl={photoUrl} uploading={uploading}
          showCamera={showCamera} onShowCamera={onShowCamera} onHideCamera={onHideCamera}
          photoFileRef={photoFileRef} onPhotoFileChange={onPhotoFileChange} onPhotoCapture={onPhotoCapture}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={onBack} className="btn-secondary flex items-center gap-1.5 text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Submit for HR Review
        </button>
      </div>
      {!canSubmit && (
        <p className="text-xs text-center text-gray-400">
          {isProcessing ? 'Waiting for OCR to finish classifying your documents…'
            : isPendingHrReview ? 'Documents are already submitted for HR review'
            : !combinedPdfUploaded ? 'Upload combined PDF to continue'
            : 'Upload your photo to continue'}
        </p>
      )}
    </div>
  );
}

// ─── Step 3B: Separate Upload ───────────────────────────────────────────────────

function SeparateUploadScreen({
  experience, qualification, submittedDocs, photoUrl, uploading, showCamera,
  fileInputRefs, photoFileRef, reuploadDocTypes, documentRejectReasons,
  openSections, onToggleSection, onShowCamera, onHideCamera,
  onFileChange, onPhotoFileChange, onPhotoCapture,
  onBack, onSubmit, submitting, onChangeMode,
}: any) {
  const hasPhoto = !!photoUrl || submittedDocs.includes('PHOTO');
  const requiredDocs = computeRequiredDocs(experience, qualification);

  const mandatoryComplete = requiredDocs
    .filter(d => d.required)
    .every(d => d.type === 'PHOTO' ? hasPhoto : isDocTypeSubmitted(d, submittedDocs));

  const completedCount = requiredDocs.filter(d => d.type === 'PHOTO' ? hasPhoto : isDocTypeSubmitted(d, submittedDocs)).length;

  const canSubmit = mandatoryComplete;

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
      id: 'photo',
      title: 'Passport Size Photo',
      icon: Image,
      isPhotoSection: true,
      docs: requiredDocs.filter(d => d.type === 'PHOTO'),
    },
  ].filter(s => s.docs.length > 0);

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="layer-card p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">{completedCount}/{requiredDocs.length} documents uploaded</span>
          <button onClick={onChangeMode} className="text-xs text-brand-600 hover:underline">Change mode</button>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', mandatoryComplete ? 'bg-emerald-500' : 'bg-brand-500')}
            style={{ width: `${Math.round((completedCount / requiredDocs.length) * 100)}%` }}
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
        <button onClick={onBack} className="btn-secondary flex items-center gap-1.5 text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          Submit for HR Review
        </button>
      </div>
      {!canSubmit && (
        <p className="text-xs text-center text-amber-600 flex items-center justify-center gap-1">
          <AlertTriangle size={12} /> Upload all required documents marked with * to submit
        </p>
      )}
    </div>
  );
}

// ─── Doc Upload Row ─────────────────────────────────────────────────────────────

function DocUploadRow({ doc, submittedDocs, uploading, fileInputRefs, reuploadDocTypes, documentRejectReasons, onFileChange }: any) {
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

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-700">{doc.label} {doc.required && <span className="text-red-400">*</span>}</p>
          {isSubmitted && <CheckCircle2 size={14} className="text-emerald-500" />}
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
            return (
              <div key={type} className={cn('relative rounded-lg border p-2.5 text-xs flex items-center justify-between',
                isTypeSubmitted ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'
              )}>
                <span className={isTypeSubmitted ? 'text-emerald-700 font-medium' : 'text-gray-600'}>
                  {typeLabels[type] || type}
                </span>
                <label className={cn('cursor-pointer px-2 py-1 rounded text-[10px] font-medium shrink-0 ml-1',
                  isTypeSubmitted ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
                )}>
                  {isUploading ? <Loader2 size={10} className="animate-spin inline" /> : isTypeSubmitted ? 'Replace' : 'Upload'}
                  <input type="file" className="hidden" accept="image/*,.pdf"
                    onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(type, f, typeLabels[type]); e.target.value = ''; }} />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const isUploading = uploading === doc.type;

  return (
    <div>
      <div className={cn('p-3 rounded-xl border flex items-center justify-between',
        isSubmitted ? 'border-emerald-200 bg-emerald-50/50' : needsReupload ? 'border-orange-200 bg-orange-50/50' : 'border-gray-100 bg-gray-50/30'
      )}>
        <div className="flex items-center gap-3 min-w-0">
          {isSubmitted ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> :
           needsReupload ? <AlertTriangle size={16} className="text-orange-500 shrink-0" /> :
           <FileText size={16} className="text-gray-400 shrink-0" />}
          <div>
            <p className="text-sm font-medium text-gray-700">
              {doc.label} {doc.required && <span className="text-red-400">*</span>}
            </p>
            {doc.hint && <p className="text-xs text-gray-400">{doc.hint}</p>}
          </div>
        </div>
        <label className={cn('shrink-0 text-xs cursor-pointer px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 transition-all',
          isSubmitted ? 'bg-emerald-100 text-emerald-700' : 'btn-primary'
        )}>
          {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          {isUploading ? 'Uploading' : isSubmitted ? 'Replace' : 'Upload'}
          <input ref={el => { fileInputRefs.current[doc.type] = el; }} type="file" className="hidden"
            accept="image/*,.pdf" disabled={isUploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(doc.type, f, doc.label); e.target.value = ''; }} />
        </label>
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

function PhotoUploadSection({ hasPhoto, photoUrl, uploading, showCamera, onShowCamera, onHideCamera, photoFileRef, onPhotoFileChange, onPhotoCapture }: any) {
  return (
    <div>
      <div className={cn('p-4 rounded-xl border', hasPhoto ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100 bg-gray-50/30')}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {hasPhoto ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Camera size={18} className="text-gray-400" />}
            <div>
              <p className="text-sm font-medium text-gray-700">Passport Size Photo <span className="text-red-400">*</span></p>
              <p className="text-xs text-gray-400">Clear, front-facing, plain background</p>
            </div>
          </div>
          {photoUrl && (
            <img src={getUploadUrl(photoUrl)} alt="KYC Photo" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input ref={photoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
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
  experience, qualification, submittedDocs, photoUrl, uploadMode, combinedPdfAnalysis, onStartReupload,
}: any) {
  const cfg = KYC_STATUS_CONFIG[kycStatus] || KYC_STATUS_CONFIG.PENDING;
  const StatusIcon = cfg.icon;
  const hasPhoto = !!photoUrl || (submittedDocs || []).includes('PHOTO');
  const [showAnalysis, setShowAnalysis] = useState(false);

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

        {uploadMode === 'COMBINED' ? (
          <div>
            <div className="flex items-center gap-3 py-2">
              {true ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Clock size={16} className="text-gray-400" />}
              <span className="text-sm text-gray-700">Combined PDF</span>
              <span className="text-xs text-emerald-600 ml-auto">Uploaded</span>
            </div>
            <div className="flex items-center gap-3 py-2">
              {hasPhoto ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-red-400" />}
              <span className="text-sm text-gray-700">Passport Photo</span>
              <span className={cn('text-xs ml-auto', hasPhoto ? 'text-emerald-600' : 'text-red-500')}>
                {hasPhoto ? 'Uploaded' : 'Missing'}
              </span>
            </div>

            {/* Combined PDF analysis */}
            {combinedPdfAnalysis && (
              <div className="mt-3">
                <button onClick={() => setShowAnalysis(!showAnalysis)} className="text-xs text-brand-600 flex items-center gap-1 hover:underline">
                  <Eye size={12} />
                  {showAnalysis ? 'Hide' : 'View'} OCR analysis results
                </button>
                {showAnalysis && (
                  <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-2">
                    <p className="font-medium text-gray-700">OCR detected {combinedPdfAnalysis.total_pages} page(s)</p>
                    {combinedPdfAnalysis.detected_docs?.length > 0 && (
                      <p>Detected: {combinedPdfAnalysis.detected_docs.join(', ')}</p>
                    )}
                    {combinedPdfAnalysis.suspicion_flags?.length > 0 && (
                      <div className="text-orange-600">
                        {combinedPdfAnalysis.suspicion_flags.map((f: string, i: number) => <p key={i}>⚠ {f}</p>)}
                      </div>
                    )}
                    <p className="text-gray-500">{combinedPdfAnalysis.summary}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Separate docs summary */
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
        )}

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

      {/* Re-upload button */}
      {canReupload && (
        <button onClick={onStartReupload} className="w-full btn-primary flex items-center justify-center gap-2 text-sm">
          <RefreshCw size={15} /> Re-upload Documents
        </button>
      )}

      {/* Dashboard access note */}
      {!['VERIFIED'].includes(kycStatus) && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-700">
          <Clock size={13} className="mt-0.5 shrink-0" />
          <span>Your dashboard access is held until HR completes the document verification.</span>
        </div>
      )}
    </div>
  );
}
