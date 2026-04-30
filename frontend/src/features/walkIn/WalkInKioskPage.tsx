import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Check, Upload, X, User, Briefcase,
  FileText, Loader2, CheckCircle2, Plus, Trash2, Brain,
} from 'lucide-react';
import { useGetWalkInJobsQuery, useRegisterWalkInMutation, useGetPsychometricQuestionsQuery } from './walkInApi';
import { uploadFile, validateFile } from '../../lib/fileUpload';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const STEPS = [
  { label: 'Personal Info',       icon: User },
  { label: 'Job Details',         icon: Briefcase },
  { label: 'Education',           icon: FileText },
  { label: 'Work Experience',     icon: Briefcase },
  { label: 'Skills & Prefs',      icon: Check },
  { label: 'Documents',           icon: FileText },
  { label: 'Assessment',          icon: Brain },
  { label: 'Confirm & Submit',    icon: Check },
];

const IDLE_TIMEOUT = 5 * 60 * 1000;
const IDLE_WARNING = 30 * 1000;

interface EducationRow { qualification: string; institution: string; year: string; marks: string; }
interface DocumentsChecklist { resume: boolean; photo: boolean; idProof: boolean; certificates: boolean; salarySlip: boolean; relievingLetter: boolean; }

interface FormData {
  // Step 0: Personal
  jobOpeningId: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  fathersName: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  alternatePhone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  currentAddress: string;
  permanentAddress: string;
  // Step 1: Job Details
  referredBy: string;
  availableFrom: string;
  employmentType: string;
  // Step 2: Education
  education: EducationRow[];
  // Step 3: Work Experience
  experienceYears: number;
  experienceMonths: number;
  isFresher: boolean;
  lastDrawnSalary: string;
  lastEmployer: string;
  designation: string;
  currentCompany: string;
  workFromDate: string;
  workToDate: string;
  reasonForLeaving: string;
  keyResponsibilities: string;
  // Step 4: Skills
  skills: string[];
  openToSiteWork: boolean | null;
  hasTwoWheeler: boolean | null;
  willingToRelocate: boolean | null;
  healthIssues: string;
  qualification: string;
  fieldOfStudy: string;
  // Step 5: Documents
  documentsChecklist: DocumentsChecklist;
  resumeUrl: string;
  // Step 6: Assessment (psychometric)
  psychAnswers: Array<{ questionId: string; selectedOption: string }>;
}

const emptyEduRow = (): EducationRow => ({ qualification: '', institution: '', year: '', marks: '' });

