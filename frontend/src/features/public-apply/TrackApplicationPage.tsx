import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Loader2, AlertTriangle, CheckCircle2, Clock, Briefcase } from 'lucide-react';
import { useTrackApplicationQuery } from './publicApplyApi';
import { cn } from '../../lib/utils';

const STEPS = ['SUBMITTED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SELECTED'];
const STEP_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW_SCHEDULED: 'Interview Scheduled',
  SELECTED: 'Selected',
  REJECTED: 'Rejected',
  ON_HOLD: 'On Hold',
};

export default function TrackApplicationPage() {
  const { uid: paramUid } = useParams<{ uid: string }>();
  const [inputUid, setInputUid] = useState(paramUid || '');
  const [searchUid, setSearchUid] = useState(paramUid || '');

  const { data: res, isLoading, isError } = useTrackApplicationQuery(searchUid, { skip: !searchUid });
  const app = res?.data;

  const handleSearch = () => {
    if (inputUid.trim()) setSearchUid(inputUid.trim());
  };

  const currentStepIndex = app ? STEPS.indexOf(app.status) : -1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Track Your Application</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your Application ID to check status</p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 mb-8">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={inputUid} onChange={e => setInputUid(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="ANST-XXXX" className="input-glass w-full pl-10 text-sm font-mono" />
          </div>
          <button onClick={handleSearch} className="btn-primary text-sm">Track</button>
        </div>

        {isLoading && <div className="text-center py-8"><Loader2 className="animate-spin text-brand-600 mx-auto" size={32} /></div>}

        {isError && searchUid && (
          <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
            <AlertTriangle size={40} className="mx-auto text-amber-500 mb-3" />
            <p className="text-sm text-gray-600">No application found with ID: <strong>{searchUid}</strong></p>
          </div>
        )}

        {app && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-lg p-6">
            <div className="mb-6">
              <p className="text-xs text-gray-400">Application</p>
              <p className="text-xl font-mono font-bold text-brand-600">{app.uid}</p>
              <p className="text-sm text-gray-600 mt-1">{app.name}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                <Briefcase size={12} /> {app.jobTitle} · Applied {new Date(app.appliedAt).toLocaleDateString('en-IN')}
              </p>
            </div>

            {/* Progress timeline */}
            {app.status === 'REJECTED' ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                <AlertTriangle size={24} className="mx-auto text-red-500 mb-2" />
                <p className="text-sm font-medium text-red-700">Application Not Selected</p>
                <p className="text-xs text-red-500 mt-1">Thank you for applying. We encourage you to apply for future openings.</p>
              </div>
            ) : app.status === 'ON_HOLD' ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <Clock size={24} className="mx-auto text-amber-500 mb-2" />
                <p className="text-sm font-medium text-amber-700">Application On Hold</p>
                <p className="text-xs text-amber-600 mt-1">Your application is being reviewed. We'll update you soon.</p>
              </div>
            ) : app.status === 'SELECTED' ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <CheckCircle2 size={24} className="mx-auto text-green-500 mb-2" />
                <p className="text-sm font-medium text-green-700">Congratulations! You've been selected!</p>
                <p className="text-xs text-green-600 mt-1">Our HR team will contact you shortly with next steps.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {STEPS.map((s, i) => (
                  <div key={s} className="flex items-center gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                      i <= currentStepIndex ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'
                    )}>
                      {i < currentStepIndex ? <CheckCircle2 size={16} /> : <span className="text-xs font-bold">{i + 1}</span>}
                    </div>
                    <div>
                      <p className={cn('text-sm font-medium', i <= currentStepIndex ? 'text-gray-800' : 'text-gray-400')}>
                        {STEP_LABELS[s]}
                      </p>
                      {s === 'INTERVIEW_SCHEDULED' && app.status === 'INTERVIEW_SCHEDULED' && app.interviewDate && (
                        <p className="text-xs text-brand-600 flex items-center gap-1 mt-0.5">
                          <Clock size={11} /> {new Date(app.interviewDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} at {new Date(app.interviewDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
