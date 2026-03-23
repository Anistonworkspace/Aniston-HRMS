import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Check, Upload, Camera, X, User, Briefcase,
  FileText, Loader2, AlertTriangle, CheckCircle2, Plus,
} from 'lucide-react';
import { useGetWalkInJobsQuery, useRegisterWalkInMutation } from './walkInApi';
import { uploadFile, validateFile, formatFileSize } from '../../lib/fileUpload';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';

const STEPS = [
  { label: 'Position & Contact', icon: User },
  { label: 'KYC Documents', icon: FileText },
  { label: 'Professional Details', icon: Briefcase },
  { label: 'Resume Upload', icon: Upload },
  { label: 'Confirm & Submit', icon: Check },
];

const QUALIFICATIONS = [
  '10th / SSLC', '12th / HSC', 'Diploma', 'Graduate / Bachelor\'s',
  'Post-Graduate / Master\'s', 'PhD / Doctorate',
];

const NOTICE_PERIODS = ['Immediate', '15 Days', '30 Days', '60 Days', '90 Days'];

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const IDLE_WARNING = 30 * 1000; // 30 seconds before reset

interface FormData {
  jobOpeningId: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  aadhaarFrontUrl: string;
  aadhaarBackUrl: string;
  panCardUrl: string;
  selfieUrl: string;
  aadhaarNumber: string;
  panNumber: string;
  ocrVerifiedName: string;
  ocrVerifiedDob: string;
  ocrVerifiedAddress: string;
  tamperDetected: boolean;
  qualification: string;
  fieldOfStudy: string;
  experienceYears: number;
  experienceMonths: number;
  isFresher: boolean;
  currentCompany: string;
  currentCtc: string;
  expectedCtc: string;
  noticePeriod: string;
  skills: string[];
  aboutMe: string;
  resumeUrl: string;
  consent: boolean;
}

const initialFormData: FormData = {
  jobOpeningId: '', fullName: '', email: '', phone: '', city: '',
  aadhaarFrontUrl: '', aadhaarBackUrl: '', panCardUrl: '', selfieUrl: '',
  aadhaarNumber: '', panNumber: '',
  ocrVerifiedName: '', ocrVerifiedDob: '', ocrVerifiedAddress: '', tamperDetected: false,
  qualification: '', fieldOfStudy: '', experienceYears: 0, experienceMonths: 0,
  isFresher: true, currentCompany: '', currentCtc: '', expectedCtc: '',
  noticePeriod: '', skills: [], aboutMe: '', resumeUrl: '', consent: false,
};

