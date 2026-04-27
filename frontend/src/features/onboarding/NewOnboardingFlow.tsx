import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, ChevronLeft, Loader2, PartyPopper,
  Upload, FileText, CheckCircle2, AlertTriangle,
  RefreshCw, Shield, Building2, Lock, Camera,
} from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { setUser } from '../auth/authSlice';
import { useGetMyOnboardingStatusQuery, useSaveMyStepMutation, useCompleteMyOnboardingMutation } from './onboardingApi';
import { useGetMfaStatusQuery } from '../auth/authApi';
import { MFASetupModal } from '../auth/MFASetupModal';
import { useUploadDocumentMutation } from '../documents/documentApi';
import PassportPhotoUploader from '../../components/ui/PassportPhotoUploader';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// New 6-step flow — password handled in InviteAcceptPage before this wizard
const STEPS = [
  { num: 1, title: 'MFA Setup', desc: 'Two-factor authentication' },
  { num: 2, title: 'Personal Details', desc: 'Your information' },
  { num: 3, title: 'Emergency Contact', desc: 'In case of emergency' },
  { num: 4, title: 'Bank Details', desc: 'Salary account' },
  { num: 5, title: 'Documents', desc: 'Upload required documents' },
  { num: 6, title: 'Review & Submit', desc: 'Complete onboarding' },
];

const IDENTITY_DOC_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'] as const;
type IdentityDocType = typeof IDENTITY_DOC_TYPES[number];
const IDENTITY_DOC_LABELS: Record<IdentityDocType, string> = {
  AADHAAR: 'Aadhaar Card',
  PASSPORT: 'Passport',
  DRIVING_LICENSE: 'Driving License',
  VOTER_ID: 'Voter ID Card',
};

const REQUIRED_NON_IDENTITY_LABELS: Record<string, string> = {
  PAN: 'PAN Card',
  TENTH_CERTIFICATE: '10th Certificate',
  TWELFTH_CERTIFICATE: '12th Certificate',
  DEGREE_CERTIFICATE: 'Degree Certificate',
  POST_GRADUATION_CERTIFICATE: 'Post-Graduation Certificate',
  RESIDENCE_PROOF: 'Residence Proof (Current Address)',
  PERMANENT_RESIDENCE_PROOF: 'Residence Proof (Permanent Address)',
  PHOTO: 'Passport Photo',
  // Experience docs — custom labels come from experienceDocFields, but keep fallbacks
  EXPERIENCE_LETTER: 'Experience Letter',
  OFFER_LETTER_DOC: 'Offer / Appointment Letter',
  SALARY_SLIP_DOC: 'Last 3 Salary Slips',
};

// New enum values — must match backend
const QUALIFICATIONS = [
  { value: 'TENTH', label: '10th Pass' },
  { value: 'TWELFTH', label: '12th Pass' },
  { value: 'DIPLOMA', label: 'Diploma' },
  { value: 'GRADUATION', label: 'Graduation' },
  { value: 'POST_GRADUATION', label: 'Post Graduation' },
  { value: 'PHD', label: 'PhD' },
] as const;

type WorkMode = 'OFFICE' | 'PROJECT_SITE' | 'FIELD_SALES' | 'HYBRID' | 'REMOTE';

function getRequiredEducationDocs(qualification: string | null | undefined): string[] {
  switch (qualification) {
    case 'TWELFTH':       return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE'];
    case 'DIPLOMA':       return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
    case 'GRADUATION':    return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
    case 'POST_GRADUATION': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
    case 'PHD':           return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
    default:              return ['TENTH_CERTIFICATE'];
  }
}

function getRequiredNonIdentityDocs(
  workMode: WorkMode | null,
  qualification?: string | null,
  addressSameAsPermanent?: boolean | null,
  experienceLevel?: string | null,
  experienceDocFields?: { key: string; label: string; required?: boolean }[],
): string[] {
  if (workMode === 'PROJECT_SITE') return ['PHOTO'];
  const eduDocs = getRequiredEducationDocs(qualification);
  const residenceDocs = addressSameAsPermanent === false
    ? ['RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF']
    : ['RESIDENCE_PROOF'];
  const resolvedExpFields = experienceLevel === 'EXPERIENCED' && (experienceDocFields || []).length === 0
    ? [{ key: 'EXPERIENCE_LETTER', label: 'Experience Letter', required: true }, { key: 'OFFER_LETTER_DOC', label: 'Offer / Appointment Letter', required: false }]
    : (experienceDocFields || []);
  const expDocs = experienceLevel === 'EXPERIENCED'
    ? resolvedExpFields.filter(f => f.required !== false).map(f => f.key)
    : [];
  return [...eduDocs, 'PAN', ...residenceDocs, 'PHOTO', ...expDocs];
}

function getDocSections(
  workMode: WorkMode | null,
  qualification: string | null | undefined,
  addressSameAsPermanent: boolean | null,
  experienceLevel: string | null,
  experienceDocFields: { key: string; label: string; required?: boolean }[],
) {
  if (workMode === 'PROJECT_SITE') {
    return [
      { title: 'Passport Photo', docs: [{ name: 'Passport Size Photograph', type: 'PHOTO', required: true }] },
    ];
  }
  const eduDocs: { name: string; type: string; required: boolean }[] = [
    { name: '10th Marksheet / Certificate', type: 'TENTH_CERTIFICATE', required: true },
  ];
  if (['TWELFTH', 'DIPLOMA', 'GRADUATION', 'POST_GRADUATION', 'PHD'].includes(qualification || '')) {
    eduDocs.push({ name: '12th Marksheet / Certificate', type: 'TWELFTH_CERTIFICATE', required: true });
  }
  if (['DIPLOMA', 'GRADUATION', 'POST_GRADUATION', 'PHD'].includes(qualification || '')) {
    eduDocs.push({ name: 'Diploma / Degree Certificate', type: 'DEGREE_CERTIFICATE', required: true });
  }
  if (['POST_GRADUATION', 'PHD'].includes(qualification || '')) {
    eduDocs.push({ name: 'Post-Graduation Certificate', type: 'POST_GRADUATION_CERTIFICATE', required: true });
  }

  const residenceDocs = addressSameAsPermanent === false
    ? [
        { name: 'Residence Proof — Current Address (Utility Bill / Rent Agreement)', type: 'RESIDENCE_PROOF', required: true },
        { name: 'Residence Proof — Permanent Address (Utility Bill / Rent Agreement)', type: 'PERMANENT_RESIDENCE_PROOF', required: true },
      ]
    : [{ name: 'Residence Proof (Utility Bill / Rent Agreement)', type: 'RESIDENCE_PROOF', required: true }];

  const sections: { title: string; docs: { name: string; type: string; required: boolean }[] }[] = [
    { title: 'Education Certificates', docs: eduDocs },
    {
      title: addressSameAsPermanent === false ? 'Address Proof (Current & Permanent)' : 'Address & Tax',
      docs: [
        { name: 'PAN Card', type: 'PAN', required: true },
        ...residenceDocs,
      ],
    },
    { title: 'Passport Photo', docs: [{ name: 'Passport Size Photograph', type: 'PHOTO', required: true }] },
  ];

  if (experienceLevel === 'EXPERIENCED') {
    const resolvedFields = experienceDocFields.length > 0
      ? experienceDocFields
      : [{ key: 'EXPERIENCE_LETTER', label: 'Experience Letter', required: true }, { key: 'OFFER_LETTER_DOC', label: 'Offer / Appointment Letter', required: false }];
    sections.push({
      title: 'Previous Employment Documents',
      docs: resolvedFields.map(f => ({ name: f.label, type: f.key, required: f.required !== false })),
    });
  }

  return sections;
}

