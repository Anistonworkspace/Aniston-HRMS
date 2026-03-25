import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck, Calendar, Clock, User, Briefcase, Star, Loader2, X,
  Play, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useGetMyInterviewsQuery, useSubmitMyScoreMutation } from '../walkIn/walkInApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const TAB_STATUSES: Record<string, string[]> = {
  upcoming: ['PENDING', 'SCHEDULED'],
  inProgress: ['IN_PROGRESS'],
  completed: ['COMPLETED'],
};

export default function InterviewAssignmentsPage() {
  const [tab, setTab] = useState<'upcoming' | 'inProgress' | 'completed'>('upcoming');
  const [scoringRound, setScoringRound] = useState<any>(null);
  const { data: res, isLoading } = useGetMyInterviewsQuery();

  const allRounds = res?.data || [];
  const filtered = allRounds.filter((r: any) => TAB_STATUSES[tab].includes(r.status));

  const counts = {
    upcoming: allRounds.filter((r: any) => TAB_STATUSES.upcoming.includes(r.status)).length,
    inProgress: allRounds.filter((r: any) => TAB_STATUSES.inProgress.includes(r.status)).length,
    completed: allRounds.filter((r: any) => TAB_STATUSES.completed.includes(r.status)).length,
  };

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCheck className="text-brand-600" size={28} /> My Interview Assignments
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Interviews assigned to you — review candidates and submit scores</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {([
          { key: 'upcoming', label: 'Upcoming', icon: Calendar },
          { key: 'inProgress', label: 'In Progress', icon: Play },
          { key: 'completed', label: 'Completed', icon: CheckCircle2 },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            )}>
            <t.icon size={16} />
            {t.label}
            {counts[t.key] > 0 && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                tab === t.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
              )}>{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 layer-card">
          <ClipboardCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No {tab === 'upcoming' ? 'upcoming' : tab === 'inProgress' ? 'in-progress' : 'completed'} interviews</p>
          <p className="text-gray-400 text-sm mt-1">
            {tab === 'upcoming' ? 'Interviews assigned to you will appear here' : 'No interviews in this category'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((round: any) => (
            <InterviewCard key={round.id} round={round} tab={tab} onScore={() => setScoringRound(round)} />
          ))}
        </div>
      )}

      {/* Score Modal */}
      <AnimatePresence>
        {scoringRound && (
          <ScoreModal round={scoringRound} onClose={() => setScoringRound(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function InterviewCard({ round, tab, onScore }: { round: any; tab: string; onScore: () => void }) {
  const candidate = round.walkIn;
  const [submitScore] = useSubmitMyScoreMutation();

  const handleStart = async () => {
    try {
      await submitScore({ roundId: round.id, data: { status: 'IN_PROGRESS' } }).unwrap();
      toast.success('Interview started');
    } catch { toast.error('Failed to start'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="layer-card p-5">
      {/* Candidate Info */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{candidate?.fullName || 'Unknown'}</h3>
          <p className="text-xs text-gray-400">{candidate?.tokenNumber}</p>
          <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
            <Briefcase size={12} /> {candidate?.jobOpening?.title || 'No position'} {candidate?.jobOpening?.department && `· ${candidate.jobOpening.department}`}
          </p>
        </div>
        {candidate?.aiScore && (
          <div className={cn('text-xs font-bold px-2 py-1 rounded flex items-center gap-1',
            Number(candidate.aiScore) >= 70 ? 'bg-emerald-50 text-emerald-600' :
            Number(candidate.aiScore) >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
          )}>
            <Star size={10} /> AI: {Number(candidate.aiScore).toFixed(0)}
          </div>
        )}
      </div>

      {/* Round Info */}
      <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Round</span>
          <span className="font-medium text-gray-800">R{round.roundNumber}: {round.roundName}</span>
        </div>
        {round.scheduledAt && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 flex items-center gap-1"><Calendar size={12} /> Scheduled</span>
            <span className="font-medium text-gray-800">
              {new Date(round.scheduledAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Status</span>
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
            round.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-600' :
            round.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-600' :
            round.status === 'SCHEDULED' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-500'
          )}>
            {round.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Completed Scores */}
      {round.status === 'COMPLETED' && round.overallScore && (
        <div className="bg-emerald-50 rounded-xl p-3 mb-4">
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            {[
              { label: 'Comm', value: round.communication },
              { label: 'Tech', value: round.technical },
              { label: 'Problem', value: round.problemSolving },
              { label: 'Culture', value: round.culturalFit },
              { label: 'Overall', value: round.overallScore },
            ].map(s => (
              <div key={s.label}>
                <p className="text-lg font-bold text-gray-800" data-mono>{s.value || '—'}</p>
                <p className="text-gray-500">{s.label}</p>
              </div>
            ))}
          </div>
          {round.result && (
            <div className={cn('text-center mt-2 text-xs font-bold',
              round.result === 'PASSED' ? 'text-emerald-600' : round.result === 'FAILED' ? 'text-red-600' : 'text-orange-600'
            )}>
              Result: {round.result}
            </div>
          )}
          {round.remarks && <p className="text-xs text-gray-500 mt-2 italic">{round.remarks}</p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {tab === 'upcoming' && (
          <button onClick={handleStart} className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
            <Play size={14} /> Start Interview
          </button>
        )}
        {tab === 'inProgress' && (
          <button onClick={onScore} className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
            <Star size={14} /> Submit Scores
          </button>
        )}
        {tab === 'completed' && round.overallScore && (
          <button onClick={onScore} className="btn-secondary text-sm flex-1 flex items-center justify-center gap-2">
            <Star size={14} /> Edit Scores
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ScoreModal({ round, onClose }: { round: any; onClose: () => void }) {
  const [submitScore, { isLoading }] = useSubmitMyScoreMutation();
  const [form, setForm] = useState({
    communication: round.communication || '',
    technical: round.technical || '',
    problemSolving: round.problemSolving || '',
    culturalFit: round.culturalFit || '',
    overallScore: round.overallScore || '',
    remarks: round.remarks || '',
    result: round.result || '',
  });

  const handleSubmit = async () => {
    if (!form.result) { toast.error('Please select a result (Passed/Failed/On Hold)'); return; }
    const data: any = { status: 'COMPLETED', result: form.result, remarks: form.remarks || undefined };
    if (form.communication) data.communication = Number(form.communication);
    if (form.technical) data.technical = Number(form.technical);
    if (form.problemSolving) data.problemSolving = Number(form.problemSolving);
    if (form.culturalFit) data.culturalFit = Number(form.culturalFit);
    if (form.overallScore) data.overallScore = Number(form.overallScore);
    try {
      await submitScore({ roundId: round.id, data }).unwrap();
      toast.success('Scores submitted!');
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to submit'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-display font-semibold text-gray-800">Score Interview</h3>
            <p className="text-sm text-gray-400">{round.walkIn?.fullName} — R{round.roundNumber}: {round.roundName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          {/* Score Inputs */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { key: 'communication', label: 'Communication' },
              { key: 'technical', label: 'Technical' },
              { key: 'problemSolving', label: 'Problem Solving' },
              { key: 'culturalFit', label: 'Cultural Fit' },
              { key: 'overallScore', label: 'Overall' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10px] text-gray-500 mb-1 text-center">{f.label}</label>
                <input type="number" min={1} max={10}
                  value={(form as any)[f.key]}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  className="input-glass w-full text-center text-lg font-bold"
                  placeholder="—"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center">Rate each metric from 1 (lowest) to 10 (highest)</p>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Remarks / Feedback</label>
            <textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
              className="input-glass w-full h-20 resize-none text-sm" placeholder="Interview feedback..." />
          </div>

          {/* Result */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">Result *</label>
            <div className="flex gap-2">
              {[
                { value: 'PASSED', label: 'Passed', color: 'bg-emerald-600 hover:bg-emerald-700', active: 'ring-2 ring-emerald-300' },
                { value: 'FAILED', label: 'Failed', color: 'bg-red-600 hover:bg-red-700', active: 'ring-2 ring-red-300' },
                { value: 'ON_HOLD', label: 'On Hold', color: 'bg-orange-500 hover:bg-orange-600', active: 'ring-2 ring-orange-300' },
              ].map(r => (
                <button key={r.value} type="button"
                  onClick={() => setForm({ ...form, result: r.value })}
                  className={cn(
                    'flex-1 py-2 rounded-lg text-sm font-medium text-white transition-all',
                    r.color,
                    form.result === r.value ? r.active : 'opacity-50'
                  )}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button onClick={handleSubmit} disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              Submit Scores
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
