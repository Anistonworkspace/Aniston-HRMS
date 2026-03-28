import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck, Calendar, Clock, User, Briefcase, Star, Loader2, X,
  Play, CheckCircle2, AlertCircle, Brain, Copy, Send, Sparkles, Eye,
} from 'lucide-react';
import { useGetMyInterviewsQuery, useSubmitMyScoreMutation } from '../walkIn/walkInApi';
import { useGetInterviewTasksQuery, useScoreRoundMutation, useGenerateRoundQuestionsMutation } from '../public-apply/publicApplyApi';
import { useAiChatMutation } from '../ai-assistant/aiAssistantApi';
import { useAppSelector } from '../../app/store';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const WALKIN_TAB_STATUSES: Record<string, string[]> = {
  upcoming: ['PENDING', 'SCHEDULED'],
  inProgress: ['IN_PROGRESS'],
  completed: ['COMPLETED'],
};

const PUBLIC_TAB_STATUSES: Record<string, string[]> = {
  upcoming: ['PENDING_ROUND'],
  inProgress: ['IN_PROGRESS_ROUND'],
  completed: ['COMPLETED_ROUND'],
};

export default function InterviewAssignmentsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'upcoming' | 'inProgress' | 'completed'>('upcoming');
  const [scoringRound, setScoringRound] = useState<any>(null);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const user = useAppSelector(s => s.auth.user);

  // Walk-in interviews (existing system)
  const { data: walkInRes, isLoading: loadingWalkIn } = useGetMyInterviewsQuery();
  // Public application interviews
  const { data: publicRes, isLoading: loadingPublic } = useGetInterviewTasksQuery();

  const walkInRounds = (walkInRes?.data || []).map((r: any) => ({ ...r, source: 'walkin' }));
  const publicRounds = (publicRes?.data || []).map((r: any) => ({
    ...r,
    source: 'public',
    // Normalize naming for display
    candidateName: r.application?.candidateName || 'Unknown',
    candidateUid: r.application?.candidateUid || '',
    applicationId: r.application?.id || r.applicationId,
    jobTitle: r.application?.jobOpening?.title || '',
    jobDepartment: r.application?.jobOpening?.department || '',
    aiScore: r.application?.totalAiScore,
    mcqScore: r.application?.mcqScore,
  }));

  // Merge and categorize
  const allRounds = [...walkInRounds, ...publicRounds];

  const getFiltered = (tabKey: string) => {
    return allRounds.filter((r: any) => {
      if (r.source === 'walkin') return WALKIN_TAB_STATUSES[tabKey].includes(r.status);
      return PUBLIC_TAB_STATUSES[tabKey].includes(r.status);
    });
  };

  const filtered = getFiltered(tab);
  const isLoading = loadingWalkIn || loadingPublic;

  const counts = {
    upcoming: getFiltered('upcoming').length,
    inProgress: getFiltered('inProgress').length,
    completed: getFiltered('completed').length,
  };

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCheck className="text-brand-600" size={28} /> My Interview Assignments
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Interviews assigned to you -- review candidates and submit scores</p>
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
            <div key={round.id}>
              {round.source === 'walkin' ? (
                <WalkInInterviewCard round={round} tab={tab} onScore={() => setScoringRound(round)} />
              ) : (
                <PublicInterviewCard
                  round={round}
                  tab={tab}
                  isActive={activePanel === round.id}
                  onTogglePanel={() => setActivePanel(activePanel === round.id ? null : round.id)}
                  onNavigate={() => navigate(`/recruitment/public-applications/${round.applicationId}`)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Score Modal for walk-in rounds */}
      <AnimatePresence>
        {scoringRound && (
          <ScoreModal round={scoringRound} onClose={() => setScoringRound(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// Walk-in interview card (uses existing walk-in scoring system)
function WalkInInterviewCard({ round, tab, onScore }: { round: any; tab: string; onScore: () => void }) {
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
      {/* Source badge */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Walk-In</span>
        <StatusBadge status={round.status} />
      </div>

      {/* Candidate Info */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{candidate?.fullName || 'Unknown'}</h3>
          <p className="text-xs text-gray-400">{candidate?.tokenNumber}</p>
          <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
            <Briefcase size={12} /> {candidate?.jobOpening?.title || 'No position'} {candidate?.jobOpening?.department && `\u00B7 ${candidate.jobOpening.department}`}
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
                <p className="text-lg font-bold text-gray-800" data-mono>{s.value || '\u2014'}</p>
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

// Public application interview card (uses public-apply scoring system)
function PublicInterviewCard({ round, tab, isActive, onTogglePanel, onNavigate }: {
  round: any; tab: string; isActive: boolean; onTogglePanel: () => void; onNavigate: () => void;
}) {
  const [scoreRound, { isLoading: isScoring }] = useScoreRoundMutation();
  const [aiChat, { isLoading: isChatting }] = useAiChatMutation();
  const [generateQuestions, { isLoading: isGeneratingRound }] = useGenerateRoundQuestionsMutation();
  const [aiResponse, setAiResponse] = useState('');
  const [scoreValue, setScoreValue] = useState(50);
  const [feedback, setFeedback] = useState('');
  const [scoreSubmitted, setScoreSubmitted] = useState(false);

  const handleGenerateQuestions = async () => {
    const prompt = `Generate 8 interview questions with expected answers for a candidate applying for ${round.jobTitle}. Include 3 behavioral, 3 technical, and 2 situational questions. Format as numbered list.`;
    try {
      const res = await aiChat({ message: prompt, context: 'hr-recruitment' }).unwrap();
      setAiResponse(res?.data?.response || res?.data?.message || JSON.stringify(res?.data));
    } catch {
      toast.error('AI assistant unavailable');
    }
  };

  const handleSubmitScore = async () => {
    try {
      await scoreRound({ roundId: round.id, score: scoreValue, feedback }).unwrap();
      setScoreSubmitted(true);
      toast.success('Score submitted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to score');
    }
  };

  const handleSaveAiQuestions = async () => {
    try {
      await generateQuestions(round.id).unwrap();
      toast.success('AI questions saved to round');
    } catch {
      toast.error('Failed to save');
    }
  };

  const getScoreLabel = (val: number) => {
    if (val <= 12) return { label: 'Poor', color: 'text-red-600' };
    if (val <= 37) return { label: 'Below Average', color: 'text-orange-600' };
    if (val <= 62) return { label: 'Average', color: 'text-amber-600' };
    if (val <= 87) return { label: 'Good', color: 'text-emerald-600' };
    return { label: 'Excellent', color: 'text-emerald-700' };
  };

  const currentLabel = getScoreLabel(scoreValue);

  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="layer-card overflow-hidden">
      <div className="p-5">
        {/* Source badge */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 flex items-center gap-1">
            <Sparkles size={10} /> AI Screened
          </span>
          <StatusBadge status={round.status} />
        </div>

        {/* Candidate Info */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">{round.candidateName}</h3>
            {round.candidateUid && <p className="text-xs text-gray-400 font-mono" data-mono>{round.candidateUid}</p>}
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
              <Briefcase size={12} /> {round.jobTitle || 'No position'} {round.jobDepartment && `\u00B7 ${round.jobDepartment}`}
            </p>
          </div>
          {round.aiScore != null && (
            <div className={cn('text-xs font-bold px-2 py-1 rounded flex items-center gap-1',
              Number(round.aiScore) >= 70 ? 'bg-emerald-50 text-emerald-600' :
              Number(round.aiScore) >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
            )}>
              <Star size={10} /> AI: {Number(round.aiScore).toFixed(0)}
            </div>
          )}
        </div>

        {/* Round Info */}
        <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Round Type</span>
            <span className="font-medium text-gray-800">{round.roundType}</span>
          </div>
          {round.scheduledAt && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 flex items-center gap-1"><Calendar size={12} /> Scheduled</span>
              <span className="font-medium text-gray-800">
                {new Date(round.scheduledAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          {round.score != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Score</span>
              <span className="font-bold text-brand-600" data-mono>{Number(round.score).toFixed(1)}/100</span>
            </div>
          )}
        </div>

        {round.feedback && (
          <p className="text-xs text-gray-500 italic bg-gray-50 rounded-lg p-2 mb-4">{round.feedback}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {tab === 'upcoming' && !scoreSubmitted && (
            <button onClick={onTogglePanel}
              className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
              <Play size={14} /> {isActive ? 'Hide Panel' : 'Take Interview'}
            </button>
          )}
          {tab === 'inProgress' && !scoreSubmitted && (
            <button onClick={onTogglePanel}
              className="btn-primary text-sm flex-1 flex items-center justify-center gap-2">
              <Star size={14} /> {isActive ? 'Hide Panel' : 'Score Interview'}
            </button>
          )}
          {tab === 'completed' && (
            <button onClick={onNavigate}
              className="btn-secondary text-sm flex-1 flex items-center justify-center gap-2">
              <Eye size={14} /> View Details
            </button>
          )}
        </div>
      </div>

      {/* Inline Interview Panel */}
      <AnimatePresence>
        {isActive && !scoreSubmitted && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="border-t-2 border-brand-200 bg-brand-50/30 overflow-hidden">
            <div className="p-5 space-y-4">
              {/* AI Questions */}
              <div>
                <h6 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Interview Questions</h6>
                <div className="flex gap-2 mb-2">
                  <button onClick={handleGenerateQuestions} disabled={isChatting}
                    className="btn-primary text-xs flex items-center gap-1.5 flex-1 justify-center disabled:opacity-50">
                    {isChatting ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                    {aiResponse ? 'Regenerate' : 'Generate Questions'}
                  </button>
                  {aiResponse && (
                    <>
                      <button onClick={() => { navigator.clipboard.writeText(aiResponse); toast.success('Copied'); }}
                        className="btn-secondary text-xs flex items-center gap-1.5">
                        <Copy size={12} /> Copy
                      </button>
                      <button onClick={handleSaveAiQuestions} disabled={isGeneratingRound}
                        className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                        {isGeneratingRound ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />} Save
                      </button>
                    </>
                  )}
                </div>
                {(isChatting || aiResponse) && (
                  <div className="bg-white rounded-xl p-3 max-h-40 overflow-y-auto border border-gray-100 text-xs">
                    {isChatting && !aiResponse ? (
                      <span className="text-gray-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Generating...</span>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-gray-700 leading-relaxed">{aiResponse}</pre>
                    )}
                  </div>
                )}
              </div>

              {/* AI-saved questions from round */}
              {round.aiQuestionsGenerated && Array.isArray(round.aiQuestionsGenerated) && round.aiQuestionsGenerated.length > 0 && (
                <details className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <summary className="text-xs text-brand-600 cursor-pointer hover:underline px-3 py-2 bg-gray-50">
                    View Saved Questions ({round.aiQuestionsGenerated.length})
                  </summary>
                  <ul className="px-3 py-2 space-y-1 text-xs text-gray-600 max-h-32 overflow-y-auto">
                    {round.aiQuestionsGenerated.map((q: any, i: number) => (
                      <li key={i} className="bg-gray-50 rounded-lg p-2">
                        <p className="font-medium">{i + 1}. {q.question}</p>
                        {q.suggestedAnswer && <p className="text-gray-400 mt-0.5">Expected: {q.suggestedAnswer}</p>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Score Input */}
              <div className="border-t border-gray-200 pt-4">
                <h6 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Submit Score</h6>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Score</span>
                  <span className={cn('text-sm font-bold', currentLabel.color)} data-mono>
                    {scoreValue}/100 - {currentLabel.label}
                  </span>
                </div>
                <input type="range" min={0} max={100} step={1} value={scoreValue}
                  onChange={e => setScoreValue(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-600 mb-2" />
                <div className="flex justify-between text-[10px] text-gray-400 mb-3">
                  <span>0 Poor</span><span>25</span><span>50 Avg</span><span>75</span><span>100 Excellent</span>
                </div>
                <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
                  className="input-glass w-full h-16 resize-none text-sm mb-3" placeholder="Interview feedback..." />
                <button onClick={handleSubmitScore} disabled={isScoring}
                  className="btn-primary text-sm flex items-center gap-2 w-full justify-center disabled:opacity-50">
                  {isScoring ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit Score
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Score Submitted confirmation */}
      {scoreSubmitted && (
        <div className="bg-emerald-50 border-t border-emerald-100 p-4 text-center">
          <CheckCircle2 size={20} className="text-emerald-500 mx-auto mb-1" />
          <p className="text-sm font-semibold text-emerald-800">Score submitted ({scoreValue}/100)</p>
        </div>
      )}
    </motion.div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; class: string }> = {
    PENDING: { label: 'Pending', class: 'bg-gray-100 text-gray-500' },
    PENDING_ROUND: { label: 'Pending', class: 'bg-gray-100 text-gray-500' },
    SCHEDULED: { label: 'Scheduled', class: 'bg-purple-50 text-purple-600' },
    IN_PROGRESS: { label: 'In Progress', class: 'bg-blue-50 text-blue-600' },
    IN_PROGRESS_ROUND: { label: 'In Progress', class: 'bg-blue-50 text-blue-600' },
    COMPLETED: { label: 'Completed', class: 'bg-emerald-50 text-emerald-600' },
    COMPLETED_ROUND: { label: 'Completed', class: 'bg-emerald-50 text-emerald-600' },
  };
  const badge = map[status] || { label: status.replace(/_/g, ' '), class: 'bg-gray-100 text-gray-500' };
  return (
    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', badge.class)}>
      {badge.label}
    </span>
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
            <p className="text-sm text-gray-400">{round.walkIn?.fullName} -- R{round.roundNumber}: {round.roundName}</p>
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
                  placeholder="\u2014"
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
