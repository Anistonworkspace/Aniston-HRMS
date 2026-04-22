import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, ChevronLeft, Loader2, PartyPopper,
  Eye, EyeOff, Upload, FileText, CheckCircle2, AlertTriangle,
  RefreshCw, Shield, X, Building2, HardHat, Briefcase, MapPin,
} from 'lucide-react';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { setUser } from '../auth/authSlice';
import { useGetMyOnboardingStatusQuery, useSaveMyStepMutation, useCompleteMyOnboardingMutation } from './onboardingApi';
import { useGetMfaStatusQuery } from '../auth/authApi';
import { MFASetupModal } from '../auth/MFASetupModal';
import { useUploadDocumentMutation } from '../documents/documentApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const STEPS = [
  { num: 1, title: 'Set Password', desc: 'Secure your account' },
  { num: 2, title: 'MFA Setup', desc: 'Two-factor authentication (optional)' },
  { num: 3, title: 'Personal Details', desc: 'Your information' },
  { num: 4, title: 'Emergency Contact', desc: 'In case of emergency' },
  { num: 5, title: 'Bank Details', desc: 'Salary account' },
  { num: 6, title: 'Documents', desc: 'Upload required documents' },
  { num: 7, title: 'Review & Submit', desc: 'Complete onboarding' },
];

// Identity proof — employee uploads ONE; stored under its actual type
const IDENTITY_DOC_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'] as const;
type IdentityDocType = typeof IDENTITY_DOC_TYPES[number];
const IDENTITY_DOC_LABELS: Record<IdentityDocType, string> = {
  AADHAAR: 'Aadhaar Card',
  PASSPORT: 'Passport',
  DRIVING_LICENSE: 'Driving License',
  VOTER_ID: 'Voter ID Card',
};
// Non-identity required docs (DEGREE_CERTIFICATE is optional — depends on qualification)
const REQUIRED_NON_IDENTITY_DOCS = ['PAN', 'TENTH_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE'];
const REQUIRED_NON_IDENTITY_LABELS: Record<string, string> = {
  PAN: 'PAN Card', TENTH_CERTIFICATE: '10th Certificate', RESIDENCE_PROOF: 'Residence Proof',
  PHOTO: 'Passport Photo', BANK_STATEMENT: 'Bank Statement', CANCELLED_CHEQUE: 'Cancelled Cheque',
};

type WorkMode = 'OFFICE' | 'PROJECT_SITE';

function getRequiredNonIdentityDocs(workMode: WorkMode | null): string[] {
  if (workMode === 'PROJECT_SITE') return ['PAN', 'PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE'];
  return ['PAN', 'TENTH_CERTIFICATE', 'RESIDENCE_PROOF', 'PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE'];
}

