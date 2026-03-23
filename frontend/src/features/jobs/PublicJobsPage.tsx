import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, MapPin, Clock, ChevronRight, Building2, Search, Hash, CheckCircle2, XCircle, PauseCircle, Loader2, X } from 'lucide-react';
import { useGetWalkInJobsQuery, useLazyGetWalkInByTokenQuery } from '../walkIn/walkInApi';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import toast from 'react-hot-toast';

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string; icon: any; description: string }> = {
  WAITING:      { label: 'Waiting',        color: 'text-amber-700',   bg: 'bg-amber-50',   icon: Clock,        description: 'Your registration is received. Please wait for your turn.' },
  IN_INTERVIEW: { label: 'In Interview',   color: 'text-blue-700',    bg: 'bg-blue-50',    icon: Briefcase,    description: 'Your interview process is ongoing.' },
  ON_HOLD:      { label: 'On Hold',        color: 'text-orange-700',  bg: 'bg-orange-50',  icon: PauseCircle,  description: 'Your application is on hold. We will update you soon.' },
  SELECTED:     { label: 'Selected',       color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2, description: 'Congratulations! You have been selected. An onboarding invite will be sent to your email.' },
  REJECTED:     { label: 'Not Selected',   color: 'text-red-700',     bg: 'bg-red-50',     icon: XCircle,      description: 'Thank you for your interest. Unfortunately, we cannot proceed with your application at this time.' },
  COMPLETED:    { label: 'Completed',      color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2, description: 'Your hiring process is complete. Check your email for next steps.' },
  NO_SHOW:      { label: 'No Show',        color: 'text-red-700',     bg: 'bg-red-50',     icon: XCircle,      description: 'You were marked as a no-show for your interview.' },
};

const ROUND_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  PENDING:     { label: 'Upcoming',    color: 'bg-gray-200' },
  SCHEDULED:   { label: 'Scheduled',   color: 'bg-blue-400' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-amber-400' },
  COMPLETED:   { label: 'Completed',   color: 'bg-emerald-400' },
  CANCELLED:   { label: 'Cancelled',   color: 'bg-red-300' },
};

export default function PublicJobsPage() {
  const { data: jobsData, isLoading } = useGetWalkInJobsQuery();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showStatusCheck, setShowStatusCheck] = useState(false);

  const jobs: any[] = jobsData?.data || [];
  const filtered = jobs.filter((job: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      job.title?.toLowerCase().includes(q) ||
      job.department?.toLowerCase().includes(q) ||
      job.location?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-600 to-brand-700 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg font-display">A</span>
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-gray-900">Aniston HRMS</h1>
              <p className="text-xs text-gray-500">Career Opportunities</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowStatusCheck(true)}
              className="text-sm text-brand-600 hover:text-brand-700 font-medium inline-flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg transition-colors"
            >
              <Hash className="w-4 h-4" />
              Check Status
            </button>
            <a
              href="/walk-in"
              className="text-sm text-gray-500 hover:text-brand-600 font-medium hidden sm:inline-flex items-center gap-1"
            >
              Direct Walk-In <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-8">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-gray-900 mb-3">
            Join Our Team
          </h2>
          <p className="text-gray-500 max-w-xl mx-auto text-base sm:text-lg">
            Explore open positions at Aniston Technologies LLP and take the next step in your career.
          </p>
          <p className="text-gray-400 max-w-lg mx-auto text-sm mt-2">
            Select a position and click "Apply" to fill in your details. Already applied?{' '}
            <button onClick={() => setShowStatusCheck(true)} className="text-brand-600 underline hover:text-brand-700">
              Check your status
            </button>
          </p>
        </motion.div>

        {/* Search */}
        <div className="max-w-md mx-auto mb-10">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search positions, departments, locations..."
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400
                shadow-sm transition-all"
            />
          </div>
        </div>
      </section>

      {/* Job Grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <Briefcase className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-1">
              {search ? 'No matching positions found' : 'No open positions right now'}
            </h3>
            <p className="text-sm text-gray-400">
              {search ? 'Try adjusting your search terms.' : 'Check back later for new opportunities.'}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((job: any, index: number) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md
                  transition-all hover:-translate-y-0.5 p-6 flex flex-col"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 text-brand-700 text-xs font-medium rounded-lg">
                    <Building2 className="w-3 h-3" />
                    {job.department || 'General'}
                  </span>
                  {job.type && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg">
                      <Clock className="w-3 h-3" />
                      {job.type}
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-display font-bold text-gray-900 mb-2 leading-tight">{job.title}</h3>
                {job.location && (
                  <p className="flex items-center gap-1.5 text-sm text-gray-500 mb-4">
                    <MapPin className="w-3.5 h-3.5 text-gray-400" />
                    {job.location}
                  </p>
                )}
                {job.description && (
                  <p className="text-sm text-gray-400 line-clamp-2 mb-5 flex-1">{job.description}</p>
                )}
                <button
                  onClick={() => navigate(`/walk-in?jobId=${job.id}`)}
                  className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-2.5
                    bg-brand-600 text-white rounded-xl text-sm font-medium
                    hover:bg-brand-700 transition-colors shadow-sm"
                >
                  Apply for Interview <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-gray-100 px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 gap-1">
          <span>Aniston Technologies LLP &mdash; Building the future of HR</span>
          <span>Powered by Aniston HRMS</span>
        </div>
      </footer>

      {/* Status Check Modal */}
      <AnimatePresence>
        {showStatusCheck && <StatusCheckModal onClose={() => setShowStatusCheck(false)} />}
      </AnimatePresence>
    </div>
  );
}

