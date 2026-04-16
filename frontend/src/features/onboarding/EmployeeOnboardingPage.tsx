import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, ChevronLeft, Loader2, AlertTriangle,
  User, Phone, ClipboardCheck, Building2, CreditCard
} from 'lucide-react';
import { useGetMyOnboardingStatusQuery, useSaveMyStepMutation, useCompleteMyOnboardingMutation } from './onboardingApi';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { setUser } from '../auth/authSlice';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// Mandatory field check for each step (Blood Group is optional)
function canProceedStep1(p: typeof PERSONAL_INIT): boolean {
  return !!(p.firstName.trim() && p.lastName.trim() && p.dateOfBirth && p.gender && p.phone.trim()
    && p.address.line1.trim() && p.address.city.trim() && p.address.state.trim() && p.address.pincode.trim());
}
function canProceedStep2(e: typeof EMERGENCY_INIT): boolean {
  return !!(e.name.trim() && e.relationship && e.phone.trim());
}
function canProceedStep3(b: typeof BANK_INIT): boolean {
  return !!(b.bankAccountNumber.trim() && b.bankName.trim() && b.ifscCode.trim() && b.accountHolderName.trim());
}

const PERSONAL_INIT = {
  firstName: '', lastName: '', dateOfBirth: '', gender: '', bloodGroup: '',
  maritalStatus: '', phone: '', personalEmail: '',
  address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
};
const EMERGENCY_INIT = { name: '', relationship: '', phone: '', email: '' };
const BANK_INIT: { bankAccountNumber: string; bankName: string; ifscCode: string; accountHolderName: string; accountType: 'SAVINGS' | 'CURRENT' } = {
  bankAccountNumber: '', bankName: '', ifscCode: '', accountHolderName: '', accountType: 'SAVINGS',
};

const STEPS = [
  { num: 1, title: 'Personal Details', desc: 'Basic personal information', icon: User },
  { num: 2, title: 'Emergency Contact', desc: 'Emergency contact person', icon: Phone },
  { num: 3, title: 'Bank Details', desc: 'Salary account information', icon: CreditCard },
  { num: 4, title: 'Review & Submit', desc: 'Confirm and complete', icon: ClipboardCheck },
];

