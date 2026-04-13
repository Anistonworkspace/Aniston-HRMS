import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, ChevronLeft, Loader2, AlertTriangle,
  User, Phone, ClipboardCheck, Building2
} from 'lucide-react';
import { useGetMyOnboardingStatusQuery, useSaveMyStepMutation, useCompleteMyOnboardingMutation } from './onboardingApi';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { setUser } from '../auth/authSlice';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// Only 3 steps — removed placeholder steps (Documents, Photo, Bank Details)
const STEPS = [
  { num: 1, title: 'Personal Details', desc: 'Basic personal information', icon: User },
  { num: 2, title: 'Emergency Contact', desc: 'Emergency contact person', icon: Phone },
  { num: 3, title: 'Review & Submit', desc: 'Confirm and complete', icon: ClipboardCheck },
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
  const [personal, setPersonal] = useState({
    firstName: '', lastName: '', dateOfBirth: '', gender: '', bloodGroup: '',
    maritalStatus: '', phone: '', personalEmail: '',
    address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
  });
  const [emergency, setEmergency] = useState({ name: '', relationship: '', phone: '', email: '' });

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
    <div className="min-h-screen overflow-y-auto bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
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
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{STEPS[currentStep - 1]?.title}</h2>
          <p className="text-sm text-gray-500 mb-6">{STEPS[currentStep - 1]?.desc}</p>

          <AnimatePresence mode="wait">
            <motion.div key={currentStep}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}>

              {/* Step 1: Personal Details */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                      <input value={personal.firstName} onChange={e => setPersonal(p => ({ ...p, firstName: e.target.value }))}
                        className="input-glass w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                      <input value={personal.lastName} onChange={e => setPersonal(p => ({ ...p, lastName: e.target.value }))}
                        className="input-glass w-full text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                      <input type="date" value={personal.dateOfBirth} onChange={e => setPersonal(p => ({ ...p, dateOfBirth: e.target.value }))}
                        className="input-glass w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                      <select value={personal.gender} onChange={e => setPersonal(p => ({ ...p, gender: e.target.value }))}
                        className="input-glass w-full text-sm">
                        <option value="">Select</option>
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Blood Group</label>
                      <select value={personal.bloodGroup} onChange={e => setPersonal(p => ({ ...p, bloodGroup: e.target.value }))}
                        className="input-glass w-full text-sm">
                        <option value="">Select</option>
                        {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                          <option key={bg} value={bg}>{bg}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input value={personal.phone} onChange={e => setPersonal(p => ({ ...p, phone: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="+91 9876543210" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
                    <input value={personal.address.line1} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, line1: e.target.value } }))}
                      className="input-glass w-full text-sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                      <input value={personal.address.city} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, city: e.target.value } }))}
                        className="input-glass w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                      <input value={personal.address.state} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, state: e.target.value } }))}
                        className="input-glass w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
                      <input value={personal.address.pincode} onChange={e => setPersonal(p => ({ ...p, address: { ...p.address, pincode: e.target.value } }))}
                        className="input-glass w-full text-sm" />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Emergency Contact */}
              {currentStep === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                      <input value={emergency.name} onChange={e => setEmergency(p => ({ ...p, name: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="Full name" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                      <select value={emergency.relationship} onChange={e => setEmergency(p => ({ ...p, relationship: e.target.value }))}
                        className="input-glass w-full text-sm">
                        <option value="">Select</option>
                        <option value="SPOUSE">Spouse</option>
                        <option value="PARENT">Parent</option>
                        <option value="SIBLING">Sibling</option>
                        <option value="FRIEND">Friend</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input value={emergency.phone} onChange={e => setEmergency(p => ({ ...p, phone: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="+91 9876543210" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
                      <input value={emergency.email} onChange={e => setEmergency(p => ({ ...p, email: e.target.value }))}
                        className="input-glass w-full text-sm" placeholder="email@example.com" />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Review & Submit */}
              {currentStep === 3 && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-green-800 mb-2">Ready to submit!</h3>
                    <p className="text-xs text-green-600">
                      Review your information below. After submitting, you'll be redirected to login.
                      You can upload documents and update your profile later.
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1.5">
                    <p><strong>Name:</strong> {personal.firstName} {personal.lastName}</p>
                    {personal.dateOfBirth && <p><strong>DOB:</strong> {personal.dateOfBirth}</p>}
                    {personal.gender && <p><strong>Gender:</strong> {personal.gender}</p>}
                    {personal.phone && <p><strong>Phone:</strong> {personal.phone}</p>}
                    {personal.address.city && <p><strong>Address:</strong> {[personal.address.line1, personal.address.city, personal.address.state, personal.address.pincode].filter(Boolean).join(', ')}</p>}
                    {emergency.name && <p><strong>Emergency Contact:</strong> {emergency.name} ({emergency.relationship}) — {emergency.phone}</p>}
                  </div>
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
                  // Step 1 (Personal) → backend step 2, Step 2 (Emergency) → backend step 6
                  if (currentStep === 1) handleSaveStep(2, personal);
                  else if (currentStep === 2) handleSaveStep(6, emergency);
                  else setCurrentStep(s => s + 1);
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