export default function WalkInKioskPage() {
  const [searchParams] = useSearchParams();
  const initialJobId = searchParams.get('jobId') || '';

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>({ ...initialFormData, jobOpeningId: initialJobId });
  const [skillInput, setSkillInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [tokenNumber, setTokenNumber] = useState('');
  const [idleWarning, setIdleWarning] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const idleTimerRef = useRef<number | null>(null);
  const warningTimerRef = useRef<number | null>(null);

  // Generate a unique temp ID per session for file uploads (before we have a token)
  const tempId = useMemo(() => `walkin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);

  const { data: jobsData } = useGetWalkInJobsQuery();
  const [registerWalkIn, { isLoading: isSubmitting }] = useRegisterWalkInMutation();

  const jobs = jobsData?.data || [];

  // --- Idle auto-reset ---
  const resetIdleTimer = useCallback(() => {
    if (submitted) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    setIdleWarning(false);

    idleTimerRef.current = window.setTimeout(() => {
      setIdleWarning(true);
      setCountdown(30);
      warningTimerRef.current = window.setTimeout(() => {
        setForm(initialFormData);
        setStep(0);
        setSubmitted(false);
        setIdleWarning(false);
      }, IDLE_WARNING);
    }, IDLE_TIMEOUT - IDLE_WARNING);
  }, [submitted]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetIdleTimer));
    resetIdleTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, [resetIdleTimer]);

  // Countdown timer for idle warning
  useEffect(() => {
    if (!idleWarning) return;
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [idleWarning]);

  // Auto-reset after submission (5 min)
  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => {
      setForm(initialFormData);
      setStep(0);
      setSubmitted(false);
      setTokenNumber('');
    }, IDLE_TIMEOUT);
    return () => clearTimeout(timer);
  }, [submitted]);

  const updateForm = (field: keyof FormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !form.skills.includes(trimmed)) {
      updateForm('skills', [...form.skills, trimmed]);
      setSkillInput('');
    }
  };

  const removeSkill = (skill: string) => {
    updateForm('skills', form.skills.filter(s => s !== skill));
  };

  const canProceed = () => {
    switch (step) {
      case 0: {
        if (!form.fullName || !form.email || !form.phone) return false;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(form.email)) {
          return false;
        }
        if (!/^\d{10}$/.test(form.phone)) {
          return false;
        }
        return true;
      }
      case 1: return !!(form.aadhaarFrontUrl && form.aadhaarBackUrl && form.panCardUrl && form.selfieUrl); // All KYC mandatory
      case 2: return !!(form.qualification); // At least qualification required
      case 3: return !!(form.resumeUrl); // Resume mandatory
      case 4: return form.consent;
      default: return true;
    }
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        ...form,
        jobOpeningId: form.jobOpeningId || undefined,
        currentCtc: form.currentCtc ? parseFloat(form.currentCtc) : undefined,
        expectedCtc: form.expectedCtc ? parseFloat(form.expectedCtc) : undefined,
        ocrVerifiedDob: form.ocrVerifiedDob || undefined,
      };
      // Remove empty strings
      Object.keys(payload).forEach(key => {
        if ((payload as any)[key] === '') delete (payload as any)[key];
      });
      delete (payload as any).consent;

      const result = await registerWalkIn(payload).unwrap();
      if (result.success) {
        setTokenNumber(result.data.tokenNumber);
        setSubmitted(true);
        toast.success('Registration complete!');
      }
    } catch (err: any) {
      const message = err?.data?.error?.message || 'Registration failed. Please try again.';
      toast.error(message);
    }
  };

  // --- Success Screen ---
  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-16"
      >
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-3xl font-display font-bold text-gray-900 mb-2">Registration Complete!</h2>
        <p className="text-gray-500 mb-8">Please show this to the receptionist</p>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-8 max-w-md mx-auto mb-8">
          <p className="text-sm text-gray-400 mb-2">Your Token Number</p>
          <p className="text-4xl font-display font-bold text-brand-600 tracking-wider" data-mono>
            {tokenNumber}
          </p>
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col items-center gap-3">
            <QRCodeSVG value={tokenNumber} size={120} level="M" />
            <p className="text-sm text-gray-500">{form.fullName}</p>
            <p className="text-sm text-gray-400">{form.email}</p>
          </div>
        </div>

        <p className="text-sm text-gray-400">This screen will auto-reset in 5 minutes</p>
      </motion.div>
    );
  }

  return (
    <div className="pb-16">
      {/* Idle Warning Modal */}
      <AnimatePresence>
        {idleWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-white rounded-2xl p-8 max-w-sm text-center"
            >
              <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
              <h3 className="text-xl font-display font-bold text-gray-900 mb-2">Still there?</h3>
              <p className="text-gray-500 mb-4">
                This form will reset in <span className="font-bold text-amber-600">{countdown}s</span>
              </p>
              <button
                onClick={() => { setIdleWarning(false); resetIdleTimer(); }}
                className="btn-primary w-full text-lg py-3"
              >
                Yes, I'm still here
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step Progress */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all
                ${i < step ? 'bg-emerald-500 text-white' :
                  i === step ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                  'bg-gray-100 text-gray-400'}`}
            >
              {i < step ? <Check className="w-5 h-5" /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-0.5 mx-1 ${i < step ? 'bg-emerald-400' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>
      <p className="text-center text-sm text-gray-500 mb-6">
        Step {step + 1} of {STEPS.length} — {STEPS[step].label}
      </p>

      {/* Form Steps */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.25 }}
          className="bg-white rounded-2xl border border-gray-100 shadow-lg p-6 sm:p-8"
        >
          {step === 0 && <Step1 form={form} updateForm={updateForm} jobs={jobs} />}
          {step === 1 && <Step2 form={form} updateForm={updateForm} tempId={tempId} />}
          {step === 2 && <Step3 form={form} updateForm={updateForm} skillInput={skillInput} setSkillInput={setSkillInput} addSkill={addSkill} removeSkill={removeSkill} />}
          {step === 3 && <Step4 form={form} updateForm={updateForm} tempId={tempId} />}
          {step === 4 && <Step5 form={form} updateForm={updateForm} jobs={jobs} />}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all
            ${step === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <ChevronLeft className="w-5 h-5" /> Back
        </button>

        {step < 4 ? (
          <button
            onClick={() => setStep(s => Math.min(4, s + 1))}
            disabled={!canProceed()}
            className={`flex items-center gap-2 px-8 py-3 rounded-xl font-medium transition-all
              ${canProceed()
                ? 'bg-brand-600 text-white hover:bg-brand-700 shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            Next <ChevronRight className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canProceed() || isSubmitting}
            className={`flex items-center gap-2 px-8 py-3 rounded-xl font-medium transition-all
              ${canProceed() && !isSubmitting
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            Submit Registration
          </button>
        )}
      </div>
    </div>
  );
}

// =========================================
// STEP 1: Position & Contact Info
// =========================================
function Step1({ form, updateForm, jobs }: { form: FormData; updateForm: any; jobs: any[] }) {
  return (
    <div className="space-y-5">
      <h3 className="text-xl font-display font-bold text-gray-900 mb-1">Position & Contact Information</h3>
      <p className="text-sm text-gray-400 mb-4">Tell us which position you're here for and how to reach you.</p>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">I am here for *</label>
        <select
          value={form.jobOpeningId}
          onChange={e => updateForm('jobOpeningId', e.target.value)}
          className="input-glass w-full"
        >
          <option value="">Select a position...</option>
          {jobs.map((job: any) => (
            <option key={job.id} value={job.id}>
              {job.title} — {job.department} ({job.location})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
          <input
            type="text"
            value={form.fullName}
            onChange={e => updateForm('fullName', e.target.value)}
            placeholder="Enter your full name"
            className="input-glass w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Mobile Number *</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-200 bg-gray-50 text-gray-500 text-sm">
              +91
            </span>
            <input
              type="tel"
              value={form.phone}
              onChange={e => updateForm('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="9876543210"
              className="input-glass w-full rounded-l-none"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address *</label>
          <input
            type="email"
            value={form.email}
            onChange={e => updateForm('email', e.target.value)}
            placeholder="you@example.com"
            className="input-glass w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">City / Location</label>
          <input
            type="text"
            value={form.city}
            onChange={e => updateForm('city', e.target.value)}
            placeholder="e.g. Mumbai"
            className="input-glass w-full"
          />
        </div>
      </div>
    </div>
  );
}

// =========================================
// STEP 2: KYC Documents
// =========================================
function Step2({ form, updateForm, tempId }: { form: FormData; updateForm: any; tempId: string }) {
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleRealUpload = async (field: keyof FormData, file: File) => {
    const validationError = validateFile(file, {
      maxSizeMB: 5,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'],
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setUploading(prev => ({ ...prev, [field]: true }));
    setProgress(prev => ({ ...prev, [field]: 0 }));

    try {
      const result = await uploadFile(
        file,
        '/walk-in/upload',
        { folder: tempId },
        (p) => setProgress(prev => ({ ...prev, [field]: p.percentage })),
      );
      if (result.success && result.data?.url) {
        updateForm(field, result.data.url);
        toast.success('Document uploaded successfully');
      } else {
        toast.error(result.error || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed. Please try again.');
    } finally {
      setUploading(prev => ({ ...prev, [field]: false }));
      setProgress(prev => ({ ...prev, [field]: 0 }));
    }
  };

  const triggerFileInput = (field: string) => {
    fileInputRefs.current[field]?.click();
  };

  const onFileSelected = (field: keyof FormData, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleRealUpload(field, file);
    // Reset the input so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      <h3 className="text-xl font-display font-bold text-gray-900 mb-1">KYC Document Upload</h3>
      <p className="text-sm text-gray-400 mb-4">Upload your identity documents for verification. This step is optional.</p>

      {/* Hidden file inputs */}
      {(['aadhaarFrontUrl', 'aadhaarBackUrl', 'panCardUrl', 'selfieUrl'] as const).map(field => (
        <input
          key={field}
          type="file"
          accept="image/*"
          capture={field === 'selfieUrl' ? 'user' : undefined}
          className="hidden"
          ref={el => { fileInputRefs.current[field] = el; }}
          onChange={e => onFileSelected(field, e)}
        />
      ))}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FileUploadBox
          label="Aadhaar Card (Front)"
          uploaded={!!form.aadhaarFrontUrl}
          uploading={!!uploading.aadhaarFrontUrl}
          progress={progress.aadhaarFrontUrl || 0}
          onUpload={() => triggerFileInput('aadhaarFrontUrl')}
          onRemove={() => updateForm('aadhaarFrontUrl', '')}
        />
        <FileUploadBox
          label="Aadhaar Card (Back)"
          uploaded={!!form.aadhaarBackUrl}
          uploading={!!uploading.aadhaarBackUrl}
          progress={progress.aadhaarBackUrl || 0}
          onUpload={() => triggerFileInput('aadhaarBackUrl')}
          onRemove={() => updateForm('aadhaarBackUrl', '')}
        />
      </div>

      <FileUploadBox
        label="PAN Card"
        uploaded={!!form.panCardUrl}
        uploading={!!uploading.panCardUrl}
        progress={progress.panCardUrl || 0}
        onUpload={() => triggerFileInput('panCardUrl')}
        onRemove={() => updateForm('panCardUrl', '')}
      />

      {/* Selfie Capture */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Take a Selfie</label>
        <div
          onClick={() => !uploading.selfieUrl && triggerFileInput('selfieUrl')}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
            ${form.selfieUrl ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'}`}
        >
          {uploading.selfieUrl ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
              <p className="text-sm text-gray-500">Uploading... {progress.selfieUrl || 0}%</p>
              <div className="w-40 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress.selfieUrl || 0}%` }} />
              </div>
            </div>
          ) : form.selfieUrl ? (
            <div className="flex items-center justify-center gap-2 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Selfie captured</span>
              <button onClick={e => { e.stopPropagation(); updateForm('selfieUrl', ''); }} className="ml-2 text-gray-400 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <Camera className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Tap to open camera and take a selfie</p>
            </>
          )}
        </div>
      </div>

      {/* OCR Verified Fields */}
      {(form.aadhaarFrontUrl || form.panCardUrl) && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm font-medium text-blue-700 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Auto-extracted from documents (verify below)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-blue-600 mb-1">Name (from Aadhaar)</label>
              <input
                value={form.ocrVerifiedName}
                onChange={e => updateForm('ocrVerifiedName', e.target.value)}
                className="input-glass w-full text-sm"
                placeholder="Auto-extracted name"
              />
            </div>
            <div>
              <label className="block text-xs text-blue-600 mb-1">Date of Birth</label>
              <input
                type="date"
                value={form.ocrVerifiedDob}
                onChange={e => updateForm('ocrVerifiedDob', e.target.value)}
                className="input-glass w-full text-sm"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs text-blue-600 mb-1">Address</label>
            <input
              value={form.ocrVerifiedAddress}
              onChange={e => updateForm('ocrVerifiedAddress', e.target.value)}
              className="input-glass w-full text-sm"
              placeholder="Auto-extracted address"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================
// STEP 3: Professional Details
// =========================================
function Step3({ form, updateForm, skillInput, setSkillInput, addSkill, removeSkill }: any) {
  return (
    <div className="space-y-5">
      <h3 className="text-xl font-display font-bold text-gray-900 mb-1">Professional Details</h3>
      <p className="text-sm text-gray-400 mb-4">Tell us about your qualifications and experience.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Highest Qualification</label>
          <select value={form.qualification} onChange={e => updateForm('qualification', e.target.value)} className="input-glass w-full">
            <option value="">Select...</option>
            {QUALIFICATIONS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Field of Study</label>
          <input
            value={form.fieldOfStudy}
            onChange={e => updateForm('fieldOfStudy', e.target.value)}
            className="input-glass w-full"
            placeholder="e.g. Computer Science"
          />
        </div>
      </div>

      {/* Experience */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <label className="text-sm font-medium text-gray-700">Experience</label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.isFresher}
              onChange={e => {
                updateForm('isFresher', e.target.checked);
                if (e.target.checked) { updateForm('experienceYears', 0); updateForm('experienceMonths', 0); updateForm('currentCompany', ''); }
              }}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            I'm a Fresher
          </label>
        </div>
        {!form.isFresher && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Years</label>
              <input type="number" min={0} max={40} value={form.experienceYears}
                onChange={e => updateForm('experienceYears', parseInt(e.target.value) || 0)}
                className="input-glass w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Months</label>
              <input type="number" min={0} max={11} value={form.experienceMonths}
                onChange={e => updateForm('experienceMonths', parseInt(e.target.value) || 0)}
                className="input-glass w-full" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Current/Last Company</label>
              <input value={form.currentCompany} onChange={e => updateForm('currentCompany', e.target.value)}
                className="input-glass w-full" placeholder="Company name" />
            </div>
          </div>
        )}
      </div>

      {/* CTC */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {!form.isFresher && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Current CTC (LPA)</label>
            <input type="number" step="0.1" value={form.currentCtc}
              onChange={e => updateForm('currentCtc', e.target.value)}
              className="input-glass w-full" placeholder="e.g. 8.5" />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Expected CTC (LPA)</label>
          <input type="number" step="0.1" value={form.expectedCtc}
            onChange={e => updateForm('expectedCtc', e.target.value)}
            className="input-glass w-full" placeholder="e.g. 12" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Notice Period</label>
          <select value={form.noticePeriod} onChange={e => updateForm('noticePeriod', e.target.value)} className="input-glass w-full">
            <option value="">Select...</option>
            {NOTICE_PERIODS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Skills */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Key Skills</label>
        <div className="flex gap-2">
          <input
            value={skillInput}
            onChange={e => setSkillInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
            className="input-glass flex-1"
            placeholder="Type a skill and press Enter"
          />
          <button onClick={addSkill} className="btn-secondary px-3">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {form.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {form.skills.map((skill: string) => (
              <span key={skill} className="badge badge-info flex items-center gap-1">
                {skill}
                <button onClick={() => removeSkill(skill)} className="hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* About Me */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Brief About Me <span className="text-gray-400 font-normal">({form.aboutMe.length}/300)</span>
        </label>
        <textarea
          value={form.aboutMe}
          onChange={e => { if (e.target.value.length <= 300) updateForm('aboutMe', e.target.value); }}
          className="input-glass w-full h-24 resize-none"
          placeholder="A brief summary about yourself..."
        />
      </div>
    </div>
  );
}

// =========================================
// STEP 4: Resume Upload
// =========================================
function Step4({ form, updateForm, tempId }: { form: FormData; updateForm: any; tempId: string }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleResumeUpload = async (file: File) => {
    const validationError = validateFile(file, {
      maxSizeMB: 5,
      allowedTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setFileName(file.name);

    try {
      const result = await uploadFile(
        file,
        '/walk-in/upload',
        { folder: tempId },
        (p) => setUploadProgress(p.percentage),
      );
      if (result.success && result.data?.url) {
        updateForm('resumeUrl', result.data.url);
        toast.success('Resume uploaded successfully');
      } else {
        toast.error(result.error || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleResumeUpload(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      <h3 className="text-xl font-display font-bold text-gray-900 mb-1">Upload Resume</h3>
      <p className="text-sm text-gray-400 mb-4">Upload your resume so our team can review your profile.</p>

      <input
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        ref={fileInputRef}
        onChange={onFileSelected}
      />

      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all
          ${form.resumeUrl ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'}`}
      >
        {uploading ? (
          <div>
            <Loader2 className="w-12 h-12 text-brand-500 mx-auto mb-3 animate-spin" />
            <p className="text-lg font-medium text-gray-600">Uploading {fileName}...</p>
            <p className="text-sm text-gray-400 mt-1">{uploadProgress}%</p>
            <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto mt-3">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : form.resumeUrl ? (
          <div>
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-lg font-medium text-emerald-700">Resume uploaded</p>
            {fileName && <p className="text-sm text-gray-500 mt-1">{fileName}</p>}
            <p className="text-sm text-gray-400 mt-1">Click to replace</p>
            <button
              onClick={e => { e.stopPropagation(); updateForm('resumeUrl', ''); setFileName(''); }}
              className="mt-3 text-sm text-red-500 hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <Upload className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-lg font-medium text-gray-600">Tap to upload your resume</p>
            <p className="text-sm text-gray-400 mt-1">PDF or DOC, max 5MB</p>
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================
// STEP 5: Confirm & Submit
// =========================================
function Step5({ form, updateForm, jobs }: { form: FormData; updateForm: any; jobs: any[] }) {
  const selectedJob = jobs.find((j: any) => j.id === form.jobOpeningId);

  return (
    <div className="space-y-5">
      <h3 className="text-xl font-display font-bold text-gray-900 mb-1">Confirm & Submit</h3>
      <p className="text-sm text-gray-400 mb-4">Review your information before submitting.</p>

      <div className="bg-gray-50 rounded-xl p-5 space-y-4">
        <SummaryRow label="Position" value={selectedJob ? `${selectedJob.title} — ${selectedJob.department}` : 'Not selected'} />
        <SummaryRow label="Name" value={form.fullName} />
        <SummaryRow label="Email" value={form.email} />
        <SummaryRow label="Phone" value={`+91 ${form.phone}`} />
        {form.city && <SummaryRow label="City" value={form.city} />}
        {form.qualification && <SummaryRow label="Qualification" value={`${form.qualification}${form.fieldOfStudy ? ` — ${form.fieldOfStudy}` : ''}`} />}
        <SummaryRow label="Experience" value={form.isFresher ? 'Fresher' : `${form.experienceYears}y ${form.experienceMonths}m${form.currentCompany ? ` at ${form.currentCompany}` : ''}`} />
        {form.expectedCtc && <SummaryRow label="Expected CTC" value={`₹${form.expectedCtc} LPA`} />}
        {form.noticePeriod && <SummaryRow label="Notice Period" value={form.noticePeriod} />}
        {form.skills.length > 0 && (
          <div>
            <span className="text-xs text-gray-400">Skills</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {form.skills.map(s => <span key={s} className="badge badge-info">{s}</span>)}
            </div>
          </div>
        )}
      </div>

      {/* Document Verification Status */}
      <div className="flex items-center gap-2 text-sm">
        {form.aadhaarFrontUrl || form.panCardUrl ? (
          <><CheckCircle2 className="w-4 h-4 text-emerald-500" /><span className="text-emerald-700">Documents uploaded</span></>
        ) : (
          <><AlertTriangle className="w-4 h-4 text-amber-500" /><span className="text-amber-700">No documents uploaded (optional)</span></>
        )}
      </div>
      <div className="flex items-center gap-2 text-sm">
        {form.resumeUrl ? (
          <><CheckCircle2 className="w-4 h-4 text-emerald-500" /><span className="text-emerald-700">Resume uploaded</span></>
        ) : (
          <><AlertTriangle className="w-4 h-4 text-amber-500" /><span className="text-amber-700">No resume uploaded (optional)</span></>
        )}
      </div>

      {/* Consent */}
      <label className="flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-200 cursor-pointer">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={e => updateForm('consent', e.target.checked)}
          className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm text-gray-600 leading-relaxed">
          I confirm that all information provided is accurate and I consent to Aniston Technologies storing my data for recruitment purposes.
        </span>
      </label>
    </div>
  );
}

// =========================================
// Helper Components
// =========================================
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function FileUploadBox({ label, uploaded, uploading, progress, onUpload, onRemove }: {
  label: string; uploaded: boolean; uploading?: boolean; progress?: number; onUpload: () => void; onRemove: () => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div
        onClick={() => !uploading && onUpload()}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all
          ${uploaded ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-brand-300'}`}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-1.5">
            <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
            <p className="text-xs text-gray-500">{progress || 0}%</p>
            <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress || 0}%` }} />
            </div>
          </div>
        ) : uploaded ? (
          <div className="flex items-center justify-center gap-2 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">Uploaded</span>
            <button onClick={e => { e.stopPropagation(); onRemove(); }} className="ml-1 text-gray-400 hover:text-red-500">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div>
            <Upload className="w-5 h-5 text-gray-300 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Tap to upload</p>
          </div>
        )}
      </div>
    </div>
  );
}