const initialFormData: FormData = {
  jobOpeningId: '', fullName: '', email: '', phone: '', city: '',
  fathersName: '', dateOfBirth: '', gender: '', maritalStatus: '',
  alternatePhone: '', emergencyContactName: '', emergencyContactPhone: '',
  emergencyContactRelation: '', currentAddress: '', permanentAddress: '',
  referredBy: '', availableFrom: '', employmentType: '',
  education: [emptyEduRow(), emptyEduRow(), emptyEduRow(), emptyEduRow()],
  experienceYears: 0, experienceMonths: 0, isFresher: true,
  lastDrawnSalary: '', lastEmployer: '', designation: '', currentCompany: '',
  workFromDate: '', workToDate: '', reasonForLeaving: '', keyResponsibilities: '',
  skills: [], openToSiteWork: null, hasTwoWheeler: null, willingToRelocate: null,
  healthIssues: '', qualification: '', fieldOfStudy: '',
  documentsChecklist: { resume: false, photo: false, idProof: false, certificates: false, salarySlip: false, relievingLetter: false },
  resumeUrl: '',
  psychAnswers: [],
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
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const warningTimerRef = useRef<number | null>(null);

  const tempId = useMemo(() => `walkin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);

  const { data: jobsData } = useGetWalkInJobsQuery();
  const { data: psychData, isLoading: psychLoading, isError: psychError, refetch: refetchPsych } = useGetPsychometricQuestionsQuery();
  const [registerWalkIn, { isLoading: isSubmitting }] = useRegisterWalkInMutation();
  // Lock in questions once loaded so a refetch() doesn't reshuffle mid-session
  const [lockedPsychQuestions, setLockedPsychQuestions] = useState<any[]>([]);
  useEffect(() => {
    if (psychData?.data?.length && lockedPsychQuestions.length === 0) {
      setLockedPsychQuestions(psychData.data);
    }
  }, [psychData]);

  const jobs = jobsData?.data || [];
  const psychQuestions: any[] = lockedPsychQuestions;

  // Idle reset
  const resetIdleTimer = useCallback(() => {
    if (submitted) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    setIdleWarning(false);
    idleTimerRef.current = window.setTimeout(() => {
      setIdleWarning(true);
      setCountdown(30);
      warningTimerRef.current = window.setTimeout(() => {
        setForm({ ...initialFormData, jobOpeningId: initialJobId });
        setStep(0); setSubmitted(false); setIdleWarning(false);
      }, IDLE_WARNING);
    }, IDLE_TIMEOUT - IDLE_WARNING);
  }, [submitted, initialJobId]);

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

  useEffect(() => {
    if (!idleWarning) return;
    const interval = setInterval(() => { setCountdown(prev => { if (prev <= 1) { clearInterval(interval); return 0; } return prev - 1; }); }, 1000);
    return () => clearInterval(interval);
  }, [idleWarning]);

  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => { setForm({ ...initialFormData, jobOpeningId: initialJobId }); setStep(0); setSubmitted(false); setTokenNumber(''); }, IDLE_TIMEOUT);
    return () => clearTimeout(timer);
  }, [submitted, initialJobId]);

  const upd = (field: keyof FormData, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const handleResumeUpload = async (file: File) => {
    const err = validateFile(file, { maxSizeMB: 10, allowedTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] });
    if (err) { toast.error(err); return; }
    setResumeFile(file);
    setResumeUploading(true);
    try {
      const result = await uploadFile(file, `/walk-in/upload`, { sessionId: tempId });
      upd('resumeUrl', result.data?.url ?? '');
      toast.success('Resume uploaded');
    } catch { toast.error('Upload failed'); }
    finally { setResumeUploading(false); }
  };

  const updateEduRow = (idx: number, field: keyof EducationRow, value: string) => {
    const next = [...form.education];
    next[idx] = { ...next[idx], [field]: value };
    upd('education', next);
  };

  const togglePsychAnswer = (questionId: string, option: string) => {
    const existing = form.psychAnswers.findIndex(a => a.questionId === questionId);
    if (existing >= 0) {
      const next = [...form.psychAnswers];
      next[existing] = { questionId, selectedOption: option };
      upd('psychAnswers', next);
    } else {
      upd('psychAnswers', [...form.psychAnswers, { questionId, selectedOption: option }]);
    }
  };

  const getAnswerFor = (questionId: string) => form.psychAnswers.find(a => a.questionId === questionId)?.selectedOption;

  const canProceed = () => {
    switch (step) {
      case 0: {
        if (!form.fullName.trim()) { toast.error('Full name is required'); return false; }
        if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { toast.error('Valid email is required'); return false; }
        if (!/^\d{10}$/.test(form.phone)) { toast.error('Valid 10-digit phone is required'); return false; }
        return true;
      }
      case 1: return true;
      case 2: return true;
      case 3: return true;
      case 4: return true;
      case 5: return true;
      case 6: return true;
      case 7: return true;
      default: return true;
    }
  };

  const handleSubmit = async () => {
    try {
      const payload: any = {
        ...form,
        jobOpeningId: form.jobOpeningId || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        availableFrom: form.availableFrom || undefined,
        education: form.education.filter(r => r.qualification || r.institution),
        psychAnswers: form.psychAnswers.length > 0 ? form.psychAnswers : undefined,
        openToSiteWork: form.openToSiteWork ?? undefined,
        hasTwoWheeler: form.hasTwoWheeler ?? undefined,
        willingToRelocate: form.willingToRelocate ?? undefined,
      };
      // strip empty strings
      Object.keys(payload).forEach(k => { if (payload[k] === '') delete payload[k]; });

      const result = await registerWalkIn(payload).unwrap();
      if (result.success) {
        setTokenNumber(result.data.tokenNumber);
        setSubmitted(true);
        toast.success('Registration complete!');
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Registration failed. Please try again.');
    }
  };

  if (submitted) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-3xl font-display font-bold text-gray-900 mb-2">Registration Complete!</h2>
        <p className="text-gray-500 mb-8">Please show this to the receptionist</p>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-8 max-w-md mx-auto mb-8">
          <p className="text-sm text-gray-400 mb-2">Your Token Number</p>
          <p className="text-4xl font-display font-bold text-brand-600 tracking-wider" data-mono>{tokenNumber}</p>
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
      {/* Idle Warning */}
      <AnimatePresence>
        {idleWarning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl p-8 max-w-sm text-center shadow-2xl">
              <p className="text-lg font-bold text-gray-900 mb-2">Still there?</p>
              <p className="text-gray-500 mb-4">Resetting in <span className="font-bold text-red-500">{countdown}s</span></p>
              <button onClick={resetIdleTimer} className="btn-primary w-full">Continue</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex flex-col items-center flex-1">
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'
              )}>
                {i < step ? <Check size={14} /> : i + 1}
              </div>
              <span className={cn('text-[9px] mt-1 text-center leading-tight hidden sm:block',
                i === step ? 'text-brand-600 font-medium' : 'text-gray-400'
              )}>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="h-1 bg-gray-200 rounded-full">
          <div className="h-full bg-brand-600 rounded-full transition-all duration-300" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.2 }}>

          {/* ── Step 0: Personal Info (Section A) ── */}
          {step === 0 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">A. Candidate Information</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Position Applied For</label>
                  <select value={form.jobOpeningId} onChange={e => upd('jobOpeningId', e.target.value)} className="input-glass w-full text-sm">
                    <option value="">Select position...</option>
                    {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input value={form.fullName} onChange={e => upd('fullName', e.target.value)} className="input-glass w-full text-sm" placeholder="As per ID proof" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Father's Name</label>
                  <input value={form.fathersName} onChange={e => upd('fathersName', e.target.value)} className="input-glass w-full text-sm" placeholder="Father's full name" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                  <input type="date" value={form.dateOfBirth} onChange={e => upd('dateOfBirth', e.target.value)} className="input-glass w-full text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                  <select value={form.gender} onChange={e => upd('gender', e.target.value)} className="input-glass w-full text-sm">
                    <option value="">Select...</option>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Marital Status</label>
                  <select value={form.maritalStatus} onChange={e => upd('maritalStatus', e.target.value)} className="input-glass w-full text-sm">
                    <option value="">Select...</option>
                    <option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input value={form.city} onChange={e => upd('city', e.target.value)} className="input-glass w-full text-sm" placeholder="Current city" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email ID <span className="text-red-500">*</span></label>
                  <input type="email" value={form.email} onChange={e => upd('email', e.target.value)} className="input-glass w-full text-sm" placeholder="email@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Primary Contact No. <span className="text-red-500">*</span></label>
                  <input value={form.phone} onChange={e => upd('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} className="input-glass w-full text-sm" placeholder="10-digit mobile" maxLength={10} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Alternate No.</label>
                  <input value={form.alternatePhone} onChange={e => upd('alternatePhone', e.target.value.replace(/\D/g, '').slice(0, 10))} className="input-glass w-full text-sm" placeholder="Optional" maxLength={10} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact Name</label>
                  <input value={form.emergencyContactName} onChange={e => upd('emergencyContactName', e.target.value)} className="input-glass w-full text-sm" placeholder="Emergency contact" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Phone</label>
                  <input value={form.emergencyContactPhone} onChange={e => upd('emergencyContactPhone', e.target.value.replace(/\D/g, '').slice(0, 10))} className="input-glass w-full text-sm" placeholder="Emergency phone" maxLength={10} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Relation</label>
                  <input value={form.emergencyContactRelation} onChange={e => upd('emergencyContactRelation', e.target.value)} className="input-glass w-full text-sm" placeholder="e.g. Father, Spouse" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Address</label>
                <textarea value={form.currentAddress} onChange={e => upd('currentAddress', e.target.value)} className="input-glass w-full text-sm" rows={2} placeholder="Full current address" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Permanent Address</label>
                <textarea value={form.permanentAddress} onChange={e => upd('permanentAddress', e.target.value)} className="input-glass w-full text-sm" rows={2} placeholder="Full permanent address" />
              </div>
            </div>
          )}

          {/* ── Step 1: Job Details (Section B) ── */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">B. Job Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Referred By</label>
                  <input value={form.referredBy} onChange={e => upd('referredBy', e.target.value)} className="input-glass w-full text-sm" placeholder="Who referred you?" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Available From</label>
                  <input type="date" value={form.availableFrom} onChange={e => upd('availableFrom', e.target.value)} className="input-glass w-full text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
                <select value={form.employmentType} onChange={e => upd('employmentType', e.target.value)} className="input-glass w-full text-sm">
                  <option value="">Select...</option>
                  <option>Full Time</option><option>Part Time</option><option>Contract</option><option>Internship</option><option>Freelance</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Step 2: Education (Section C) ── */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">C. Educational Qualifications</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left p-2 font-medium text-gray-700 border border-gray-200">Qualification</th>
                      <th className="text-left p-2 font-medium text-gray-700 border border-gray-200">Institution</th>
                      <th className="text-left p-2 font-medium text-gray-700 border border-gray-200">Year</th>
                      <th className="text-left p-2 font-medium text-gray-700 border border-gray-200">Marks/CGPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.education.map((row, i) => (
                      <tr key={i}>
                        <td className="border border-gray-200 p-1">
                          <input value={row.qualification} onChange={e => updateEduRow(i, 'qualification', e.target.value)} className="w-full text-sm px-2 py-1 border-0 outline-none bg-transparent" placeholder="e.g. B.Tech" />
                        </td>
                        <td className="border border-gray-200 p-1">
                          <input value={row.institution} onChange={e => updateEduRow(i, 'institution', e.target.value)} className="w-full text-sm px-2 py-1 border-0 outline-none bg-transparent" placeholder="College/University" />
                        </td>
                        <td className="border border-gray-200 p-1">
                          <input value={row.year} onChange={e => updateEduRow(i, 'year', e.target.value)} className="w-full text-sm px-2 py-1 border-0 outline-none bg-transparent" placeholder="2022" />
                        </td>
                        <td className="border border-gray-200 p-1">
                          <input value={row.marks} onChange={e => updateEduRow(i, 'marks', e.target.value)} className="w-full text-sm px-2 py-1 border-0 outline-none bg-transparent" placeholder="75% / 8.2" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => upd('education', [...form.education, emptyEduRow()])} className="text-sm text-brand-600 flex items-center gap-1 hover:underline">
                <Plus size={14} /> Add row
              </button>
            </div>
          )}

          {/* ── Step 3: Work Experience (Section D) ── */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">D. Work Experience</h2>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isFresher} onChange={e => upd('isFresher', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-brand-600" />
                <span className="text-sm text-gray-700">I am a Fresher (no prior work experience)</span>
              </label>

              {!form.isFresher && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Experience (Years)</label>
                      <input type="number" min={0} value={form.experienceYears} onChange={e => upd('experienceYears', Number(e.target.value))} className="input-glass w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Months</label>
                      <input type="number" min={0} max={11} value={form.experienceMonths} onChange={e => upd('experienceMonths', Number(e.target.value))} className="input-glass w-full text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Last Drawn Salary</label>
                      <input value={form.lastDrawnSalary} onChange={e => upd('lastDrawnSalary', e.target.value)} className="input-glass w-full text-sm" placeholder="e.g. ₹25,000/month or 3 LPA" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Last Employer</label>
                      <input value={form.lastEmployer} onChange={e => upd('lastEmployer', e.target.value)} className="input-glass w-full text-sm" placeholder="Company name" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
                      <input value={form.designation} onChange={e => upd('designation', e.target.value)} className="input-glass w-full text-sm" placeholder="Job title held" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">From (MM/YYYY)</label>
                      <input value={form.workFromDate} onChange={e => upd('workFromDate', e.target.value)} className="input-glass w-full text-sm" placeholder="01/2021" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">To (MM/YYYY)</label>
                      <input value={form.workToDate} onChange={e => upd('workToDate', e.target.value)} className="input-glass w-full text-sm" placeholder="06/2024 or Present" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Leaving</label>
                    <input value={form.reasonForLeaving} onChange={e => upd('reasonForLeaving', e.target.value)} className="input-glass w-full text-sm" placeholder="Growth opportunity, relocation, etc." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Key Responsibilities</label>
                    <textarea value={form.keyResponsibilities} onChange={e => upd('keyResponsibilities', e.target.value)} className="input-glass w-full text-sm" rows={3} placeholder="Briefly describe your main duties and achievements" />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 4: Skills & Preferences (Section E) ── */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">E. Skills & Preferences</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Technical Skills / Software Known</label>
                <div className="flex gap-2 mb-2">
                  <input value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const t = skillInput.trim(); if (t && !form.skills.includes(t)) { upd('skills', [...form.skills, t]); setSkillInput(''); }}}} className="input-glass flex-1 text-sm" placeholder="Type skill and press Enter" />
                  <button onClick={() => { const t = skillInput.trim(); if (t && !form.skills.includes(t)) { upd('skills', [...form.skills, t]); setSkillInput(''); }}} className="btn-secondary px-3 text-sm">Add</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.skills.map(s => (
                    <span key={s} className="flex items-center gap-1 bg-brand-50 text-brand-700 text-xs px-3 py-1 rounded-full border border-brand-200">
                      {s}
                      <button onClick={() => upd('skills', form.skills.filter(x => x !== s))}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Highest Qualification</label>
                <select value={form.qualification} onChange={e => upd('qualification', e.target.value)} className="input-glass w-full text-sm">
                  <option value="">Select...</option>
                  <option>10th / SSLC</option><option>12th / HSC</option><option>Diploma</option>
                  <option>Graduate / Bachelor's</option><option>Post-Graduate / Master's</option><option>PhD / Doctorate</option>
                </select>
              </div>

              {['openToSiteWork', 'hasTwoWheeler', 'willingToRelocate'].map(field => (
                <div key={field} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-700">
                    {field === 'openToSiteWork' ? 'Open to Site Work?' : field === 'hasTwoWheeler' ? 'Own Two-wheeler?' : 'Willing to Relocate?'}
                  </span>
                  <div className="flex gap-3">
                    {[true, false].map(v => (
                      <button key={String(v)} onClick={() => upd(field as keyof FormData, v)}
                        className={cn('px-4 py-1.5 text-sm rounded-lg border transition-colors', (form as any)[field] === v ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600 hover:border-brand-300')}>
                        {v ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Health Issues (if any)</label>
                <input value={form.healthIssues} onChange={e => upd('healthIssues', e.target.value)} className="input-glass w-full text-sm" placeholder="None / Specify if any" />
              </div>
            </div>
          )}

          {/* ── Step 5: Documents Checklist (Section F) ── */}
          {step === 5 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">F. Documents Checklist</h2>
              <p className="text-sm text-gray-500">Check which original documents you have brought today:</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(Object.keys(form.documentsChecklist) as (keyof DocumentsChecklist)[]).map(key => (
                  <label key={key} className={cn('flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors', form.documentsChecklist[key] ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300')}>
                    <input type="checkbox" checked={form.documentsChecklist[key]} onChange={e => upd('documentsChecklist', { ...form.documentsChecklist, [key]: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-brand-600" />
                    <span className="text-sm font-medium text-gray-700 capitalize">{key === 'idProof' ? 'ID Proof' : key === 'salarySlip' ? 'Salary Slip' : key === 'relievingLetter' ? 'Relieving Letter' : key.charAt(0).toUpperCase() + key.slice(1)}</span>
                  </label>
                ))}
              </div>

              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload Resume (optional)</label>
                {!form.resumeUrl ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition-all"
                  >
                    {resumeUploading ? <Loader2 size={28} className="mx-auto animate-spin text-brand-500 mb-2" /> : <Upload size={28} className="mx-auto text-gray-400 mb-2" />}
                    <p className="text-sm text-gray-500">{resumeUploading ? 'Uploading...' : 'Click to upload resume (PDF, DOC)'}</p>
                    <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleResumeUpload(f); }} />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                    <FileText size={20} className="text-green-600" />
                    <span className="text-sm text-gray-700 flex-1">{resumeFile?.name || 'Resume uploaded'}</span>
                    <button onClick={() => { upd('resumeUrl', ''); setResumeFile(null); }} className="p-1 hover:bg-green-100 rounded"><Trash2 size={14} className="text-gray-500" /></button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 6: Psychometric Assessment (Section G) ── */}
          {step === 6 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <Brain size={24} className="text-brand-600" />
                <div>
                  <h2 className="text-xl font-bold text-gray-900">G. Personal Assessment</h2>
                  <p className="text-sm text-gray-500">Answer honestly — there are no right or wrong answers here.</p>
                </div>
              </div>

              {psychLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                  <Loader2 size={16} className="animate-spin" /> Loading questions...
                </div>
              )}
              {psychError && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                  <p className="font-medium mb-1">Assessment unavailable</p>
                  <p className="text-xs mb-3">Could not load questions. You can skip this step or try again.</p>
                  <button onClick={() => refetchPsych()} className="text-xs underline mr-4">Retry</button>
                  <button onClick={() => setStep(s => s + 1)} className="text-xs underline">Skip Assessment →</button>
                </div>
              )}

              {psychQuestions.map((q: any, i: number) => (
                <div key={q.id} className="bg-gray-50 rounded-xl p-4">
                  <p className="text-sm font-medium text-gray-800 mb-3">{i + 1}. {q.questionText}</p>
                  <div className="space-y-2">
                    {(['A', 'B', 'C', 'D'] as const).map(opt => {
                      const text = q[`option${opt}`];
                      const selected = getAnswerFor(q.id) === opt;
                      return (
                        <button key={opt} onClick={() => togglePsychAnswer(q.id, opt)}
                          className={cn('w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-all',
                            selected ? 'bg-brand-50 border-brand-400 text-brand-700 ring-2 ring-brand-200' : 'border-gray-200 hover:border-gray-300 hover:bg-white'
                          )}>
                          <span className="font-semibold mr-2">{opt}.</span>{text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {psychQuestions.length > 0 && (
                <p className="text-xs text-gray-400 text-center">{form.psychAnswers.length} of {psychQuestions.length} questions answered</p>
              )}
            </div>
          )}

          {/* ── Step 7: Confirm & Submit (Section G: Declaration) ── */}
          {step === 7 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Confirm & Submit</h2>

              <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1.5 text-gray-700">
                <p><strong>Name:</strong> {form.fullName}</p>
                {form.fathersName && <p><strong>Father's Name:</strong> {form.fathersName}</p>}
                <p><strong>Email:</strong> {form.email}</p>
                <p><strong>Phone:</strong> {form.phone}</p>
                {form.gender && <p><strong>Gender:</strong> {form.gender}</p>}
                {form.jobOpeningId && <p><strong>Position:</strong> {jobs.find((j: any) => j.id === form.jobOpeningId)?.title || form.jobOpeningId}</p>}
                {form.employmentType && <p><strong>Employment Type:</strong> {form.employmentType}</p>}
                <p><strong>Experience:</strong> {form.isFresher ? 'Fresher' : `${form.experienceYears}y ${form.experienceMonths}m`}</p>
                {form.skills.length > 0 && <p><strong>Skills:</strong> {form.skills.join(', ')}</p>}
                <p><strong>Assessment answered:</strong> {form.psychAnswers.length}/{psychQuestions.length} questions</p>
              </div>

              <div className="border border-gray-200 rounded-xl p-4 text-xs text-gray-500 leading-relaxed">
                <strong className="text-gray-700">Declaration:</strong> I declare that the information provided above is accurate and complete to the best of my knowledge. Any false or misleading details may result in disqualification or dismissal.
              </div>

              <button onClick={handleSubmit} disabled={isSubmitting} className="btn-primary w-full flex items-center justify-center gap-2">
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Submit Registration
              </button>
            </div>
          )}

        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex gap-3 mt-8">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} className="btn-secondary flex items-center gap-2 flex-1">
            <ChevronLeft size={16} /> Back
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button onClick={() => { if (canProceed()) setStep(s => s + 1); }} className="btn-primary flex items-center gap-2 flex-1">
            Next <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
