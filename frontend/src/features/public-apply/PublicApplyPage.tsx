import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, AlertTriangle, Briefcase, MapPin, Clock, FileText, Copy } from 'lucide-react';
import { useGetJobFormQuery, useSubmitPublicApplicationMutation } from './publicApplyApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function PublicApplyPage() {
  const { token } = useParams<{ token: string }>();
  const { data: res, isLoading, isError } = useGetJobFormQuery(token || '', { skip: !token });
  const [submitApp, { isLoading: submitting }] = useSubmitPublicApplicationMutation();

  const [step, setStep] = useState(1); // 1=details, 2=MCQ, 3=resume, 4=done
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);

  const job = res?.data;
  const questions = job?.questions || [];

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-brand-600" size={32} /></div>;
  }

  if (isError || !job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Job Not Found</h1>
          <p className="text-sm text-gray-500">This application link is invalid or the position has been closed.</p>
        </div>
      </div>
    );
  }

  const handleSelectAnswer = (questionId: string, option: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: option }));
    // Auto-advance after 500ms
    setTimeout(() => {
      if (currentQ < questions.length - 1) {
        setCurrentQ(prev => prev + 1);
      } else {
        setStep(3); // Move to resume step
      }
    }, 500);
  };

  const handleSubmit = async () => {
    try {
      const mcqAnswers = Object.entries(answers).map(([questionId, selectedOption]) => ({
        questionId,
        selectedOption,
      }));
      const res = await submitApp({
        token: token!,
        data: { candidateName: name, email: email || undefined, mobileNumber: phone || undefined, mcqAnswers },
      }).unwrap();
      setResult(res.data);
      setStep(4);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit application');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Job Header */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h1 className="text-xl font-bold text-gray-900">{job.title}</h1>
          <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1"><Briefcase size={14} /> {job.department}</span>
            <span className="flex items-center gap-1"><MapPin size={14} /> {job.location}</span>
            <span className="flex items-center gap-1"><Clock size={14} /> {job.type?.replace('_', ' ')}</span>
          </div>
          {/* Progress bar */}
          <div className="mt-4 flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={cn('flex-1 h-1.5 rounded-full', step >= s ? 'bg-brand-600' : 'bg-gray-200')} />
            ))}
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-400">
            <span>Details</span>
            <span>Screening</span>
            <span>Submit</span>
          </div>
        </div>

        {/* Step 1: Candidate Details */}
        {step === 1 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Your Details</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} required className="input-glass w-full text-sm" placeholder="John Doe" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="input-glass w-full text-sm" placeholder="john@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} className="input-glass w-full text-sm" placeholder="9876543210" />
              </div>
              <p className="text-xs text-gray-400">* At least email or phone is recommended for communication.</p>
              <button onClick={() => questions.length > 0 ? setStep(2) : setStep(3)}
                disabled={!name} className="btn-primary w-full text-sm">
                {questions.length > 0 ? 'Next: Screening Questions' : 'Next: Submit Application'}
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: MCQ Questions */}
        {step === 2 && questions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Screening Question {currentQ + 1} of {questions.length}</h2>
              <span className="text-xs text-gray-400 px-2 py-1 bg-gray-100 rounded-full">{questions[currentQ]?.category}</span>
            </div>
            <div className="mb-2 h-1 bg-gray-200 rounded-full">
              <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
            </div>

            <p className="text-sm text-gray-800 mb-6 font-medium">{questions[currentQ]?.questionText}</p>

            <div className="space-y-3">
              {['A', 'B', 'C', 'D'].map(opt => {
                const q = questions[currentQ];
                const optionText = q?.[`option${opt}` as keyof typeof q];
                const isSelected = answers[q?.id] === opt;
                return (
                  <button key={opt} onClick={() => handleSelectAnswer(q.id, opt)}
                    className={cn(
                      'w-full text-left px-4 py-3 rounded-xl border text-sm transition-all',
                      isSelected ? 'bg-brand-50 border-brand-300 text-brand-700 ring-2 ring-brand-200' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    )}>
                    <span className="font-semibold mr-2">{opt}.</span>
                    {optionText}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Step 3: Submit */}
        {step === 3 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Submit Application</h2>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm text-gray-600">
              <p><strong>Name:</strong> {name}</p>
              {email && <p><strong>Email:</strong> {email}</p>}
              {phone && <p><strong>Phone:</strong> {phone}</p>}
              <p><strong>Questions answered:</strong> {Object.keys(answers).length} / {questions.length}</p>
            </div>
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              Submit Application
            </button>
          </motion.div>
        )}

        {/* Step 4: Success */}
        {step === 4 && result && (
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <CheckCircle2 size={48} className="mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application Submitted!</h2>
            <div className="bg-gray-50 rounded-xl p-4 inline-block mb-4">
              <p className="text-xs text-gray-400 mb-1">Your Application ID</p>
              <p className="text-2xl font-mono font-bold text-brand-600">{result.candidateUid}</p>
            </div>
            <p className="text-sm text-gray-500 mb-4">Track your application status at:</p>
            <div className="flex items-center gap-2 justify-center">
              <code className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg">{window.location.origin}/track/{result.candidateUid}</code>
              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/track/${result.candidateUid}`); toast.success('Copied!'); }}
                className="p-1.5 rounded-lg hover:bg-gray-100"><Copy size={14} /></button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
