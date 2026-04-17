import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  MapPin,
  Clock,
  FileText,
  Copy,
  Upload,
  X,
  Timer,
  ExternalLink,
} from 'lucide-react';
import { useGetJobFormQuery, useSubmitPublicApplicationMutation } from './publicApplyApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const QUESTION_TIME_LIMIT = 90; // seconds per question

// Email regex for proper validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Indian mobile: 10 digits starting with 6-9
const PHONE_REGEX = /^[6-9]\d{9}$/;

export default function PublicApplyPage() {
  const { token } = useParams<{ token: string }>();
  const { data: res, isLoading, isError } = useGetJobFormQuery(token || '', { skip: !token });
  const [submitApp, { isLoading: submitting }] = useSubmitPublicApplicationMutation();

  const [step, setStep] = useState(1); // 1=details, 2=MCQ, 3=resume, 4=done
  // --- Step 1 fields ---
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [experience, setExperience] = useState('');
  const [currentDesignation, setCurrentDesignation] = useState('');
  const [preferredLocation, setPreferredLocation] = useState('');
  const [willingToRelocate, setWillingToRelocate] = useState('');
  const [currentCTC, setCurrentCTC] = useState('');
  const [expectedCTC, setExpectedCTC] = useState('');
  const [noticePeriod, setNoticePeriod] = useState('');
  // --- Validation errors ---
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  // --- Step 2 ---
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // --- Step 3 ---
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [noResume, setNoResume] = useState(false);
  // --- Step 4 ---
  const [result, setResult] = useState<any>(null);
  // --- Timer ---
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_LIMIT);
  const [isAnswering, setIsAnswering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const job = res?.data;
  const questions = job?.questions || [];

  // Advance to next question or to resume step
  const advanceQuestion = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsAnswering(false);
    if (currentQ < questions.length - 1) {
      setCurrentQ(prev => prev + 1);
      setTimeLeft(QUESTION_TIME_LIMIT);
    } else {
      setStep(3); // Move to resume upload step
    }
  }, [currentQ, questions.length]);

  // Timer countdown for MCQ step
  useEffect(() => {
    if (step !== 2 || questions.length === 0) return;

    setTimeLeft(QUESTION_TIME_LIMIT);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          advanceQuestion();
          return QUESTION_TIME_LIMIT;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, currentQ]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-brand-600" size={32} />
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Job Not Found</h1>
          <p className="text-sm text-gray-500">
            This application link is invalid or the position has been closed.
          </p>
        </div>
      </div>
    );
  }

  // --- Validation ---
  const validateEmail = (v: string) => {
    if (!v) { setEmailError(''); return true; }
    if (!EMAIL_REGEX.test(v)) { setEmailError('Enter a valid email address'); return false; }
    setEmailError('');
    return true;
  };
  const validatePhone = (v: string) => {
    if (!v) { setPhoneError(''); return true; }
    const digits = v.replace(/\D/g, '').slice(-10);
    if (!PHONE_REGEX.test(digits)) { setPhoneError('Enter a valid 10-digit Indian mobile number'); return false; }
    setPhoneError('');
    return true;
  };

  const canProceedStep1 = () => {
    if (!name.trim()) { toast.error('Please enter your full name'); return false; }
    if (!email.trim()) { toast.error('Please enter your email'); return false; }
    if (!EMAIL_REGEX.test(email.trim())) { toast.error('Please enter a valid email'); return false; }
    if (!phone.trim()) { toast.error('Please enter your mobile number'); return false; }
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (!PHONE_REGEX.test(digits)) { toast.error('Please enter a valid 10-digit mobile number'); return false; }
    return true;
  };

  const handleSelectAnswer = (questionId: string, option: string) => {
    if (isAnswering) return;
    setIsAnswering(true);
    setAnswers(prev => ({ ...prev, [questionId]: option }));
    setTimeout(() => {
      advanceQuestion();
    }, 500);
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) validateAndSetFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const validateAndSetFile = (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are accepted');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size must be under 50MB');
      return;
    }
    setResumeFile(file);
  };

  const handleSubmit = async () => {
    try {
      const mcqAnswers = Object.entries(answers).map(([questionId, selectedOption]) => ({
        questionId,
        selectedOption,
      }));

      const formData = new FormData();
      formData.append('candidateName', name.trim());
      formData.append('email', email.trim());
      formData.append('mobileNumber', phone.replace(/\D/g, '').slice(-10));
      if (city) formData.append('city', city.trim());
      if (experience) formData.append('experience', experience);
      if (currentDesignation) formData.append('currentDesignation', currentDesignation.trim());
      if (preferredLocation) formData.append('preferredLocation', preferredLocation.trim());
      if (willingToRelocate) formData.append('willingToRelocate', willingToRelocate);
      if (currentCTC) formData.append('currentCTC', currentCTC.trim());
      if (expectedCTC) formData.append('expectedCTC', expectedCTC.trim());
      if (noticePeriod) formData.append('noticePeriod', noticePeriod);
      formData.append('mcqAnswers', JSON.stringify(mcqAnswers));
      if (resumeFile && !noResume) {
        formData.append('resume', resumeFile);
      }

      const res = await submitApp({
        token: token!,
        formData,
      }).unwrap();
      setResult(res.data);
      setStep(4);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit application');
    }
  };

  // Timer visuals
  const timerProgress = timeLeft / QUESTION_TIME_LIMIT;
  const timerColor =
    timeLeft > 60 ? 'text-green-500' : timeLeft > 30 ? 'text-amber-500' : 'text-red-500';
  const timerStroke =
    timeLeft > 60 ? 'stroke-green-500' : timeLeft > 30 ? 'stroke-amber-500' : 'stroke-red-500';

  const stepLabels = ['Details', 'Screening', 'Resume', 'Submit'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Job Header */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h1 className="text-xl font-bold text-gray-900">{job.title}</h1>
          <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Briefcase size={14} /> {job.department}
            </span>
            <span className="flex items-center gap-1">
              <MapPin size={14} /> {job.location}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} /> {job.type?.replace('_', ' ')}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-4 flex items-center gap-2">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={cn(
                  'flex-1 h-1.5 rounded-full transition-colors duration-300',
                  step >= s ? 'bg-brand-600' : 'bg-gray-200'
                )}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-400">
            {stepLabels.map((label, i) => (
              <span
                key={label}
                className={cn(step === i + 1 && 'text-brand-600 font-medium')}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Step 1: Candidate Details */}
        {step === 1 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-lg p-6"
          >
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Details</h2>
            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="input-glass w-full text-sm"
                  placeholder="John Doe"
                />
              </div>

              {/* Email + Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={email}
                    onChange={e => { setEmail(e.target.value); validateEmail(e.target.value); }}
                    onBlur={() => validateEmail(email)}
                    type="email"
                    required
                    className={cn('input-glass w-full text-sm', emailError && 'border-red-400 ring-1 ring-red-200')}
                    placeholder="john@example.com"
                  />
                  {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mobile <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={phone}
                    onChange={e => { setPhone(e.target.value); validatePhone(e.target.value); }}
                    onBlur={() => validatePhone(phone)}
                    required
                    className={cn('input-glass w-full text-sm', phoneError && 'border-red-400 ring-1 ring-red-200')}
                    placeholder="9876543210"
                    maxLength={10}
                  />
                  {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
                </div>
              </div>

              {/* City + Experience */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    className="input-glass w-full text-sm"
                    placeholder="e.g. Mumbai"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Years of Experience</label>
                  <select
                    value={experience}
                    onChange={e => setExperience(e.target.value)}
                    className="input-glass w-full text-sm"
                  >
                    <option value="">Select...</option>
                    <option value="Fresher">Fresher</option>
                    <option value="1-2">1-2 years</option>
                    <option value="2-5">2-5 years</option>
                    <option value="5-10">5-10 years</option>
                    <option value="10+">10+ years</option>
                  </select>
                </div>
              </div>

              {/* Designation */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Designation</label>
                <input
                  value={currentDesignation}
                  onChange={e => setCurrentDesignation(e.target.value)}
                  className="input-glass w-full text-sm"
                  placeholder="e.g. Software Engineer"
                />
              </div>

              {/* Preferred Location + Willing to Relocate */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Job Location</label>
                  <select
                    value={preferredLocation}
                    onChange={e => setPreferredLocation(e.target.value)}
                    className="input-glass w-full text-sm"
                  >
                    <option value="">Select...</option>
                    <option value="Delhi NCR">Delhi NCR</option>
                    <option value="Rohini, Delhi">Rohini, Delhi</option>
                    <option value="Mumbai">Mumbai</option>
                    <option value="Bangalore">Bangalore</option>
                    <option value="Hyderabad">Hyderabad</option>
                    <option value="Pune">Pune</option>
                    <option value="Chennai">Chennai</option>
                    <option value="Kolkata">Kolkata</option>
                    <option value="Ahmedabad">Ahmedabad</option>
                    <option value="Remote">Remote / Work from Home</option>
                    <option value="Any">Any Location</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Willing to Relocate to Delhi?</label>
                  <select
                    value={willingToRelocate}
                    onChange={e => setWillingToRelocate(e.target.value)}
                    className="input-glass w-full text-sm"
                  >
                    <option value="">Select...</option>
                    <option value="yes">Yes, willing to relocate</option>
                    <option value="no">No, not willing to relocate</option>
                    <option value="maybe">Maybe, depends on the offer</option>
                  </select>
                </div>
              </div>

              {/* CTC + Notice Period */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current CTC (LPA)</label>
                  <input
                    value={currentCTC}
                    onChange={e => setCurrentCTC(e.target.value)}
                    className="input-glass w-full text-sm"
                    placeholder="e.g. 5 LPA"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected CTC (LPA)</label>
                  <input
                    value={expectedCTC}
                    onChange={e => setExpectedCTC(e.target.value)}
                    className="input-glass w-full text-sm"
                    placeholder="e.g. 8 LPA"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notice Period</label>
                  <select
                    value={noticePeriod}
                    onChange={e => setNoticePeriod(e.target.value)}
                    className="input-glass w-full text-sm"
                  >
                    <option value="">Select...</option>
                    <option value="Immediate">Immediate</option>
                    <option value="15 days">15 days</option>
                    <option value="1 month">1 month</option>
                    <option value="2 months">2 months</option>
                    <option value="3 months">3 months</option>
                  </select>
                </div>
              </div>

              <button
                onClick={() => {
                  if (!canProceedStep1()) return;
                  // Always go to screening — questions are guaranteed (fallback exists)
                  setStep(questions.length > 0 ? 2 : 2);
                }}
                className="btn-primary w-full text-sm"
              >
                Next: Screening Questions
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: MCQ Questions with Timer */}
        {step === 2 && questions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-lg p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Question {currentQ + 1} of {questions.length}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-400">
                  {questions[currentQ]?.category}
                </span>
              </div>
            </div>

            {/* Question progress bar */}
            <div className="mb-4 h-1 bg-gray-200 rounded-full">
              <div
                className="h-full bg-brand-600 rounded-full transition-all"
                style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }}
              />
            </div>

            {/* Countdown Timer */}
            <div className="flex items-center justify-center mb-6">
              <div className="relative w-20 h-20">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="6" />
                  <circle
                    cx="40" cy="40" r="34" fill="none"
                    className={timerStroke}
                    strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - timerProgress)}`}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <div className={cn('absolute inset-0 flex flex-col items-center justify-center', timerColor)}>
                  <Timer size={14} />
                  <span className="text-lg font-bold font-mono" data-mono>{timeLeft}s</span>
                </div>
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentQ}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.2 }}
              >
                <p className="text-sm text-gray-800 mb-6 font-medium">
                  {questions[currentQ]?.questionText}
                </p>

                <div className="space-y-3">
                  {['A', 'B', 'C', 'D'].map(opt => {
                    const q = questions[currentQ];
                    const optionText = q?.[`option${opt}` as keyof typeof q];
                    const isSelected = answers[q?.id] === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => handleSelectAnswer(q.id, opt)}
                        disabled={isAnswering}
                        className={cn(
                          'w-full text-left px-4 py-3 rounded-xl border text-sm transition-all',
                          isSelected
                            ? 'bg-brand-50 border-brand-300 text-brand-700 ring-2 ring-brand-200'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                          isAnswering && !isSelected && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <span className="font-semibold mr-2">{opt}.</span>
                        {optionText}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>

            {timeLeft <= 15 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-red-500 text-center mt-4 font-medium"
              >
                Hurry! Time is running out for this question.
              </motion.p>
            )}
          </motion.div>
        )}

        {/* Step 3: Resume Upload */}
        {step === 3 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-lg p-6"
          >
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Upload Resume</h2>
            <p className="text-sm text-gray-500 mb-6">
              Upload your resume in PDF format (max 50MB). This step is optional but recommended — your resume will be analyzed against the job description using AI OCR.
            </p>

            {!noResume && (
              <>
                {!resumeFile ? (
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition-all"
                  >
                    <Upload size={40} className="mx-auto text-gray-400 mb-3" />
                    <p className="text-sm text-gray-600 font-medium">
                      Drag & drop your resume here
                    </p>
                    <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                    <p className="text-xs text-gray-400 mt-2">PDF only, max 50MB — AI OCR handles scanned documents</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="border border-green-200 bg-green-50 rounded-xl p-4 flex items-center gap-3">
                    <FileText size={24} className="text-green-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {resumeFile.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(resumeFile.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setResumeFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="p-1.5 rounded-lg hover:bg-green-100 text-gray-500"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </>
            )}

            <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={noResume}
                onChange={e => {
                  setNoResume(e.target.checked);
                  if (e.target.checked) {
                    setResumeFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }
                }}
                className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-600">I don't have a resume right now</span>
            </label>

            <div className="mt-6">
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {submitting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <FileText size={16} />
                )}
                Submit Application
              </button>
            </div>

            {/* Summary */}
            <div className="bg-gray-50 rounded-xl p-4 mt-4 text-sm text-gray-600 space-y-0.5">
              <p><strong>Name:</strong> {name}</p>
              <p><strong>Email:</strong> {email}</p>
              <p><strong>Phone:</strong> {phone}</p>
              {city && <p><strong>City:</strong> {city}</p>}
              {experience && <p><strong>Experience:</strong> {experience}</p>}
              {currentDesignation && <p><strong>Designation:</strong> {currentDesignation}</p>}
              {preferredLocation && <p><strong>Preferred Location:</strong> {preferredLocation}</p>}
              {willingToRelocate && <p><strong>Willing to Relocate:</strong> {willingToRelocate === 'yes' ? 'Yes' : willingToRelocate === 'no' ? 'No' : 'Maybe'}</p>}
              {currentCTC && <p><strong>Current CTC:</strong> {currentCTC}</p>}
              {expectedCTC && <p><strong>Expected CTC:</strong> {expectedCTC}</p>}
              {noticePeriod && <p><strong>Notice Period:</strong> {noticePeriod}</p>}
              <p><strong>Questions answered:</strong> {Object.keys(answers).length} / {questions.length}</p>
              <p><strong>Resume:</strong> {noResume ? 'Skipped' : resumeFile ? resumeFile.name : 'Not uploaded'}</p>
            </div>
          </motion.div>
        )}

        {/* Step 4: Success */}
        {step === 4 && result && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-lg p-8 text-center"
          >
            <CheckCircle2 size={48} className="mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application Submitted!</h2>
            <div className="bg-gray-50 rounded-xl p-4 inline-block mb-4">
              <p className="text-xs text-gray-400 mb-1">Your Application ID</p>
              <p className="text-2xl font-mono font-bold text-brand-600">
                {result.candidateUid}
              </p>
            </div>
            <p className="text-sm text-gray-500 mb-4">Track your application status:</p>
            <div className="flex items-center gap-2 justify-center">
              <Link
                to={`/track/${result.candidateUid}`}
                className="text-xs text-brand-600 hover:text-brand-700 underline flex items-center gap-1"
              >
                <ExternalLink size={12} />
                {window.location.origin}/track/{result.candidateUid}
              </Link>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/track/${result.candidateUid}`
                  );
                  toast.success('Copied!');
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100"
              >
                <Copy size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