function getSiteDocSections() {
  return [
    {
      title: 'Identity & Financial Proof',
      docs: [{ name: 'PAN Card', type: 'PAN', required: true }],
    },
    {
      title: 'Passport Photo',
      docs: [{ name: 'Passport Size Photograph', type: 'PHOTO', required: true }],
    },
    {
      title: 'Financial Documents',
      docs: [
        { name: 'Bank Statement (last 3 months)', type: 'BANK_STATEMENT', required: true },
        { name: 'Cancelled Cheque', type: 'CANCELLED_CHEQUE', required: true },
      ],
    },
  ];
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
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);

  // Resume from last incomplete step
  useEffect(() => {
    if (status?.resumeStep) {
      setCurrentStep(Math.min(status.resumeStep, 7));
    }
  }, [status]);

  useEffect(() => {
    if (status?.workMode) setWorkMode(status.workMode as WorkMode);
  }, [status]);

  const handleSaveStep = async (stepNum: number, data: any) => {
    try {
      await saveStep({ step: stepNum, data }).unwrap();
      toast.success('Saved!');
      await refetch();
      setCurrentStep(s => Math.min(s + 1, 7));
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    }
  };

  const handleComplete = async () => {
    try {
      await completeOnboarding().unwrap();
      if (currentUser) {
        dispatch(setUser({ ...currentUser, onboardingComplete: true }));
      }
      setCompleted(true);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to complete onboarding');
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
    return <CompletionScreen orgName={status?.organization?.name} onContinue={() => navigate('/kyc-pending', { replace: true })} />;
  }

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
                {step.num === 2 && <span className="text-gray-400 ml-0.5">(opt)</span>}
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
              <Step1Password
                onSave={(d) => handleSaveStep(1, d)}
                onContinue={() => setCurrentStep(2)}
                saving={saving}
                isAlreadySet={status?.sections?.password}
                workMode={workMode}
                onWorkModeChange={setWorkMode}
              />
            )}
            {currentStep === 2 && (
              <Step2MFA
                onSkip={() => { setCurrentStep(3); }}
                onEnabled={() => { refetch(); setCurrentStep(3); }}
                isMfaEnabled={status?.sections?.mfa}
              />
            )}
            {currentStep === 3 && (
              <Step3Personal
                onSave={(d) => handleSaveStep(3, d)}
                saving={saving}
                initialData={status}
                isSiteEmployee={workMode === 'PROJECT_SITE'}
              />
            )}
            {currentStep === 4 && (
              <Step4Emergency
                onSave={(d) => handleSaveStep(4, d)}
                saving={saving}
                initialData={status?.emergencyContact}
              />
            )}
            {currentStep === 5 && (
              <Step5Bank
                onSave={(d) => handleSaveStep(5, d)}
                saving={saving}
                initialData={status}
              />
            )}
            {currentStep === 6 && (
              <Step6Documents
                uploadedDocTypes={status?.uploadedDocTypes || []}
                onContinue={() => setCurrentStep(7)}
                onRefetch={refetch}
                workMode={workMode}
              />
            )}
            {currentStep === 7 && (
              <Step7Review
                status={status}
                onComplete={handleComplete}
                completing={completing}
                workMode={workMode}
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
          {currentStep < 7 && currentStep !== 6 && (
            <button onClick={() => setCurrentStep(s => s + 1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              Skip <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================
// STEP 1: SET PASSWORD
// ==================
function Step1Password({ onSave, onContinue, saving, isAlreadySet, workMode, onWorkModeChange }: {
  onSave: (d: any) => void;
  onContinue?: () => void;
  saving: boolean;
  isAlreadySet?: boolean;
  workMode: WorkMode | null;
  onWorkModeChange: (m: WorkMode) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  const workTypeSection = (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-700">Work Type <span className="text-red-500">*</span></p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onWorkModeChange('OFFICE')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-left',
            workMode === 'OFFICE'
              ? 'border-brand-500 bg-brand-50'
              : 'border-gray-200 hover:border-brand-300'
          )}
        >
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', workMode === 'OFFICE' ? 'bg-brand-600' : 'bg-gray-100')}>
            <Briefcase size={18} className={workMode === 'OFFICE' ? 'text-white' : 'text-gray-500'} />
          </div>
          <div>
            <p className={cn('text-sm font-semibold', workMode === 'OFFICE' ? 'text-brand-700' : 'text-gray-700')}>Office Employee</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Works at office/remote. Full onboarding.</p>
          </div>
          {workMode === 'OFFICE' && <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center self-end ml-auto"><Check size={12} className="text-white" /></div>}
        </button>
        <button
          type="button"
          onClick={() => onWorkModeChange('PROJECT_SITE')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-left',
            workMode === 'PROJECT_SITE'
              ? 'border-amber-500 bg-amber-50'
              : 'border-gray-200 hover:border-amber-300'
          )}
        >
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', workMode === 'PROJECT_SITE' ? 'bg-amber-500' : 'bg-gray-100')}>
            <HardHat size={18} className={workMode === 'PROJECT_SITE' ? 'text-white' : 'text-gray-500'} />
          </div>
          <div>
            <p className={cn('text-sm font-semibold', workMode === 'PROJECT_SITE' ? 'text-amber-700' : 'text-gray-700')}>Site Employee</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Works at field/construction sites. Basic onboarding.</p>
          </div>
          {workMode === 'PROJECT_SITE' && <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center self-end ml-auto"><Check size={12} className="text-white" /></div>}
        </button>
      </div>
      {!workMode && <p className="text-[11px] text-amber-600">Please select your work type to continue.</p>}
    </div>
  );

  if (isAlreadySet) {
    return (
      <div className="space-y-5">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-emerald-500 flex-shrink-0" />
          <p className="text-sm text-emerald-700">Password already set. You can update it below or continue to the next step.</p>
        </div>
        {workTypeSection}
        <form onSubmit={(e) => { e.preventDefault(); if (!workMode) { toast.error('Please select your work type'); return; } if (password && password === confirm) onSave({ password, workMode }); else if (password !== confirm) toast.error('Passwords do not match'); }} className="space-y-3">
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500 mb-2">Update password (optional)</p>
            <div className="relative">
              <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="New Password (optional)" className="input-glass w-full pr-10" minLength={8} />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password && (
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Confirm Password" className="input-glass w-full mt-2" minLength={8} />
            )}
          </div>
          <div className="flex gap-3">
            {password
              ? <button type="submit" disabled={saving || !workMode} className="btn-primary flex-1 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Update Password & Continue'}</button>
              : <button type="button" disabled={!workMode} onClick={() => { if (workMode) onSave({ workMode }); }} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">Continue to Next Step <ChevronRight size={16} /></button>
            }
          </div>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!workMode) { toast.error('Please select your work type'); return; }
      if (!password) { toast.error('Password is required'); return; }
      if (password !== confirm) { toast.error('Passwords do not match'); return; }
      onSave({ password, workMode });
    }} className="space-y-5">
      {workTypeSection}
      <div className="border-t border-gray-100 pt-3 space-y-3">
        <div className="relative">
          <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
            placeholder="New Password *" className="input-glass w-full pr-10" required minLength={8} />
          <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder="Confirm Password *" className="input-glass w-full" required minLength={8} />
        <p className="text-xs text-gray-400">Minimum 8 characters — include uppercase, lowercase, number and special character.</p>
      </div>
      <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
        {saving && <Loader2 size={16} className="animate-spin" />}
        Set Password & Continue
      </button>
    </form>
  );
}

// ==================
// STEP 2: MFA SETUP
// ==================
function Step2MFA({ onSkip, onEnabled, isMfaEnabled }: { onSkip: () => void; onEnabled: () => void; isMfaEnabled?: boolean }) {
  const [showSetup, setShowSetup] = useState(false);
  const { data: mfaStatus, refetch } = useGetMfaStatusQuery();
  const isEnabled = isMfaEnabled || mfaStatus?.data?.isEnabled;

  if (isEnabled) {
    return (
      <div className="space-y-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
          <Shield size={20} className="text-emerald-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-700">Two-Factor Authentication Enabled</p>
            <p className="text-xs text-emerald-600 mt-0.5">Your account is protected with MFA.</p>
          </div>
        </div>
        <button onClick={onSkip} className="btn-primary w-full">Continue to Next Step</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-800">Two-Factor Authentication (Optional)</p>
            <p className="text-xs text-blue-600 mt-1">Add an extra layer of security to your account. You'll need an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator.</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm text-gray-600">
        <p className="font-medium text-gray-700 text-xs uppercase tracking-wide">How it works:</p>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span> Download an authenticator app on your phone</div>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span> Scan the QR code shown after clicking "Enable MFA"</div>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span> Enter the 6-digit code from the app to verify</div>
        <div className="flex items-center gap-2 text-xs"><span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span> Use the code at every login for extra security</div>
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
// STEP 3: PERSONAL DETAILS
// ==================
const PERSONAL_INIT = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '',
  bloodGroup: '', maritalStatus: '', phone: '', personalEmail: '',
  address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
};

function Step3Personal({ onSave, saving, initialData, isSiteEmployee }: { onSave: (d: any) => void; saving: boolean; initialData: any; isSiteEmployee?: boolean }) {
  const [form, setForm] = useState(PERSONAL_INIT);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (initialData) {
      const addr = (initialData.address as any) || {};
      setForm({
        firstName: initialData.firstName || '',
        lastName: initialData.lastName || '',
        dateOfBirth: initialData.dateOfBirth || '',
        gender: initialData.gender && initialData.gender !== 'PREFER_NOT_TO_SAY' ? initialData.gender : '',
        bloodGroup: initialData.bloodGroup || '',
        maritalStatus: initialData.maritalStatus || '',
        phone: initialData.phone || '',
        personalEmail: initialData.personalEmail || '',
        address: {
          line1: addr.line1 || '',
          line2: addr.line2 || '',
          city: addr.city || '',
          state: addr.state || '',
          pincode: addr.pincode || '',
          country: addr.country || 'India',
        },
      });
    }
  }, [initialData]);

  const isValid = !!(form.firstName.trim() && form.lastName.trim() && form.dateOfBirth &&
    form.gender && form.phone.trim() &&
    (isSiteEmployee || (form.address.line1.trim() && form.address.city.trim() && form.address.state.trim() && form.address.pincode.trim())));

  const set = (field: string, val: string) => setForm(p => ({ ...p, [field]: val }));
  const setAddr = (field: string, val: string) => setForm(p => ({ ...p, address: { ...p.address, [field]: val } }));
  const err = (cond: boolean) => showErrors && !cond ? 'border-red-400 ring-1 ring-red-200' : '';

  return (
    <div className="space-y-4">
      {showErrors && !isValid && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={13} /> Please fill all required fields marked with *
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
          <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 9876543210" className={cn('input-glass w-full text-sm', err(!!form.phone.trim()))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Personal Email <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="email" value={form.personalEmail} onChange={e => set('personalEmail', e.target.value)} className="input-glass w-full text-sm" placeholder="personal@email.com" />
        </div>
      </div>

      {!isSiteEmployee && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-600 mb-3 uppercase tracking-wide">Address</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Street Address <span className="text-red-500">*</span></label>
              <input value={form.address.line1} onChange={e => setAddr('line1', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.address.line1.trim()))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Address Line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.address.line2} onChange={e => setAddr('line2', e.target.value)} className="input-glass w-full text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">City <span className="text-red-500">*</span></label>
                <input value={form.address.city} onChange={e => setAddr('city', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.address.city.trim()))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
                <input value={form.address.state} onChange={e => setAddr('state', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.address.state.trim()))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Pincode <span className="text-red-500">*</span></label>
                <input value={form.address.pincode} onChange={e => setAddr('pincode', e.target.value)} className={cn('input-glass w-full text-sm', err(!!form.address.pincode.trim()))} />
              </div>
            </div>
          </div>
        </div>
      )}
      {isSiteEmployee && (
        <div className="border-t border-gray-100 pt-4 p-3 bg-amber-50 rounded-lg">
          <p className="text-xs text-amber-700 flex items-center gap-1.5"><HardHat size={13} /> Address not required for site employees. HR will update location details separately.</p>
        </div>
      )}

      <button
        onClick={() => { setShowErrors(true); if (isValid) onSave(form); else toast.error('Please fill all required fields'); }}
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
// STEP 4: EMERGENCY CONTACT
// ==================
function Step4Emergency({ onSave, saving, initialData }: { onSave: (d: any) => void; saving: boolean; initialData: any }) {
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
// STEP 5: BANK DETAILS
// ==================
function Step5Bank({ onSave, saving, initialData }: { onSave: (d: any) => void; saving: boolean; initialData: any }) {
  const [form, setForm] = useState({ accountHolderName: '', accountType: 'SAVINGS' as 'SAVINGS' | 'CURRENT', bankName: '', bankAccountNumber: '', ifscCode: '' });
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (initialData?.bankAccountNumber) {
      setForm({
        accountHolderName: initialData.accountHolderName || '',
        accountType: (initialData.accountType as 'SAVINGS' | 'CURRENT') || 'SAVINGS',
        bankName: initialData.bankName || '',
        bankAccountNumber: initialData.bankAccountNumber || '',
        ifscCode: initialData.ifscCode || '',
      });
    }
  }, [initialData]);

  const isValid = !!(form.accountHolderName.trim() && form.bankName.trim() && form.bankAccountNumber.trim() && form.ifscCode.trim());
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
          <input value={form.ifscCode} onChange={e => set('ifscCode', e.target.value.toUpperCase())} placeholder="SBIN0001234" className={cn('input-glass w-full text-sm font-mono', err(!!form.ifscCode.trim()))} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Account Type <span className="text-red-500">*</span></label>
        <select value={form.accountType} onChange={e => set('accountType', e.target.value)} className="input-glass w-full text-sm">
          <option value="SAVINGS">Savings</option>
          <option value="CURRENT">Current</option>
        </select>
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
// STEP 6: DOCUMENTS (separate upload only)
// ==================
const DOC_SECTIONS = [
  {
    title: 'Education Certificates',
    docs: [
      { name: '10th Marksheet / Certificate', type: 'TENTH_CERTIFICATE', required: true },
      { name: '12th Marksheet / Certificate', type: 'TWELFTH_CERTIFICATE', required: false },
      { name: 'Diploma / Degree Certificate', type: 'DEGREE_CERTIFICATE', required: false },
      { name: 'Post-Graduation Certificate', type: 'POST_GRADUATION_CERTIFICATE', required: false },
    ],
  },
  {
    title: 'Address & Financial Proof',
    docs: [
      { name: 'PAN Card', type: 'PAN', required: true },
      { name: 'Residence Proof (Utility Bill / Rent Agreement)', type: 'RESIDENCE_PROOF', required: true },
    ],
  },
  {
    title: 'Passport Photo',
    docs: [
      { name: 'Passport Size Photograph', type: 'PHOTO', required: true },
    ],
  },
  {
    title: 'Previous Employment (if applicable)',
    docs: [
      { name: 'Offer / Appointment Letter', type: 'OFFER_LETTER_DOC', required: false },
      { name: 'Last 3 Salary Slips / Bank Statements', type: 'SALARY_SLIP_DOC', required: false },
      { name: 'Relieving / Experience Letter', type: 'EXPERIENCE_LETTER', required: false },
    ],
  },
  {
    title: 'Financial Documents',
    docs: [
      { name: 'Bank Statement (last 3 months)', type: 'BANK_STATEMENT', required: true },
      { name: 'Cancelled Cheque', type: 'CANCELLED_CHEQUE', required: true },
    ],
  },
];

type UploadState = { status: 'idle' | 'uploading' | 'done' | 'error'; fileName?: string; error?: string };

function Step6Documents({ uploadedDocTypes, onContinue, onRefetch, workMode }: {
  uploadedDocTypes: string[];
  onContinue: () => void;
  onRefetch: () => void;
  workMode?: WorkMode | null;
}) {
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [identityType, setIdentityType] = useState<IdentityDocType>('AADHAAR');
  const [uploadDocument] = useUploadDocumentMutation();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const identityFileRef = useRef<HTMLInputElement | null>(null);
  const requiredNonIdentityDocs = getRequiredNonIdentityDocs(workMode ?? null);
  const activeSections = workMode === 'PROJECT_SITE' ? getSiteDocSections() : DOC_SECTIONS;

  // Sync initial state + identity type from already-uploaded docs
  useEffect(() => {
    const initial: Record<string, UploadState> = {};
    for (const type of uploadedDocTypes) {
      initial[type] = { status: 'done', fileName: 'Previously uploaded' };
    }
    setUploads(prev => ({ ...initial, ...prev }));
    const uploadedIdentity = IDENTITY_DOC_TYPES.find(t => uploadedDocTypes.includes(t));
    if (uploadedIdentity) setIdentityType(uploadedIdentity);
  }, [uploadedDocTypes]);

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

      {/* Identity Proof — separate section with type selector */}
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
        {identityUploaded && (() => {
          const uploadedIdType = IDENTITY_DOC_TYPES.find(t => uploads[t]?.status === 'done')!;
          if (uploadedIdType !== identityType) {
            return <p className="text-[11px] text-amber-600 mt-1">Note: You uploaded {IDENTITY_DOC_LABELS[uploadedIdType]}. Change type selector above to replace it.</p>;
          }
          return null;
        })()}
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
              return (
                <div key={doc.type} className={cn(
                  'flex items-center justify-between py-3 px-3 rounded-lg transition-colors',
                  state.status === 'done' ? 'bg-emerald-50 border border-emerald-200' :
                  state.status === 'error' ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'
                )}>
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5 flex-wrap">
                      {doc.name} {doc.required && <span className="text-red-500">*</span>}
                      {state.status === 'done' && <CheckCircle2 size={13} className="text-emerald-500" />}
                    </p>
                    {state.fileName && (
                      <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                        <FileText size={10} /> {state.fileName}
                        {state.status === 'done' && <span className="text-emerald-600 ml-1">✓ Pending HR review</span>}
                      </p>
                    )}
                    {state.error && <p className="text-[11px] text-red-500 mt-0.5">{state.error}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {state.status === 'uploading' && <Loader2 size={15} className="animate-spin text-brand-500" />}
                    {state.status === 'error' && (
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
                      {state.status === 'done' ? 'Replace' : state.status === 'uploading' ? 'Uploading…' : 'Upload'}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

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
// STEP 7: REVIEW & SUBMIT
// ==================
function Step7Review({ status, onComplete, completing, workMode }: { status: any; onComplete: () => void; completing: boolean; workMode?: WorkMode | null }) {
  const [agreed, setAgreed] = useState(false);

  const addr = status?.address as any;
  const ec = status?.emergencyContact as any;
  const allSectionsDone = status?.sections?.personalDetails && status?.sections?.emergencyContact &&
    status?.sections?.bankDetails && status?.sections?.documents;

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
          <p className="text-xs text-amber-600 mt-2">Please complete all sections before submitting.</p>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
        <ReviewSection title="Personal Details">
          <ReviewRow label="Name" value={`${status?.firstName || ''} ${status?.lastName || ''}`} />
          <ReviewRow label="DOB" value={status?.dateOfBirth} />
          <ReviewRow label="Gender" value={status?.gender} />
          <ReviewRow label="Phone" value={status?.phone} />
          {addr?.city && <ReviewRow label="City" value={`${addr.city}, ${addr.state} ${addr.pincode}`} />}
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
          {getRequiredNonIdentityDocs(workMode ?? null).map(t => (
            <ReviewRow key={t} label={REQUIRED_NON_IDENTITY_LABELS[t] || t.replace(/_/g, ' ')} value={status?.uploadedDocTypes?.includes(t) ? '✓ Uploaded' : '✗ Missing'} valueClass={status?.uploadedDocTypes?.includes(t) ? 'text-emerald-600' : 'text-red-500'} />
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