export default function EmployeeOnboardingPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector(s => s.auth.user);
  const { data: statusRes, isLoading, isError, error, refetch } = useGetMyOnboardingStatusQuery();
  const [saveStep, { isLoading: saving }] = useSaveMyStepMutation();
  const [completeOnboarding, { isLoading: completing }] = useCompleteMyOnboardingMutation();
  const [currentStep, setCurrentStep] = useState(1);

  // Form states
  const [personal, setPersonal] = useState(PERSONAL_INIT);
  const [emergency, setEmergency] = useState(EMERGENCY_INIT);
  const [bank, setBank] = useState(BANK_INIT);
  const [showErrors, setShowErrors] = useState(false);

  const status = statusRes?.data;

  useEffect(() => {
    if (status) {
      // Pre-fill existing data only — navigation is handled by handleComplete
      setPersonal(prev => ({
        ...prev,
        firstName: status.firstName || prev.firstName,
        lastName: status.lastName || prev.lastName,
      }));
    }
  }, [status]);

  const handleSaveStep = async (backendStep: number, data: any) => {
    try {
      await saveStep({ step: backendStep, data }).unwrap();
      toast.success('Saved!');
      setCurrentStep(s => Math.min(s + 1, STEPS.length));
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    }
  };

  const handleComplete = async () => {
    try {
      await completeOnboarding().unwrap();
      // Update Redux user state immediately so ProtectedRoute doesn't bounce back
      if (currentUser) {
        dispatch(setUser({ ...currentUser, onboardingComplete: true }));
      }
      toast.success('Onboarding complete! Welcome aboard!');
      navigate('/kyc-pending', { replace: true });
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to complete onboarding');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-brand-600" />
          <p className="text-sm text-gray-400">Loading your onboarding...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Unable to Load Onboarding</h1>
          <p className="text-sm text-gray-500 mb-4">
            {(error as any)?.data?.error?.message || 'Something went wrong loading your onboarding status. Please try again.'}
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => refetch()} className="btn-primary text-sm flex items-center gap-2">
              Try Again
            </button>
            <button onClick={() => navigate('/login', { replace: true })} className="text-sm text-gray-500 hover:text-gray-700 underline">
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="h-[100dvh] overflow-y-auto bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-3xl mx-auto py-8 px-4 pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+2rem))]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-brand-100 flex items-center justify-center mx-auto mb-3">
            <Building2 size={28} className="text-brand-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-gray-900">
            Welcome, {status?.firstName || 'there'}!
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete your profile to get started at {status?.organization?.name || 'the team'}
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = currentStep === step.num;
            const isDone = currentStep > step.num;
            return (
              <div key={step.num} className="flex items-center">
                <button
                  onClick={() => currentStep > step.num && setCurrentStep(step.num)}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all',
                    isDone ? 'bg-green-500 text-white' :
                    isActive ? 'bg-brand-600 text-white ring-4 ring-brand-200' :
                    'bg-gray-200 text-gray-400'
                  )}
                >
                  {isDone ? <Check size={16} /> : <Icon size={16} />}
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={cn('w-12 h-0.5 mx-1', isDone ? 'bg-green-500' : 'bg-gray-200')} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{STEPS[currentStep - 1]?.title}</h2>
          <p className="text-sm text-gray-500 mb-6">{STEPS[currentStep - 1]?.desc}</p>

          <AnimatePresence mode="wait">
            <motion.div key={currentStep}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}>

              {/* Step 1: Personal Details */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  {showErrors && !canProceedStep1(personal) && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertTriangle size={13} /> Please fill all required fields marked with *
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">First Name <span className="text-red-500">*</span></label>
                      <input value={personal.firstName} onChange={e => setPersonal(p => ({ ...p, firstName: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.firstName.trim() && 'border-red-400 ring-red-200')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Last Name <span className="text-red-500">*</span></label>
                      <input value={personal.lastName} onChange={e => setPersonal(p => ({ ...p, lastName: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.lastName.trim() && 'border-red-400 ring-red-200')} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth <span className="text-red-500">*</span></label>
                      <input type="date" value={personal.dateOfBirth} onChange={e => setPersonal(p => ({ ...p, dateOfBirth: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.dateOfBirth && 'border-red-400 ring-red-200')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Gender <span className="text-red-500">*</span></label>
                      <select value={personal.gender} onChange={e => setPersonal(p => ({ ...p, gender: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.gender && 'border-red-400 ring-red-200')}>
                        <option value="">Select</option>
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                        <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Blood Group <span className="text-xs text-gray-400">(optional)</span></label>
                      <select value={personal.bloodGroup} onChange={e => setPersonal(p => ({ ...p, bloodGroup: e.target.value }))}
                        className="input-glass w-full text-sm">
                        <option value="">Select</option>
                        {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                          <option key={bg} value={bg}>{bg}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Marital Status <span className="text-xs text-gray-400">(optional)</span></label>
                      <select value={personal.maritalStatus} onChange={e => setPersonal(p => ({ ...p, maritalStatus: e.target.value }))}
                        className="input-glass w-full text-sm">
                        <option value="">Select</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Divorced">Divorced</option>
                        <option value="Widowed">Widowed</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
                      <input value={personal.phone} onChange={e => setPersonal(p => ({ ...p, phone: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.phone.trim() && 'border-red-400 ring-red-200')}
                        placeholder="+91 9876543210" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Personal Email <span className="text-xs text-gray-400">(optional)</span></label>
                      <input type="email" value={personal.personalEmail} onChange={e => setPersonal(p => ({ ...p, personalEmail: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="personal@email.com" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1 <span className="text-red-500">*</span></label>
                    <input value={personal.address.line1} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, line1: e.target.value } }))}
                      className={cn('input-glass w-full text-sm', showErrors && !personal.address.line1.trim() && 'border-red-400 ring-red-200')} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">City <span className="text-red-500">*</span></label>
                      <input value={personal.address.city} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, city: e.target.value } }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.address.city.trim() && 'border-red-400 ring-red-200')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
                      <input value={personal.address.state} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, state: e.target.value } }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.address.state.trim() && 'border-red-400 ring-red-200')} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Pincode <span className="text-red-500">*</span></label>
                      <input value={personal.address.pincode} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, pincode: e.target.value } }))}
                        className={cn('input-glass w-full text-sm', showErrors && !personal.address.pincode.trim() && 'border-red-400 ring-red-200')} />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Emergency Contact */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  {showErrors && !canProceedStep2(emergency) && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertTriangle size={13} /> Please fill all required fields marked with *
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name <span className="text-red-500">*</span></label>
                      <input value={emergency.name} onChange={e => setEmergency(p => ({ ...p, name: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !emergency.name.trim() && 'border-red-400 ring-red-200')}
                        placeholder="Full name" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Relationship <span className="text-red-500">*</span></label>
                      <select value={emergency.relationship} onChange={e => setEmergency(p => ({ ...p, relationship: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !emergency.relationship && 'border-red-400 ring-red-200')}>
                        <option value="">Select</option>
                        <option value="SPOUSE">Spouse</option>
                        <option value="PARENT">Parent</option>
                        <option value="SIBLING">Sibling</option>
                        <option value="FRIEND">Friend</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
                      <input value={emergency.phone} onChange={e => setEmergency(p => ({ ...p, phone: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !emergency.phone.trim() && 'border-red-400 ring-red-200')}
                        placeholder="+91 9876543210" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-xs text-gray-400">(optional)</span></label>
                      <input value={emergency.email} onChange={e => setEmergency(p => ({ ...p, email: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="email@example.com" />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Bank Details */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  {showErrors && !canProceedStep3(bank) && (
                    <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertTriangle size={13} /> Please fill all required fields marked with *
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Account Holder Name <span className="text-red-500">*</span></label>
                      <input value={bank.accountHolderName} onChange={e => setBank(b => ({ ...b, accountHolderName: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !bank.accountHolderName.trim() && 'border-red-400 ring-red-200')}
                        placeholder="As per bank records" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Account Number <span className="text-red-500">*</span></label>
                      <input value={bank.bankAccountNumber} onChange={e => setBank(b => ({ ...b, bankAccountNumber: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !bank.bankAccountNumber.trim() && 'border-red-400 ring-red-200')}
                        placeholder="Bank account number" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name <span className="text-red-500">*</span></label>
                      <input value={bank.bankName} onChange={e => setBank(b => ({ ...b, bankName: e.target.value }))}
                        className={cn('input-glass w-full text-sm', showErrors && !bank.bankName.trim() && 'border-red-400 ring-red-200')}
                        placeholder="e.g. State Bank of India" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">IFSC Code <span className="text-red-500">*</span></label>
                      <input value={bank.ifscCode} onChange={e => setBank(b => ({ ...b, ifscCode: e.target.value.toUpperCase() }))}
                        className={cn('input-glass w-full text-sm font-mono', showErrors && !bank.ifscCode.trim() && 'border-red-400 ring-red-200')}
                        placeholder="SBIN0001234" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                    <select value={bank.accountType} onChange={e => setBank(b => ({ ...b, accountType: e.target.value as 'SAVINGS' | 'CURRENT' }))}
                      className="input-glass w-full text-sm">
                      <option value="SAVINGS">Savings</option>
                      <option value="CURRENT">Current</option>
                    </select>
                  </div>
                  <p className="text-xs text-gray-400">
                    Your bank details are encrypted and used only for payroll processing.
                  </p>
                </div>
              )}

              {/* Step 4: Review & Submit */}
              {currentStep === 4 && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-green-800 mb-1">Ready to submit!</h3>
                    <p className="text-xs text-green-600">
                      Review your information below. After submitting, you'll be redirected to document verification.
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Personal Details</p>
                    <ReviewRow label="Name" value={`${personal.firstName} ${personal.lastName}`} />
                    <ReviewRow label="Date of Birth" value={personal.dateOfBirth} />
                    <ReviewRow label="Gender" value={personal.gender} />
                    <ReviewRow label="Blood Group" value={personal.bloodGroup || '—'} />
                    <ReviewRow label="Marital Status" value={personal.maritalStatus || '—'} />
                    <ReviewRow label="Phone" value={personal.phone} />
                    {personal.personalEmail && <ReviewRow label="Personal Email" value={personal.personalEmail} />}
                    <ReviewRow label="Address" value={[personal.address.line1, personal.address.city, personal.address.state, personal.address.pincode].filter(Boolean).join(', ')} />
                    <div className="border-t border-gray-200 my-2" />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Emergency Contact</p>
                    {emergency.name ? (
                      <>
                        <ReviewRow label="Contact Name" value={emergency.name} />
                        <ReviewRow label="Relationship" value={emergency.relationship} />
                        <ReviewRow label="Phone" value={emergency.phone} />
                        {emergency.email && <ReviewRow label="Email" value={emergency.email} />}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">Not provided</p>
                    )}
                    <div className="border-t border-gray-200 my-2" />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bank Details</p>
                    {bank.bankAccountNumber ? (
                      <>
                        <ReviewRow label="Account Holder" value={bank.accountHolderName} />
                        <ReviewRow label="Bank" value={bank.bankName} />
                        <ReviewRow label="Account No." value={`****${bank.bankAccountNumber.slice(-4)}`} />
                        <ReviewRow label="IFSC" value={bank.ifscCode} />
                        <ReviewRow label="Account Type" value={bank.accountType} />
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">Not provided</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 text-center">
                    Click "Complete Onboarding" to save and proceed to document upload.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={() => setCurrentStep(s => Math.max(s - 1, 1))}
              disabled={currentStep === 1}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30">
              <ChevronLeft size={16} /> Back
            </button>

            {currentStep < STEPS.length ? (
              <button
                onClick={() => {
                  setShowErrors(true);
                  if (currentStep === 1) {
                    if (!canProceedStep1(personal)) { toast.error('Please fill all required fields'); return; }
                    handleSaveStep(2, personal);
                  } else if (currentStep === 2) {
                    if (!canProceedStep2(emergency)) { toast.error('Please fill all required fields'); return; }
                    handleSaveStep(6, emergency);
                  } else if (currentStep === 3) {
                    if (!canProceedStep3(bank)) { toast.error('Please fill all required bank fields'); return; }
                    handleSaveStep(5, bank);
                  } else {
                    setCurrentStep(s => s + 1);
                  }
                }}
                disabled={saving}
                className="btn-primary flex items-center gap-1 text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Save & Continue
                <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={handleComplete} disabled={completing}
                className="btn-primary flex items-center gap-2 text-sm bg-green-600 hover:bg-green-700">
                {completing ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
                Complete Onboarding
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="text-gray-800 font-medium text-xs text-right max-w-[60%]">{value || '—'}</span>
    </div>
  );
}
