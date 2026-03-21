import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, ChevronLeft, Loader2, PartyPopper, Eye, EyeOff } from 'lucide-react';
import { useGetOnboardingStatusQuery, useSaveOnboardingStepMutation, useCompleteOnboardingMutation } from './onboardingApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const STEPS = [
  { num: 1, title: 'Set Password', desc: 'Create your account password' },
  { num: 2, title: 'Personal Details', desc: 'Basic personal information' },
  { num: 3, title: 'Documents', desc: 'Upload required documents' },
  { num: 4, title: 'Photo & Signature', desc: 'Profile photo and signature' },
  { num: 5, title: 'Bank Details', desc: 'Salary account information' },
  { num: 6, title: 'Emergency Contact', desc: 'Emergency contact person' },
  { num: 7, title: 'Review & Submit', desc: 'Review all information' },
];

export default function OnboardingPortal() {
  const { token } = useParams<{ token: string }>();
  const { data: statusRes, isLoading, error } = useGetOnboardingStatusQuery(token!);
  const [saveStep, { isLoading: saving }] = useSaveOnboardingStepMutation();
  const [completeOnboarding] = useCompleteOnboardingMutation();
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);

  const status = statusRes?.data;

  useEffect(() => {
    if (status?.currentStep) {
      setCurrentStep(Math.min(status.currentStep, 7));
    }
  }, [status]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-1">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading onboarding portal...</p>
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-1 p-4">
        <div className="layer-card p-8 text-center max-w-md">
          <h2 className="text-xl font-display font-bold text-gray-800 mb-2">Invalid Link</h2>
          <p className="text-gray-500 text-sm">This onboarding link is invalid or has expired. Please contact HR for a new invite.</p>
        </div>
      </div>
    );
  }

  if (completed) {
    return <CompletionScreen orgName={status.organization?.name} />;
  }

  const handleSaveStep = async (stepData: any) => {
    try {
      await saveStep({ token: token!, step: currentStep, data: stepData }).unwrap();
      toast.success(`Step ${currentStep} saved!`);
      if (currentStep < 7) {
        setCurrentStep(currentStep + 1);
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    }
  };

  const handleComplete = async () => {
    try {
      await completeOnboarding(token!).unwrap();
      setCompleted(true);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to complete');
    }
  };

  return (
    <div className="min-h-screen bg-surface-1">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <img src="/logo.png" alt="Aniston" className="w-8 h-8 object-contain" />
          <div>
            <h1 className="font-display font-semibold text-gray-900">Welcome Aboard!</h1>
            <p className="text-xs text-gray-400">{status.organization?.name || 'Aniston Technologies LLP'}</p>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Step indicators */}
        <div className="flex items-center justify-between mb-8 overflow-x-auto pb-2">
          {STEPS.map((step, i) => (
            <div key={step.num} className="flex items-center">
              <div
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors flex-shrink-0',
                  currentStep > step.num
                    ? 'bg-emerald-500 text-white'
                    : currentStep === step.num
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-200 text-gray-500'
                )}
              >
                {currentStep > step.num ? <Check size={16} /> : step.num}
              </div>
              <span className={cn(
                'hidden sm:block text-xs ml-2 whitespace-nowrap',
                currentStep === step.num ? 'text-brand-600 font-medium' : 'text-gray-400'
              )}>
                {step.title}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'w-8 sm:w-12 h-0.5 mx-2',
                  currentStep > step.num ? 'bg-emerald-500' : 'bg-gray-200'
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="layer-card p-6 sm:p-8"
          >
            <h2 className="text-lg font-display font-semibold text-gray-800 mb-1">
              {STEPS[currentStep - 1].title}
            </h2>
            <p className="text-sm text-gray-400 mb-6">{STEPS[currentStep - 1].desc}</p>

            {currentStep === 1 && <Step1Password onSave={handleSaveStep} saving={saving} />}
            {currentStep === 2 && <Step2Personal onSave={handleSaveStep} saving={saving} employee={status.employee} />}
            {currentStep === 3 && <Step3Documents onSave={handleSaveStep} saving={saving} />}
            {currentStep === 4 && <Step4Photo onSave={handleSaveStep} saving={saving} />}
            {currentStep === 5 && <Step5Bank onSave={handleSaveStep} saving={saving} />}
            {currentStep === 6 && <Step6Emergency onSave={handleSaveStep} saving={saving} />}
            {currentStep === 7 && <Step7Review onComplete={handleComplete} saving={saving} />}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="btn-secondary flex items-center gap-2 disabled:opacity-30"
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <span className="text-sm text-gray-400">Step {currentStep} of 7</span>
          {currentStep < 7 && (
            <button
              onClick={() => setCurrentStep(Math.min(7, currentStep + 1))}
              className="btn-secondary flex items-center gap-2"
            >
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================
// STEP COMPONENTS
// ==================

function Step1Password({ onSave, saving }: { onSave: (data: any) => void; saving: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (password === confirm) onSave({ password }); else toast.error('Passwords do not match'); }} className="space-y-4">
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="New Password" className="input-glass w-full pr-10" required minLength={8} />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm Password" className="input-glass w-full" required minLength={8} />
      <p className="text-xs text-gray-400">Min 8 characters with uppercase, lowercase, number, and special character</p>
      <SaveButton saving={saving} />
    </form>
  );
}

function Step2Personal({ onSave, saving, employee }: { onSave: (data: any) => void; saving: boolean; employee: any }) {
  const [form, setForm] = useState({
    firstName: employee?.firstName || '', lastName: employee?.lastName || '',
    dateOfBirth: '', gender: 'MALE', bloodGroup: '', phone: '', personalEmail: '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          placeholder="First Name *" className="input-glass" required />
        <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          placeholder="Last Name *" className="input-glass" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
          className="input-glass" />
        <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="input-glass">
          <option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Phone Number *" className="input-glass" required />
        <input value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
          placeholder="Blood Group" className="input-glass" />
      </div>
      <input type="email" value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })}
        placeholder="Personal Email" className="input-glass w-full" />
      <SaveButton saving={saving} />
    </form>
  );
}

