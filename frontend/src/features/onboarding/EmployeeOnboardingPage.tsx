import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ChevronRight, ChevronLeft, Loader2, PartyPopper,
  User, FileText, Camera, Building2, Phone, ClipboardCheck
} from 'lucide-react';
import { useGetMyOnboardingStatusQuery, useSaveMyStepMutation, useCompleteMyOnboardingMutation } from './onboardingApi';
import { useAppDispatch } from '../../app/store';
import { logout } from '../auth/authSlice';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const STEPS = [
  { num: 1, title: 'Personal Details', desc: 'Basic personal information', icon: User },
  { num: 2, title: 'Documents', desc: 'Upload required documents', icon: FileText },
  { num: 3, title: 'Photo', desc: 'Profile photo', icon: Camera },
  { num: 4, title: 'Bank Details', desc: 'Salary account information', icon: Building2 },
  { num: 5, title: 'Emergency Contact', desc: 'Emergency contact person', icon: Phone },
  { num: 6, title: 'Review & Submit', desc: 'Confirm and complete', icon: ClipboardCheck },
];

export default function EmployeeOnboardingPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data: statusRes, isLoading, refetch } = useGetMyOnboardingStatusQuery();
  const [saveStep, { isLoading: saving }] = useSaveMyStepMutation();
  const [completeOnboarding, { isLoading: completing }] = useCompleteMyOnboardingMutation();
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);

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
      if (status.onboardingComplete) {
        navigate('/dashboard', { replace: true });
      }
      // Pre-fill existing data
      setPersonal(prev => ({
        ...prev,
        firstName: status.firstName || prev.firstName,
        lastName: status.lastName || prev.lastName,
      }));
    }
  }, [status, navigate]);

  const handleSaveStep = async (step: number, data: any) => {
    try {
      await saveStep({ step: step + 1, data }).unwrap(); // Backend steps are 2-indexed (1 was password)
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
      setCompleted(true);
      toast.success('Onboarding complete! Welcome aboard!');
      setTimeout(() => {
        // Force re-login to refresh user state
        dispatch(logout());
        navigate('/login', { replace: true });
      }, 3000);
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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="text-center p-8">
          <PartyPopper size={64} className="mx-auto text-brand-600 mb-4" />
          <h1 className="text-2xl font-display font-bold text-gray-900 mb-2">Welcome Aboard!</h1>
          <p className="text-gray-500">Your onboarding is complete. Redirecting to login...</p>
          <Loader2 size={20} className="animate-spin text-brand-600 mx-auto mt-4" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-8 px-4">
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
                  <div className={cn('w-8 h-0.5 mx-1', isDone ? 'bg-green-500' : 'bg-gray-200')} />
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

              {/* Step 2: Documents */}
              {currentStep === 2 && (
                <div className="text-center py-8">
                  <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-2">Upload your documents (Aadhaar, PAN, certificates)</p>
                  <p className="text-xs text-gray-400">You can upload documents from your Profile page after onboarding. Click Next to continue.</p>
                </div>
              )}

              {/* Step 3: Photo */}
              {currentStep === 3 && (
                <div className="text-center py-8">
                  <Camera size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-2">Upload a profile photo</p>
                  <p className="text-xs text-gray-400">You can set your photo from Profile page. Click Next to continue.</p>
                </div>
              )}

              {/* Step 4: Bank Details */}
              {currentStep === 4 && (
                <div className="text-center py-8">
                  <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 mb-2">Bank details for salary disbursement</p>
                  <p className="text-xs text-gray-400">HR will set up your salary structure. Click Next to continue.</p>
                </div>
              )}

              {/* Step 5: Emergency Contact */}
              {currentStep === 5 && (
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

              {/* Step 6: Review & Submit */}
              {currentStep === 6 && (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-green-800 mb-2">Ready to submit!</h3>
                    <p className="text-xs text-green-600">
                      Review your information above. After submitting, you'll be redirected to the dashboard.
                      You can always update your profile later from the Settings page.
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-sm">
                    <p><strong>Name:</strong> {personal.firstName} {personal.lastName}</p>
                    {personal.dateOfBirth && <p><strong>DOB:</strong> {personal.dateOfBirth}</p>}
                    {personal.gender && <p><strong>Gender:</strong> {personal.gender}</p>}
                    {personal.phone && <p><strong>Phone:</strong> {personal.phone}</p>}
                    {emergency.name && <p><strong>Emergency:</strong> {emergency.name} ({emergency.relationship})</p>}
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
                  if (currentStep === 1) handleSaveStep(1, personal);
                  else if (currentStep === 5) handleSaveStep(5, emergency);
                  else setCurrentStep(s => s + 1);
                }}
                disabled={saving}
                className="btn-primary flex items-center gap-1 text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {currentStep === 1 || currentStep === 5 ? 'Save & Continue' : 'Next'}
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