function StatusCheckModal({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('');
  const [fetchStatus, { data: statusData, isLoading, isError }] = useLazyGetWalkInByTokenQuery();
  const candidate = statusData?.data;

  const handleCheck = async () => {
    if (!token.trim()) { toast.error('Please enter your token number'); return; }
    fetchStatus(token.trim().toUpperCase());
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-display font-bold text-gray-900">Check Application Status</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Enter your walk-in token number (e.g., WALK-IN-2026-0001) to check your interview status.
        </p>

        <div className="flex gap-2 mb-5">
          <input
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCheck()}
            placeholder="WALK-IN-2026-0001"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono uppercase
              focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
            autoFocus
          />
          <button
            onClick={handleCheck}
            disabled={isLoading}
            className="px-5 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors flex items-center gap-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Check
          </button>
        </div>

        {/* Result */}
        {isError && (
          <div className="bg-red-50 rounded-xl p-4 text-center">
            <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-700 font-medium">Token not found</p>
            <p className="text-xs text-red-500 mt-1">Please double-check your token number and try again.</p>
          </div>
        )}

        {candidate && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Candidate Info */}
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
                  <span className="text-sm font-bold text-brand-600">
                    {candidate.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{candidate.fullName}</p>
                  <p className="text-xs text-gray-400 font-mono" data-mono>{candidate.tokenNumber}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                <span className="text-gray-400">Position:</span> {candidate.jobTitle || 'Not specified'}
                {candidate.department ? ` (${candidate.department})` : ''}
              </p>
            </div>

            {/* Status */}
            {(() => {
              const sd = STATUS_DISPLAY[candidate.status] || STATUS_DISPLAY.WAITING;
              const Icon = sd.icon;
              return (
                <div className={`rounded-xl p-4 ${sd.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-5 h-5 ${sd.color}`} />
                    <span className={`font-semibold ${sd.color}`}>{sd.label}</span>
                  </div>
                  <p className="text-sm text-gray-600">{sd.description}</p>
                </div>
              );
            })()}

            {/* Interview Rounds Progress */}
            {candidate.interviewRounds && candidate.interviewRounds.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">Interview Rounds</p>
                <div className="space-y-2">
                  {candidate.interviewRounds.map((round: any) => {
                    const rs = ROUND_STATUS_DISPLAY[round.status] || ROUND_STATUS_DISPLAY.PENDING;
                    return (
                      <div key={round.id} className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${rs.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700">
                            <span className="font-mono text-xs text-gray-400 mr-1.5" data-mono>R{round.roundNumber}</span>
                            {round.roundName}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400">{rs.label}</span>
                        {round.result && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            round.result === 'PASSED' ? 'bg-emerald-50 text-emerald-700' :
                            round.result === 'FAILED' ? 'bg-red-50 text-red-700' :
                            'bg-orange-50 text-orange-700'
                          }`}>
                            {round.result === 'PASSED' ? 'Cleared' : round.result === 'FAILED' ? 'Not Cleared' : 'On Hold'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