function Step3Documents({ onSave, saving }: { onSave: (data: any) => void; saving: boolean }) {
  const docs = [
    { name: 'Aadhaar Card', type: 'AADHAAR', required: true },
    { name: 'PAN Card', type: 'PAN', required: true },
    { name: '10th Certificate', type: 'TENTH_CERTIFICATE', required: true },
    { name: '12th Certificate', type: 'TWELFTH_CERTIFICATE', required: false },
    { name: 'Graduation Degree', type: 'DEGREE_CERTIFICATE', required: true },
    { name: 'Bank Statement', type: 'BANK_STATEMENT', required: true },
    { name: 'Cancelled Cheque', type: 'CANCELLED_CHEQUE', required: true },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 mb-4">Upload your documents. Required documents are marked with *</p>
      {docs.map((doc) => (
        <div key={doc.type} className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
          <div>
            <p className="text-sm font-medium text-gray-700">{doc.name} {doc.required && <span className="text-red-400">*</span>}</p>
            <p className="text-xs text-gray-400">{doc.type}</p>
          </div>
          <label className="btn-secondary text-xs cursor-pointer">
            <input type="file" className="hidden" accept="image/*,.pdf" />
            Upload
          </label>
        </div>
      ))}
      <button onClick={() => onSave({ documentsAcknowledged: true })} className="btn-primary w-full mt-4" disabled={saving}>
        Continue
      </button>
    </div>
  );
}

function Step4Photo({ onSave, saving }: { onSave: (data: any) => void; saving: boolean }) {
  return (
    <div className="space-y-6 text-center">
      <div className="w-32 h-32 mx-auto rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center">
        <p className="text-xs text-gray-400">Photo</p>
      </div>
      <label className="btn-secondary inline-flex cursor-pointer">
        <input type="file" className="hidden" accept="image/*" />
        Upload Photo
      </label>
      <div className="border-t border-gray-100 pt-6">
        <p className="text-sm text-gray-500 mb-3">Digital Signature</p>
        <div className="w-64 h-24 mx-auto rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center">
          <p className="text-xs text-gray-400">Draw or upload signature</p>
        </div>
      </div>
      <button onClick={() => onSave({ photoUploaded: true })} className="btn-primary w-full" disabled={saving}>
        Continue
      </button>
    </div>
  );
}

function Step5Bank({ onSave, saving }: { onSave: (data: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ accountNumber: '', ifsc: '', bankName: '', accountType: 'SAVINGS' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
        placeholder="Account Number *" className="input-glass w-full" required />
      <div className="grid grid-cols-2 gap-3">
        <input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })}
          placeholder="IFSC Code *" className="input-glass" required />
        <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })}
          placeholder="Bank Name *" className="input-glass" required />
      </div>
      <select value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} className="input-glass w-full">
        <option value="SAVINGS">Savings</option><option value="CURRENT">Current</option>
      </select>
      <SaveButton saving={saving} />
    </form>
  );
}

function Step6Emergency({ onSave, saving }: { onSave: (data: any) => void; saving: boolean }) {
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', email: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Contact Person Name *" className="input-glass w-full" required />
      <div className="grid grid-cols-2 gap-3">
        <input value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}
          placeholder="Relationship *" className="input-glass" required />
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Phone Number *" className="input-glass" required />
      </div>
      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="Email (optional)" className="input-glass w-full" />
      <SaveButton saving={saving} />
    </form>
  );
}

function Step7Review({ onComplete, saving }: { onComplete: () => void; saving: boolean }) {
  return (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 flex items-center justify-center">
        <Check size={28} className="text-emerald-500" />
      </div>
      <div>
        <h3 className="text-lg font-display font-semibold text-gray-800">All steps completed!</h3>
        <p className="text-sm text-gray-500 mt-1">Please review your information and submit to complete onboarding.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-600 text-left max-w-sm mx-auto">
        <input type="checkbox" className="rounded border-gray-300 mt-0.5" required />
        I confirm that all information provided is accurate and I agree to the company policies.
      </label>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onComplete}
        disabled={saving}
        className="btn-primary text-lg px-10 py-3"
      >
        {saving ? <Loader2 size={20} className="animate-spin" /> : null}
        Complete Onboarding
      </motion.button>
    </div>
  );
}

function CompletionScreen({ orgName }: { orgName?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-emerald-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200 }}
        className="layer-card p-10 text-center max-w-md"
      >
        <motion.div
          initial={{ rotate: -20 }}
          animate={{ rotate: 0 }}
          transition={{ delay: 0.3, type: 'spring' }}
        >
          <PartyPopper size={56} className="mx-auto text-brand-600 mb-4" />
        </motion.div>
        <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">Welcome to the Team!</h1>
        <p className="text-gray-500 text-sm">
          Your onboarding at {orgName || 'Aniston Technologies LLP'} is complete. You can now log in to your account.
        </p>
        <a href="/login" className="btn-primary inline-block mt-6">Go to Login</a>
      </motion.div>
    </div>
  );
}

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
      type="submit" disabled={saving}
      className="btn-primary w-full flex items-center justify-center gap-2">
      {saving && <Loader2 size={16} className="animate-spin" />}
      {saving ? 'Saving...' : 'Save & Continue'}
    </motion.button>
  );
}