export default function NewOnboardingFlow() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(s => s.auth.user);

  const { data: statusRes, isLoading, refetch } = useGetMyOnboardingStatusQuery();
  const [saveStep, { isLoading: saving }] = useSaveMyStepMutation();
  const [completeOnboarding, { isLoading: completing }] = useCompleteMyOnboardingMutation();

  const status = statusRes?.data;
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);

  // Resume from last incomplete step
  useEffect(() => {
    if (status?.resumeStep) {
      setCurrentStep(Math.min(status.resumeStep, 6));
    }
  }, [status]);

  const handleSaveStep = async (stepNum: number, data: any) => {
    try {
      await saveStep({ step: stepNum, data }).unwrap();
      toast.success('Saved!');
      await refetch();
      setCurrentStep(s => Math.min(s + 1, 6));
    } catch (err: any) {
      // Global api.ts handler already toasts server errors; only handle offline case here
      if (err?.status === 'FETCH_ERROR') {
        toast.error('You are offline. Please reconnect and try again.');
      }
    }
  };

  const handleComplete = async () => {
    try {
      await completeOnboarding().unwrap();
      if (currentUser) {
        dispatch(setUser({ ...currentUser, onboardingComplete: true, profileComplete: true, kycCompleted: false }));
      }
      setCompleted(true);
    } catch (err: any) {
      if (err?.status === 'FETCH_ERROR') {
        toast.error('You are offline. Please reconnect and try again.');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <Loader2 size={32} className="animate-spin text-brand-600" />
      </div>
    );
  }

  if (completed) {
    const nextRoute = currentUser?.kycCompleted === false ? '/kyc-pending' : '/dashboard';
    return <CompletionScreen orgName={status?.organization?.name} onContinue={() => navigate(nextRoute, { replace: true })} />;
  }

  const workMode = status?.workMode as WorkMode | null;
  const isReupload = status?.kycStatus === 'REUPLOAD_REQUIRED';

  return (
    <div className="h-[100dvh] overflow-y-auto bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center">
            <Building2 size={18} className="text-brand-600" />
          </div>
          <div>
            <h1 className="font-display font-semibold text-gray-900 text-sm">Welcome Aboard!</h1>
            <p className="text-xs text-gray-400">{status?.organization?.name || 'Aniston Technologies LLP'}</p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+2rem))]">
        {/* Re-upload banner — shown when HR rejected/deleted documents */}
        {isReupload && (
          <div className="mb-5 bg-orange-50 border border-orange-300 rounded-xl p-4">
            <p className="text-sm font-semibold text-orange-800 flex items-center gap-2">
              <AlertTriangle size={16} /> Document Re-upload Required
            </p>
            <p className="text-xs text-orange-700 mt-1">
              HR has flagged some of your documents. Please re-upload them to continue. All your previously filled information is pre-loaded below.
            </p>
            {(status?.reuploadDocTypes?.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-1">
                {(status?.reuploadDocTypes as string[]).map((docType: string) => {
                  const reason = (status?.documentRejectReasons as Record<string, string>)?.[docType];
                  const label = REQUIRED_NON_IDENTITY_LABELS[docType] || docType.replace(/_/g, ' ');
                  return (
                    <li key={docType} className="text-xs text-orange-700">
                      <span className="font-semibold">{label}:</span>{' '}
                      {reason || 'Please re-upload a clear, valid copy'}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center justify-between mb-6 overflow-x-auto pb-2 gap-1">
          {STEPS.map((step, i) => (
            <div key={step.num} className="flex items-center flex-shrink-0">
              <button
                onClick={() => currentStep > step.num && setCurrentStep(step.num)}
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-all',
                  currentStep > step.num ? 'bg-emerald-500 text-white cursor-pointer' :
                  currentStep === step.num ? 'bg-brand-600 text-white ring-4 ring-brand-200' :
                  'bg-gray-200 text-gray-500 cursor-default'
                )}
              >
                {currentStep > step.num ? <Check size={14} /> : step.num}
              </button>
              <span className={cn(
                'hidden sm:block text-[11px] ml-1.5 whitespace-nowrap',
                currentStep === step.num ? 'text-brand-600 font-medium' :
                currentStep > step.num ? 'text-emerald-600' : 'text-gray-400'
              )}>
                {step.title}
                {step.num === 1 && <span className="text-gray-400 ml-0.5">(opt)</span>}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn('w-4 sm:w-8 h-0.5 mx-1', currentStep > step.num ? 'bg-emerald-400' : 'bg-gray-200')} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="bg-white rounded-2xl shadow-lg p-5 sm:p-8"
          >
            <h2 className="text-lg font-display font-semibold text-gray-900 mb-0.5">{STEPS[currentStep - 1].title}</h2>
            <p className="text-sm text-gray-500 mb-6">{STEPS[currentStep - 1].desc}</p>

            {currentStep === 1 && (
              <Step1MFA
                onSkip={() => setCurrentStep(2)}
                onEnabled={() => { refetch(); setCurrentStep(2); }}
                isMfaEnabled={status?.sections?.mfa}
                workMode={workMode}
              />
            )}
            {currentStep === 2 && (
              <Step2Personal
                onSave={(d) => handleSaveStep(2, d)}
                saving={saving}
                initialData={status}
                isSiteEmployee={workMode === 'PROJECT_SITE'}
              />
            )}
            {currentStep === 3 && (
              <Step3Emergency
                onSave={(d) => handleSaveStep(3, d)}
                saving={saving}
                initialData={status?.emergencyContact}
              />
            )}
            {currentStep === 4 && (
              <Step4Bank
                onSave={(d) => handleSaveStep(4, d)}
                saving={saving}
                initialData={status}
              />
            )}
            {currentStep === 5 && (
              <Step5Documents
                uploadedDocTypes={status?.uploadedDocTypes || []}
                rejectedDocs={(status as any)?.rejectedDocs || []}
                reuploadDocTypes={status?.reuploadDocTypes || []}
                documentRejectReasons={status?.documentRejectReasons || {}}
                onContinue={() => setCurrentStep(6)}
                onRefetch={refetch}
                workMode={workMode}
                qualification={status?.qualification}
                addressSameAsPermanent={status?.addressSameAsPermanent ?? null}
                experienceLevel={status?.experienceLevel || null}
                experienceDocFields={status?.experienceDocFields || []}
              />
            )}
            {currentStep === 6 && (
              <Step6Review
                status={status}
                onComplete={handleComplete}
                completing={completing}
                workMode={workMode}
                qualification={status?.qualification}
                addressSameAsPermanent={status?.addressSameAsPermanent ?? null}
                experienceLevel={status?.experienceLevel || null}
                experienceDocFields={status?.experienceDocFields || []}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setCurrentStep(s => Math.max(s - 1, 1))}
            disabled={currentStep === 1}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
          >
            <ChevronLeft size={16} /> Back
          </button>
          <span className="text-xs text-gray-400">Step {currentStep} of {STEPS.length}</span>
          {currentStep === 1 && (
            <button onClick={() => setCurrentStep(2)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              Skip <ChevronRight size={16} />
            </button>
          )}
          {currentStep !== 1 && <span />}
        </div>
      </div>
    </div>
  );
}

// ==================
// STEP 1: MFA SETUP
// ==================
function Step1MFA({ onSkip, onEnabled, isMfaEnabled, workMode }: {
  onSkip: () => void;
  onEnabled: () => void;
  isMfaEnabled?: boolean;
  workMode?: WorkMode | null;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const { data: mfaStatus, refetch } = useGetMfaStatusQuery();
  const isEnabled = isMfaEnabled || mfaStatus?.data?.isEnabled;
  const isOffice = workMode === 'OFFICE';

  if (isEnabled) {
    return (
      <div className="space-y-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
          <Shield size={20} className="text-emerald-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-700">Two-Factor Authentication Enabled</p>
            <p className="text-xs text-emerald-600 mt-0.5">Your account is protected with MFA. You're all set!</p>
          </div>
        </div>
        <button onClick={onSkip} className="btn-primary w-full">Continue to Next Step</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isOffice ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Shield size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Two-Factor Authentication <span className="font-normal text-amber-600">(Recommended)</span></p>
              <p className="text-xs text-amber-700 mt-1">MFA is strongly recommended for office employees to protect your account and company data. You can skip this now and set it up later from your Profile settings.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Shield size={20} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Two-Factor Authentication <span className="font-normal text-blue-600">(Optional)</span></p>
              <p className="text-xs text-blue-600 mt-1">MFA is recommended but not required for your work mode. You can enable it now or later from your profile.</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm text-gray-600">
        <p className="font-medium text-gray-700 text-xs uppercase tracking-wide">How to set up:</p>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span> Download Google Authenticator or Authy on your phone</div>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span> Click "Enable MFA" — scan QR code, or copy the secret key</div>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span> Enter the 6-digit code from the app to verify</div>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span> You'll use this code at every login for extra security</div>
      </div>

      <div className="flex flex-col gap-3">
        <button onClick={() => setShowSetup(true)} className="btn-primary w-full flex items-center justify-center gap-2">
          <Shield size={16} /> Enable Two-Factor Authentication
        </button>
        <button onClick={onSkip} className="text-sm text-gray-500 hover:text-gray-700 text-center py-1">
          Skip for now — I'll set it up later in Profile settings
        </button>
      </div>

      {showSetup && (
        <MFASetupModal
          onClose={() => setShowSetup(false)}
          onEnabled={() => { setShowSetup(false); refetch(); onEnabled(); }}
        />
      )}
    </div>
  );
}

// ==================
// STEP 2: PERSONAL DETAILS
// ==================
const ADDR_INIT = { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' };
const PERSONAL_INIT = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '',
  bloodGroup: '', maritalStatus: '', phone: '', personalEmail: '',
  qualification: '',
  currentAddress: { ...ADDR_INIT },
  permanentAddress: { ...ADDR_INIT },
};

function Step2Personal({ onSave, saving, initialData, isSiteEmployee }: {
  onSave: (d: any) => void;
  saving: boolean;
  initialData: any;
  isSiteEmployee?: boolean;
}) {
  const [form, setForm] = useState(PERSONAL_INIT);
  // null = not set yet, true = same, false = different
  const [sameAsCurrent, setSameAsCurrent] = useState<boolean | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (initialData) {
      const curr = (initialData.currentAddress as any) || (initialData.address as any) || {};
      const perm = (initialData.permanentAddress as any) || {};
      setForm({
        firstName: initialData.firstName || '',
        lastName: initialData.lastName || '',
        dateOfBirth: initialData.dateOfBirth || '',
        gender: initialData.gender && initialData.gender !== 'PREFER_NOT_TO_SAY' ? initialData.gender : '',
        bloodGroup: initialData.bloodGroup || '',
        maritalStatus: initialData.maritalStatus || '',
        phone: initialData.phone || '',
        personalEmail: initialData.personalEmail || '',
        qualification: initialData.qualification || '',
        currentAddress: { line1: curr.line1 || '', line2: curr.line2 || '', city: curr.city || '', state: curr.state || '', pincode: curr.pincode || '', country: curr.country || 'India' },
        permanentAddress: { line1: perm.line1 || '', line2: perm.line2 || '', city: perm.city || '', state: perm.state || '', pincode: perm.pincode || '', country: perm.country || 'India' },
      });
      // Pre-fill address same toggle from DB
      if (initialData.addressSameAsPermanent !== null && initialData.addressSameAsPermanent !== undefined) {
        setSameAsCurrent(initialData.addressSameAsPermanent);
      }
    }
  }, [initialData]);

  const addrValid = (a: typeof ADDR_INIT) => !!(a.line1.trim() && a.city.trim() && a.state.trim() && a.pincode.trim());
  const sameResolved = sameAsCurrent === true;
  const permAddr = sameResolved ? form.currentAddress : form.permanentAddress;
  const permValid = sameResolved || addrValid(form.permanentAddress);
  const phoneDigits = form.phone.replace(/\D/g, '');
  const phoneValid = phoneDigits.length >= 10 && phoneDigits.length <= 12;

  const isValid = !!(
    form.firstName.trim() && form.lastName.trim() && form.dateOfBirth &&
    form.gender && phoneValid &&
    (isSiteEmployee || !!form.qualification) &&
    addrValid(form.currentAddress) && permValid &&
    sameAsCurrent !== null // must explicitly choose
  );

  const set = (field: string, val: string) => setForm(p => ({ ...p, [field]: val }));
  const setCurr = (field: string, val: string) => setForm(p => ({ ...p, currentAddress: { ...p.currentAddress, [field]: val } }));
  const setPerm = (field: string, val: string) => setForm(p => ({ ...p, permanentAddress: { ...p.permanentAddress, [field]: val } }));
  const err = (cond: boolean) => showErrors && !cond ? 'border-red-400 ring-1 ring-red-200' : '';

  const addressBlock = (label: string, addr: typeof ADDR_INIT, onChange: (f: string, v: string) => void, disabled = false) => (
    <div className="border-t border-gray-100 pt-4">
      {label && <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">{label}</p>}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Street Address <span className="text-red-500">*</span></label>
          <input value={addr.line1} onChange={e => onChange('line1', e.target.value)} disabled={disabled}
            className={cn('input-glass w-full text-sm', disabled && 'opacity-60 cursor-not-allowed', err(!!addr.line1.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Address Line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
          <input value={addr.line2} onChange={e => onChange('line2', e.target.value)} disabled={disabled}
            className={cn('input-glass w-full text-sm', disabled && 'opacity-60 cursor-not-allowed')} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">City <span className="text-red-500">*</span></label>
            <input value={addr.city} onChange={e => onChange('city', e.target.value)} disabled={disabled}
              className={cn('input-glass w-full text-sm', disabled && 'opacity-60 cursor-not-allowed', err(!!addr.city.trim()))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
            <input value={addr.state} onChange={e => onChange('state', e.target.value)} disabled={disabled}
              className={cn('input-glass w-full text-sm', disabled && 'opacity-60 cursor-not-allowed', err(!!addr.state.trim()))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Pincode <span className="text-red-500">*</span></label>
            <input value={addr.pincode} onChange={e => onChange('pincode', e.target.value)} disabled={disabled}
              className={cn('input-glass w-full text-sm', disabled && 'opacity-60 cursor-not-allowed', err(!!addr.pincode.trim()))} />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {showErrors && !isValid && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={13} /> Please fill all required fields marked with *
        </div>
      )}

      {/* Joining Date — read-only, set by HR */}
      {initialData?.joiningDate && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
          <Lock size={13} className="text-blue-500 flex-shrink-0" />
          <span className="text-xs text-blue-700">
            Joining Date: <span className="font-semibold">{initialData.joiningDate}</span> — set by HR
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">First Name <span className="text-red-500">*</span></label>
          <input value={form.firstName} onChange={e => set('firstName', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.firstName.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Last Name <span className="text-red-500">*</span></label>
          <input value={form.lastName} onChange={e => set('lastName', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.lastName.trim()))} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date of Birth <span className="text-red-500">*</span></label>
          <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.dateOfBirth))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Gender <span className="text-red-500">*</span></label>
          <select value={form.gender} onChange={e => set('gender', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.gender))}>
            <option value="">Select</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
            <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Blood Group <span className="text-gray-400 font-normal">(optional)</span></label>
          <select value={form.bloodGroup} onChange={e => set('bloodGroup', e.target.value)} className="input-glass w-full text-sm">
            <option value="">Select</option>
            {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Marital Status <span className="text-gray-400 font-normal">(optional)</span></label>
          <select value={form.maritalStatus} onChange={e => set('maritalStatus', e.target.value)} className="input-glass w-full text-sm">
            <option value="">Select</option>
            <option value="Single">Single</option>
            <option value="Married">Married</option>
            <option value="Divorced">Divorced</option>
            <option value="Widowed">Widowed</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
          <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="9876543210" className={cn('input-glass w-full text-sm', err(phoneValid))} />
          {showErrors && form.phone.trim() && !phoneValid && (
            <p className="text-[11px] text-red-500 mt-1">Enter a valid 10-digit mobile number</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Personal Email <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="email" value={form.personalEmail} onChange={e => set('personalEmail', e.target.value)} className="input-glass w-full text-sm" placeholder="personal@email.com" />
        </div>
      </div>

      {/* Qualification — office employees only */}
      {!isSiteEmployee && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Education</p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Highest Qualification <span className="text-red-500">*</span></label>
            <select value={form.qualification} onChange={e => set('qualification', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.qualification))}>
              <option value="">Select qualification</option>
              {QUALIFICATIONS.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
            {form.qualification && (
              <p className="text-[11px] text-brand-600 mt-1">
                Required certificates: {getRequiredEducationDocs(form.qualification)
                  .map(t => REQUIRED_NON_IDENTITY_LABELS[t] || t).join(' + ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Current Address */}
      {addressBlock('Current Address', form.currentAddress, setCurr)}

      {/* Permanent Address — with same/different toggle */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Permanent Address</p>

        {/* Must explicitly choose — required for doc logic */}
        {sameAsCurrent === null && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
            <p className="text-xs text-amber-700 font-medium mb-2">Is your permanent address the same as your current address?</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSameAsCurrent(true)}
                className="flex-1 py-2 px-3 rounded-lg border-2 border-gray-200 text-xs font-medium hover:border-brand-400 transition-colors">
                Yes, same address
              </button>
              <button type="button" onClick={() => setSameAsCurrent(false)}
                className="flex-1 py-2 px-3 rounded-lg border-2 border-gray-200 text-xs font-medium hover:border-brand-400 transition-colors">
                No, different address
              </button>
            </div>
          </div>
        )}

        {sameAsCurrent !== null && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500">
              {sameAsCurrent ? '✓ Same as current address' : 'Different from current address'}
            </span>
            <button type="button" onClick={() => setSameAsCurrent(null)} className="text-xs text-brand-600 hover:underline">Change</button>
          </div>
        )}

        {sameAsCurrent === true && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 size={13} /> Permanent address same as current address. One residence proof required.
            </p>
          </div>
        )}
        {sameAsCurrent === false && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
              <p className="text-xs text-blue-700">You will need to upload residence proof for <strong>both</strong> addresses.</p>
            </div>
            {addressBlock('', form.permanentAddress, setPerm)}
          </>
        )}
      </div>

      <button
        onClick={() => {
          setShowErrors(true);
          if (sameAsCurrent === null) { toast.error('Please indicate whether your permanent address is the same as your current address'); return; }
          if (!form.qualification && !isSiteEmployee) { toast.error('Please select your qualification'); return; }
          if (isValid) {
            onSave({
              ...form,
              addressSameAsPermanent: sameAsCurrent,
              permanentAddress: sameAsCurrent ? form.currentAddress : form.permanentAddress,
            });
          } else {
            toast.error('Please fill all required fields');
          }
        }}
        disabled={saving}
        className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        Save & Continue
      </button>
    </div>
  );
}

// ==================
// STEP 3: EMERGENCY CONTACT
// ==================
function Step3Emergency({ onSave, saving, initialData }: { onSave: (d: any) => void; saving: boolean; initialData: any }) {
  const ec = initialData as any;
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', email: '' });
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (ec?.name) setForm({ name: ec.name || '', relationship: ec.relationship || '', phone: ec.phone || '', email: ec.email || '' });
  }, [initialData]);

  const isValid = !!(form.name.trim() && form.relationship && form.phone.trim());
  const err = (cond: boolean) => showErrors && !cond ? 'border-red-400 ring-1 ring-red-200' : '';

  return (
    <div className="space-y-4">
      {showErrors && !isValid && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={13} /> Please fill all required fields
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" className={cn('input-glass w-full text-sm', err(!!form.name.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Relationship <span className="text-red-500">*</span></label>
          <select value={form.relationship} onChange={e => setForm(p => ({ ...p, relationship: e.target.value }))} className={cn('input-glass w-full text-sm', err(!!form.relationship))}>
            <option value="">Select</option>
            <option value="SPOUSE">Spouse</option>
            <option value="PARENT">Parent</option>
            <option value="SIBLING">Sibling</option>
            <option value="FRIEND">Friend</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
          <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91 9876543210" className={cn('input-glass w-full text-sm', err(!!form.phone.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="input-glass w-full text-sm" />
        </div>
      </div>
      <button
        onClick={() => { setShowErrors(true); if (isValid) onSave(form); else toast.error('Please fill all required fields'); }}
        disabled={saving}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        Save & Continue
      </button>
    </div>
  );
}

// ==================
// STEP 4: BANK DETAILS
// ==================
function Step4Bank({ onSave, saving, initialData }: { onSave: (d: any) => void; saving: boolean; initialData: any }) {
  const [form, setForm] = useState({ accountHolderName: '', accountType: 'SAVINGS' as 'SAVINGS' | 'CURRENT', bankName: '', bankAccountNumber: '', ifscCode: '', epfMemberId: '' });
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (initialData?.bankAccountNumber || initialData?.bankName || initialData?.ifscCode || initialData?.accountHolderName) {
      setForm({
        accountHolderName: initialData.accountHolderName || '',
        accountType: (initialData.accountType as 'SAVINGS' | 'CURRENT') || 'SAVINGS',
        bankName: initialData.bankName || '',
        bankAccountNumber: initialData.bankAccountNumber || '',
        ifscCode: initialData.ifscCode || '',
        epfMemberId: initialData.epfMemberId || '',
      });
    }
  }, [initialData]);

  const ifscValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifscCode.toUpperCase().trim());
  const isValid = !!(form.accountHolderName.trim() && form.bankName.trim() && form.bankAccountNumber.trim() && ifscValid);
  const err = (cond: boolean) => showErrors && !cond ? 'border-red-400 ring-1 ring-red-200' : '';
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4">
      {showErrors && !isValid && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={13} /> Please fill all required bank fields
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Account Holder Name <span className="text-red-500">*</span></label>
          <input value={form.accountHolderName} onChange={e => set('accountHolderName', e.target.value)} placeholder="As per bank records" className={cn('input-glass w-full text-sm', err(!!form.accountHolderName.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Account Number <span className="text-red-500">*</span></label>
          <input value={form.bankAccountNumber} onChange={e => set('bankAccountNumber', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.bankAccountNumber.trim()))} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Bank Name <span className="text-red-500">*</span></label>
          <input value={form.bankName} onChange={e => set('bankName', e.target.value)} placeholder="e.g. State Bank of India" className={cn('input-glass w-full text-sm', err(!!form.bankName.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">IFSC Code <span className="text-red-500">*</span></label>
          <input value={form.ifscCode} onChange={e => set('ifscCode', e.target.value.toUpperCase())} placeholder="SBIN0001234" className={cn('input-glass w-full text-sm font-mono', err(ifscValid))} />
          {showErrors && form.ifscCode.trim() && !ifscValid && (
            <p className="text-[11px] text-red-500 mt-1">Invalid IFSC — 11 chars: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)</p>
          )}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Account Type <span className="text-red-500">*</span></label>
        <select value={form.accountType} onChange={e => set('accountType', e.target.value)} className="input-glass w-full text-sm">
          <option value="SAVINGS">Savings</option>
          <option value="CURRENT">Current</option>
        </select>
      </div>
      <div className="border-t border-gray-100 pt-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Previous EPF / UAN Number <span className="text-gray-400 font-normal">(optional — for experienced hires)</span>
        </label>
        <input
          value={form.epfMemberId}
          onChange={e => set('epfMemberId', e.target.value.toUpperCase())}
          placeholder="e.g. 100123456789 (12-digit UAN)"
          className="input-glass w-full text-sm font-mono"
        />
        <p className="text-[11px] text-gray-400 mt-1">If you have a UAN from a previous employer, enter it here. This helps HR link your EPF account.</p>
      </div>
      <p className="text-xs text-gray-400">Bank details are encrypted and used only for payroll processing.</p>
      <button
        onClick={() => { setShowErrors(true); if (isValid) onSave(form); else toast.error('Please fill all required bank fields'); }}
        disabled={saving}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {saving && <Loader2 size={16} className="animate-spin" />}
        Save & Continue
      </button>
    </div>
  );
}

// ==================
// STEP 5: DOCUMENTS
// ==================
type UploadState = { status: 'idle' | 'uploading' | 'done' | 'error'; fileName?: string; error?: string };

function Step5Documents({
  uploadedDocTypes, rejectedDocs = [], reuploadDocTypes = [], documentRejectReasons = {},
  onContinue, onRefetch, workMode, qualification, addressSameAsPermanent, experienceLevel, experienceDocFields,
}: {
  uploadedDocTypes: string[];
  rejectedDocs?: { type: string; name: string; rejectionReason: string | null }[];
  reuploadDocTypes?: string[];
  documentRejectReasons?: Record<string, string>;
  onContinue: () => void;
  onRefetch: () => void;
  workMode?: WorkMode | null;
  qualification?: string | null;
  addressSameAsPermanent: boolean | null;
  experienceLevel: string | null;
  experienceDocFields: { key: string; label: string; required?: boolean }[];
}) {
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [identityType, setIdentityType] = useState<IdentityDocType>('AADHAAR');
  const [otherDocName, setOtherDocName] = useState('');
  const [otherUploading, setOtherUploading] = useState(false);
  const otherFileRef = useRef<HTMLInputElement | null>(null);
  const [uploadDocument] = useUploadDocumentMutation();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const identityFileRef = useRef<HTMLInputElement | null>(null);

  const requiredNonIdentityDocs = getRequiredNonIdentityDocs(workMode ?? null, qualification, addressSameAsPermanent, experienceLevel, experienceDocFields);
  const activeSections = getDocSections(workMode ?? null, qualification, addressSameAsPermanent, experienceLevel, experienceDocFields);
  const rejectedTypeMap = Object.fromEntries(rejectedDocs.map(d => [d.type, d]));

  // Sync upload state from already-uploaded / rejected docs
  useEffect(() => {
    const initial: Record<string, UploadState> = {};
    for (const type of uploadedDocTypes) {
      initial[type] = { status: 'done', fileName: 'Previously uploaded' };
    }
    for (const rd of rejectedDocs) {
      initial[rd.type] = {
        status: 'error',
        fileName: rd.name,
        error: rd.rejectionReason ? `Rejected by HR: ${rd.rejectionReason}` : 'Rejected by HR — please re-upload',
      };
    }
    // Also show HR-deleted docs (in reuploadDocTypes but not in rejectedDocs) as needing upload
    for (const t of reuploadDocTypes) {
      if (!initial[t]) {
        initial[t] = { status: 'error', error: documentRejectReasons[t] || 'Document removed by HR — please re-upload' };
      }
    }
    setUploads(prev => ({ ...initial, ...prev }));
    const uploadedIdentity = IDENTITY_DOC_TYPES.find(t => uploadedDocTypes.includes(t));
    if (uploadedIdentity) setIdentityType(uploadedIdentity);
  }, [uploadedDocTypes, rejectedDocs, reuploadDocTypes, documentRejectReasons]);

  const handleUpload = useCallback(async (file: File, docType: string, docName: string) => {
    if (file.size > 100 * 1024 * 1024) { toast.error('File must be under 100MB'); return; }
    setUploads(prev => ({ ...prev, [docType]: { status: 'uploading', fileName: file.name } }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', docType);
      formData.append('name', docName);
      await (uploadDocument as any)(formData).unwrap();
      setUploads(prev => ({ ...prev, [docType]: { status: 'done', fileName: file.name } }));
      toast.success(`${docName} uploaded`);
      onRefetch();
    } catch (err: any) {
      const msg = err?.data?.error?.message || 'Upload failed';
      setUploads(prev => ({ ...prev, [docType]: { status: 'error', fileName: file.name, error: msg } }));
      toast.error(msg);
    }
  }, [uploadDocument, onRefetch]);

  const identityUploaded = IDENTITY_DOC_TYPES.some(t => uploads[t]?.status === 'done');
  const identityState = uploads[identityType] || { status: 'idle' };
  const totalRequired = requiredNonIdentityDocs.length + 1;
  const nonIdentityDone = requiredNonIdentityDocs.filter(t => uploads[t]?.status === 'done').length;
  const requiredDoneCount = nonIdentityDone + (identityUploaded ? 1 : 0);
  const allRequiredDone = nonIdentityDone === requiredNonIdentityDocs.length && identityUploaded;

  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-sm font-medium text-amber-800">Upload each document separately</p>
        <p className="text-xs text-amber-700 mt-1">Documents marked <span className="text-red-500 font-bold">*</span> are required. OCR will automatically extract data from identity documents.</p>
      </div>

      {/* Progress */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-600">Upload Progress</span>
          <span className="text-xs text-gray-400 font-mono">{requiredDoneCount}/{totalRequired} required</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', allRequiredDone ? 'bg-emerald-500' : 'bg-brand-500')}
            style={{ width: `${(requiredDoneCount / totalRequired) * 100}%` }}
          />
        </div>
      </div>

      {/* Identity Proof */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />Identity Proof
        </h4>
        <div className={cn(
          'rounded-lg border transition-colors',
          identityUploaded ? 'bg-emerald-50 border-emerald-200' :
          identityState.status === 'error' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'
        )}>
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <select
              value={identityType}
              onChange={e => setIdentityType(e.target.value as IdentityDocType)}
              className="input-glass text-sm flex-1"
              disabled={identityUploaded}
            >
              {IDENTITY_DOC_TYPES.map(t => (
                <option key={t} value={t}>{IDENTITY_DOC_LABELS[t]}</option>
              ))}
            </select>
            <span className="text-red-500 text-sm font-bold shrink-0">*</span>
          </div>
          <div className="flex items-center justify-between py-2 px-3">
            <div className="min-w-0 flex-1 mr-3">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                {IDENTITY_DOC_LABELS[identityType]}
                {identityUploaded && <CheckCircle2 size={13} className="text-emerald-500" />}
              </p>
              {identityUploaded && (() => {
                const uploadedIdType = IDENTITY_DOC_TYPES.find(t => uploads[t]?.status === 'done')!;
                return (
                  <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                    <FileText size={10} /> {uploads[uploadedIdType]?.fileName}
                    <span className="text-emerald-600 ml-1">✓ Pending HR review</span>
                  </p>
                );
              })()}
              {identityState.error && <p className="text-[11px] text-red-500 mt-0.5">{identityState.error}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {identityState.status === 'uploading' && <Loader2 size={15} className="animate-spin text-brand-500" />}
              <label className={cn(
                'text-xs cursor-pointer px-2.5 py-1.5 rounded-lg font-medium transition-colors',
                identityUploaded ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'btn-secondary',
                identityState.status === 'uploading' && 'opacity-50 pointer-events-none'
              )}>
                <input
                  ref={identityFileRef}
                  type="file" className="hidden"
                  accept="image/*,.pdf"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, identityType, IDENTITY_DOC_LABELS[identityType]); e.target.value = ''; }}
                  disabled={identityState.status === 'uploading'}
                />
                {identityUploaded ? 'Replace' : identityState.status === 'uploading' ? 'Uploading…' : 'Upload'}
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* All other doc sections */}
      {activeSections.map(section => (
        <div key={section.title}>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />{section.title}
          </h4>
          <div className="space-y-2">
            {section.docs.map(doc => {
              const state = uploads[doc.type] || { status: 'idle' };
              const isReuploadNeeded = reuploadDocTypes.includes(doc.type);

              // Passport photo — use special camera+upload component
              if (doc.type === 'PHOTO') {
                return (
                  <div key={doc.type} className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Camera size={13} className="text-brand-500" />
                      <p className="text-sm font-medium text-gray-700">
                        Passport Size Photograph <span className="text-red-500">*</span>
                      </p>
                      {state.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                      {isReuploadNeeded && state.status !== 'done' && (
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">RE-UPLOAD</span>
                      )}
                    </div>
                    {isReuploadNeeded && documentRejectReasons[doc.type] && state.status !== 'done' && (
                      <p className="text-[11px] text-red-500">HR note: {documentRejectReasons[doc.type]}</p>
                    )}
                    <PassportPhotoUploader
                      isUploading={state.status === 'uploading'}
                      isUploaded={state.status === 'done'}
                      uploadedFileName={state.fileName}
                      onPhotoReady={(file) => handleUpload(file, doc.type, doc.name)}
                    />
                  </div>
                );
              }

              return (
                <div key={doc.type} className={cn(
                  'flex items-center justify-between py-3 px-3 rounded-lg transition-colors',
                  state.status === 'done' ? 'bg-emerald-50 border border-emerald-200' :
                  state.status === 'error' || isReuploadNeeded ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'
                )}>
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5 flex-wrap">
                      {doc.name} {doc.required && <span className="text-red-500">*</span>}
                      {state.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                      {isReuploadNeeded && state.status !== 'done' && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">RE-UPLOAD</span>}
                    </p>
                    {state.fileName && (
                      <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                        <FileText size={10} /> {state.fileName}
                        {state.status === 'done' && <span className="text-emerald-600 ml-1">✓ Pending HR review</span>}
                      </p>
                    )}
                    {state.error && <p className="text-[11px] text-red-500 mt-0.5">{state.error}</p>}
                    {isReuploadNeeded && !state.error && documentRejectReasons[doc.type] && (
                      <p className="text-[11px] text-red-500 mt-0.5">HR note: {documentRejectReasons[doc.type]}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {state.status === 'uploading' && <Loader2 size={15} className="animate-spin text-brand-500" />}
                    {(state.status === 'error' || isReuploadNeeded) && state.status !== 'uploading' && (
                      <button onClick={() => fileInputRefs.current[doc.type]?.click()} className="p-1 text-red-500 hover:bg-red-100 rounded">
                        <RefreshCw size={13} />
                      </button>
                    )}
                    <label className={cn(
                      'text-xs cursor-pointer px-2.5 py-1.5 rounded-lg font-medium transition-colors',
                      state.status === 'done' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'btn-secondary',
                      state.status === 'uploading' && 'opacity-50 pointer-events-none'
                    )}>
                      <input
                        ref={el => { fileInputRefs.current[doc.type] = el; }}
                        type="file" className="hidden"
                        accept="image/*,.pdf,.doc,.docx"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f, doc.type, doc.name); e.target.value = ''; }}
                        disabled={state.status === 'uploading'}
                      />
                      {state.status === 'done' ? 'Replace' : state.status === 'uploading' ? 'Uploading…' : isReuploadNeeded ? 'Re-upload' : 'Upload'}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Optional: Other Documents / Certificates — available to every employee */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Other Documents / Certificates
          <span className="text-[10px] text-gray-400 font-normal normal-case">(optional)</span>
        </h4>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
          <p className="text-xs text-gray-500">Upload any additional certificates, professional certifications, or supporting documents you'd like to include (e.g. awards, training certificates, language certifications).</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={otherDocName}
              onChange={e => setOtherDocName(e.target.value)}
              placeholder="Document name (e.g. AWS Certification)"
              className="input-glass text-sm flex-1 min-w-0"
              maxLength={80}
            />
            <label className={cn(
              'text-xs cursor-pointer px-3 py-2 rounded-lg font-medium transition-colors shrink-0',
              otherDocName.trim() ? 'btn-secondary' : 'bg-gray-100 text-gray-300 cursor-not-allowed pointer-events-none',
              otherUploading && 'opacity-50 pointer-events-none'
            )}>
              <input
                ref={otherFileRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx"
                disabled={!otherDocName.trim() || otherUploading}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file || !otherDocName.trim()) return;
                  e.target.value = '';
                  setOtherUploading(true);
                  try {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('type', 'OTHER');
                    formData.append('name', otherDocName.trim());
                    await (uploadDocument as any)(formData).unwrap();
                    toast.success(`${otherDocName.trim()} uploaded`);
                    setOtherDocName('');
                    onRefetch();
                  } catch (err: any) {
                    toast.error(err?.data?.error?.message || 'Upload failed');
                  } finally {
                    setOtherUploading(false);
                  }
                }}
              />
              {otherUploading ? 'Uploading…' : 'Upload'}
            </label>
          </div>
        </div>
      </div>

      <button
        onClick={onContinue}
        disabled={!allRequiredDone}
        className={cn('w-full py-3 rounded-xl font-semibold text-sm transition-colors mt-2',
          allRequiredDone ? 'btn-primary' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
        )}
      >
        {allRequiredDone ? 'Continue to Review' : `Upload ${totalRequired - requiredDoneCount} more required document${totalRequired - requiredDoneCount !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}

// ==================
// STEP 6: REVIEW & SUBMIT
// ==================
function Step6Review({ status, onComplete, completing, workMode, qualification, addressSameAsPermanent, experienceLevel, experienceDocFields }: {
  status: any;
  onComplete: () => void;
  completing: boolean;
  workMode?: WorkMode | null;
  qualification?: string | null;
  addressSameAsPermanent: boolean | null;
  experienceLevel: string | null;
  experienceDocFields: { key: string; label: string; required?: boolean }[];
}) {
  const [agreed, setAgreed] = useState(false);

  const addr = status?.currentAddress as any;
  const permAddr = status?.permanentAddress as any;
  const ec = status?.emergencyContact as any;
  // MFA is optional — not required to complete onboarding
  const allSectionsDone = status?.sections?.personalDetails &&
    status?.sections?.emergencyContact && status?.sections?.bankDetails && status?.sections?.documents;

  const requiredDocs = getRequiredNonIdentityDocs(workMode ?? null, qualification, addressSameAsPermanent, experienceLevel, experienceDocFields);

  return (
    <div className="space-y-5">
      {!allSectionsDone && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><AlertTriangle size={16} /> Incomplete Sections</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-700">
            {!status?.sections?.personalDetails && <li>• Personal Details — incomplete</li>}
            {!status?.sections?.emergencyContact && <li>• Emergency Contact — incomplete</li>}
            {!status?.sections?.bankDetails && <li>• Bank Details — incomplete</li>}
            {!status?.sections?.documents && <li>• Required Documents — {status?.missingRequiredDocs?.length || 0} missing</li>}
          </ul>
          <p className="text-xs text-amber-600 mt-2">Please complete all required sections before submitting.</p>
        </div>
      )}
      {!status?.sections?.mfa && allSectionsDone && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
          <Shield size={15} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            <span className="font-semibold">MFA not set up</span> — You can enable Two-Factor Authentication after onboarding from your Profile settings for extra security.
          </p>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
        <ReviewSection title="Personal Details">
          <ReviewRow label="Name" value={`${status?.firstName || ''} ${status?.lastName || ''}`} />
          <ReviewRow label="DOB" value={status?.dateOfBirth} />
          <ReviewRow label="Gender" value={status?.gender} />
          <ReviewRow label="Phone" value={status?.phone} />
          <ReviewRow label="Joining Date" value={status?.joiningDate} />
          {qualification && <ReviewRow label="Qualification" value={QUALIFICATIONS.find(q => q.value === qualification)?.label || qualification} />}
          {addr?.city && <ReviewRow label="Current City" value={`${addr.city}, ${addr.state} ${addr.pincode}`} />}
          {addressSameAsPermanent === false && permAddr?.city && (
            <ReviewRow label="Permanent City" value={`${permAddr.city}, ${permAddr.state} ${permAddr.pincode}`} />
          )}
          {addressSameAsPermanent === true && <ReviewRow label="Permanent Address" value="Same as current" />}
        </ReviewSection>

        <ReviewSection title="Emergency Contact">
          {ec?.name ? (
            <>
              <ReviewRow label="Name" value={ec.name} />
              <ReviewRow label="Relationship" value={ec.relationship} />
              <ReviewRow label="Phone" value={ec.phone} />
            </>
          ) : <p className="text-xs text-red-500">Not provided</p>}
        </ReviewSection>

        <ReviewSection title="Bank Details">
          {status?.bankAccountNumber ? (
            <>
              <ReviewRow label="Bank" value={status.bankName} />
              <ReviewRow label="Account No." value={`****${status.bankAccountNumber?.slice(-4)}`} />
              <ReviewRow label="IFSC" value={status.ifscCode} />
              {status.epfMemberId && <ReviewRow label="EPF / UAN" value={status.epfMemberId} />}
            </>
          ) : <p className="text-xs text-red-500">Not provided</p>}
        </ReviewSection>

        <ReviewSection title="Documents">
          {(() => {
            const uploadedIdType = IDENTITY_DOC_TYPES.find(t => status?.uploadedDocTypes?.includes(t));
            return (
              <ReviewRow
                label="Identity Proof"
                value={uploadedIdType ? `✓ ${IDENTITY_DOC_LABELS[uploadedIdType]}` : '✗ Missing'}
                valueClass={uploadedIdType ? 'text-emerald-600' : 'text-red-500'}
              />
            );
          })()}
          {requiredDocs.map(t => (
            <ReviewRow key={t} label={REQUIRED_NON_IDENTITY_LABELS[t] || t.replace(/_/g, ' ')}
              value={status?.uploadedDocTypes?.includes(t) ? '✓ Uploaded' : '✗ Missing'}
              valueClass={status?.uploadedDocTypes?.includes(t) ? 'text-emerald-600' : 'text-red-500'} />
          ))}
        </ReviewSection>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="rounded border-gray-300 mt-0.5" />
        I confirm that all information provided is accurate and complete.
      </label>

      <button
        onClick={onComplete}
        disabled={completing || !agreed || !allSectionsDone}
        className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3 disabled:opacity-50"
      >
        {completing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
        Complete Onboarding
      </button>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
      <div className="border-t border-gray-200 mt-3" />
    </div>
  );
}

function ReviewRow({ label, value, valueClass }: { label: string; value?: string; valueClass?: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={cn('text-gray-800 font-medium text-right max-w-[60%]', valueClass)}>{value || '—'}</span>
    </div>
  );
}

function CompletionScreen({ orgName, onContinue }: { orgName?: string; onContinue: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-brand-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200 }}
        className="bg-white rounded-2xl shadow-xl p-10 text-center max-w-md w-full"
      >
        <motion.div initial={{ rotate: -20 }} animate={{ rotate: 0 }} transition={{ delay: 0.3, type: 'spring' }}>
          <PartyPopper size={56} className="mx-auto text-brand-600 mb-4" />
        </motion.div>
        <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">Welcome to the Team!</h1>
        <p className="text-gray-500 text-sm">
          Your onboarding at {orgName || 'Aniston Technologies LLP'} is complete. Please upload your KYC documents to get full access.
        </p>
        <button onClick={onContinue} className="btn-primary inline-block mt-6 px-8">Go to KYC Verification</button>
      </motion.div>
    </div>
  );
}
