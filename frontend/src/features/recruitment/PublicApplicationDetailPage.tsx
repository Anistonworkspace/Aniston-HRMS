import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, User, Mail, Phone, FileText, Star, Calendar, Briefcase,
  Loader2, Download, Plus, CheckCircle2, XCircle, PauseCircle, X,
  Eye, EyeOff, Copy, Save, MessageSquare, ChevronDown, ChevronUp, Send, Sparkles,
  UserPlus, AlertTriangle, BookOpen, Tag, Target, Shield, Search,
} from 'lucide-react';
import {
  useGetPublicApplicationDetailQuery,
  useFinalizeCandidateMutation,
  useScheduleInterviewMutation,
  useScoreRoundMutation,
  useGenerateRoundQuestionsMutation,
} from '../public-apply/publicApplyApi';
import { useCreateInvitationMutation } from '../invitation/invitationApi';
import { useGetDepartmentsQuery, useGetDesignationsQuery } from '../employee/employeeDepsApi';
import { useGetInterviewersQuery } from '../walkIn/walkInApi';
import { useAiChatMutation } from '../ai-assistant/aiAssistantApi';
import { useAppSelector } from '../../app/store';
import { formatDate, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';

const HR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

const STATUS_BADGE: Record<string, { label: string; class: string }> = {
  SUBMITTED: { label: 'Submitted', class: 'badge-info' },
  SHORTLISTED: { label: 'Shortlisted', class: 'badge-info' },
  INTERVIEW_SCHEDULED: { label: 'Interview Scheduled', class: 'badge-warning' },
  SELECTED: { label: 'Selected', class: 'badge-success' },
  REJECTED: { label: 'Rejected', class: 'badge-danger' },
  ON_HOLD: { label: 'On Hold', class: 'badge-warning' },
};

const ROUND_STATUS_BADGE: Record<string, { label: string; class: string }> = {
  PENDING_ROUND: { label: 'Pending', class: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS_ROUND: { label: 'In Progress', class: 'bg-blue-50 text-blue-600' },
  COMPLETED_ROUND: { label: 'Completed', class: 'bg-emerald-50 text-emerald-600' },
};

const PROMPT_SUGGESTIONS = [
  'Generate 8 HR behavioral questions for this candidate',
  'Generate technical questions based on their resume skills',
  'What are red flags I should probe in this interview?',
];

/* ─── Score Ring SVG Component ─── */
function ScoreRing({ score, label, color, size = 72 }: { score: number | null; label: string; color: string; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeScore = score ?? 0;
  const offset = circumference - (safeScore / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className="text-lg font-bold" data-mono style={{ color }}>{score != null ? score.toFixed(0) : '\u2014'}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function scoreRingColor(s: number | null | undefined): string {
  if (s == null) return '#d1d5db';
  if (s >= 70) return '#059669';
  if (s >= 40) return '#d97706';
  return '#ef4444';
}

export default function PublicApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAppSelector(s => s.auth.user);
  const isHR = user?.role ? HR_ROLES.includes(user.role) : false;

  const { data, isLoading, refetch } = useGetPublicApplicationDetailQuery(id!, { pollingInterval: 30_000 });
  const [finalizeCandidate, { isLoading: isFinalizing }] = useFinalizeCandidateMutation();
  const [scheduleInterview, { isLoading: isScheduling }] = useScheduleInterviewMutation();
  const [scoreRound, { isLoading: isScoring }] = useScoreRoundMutation();
  const [generateQuestions, { isLoading: isGenerating }] = useGenerateRoundQuestionsMutation();

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showScoreModal, setShowScoreModal] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string>('');
  const [showResumeViewer, setShowResumeViewer] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const app = data?.data;

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>;
  }

  if (!app) {
    return <div className="page-container text-center py-16"><p className="text-gray-500">Application not found</p></div>;
  }

  const badge = STATUS_BADGE[app.status] || { label: app.status, class: 'badge-neutral' };

  /* Resume URL resolution */
  const resolvedResumeUrl = app.resumeUrl ? getUploadUrl(app.resumeUrl) : null;
  const resumeIsPdf = resolvedResumeUrl?.toLowerCase().endsWith('.pdf') ?? false;

  const handleFinalize = async (status: string) => {
    if (!confirm(`Are you sure you want to mark this candidate as ${status}?`)) return;
    try {
      await finalizeCandidate({ applicationId: id!, finalStatus: status }).unwrap();
      toast.success(`Candidate marked as ${status}`);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Finalization failed');
    }
  };

  const handleGenerateQuestions = async (roundId: string) => {
    try {
      await generateQuestions(roundId).unwrap();
      toast.success('AI questions generated for this round');
      refetch();
    } catch {
      toast.error('Failed to generate questions');
    }
  };

  /* Score data extraction — BUG-3 FIX: use resumeMatchScore directly from model */
  const resumeScore = app.resumeMatchScore != null
    ? Number(app.resumeMatchScore)
    : typeof app.resumeScoreData === 'object' && app.resumeScoreData?.matchScore != null
    ? Number(app.resumeScoreData.matchScore) : null;
  const mcqScore = app.mcqScore != null ? Number(app.mcqScore) : null;
  const intelligenceScore = app.intelligenceScore != null ? Number(app.intelligenceScore) : null;
  const integrityScore = app.integrityScore != null ? Number(app.integrityScore) : null;
  const energyScore = app.energyScore != null ? Number(app.energyScore) : null;
  const totalAiScore = app.totalAiScore != null ? Number(app.totalAiScore) : null;

  /* Determine if user is an assigned interviewer for an active round */
  const activeRoundForUser = app.interviewRounds?.find(
    (r: any) => r.conductedBy === user?.id && ['PENDING_ROUND', 'IN_PROGRESS_ROUND'].includes(r.status)
  );

  return (
    <div className="page-container max-w-5xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Header Card */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="layer-card p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center">
            <span className="text-xl font-bold text-brand-600">
              {app.candidateName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
            </span>
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-display font-bold text-gray-900">{app.candidateName}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 mt-1">
              {app.email && <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {app.email}</span>}
              {app.mobileNumber && <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {app.mobileNumber}</span>}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`badge ${badge.class}`}>{badge.label}</span>
              <span className="text-xs font-mono text-brand-600 bg-brand-50 px-2 py-0.5 rounded" data-mono>{app.candidateUid}</span>
              {app.jobOpening && (
                <span className="text-xs text-gray-400">
                  <Briefcase className="w-3 h-3 inline mr-1" />{app.jobOpening.title} — {app.jobOpening.department}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            {totalAiScore != null && (
              <div className="flex items-center gap-1 text-amber-600">
                <Star className="w-5 h-5 fill-amber-400" />
                <span className="text-2xl font-display font-bold" data-mono>{totalAiScore.toFixed(1)}</span>
              </div>
            )}
            {app.finalScore != null && (
              <p className="text-xs text-gray-400 mt-1">Final: <span className="font-bold" data-mono>{Number(app.finalScore).toFixed(1)}</span></p>
            )}
          </div>
        </div>
      </motion.div>

      {/* AI Score Donut Chart */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="layer-card p-6 mb-6">
        <h3 className="font-display font-bold text-gray-900 mb-5">AI Score Breakdown</h3>
        <div className="flex flex-col items-center gap-6">
          {/* Central large donut for total AI score */}
          <div className="relative">
            <svg width={140} height={140} className="transform -rotate-90">
              <circle cx={70} cy={70} r={60} fill="none" stroke="#f3f4f6" strokeWidth="10" />
              <circle cx={70} cy={70} r={60} fill="none" stroke={scoreRingColor(totalAiScore)} strokeWidth="10"
                strokeDasharray={2 * Math.PI * 60} strokeDashoffset={2 * Math.PI * 60 - ((totalAiScore ?? 0) / 100) * 2 * Math.PI * 60}
                strokeLinecap="round" className="transition-all duration-1000" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-display font-bold text-gray-900" data-mono>{totalAiScore != null ? totalAiScore.toFixed(0) : '\u2014'}</span>
              <span className="text-xs text-gray-400">Total AI</span>
            </div>
          </div>

          {/* Individual score rings */}
          <div className="flex flex-wrap justify-center gap-6">
            <ScoreRing score={resumeScore} label="Resume" color={scoreRingColor(resumeScore)} />
            <ScoreRing score={mcqScore} label="MCQ" color={scoreRingColor(mcqScore)} />
            <ScoreRing score={intelligenceScore} label="Intelligence" color={scoreRingColor(intelligenceScore)} />
            <ScoreRing score={integrityScore} label="Integrity" color={scoreRingColor(integrityScore)} />
            <ScoreRing score={energyScore} label="Energy" color={scoreRingColor(energyScore)} />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-100 w-full">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> 70+ Excellent</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 40-69 Average</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Below 40 Low</span>
          </div>
        </div>
      </motion.div>

      {/* ── Fallback Question Warning ── */}
      {app.usedFallbackQuestions && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Generic MCQ Questions Used</p>
            <p className="text-xs text-amber-700 mt-0.5">
              AI question generation was unavailable when this candidate applied. They were scored on generic behavioural questions from the fallback bank — not job-specific AI questions. MCQ scores reflect general aptitude only.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Resume & ATS Panel ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="layer-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-brand-600" /> Resume
          </h3>
          <div className="flex items-center gap-2">
            {/* ATS Score Badge */}
            {app.atsScore != null && (
              <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
                Number(app.atsScore) >= 70 ? 'bg-emerald-50 text-emerald-700' :
                Number(app.atsScore) >= 45 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
              }`}>
                <Shield size={12} /> ATS {Number(app.atsScore).toFixed(0)}
              </span>
            )}
            {resolvedResumeUrl && (
              <>
                <button onClick={() => setShowResumeViewer(!showResumeViewer)}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors">
                  {showResumeViewer ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showResumeViewer ? 'Hide Preview' : 'Preview'}
                </button>
                <a href={resolvedResumeUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-600 transition-colors">
                  <Download size={14} /> Download
                </a>
              </>
            )}
          </div>
        </div>

        {resolvedResumeUrl ? (
          <AnimatePresence>
            {showResumeViewer && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
                {resumeIsPdf ? (
                  <iframe
                    src={resolvedResumeUrl}
                    className="w-full h-96 rounded-lg border border-gray-200"
                    title="Resume viewer"
                    sandbox="allow-same-origin allow-scripts"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-lg border border-gray-200 bg-gray-50">
                    <FileText className="w-10 h-10 text-gray-300" />
                    <p className="text-sm text-gray-500">Preview not available for this file type.</p>
                    <a href={resolvedResumeUrl} target="_blank" rel="noopener noreferrer"
                      className="btn-primary text-sm flex items-center gap-1.5 px-4 py-2">
                      <Download size={14} /> Download to View
                    </a>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <FileText className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">No resume uploaded</p>
          </div>
        )}

        {/* ATS Score Breakdown */}
        {app.atsScoreData && (
          <div className="mt-3 border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Shield size={13} className="text-brand-500" /> ATS Compatibility Breakdown
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {[
                { label: 'Sections', val: app.atsScoreData.breakdown?.sections, max: 25 },
                { label: 'Keywords', val: app.atsScoreData.breakdown?.keywords, max: 35 },
                { label: 'Contact', val: app.atsScoreData.breakdown?.contact, max: 15 },
                { label: 'Quantified', val: app.atsScoreData.breakdown?.quantification, max: 15 },
                { label: 'Parse Quality', val: app.atsScoreData.breakdown?.parseQuality, max: 10 },
              ].map(({ label, val, max }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                  <div className="text-xs font-bold text-gray-800" data-mono>{val ?? '—'}<span className="font-normal text-gray-400">/{max}</span></div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
                  <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${val != null ? (val / max) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {/* Sections found / missing */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {app.atsScoreData.sectionsFound?.length > 0 && (
                <div>
                  <p className="text-emerald-700 font-semibold mb-1">Sections Detected</p>
                  <div className="flex flex-wrap gap-1">
                    {app.atsScoreData.sectionsFound.map((s: string) => (
                      <span key={s} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px]">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {app.atsScoreData.sectionsMissing?.length > 0 && (
                <div>
                  <p className="text-red-600 font-semibold mb-1">Sections Missing</p>
                  <div className="flex flex-wrap gap-1">
                    {app.atsScoreData.sectionsMissing.map((s: string) => (
                      <span key={s} className="px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px]">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Application Details */}
      <div className="layer-card p-5 mb-6">
        <h3 className="font-display font-bold text-gray-900 mb-3">Application Details</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-400">Applied:</span> <span className="text-gray-700">{formatDate(app.createdAt)}</span></div>
          <div><span className="text-gray-400">Status:</span> <span className={`badge ${badge.class}`}>{badge.label}</span></div>
          {app.finalStatus && <div><span className="text-gray-400">Final Status:</span> <span className="text-gray-700 font-semibold">{app.finalStatus}</span></div>}
          {app.finalizedAt && <div><span className="text-gray-400">Finalized At:</span> <span className="text-gray-700">{formatDate(app.finalizedAt)}</span></div>}
        </div>
      </div>

      {/* Interview Rounds */}
      <div className="layer-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-gray-900">Interview Rounds</h3>
          {isHR && (
            <button onClick={() => setShowScheduleModal(true)} className="btn-primary text-sm flex items-center gap-1.5">
              <Plus size={14} /> Add Interview Round
            </button>
          )}
        </div>

        {app.interviewRounds?.length > 0 ? (
          <div className="space-y-3">
            {app.interviewRounds.map((round: any) => {
              const roundBadge = ROUND_STATUS_BADGE[round.status] || { label: round.status, class: 'bg-gray-100 text-gray-600' };
              return (
                <div key={round.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-900">{round.roundType} Round</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${roundBadge.class}`}>{roundBadge.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {round.score != null && (
                        <span className="text-lg font-bold text-brand-600" data-mono>{Number(round.score).toFixed(1)}/10</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    {round.scheduledAt && <div>Scheduled: {formatDate(round.scheduledAt)}</div>}
                    {round.completedAt && <div>Completed: {formatDate(round.completedAt)}</div>}
                  </div>
                  {round.feedback && (
                    <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg p-2">{round.feedback}</p>
                  )}
                  {round.aiQuestionsGenerated && (
                    <details className="mt-2">
                      <summary className="text-xs text-brand-600 cursor-pointer hover:underline">View AI-Generated Questions</summary>
                      <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        {(Array.isArray(round.aiQuestionsGenerated) ? round.aiQuestionsGenerated : []).map((q: any, i: number) => (
                          <li key={i} className="bg-gray-50 rounded-lg p-2">
                            <p className="font-medium">{i + 1}. {q.question}</p>
                            {q.suggestedAnswer && <p className="text-gray-400 mt-0.5">Suggested: {q.suggestedAnswer}</p>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {/* HR actions per round */}
                  {isHR && ['PENDING_ROUND', 'IN_PROGRESS_ROUND'].includes(round.status) && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleGenerateQuestions(round.id)} disabled={isGenerating}
                        className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />} Generate AI Questions
                      </button>
                      <button onClick={() => setShowScoreModal(round.id)}
                        className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Score Round
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">No interview rounds scheduled yet</p>
        )}
      </div>

      {/* AI Interview Assistant Panel — visible only to assigned interviewer for active round */}
      {activeRoundForUser && (
        <AiInterviewAssistantPanel
          round={activeRoundForUser}
          candidateName={app.candidateName}
          jobTitle={app.jobOpening?.title || ''}
          onQuestionsGenerated={() => refetch()}
        />
      )}

      {/* HR Controls: Finalize */}
      {isHR && !app.finalizedAt && (
        <div className="layer-card p-5 mb-6">
          <h3 className="font-display font-bold text-gray-900 mb-4">Finalize Candidate</h3>
          <p className="text-sm text-gray-500 mb-4">Set the final decision for this candidate. This will compute the weighted score from all interview rounds.</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleFinalize('SELECTED')} disabled={isFinalizing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50">
              {isFinalizing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Select
            </button>
            <button onClick={() => handleFinalize('REJECTED')} disabled={isFinalizing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50">
              {isFinalizing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Reject
            </button>
            <button onClick={() => handleFinalize('ON_HOLD')} disabled={isFinalizing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors disabled:opacity-50">
              {isFinalizing ? <Loader2 size={16} className="animate-spin" /> : <PauseCircle size={16} />} On Hold
            </button>
          </div>
        </div>
      )}

      {/* ── Resume Intelligence Panel (G1 + G2 + G4 + G6) ── */}
      {(app.resumeScoreData || (app.matchedKeywords?.length > 0) || app.resumeText) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="layer-card p-5 mb-6">
          <h3 className="font-display font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-brand-600" /> Resume Intelligence
          </h3>

          {/* Parse method + summary */}
          {app.resumeScoreData?.parseMethod && (
            <p className="text-xs text-gray-400 mb-2">
              Extracted via: <span className="font-medium text-gray-600">
                {app.resumeScoreData.parseMethod === 'ai-ocr' ? 'AI OCR Service' : app.resumeScoreData.parseMethod === 'pdf-parse' ? 'PDF Text Extraction' : 'N/A'}
              </span>
            </p>
          )}
          {app.resumeScoreData?.summary && (
            <p className="text-sm text-gray-600 mb-4 bg-brand-50/60 rounded-xl p-3 italic border border-brand-100">
              {app.resumeScoreData.summary}
            </p>
          )}

          {/* Strengths + Gaps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            {Array.isArray(app.resumeScoreData?.strengths) && app.resumeScoreData.strengths.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
                  <CheckCircle2 size={13} /> Strengths ({app.resumeScoreData.strengths.length})
                </p>
                <ul className="space-y-1.5">
                  {app.resumeScoreData.strengths.map((s: string, i: number) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2 bg-emerald-50/60 rounded-lg px-2.5 py-1.5">
                      <span className="text-emerald-500 shrink-0 mt-0.5">✓</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(app.resumeScoreData?.gaps) && app.resumeScoreData.gaps.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1.5">
                  <XCircle size={13} /> Gaps / Missing ({app.resumeScoreData.gaps.length})
                </p>
                <ul className="space-y-1.5">
                  {app.resumeScoreData.gaps.map((g: string, i: number) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2 bg-red-50/60 rounded-lg px-2.5 py-1.5">
                      <span className="text-red-400 shrink-0 mt-0.5">✗</span> {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Keyword Match Chips (G2 + G4) */}
          {((app.matchedKeywords?.length > 0) || (app.missingKeywords?.length > 0)) && (
            <div className="border-t border-gray-100 pt-4 mb-4">
              <p className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Tag size={13} className="text-brand-500" /> JD Keyword Match
              </p>
              <div className="space-y-3">
                {app.matchedKeywords?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-emerald-600 font-semibold mb-1.5">
                      ✓ FOUND in resume ({app.matchedKeywords.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {app.matchedKeywords.map((kw: string) => (
                        <span key={kw} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-medium">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {app.missingKeywords?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-red-500 font-semibold mb-1.5">
                      ✗ MISSING from resume ({app.missingKeywords.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {app.missingKeywords.map((kw: string) => (
                        <span key={kw} className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full text-[10px] font-medium">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Extracted Resume Text (G6) — collapsible */}
          {app.resumeText && (
            <div className="border-t border-gray-100 pt-4">
              <details>
                <summary className="text-xs font-semibold text-gray-600 cursor-pointer hover:text-brand-600 flex items-center gap-1.5 select-none">
                  <BookOpen size={13} /> View Extracted Resume Text
                </summary>
                <div className="mt-3 bg-gray-50 rounded-xl p-4 max-h-64 overflow-y-auto border border-gray-200">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">{app.resumeText}</pre>
                </div>
              </details>
            </div>
          )}
        </motion.div>
      )}

      {/* Already finalized */}
      {app.finalizedAt && (
        <div className="layer-card p-5 mb-6 border-l-4 border-brand-500">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display font-bold text-gray-900 mb-2">Finalized</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-400">Decision:</span> <span className="font-semibold text-gray-800">{app.finalStatus}</span></div>
                <div><span className="text-gray-400">Final Score:</span> <span className="font-bold text-brand-600" data-mono>{app.finalScore != null ? Number(app.finalScore).toFixed(1) : '\u2014'}</span></div>
                <div><span className="text-gray-400">Finalized At:</span> <span className="text-gray-700">{formatDate(app.finalizedAt)}</span></div>
              </div>
            </div>
            {/* Send Onboarding Invitation button — opens the same invitation form as Manage Employees */}
            {isHR && app.finalStatus === 'SELECTED' && app.email && (
              <button onClick={() => setShowInviteModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors shrink-0">
                <UserPlus size={16} />
                Send Onboarding Invite
              </button>
            )}
          </div>
          {isHR && app.finalStatus === 'SELECTED' && app.email && (
            <p className="text-xs text-gray-400 mt-3">
              Click "Send Onboarding Invite" to open the invitation form (same as Manage Employees). Set the department, role, and joining date before sending. The candidate will receive an invite link to complete their profile and create their employee account.
            </p>
          )}
        </div>
      )}

      {/* Candidate Onboarding Invitation Modal */}
      {showInviteModal && app && (
        <CandidateInviteModal
          open={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          candidateEmail={app.email || ''}
          candidateName={app.candidateName || ''}
        />
      )}

      {/* Schedule Interview Modal */}
      {showScheduleModal && (
        <ScheduleInterviewModal
          applicationId={id!}
          onClose={() => setShowScheduleModal(false)}
          onSuccess={() => { setShowScheduleModal(false); refetch(); }}
        />
      )}

      {/* Score Round Modal */}
      {showScoreModal && (
        <ScoreRoundModal
          roundId={showScoreModal}
          onClose={() => setShowScoreModal(null)}
          onSuccess={() => { setShowScoreModal(null); refetch(); }}
        />
      )}
    </div>
  );
}

/* ─── AI Interview Assistant Panel ─── */
function AiInterviewAssistantPanel({ round, candidateName, jobTitle, onQuestionsGenerated }: {
  round: any;
  candidateName: string;
  jobTitle: string;
  onQuestionsGenerated: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [customPrompt, setCustomPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiChat, { isLoading: isChatting }] = useAiChatMutation();
  const [generateQuestions, { isLoading: isSaving }] = useGenerateRoundQuestionsMutation();
  const responseRef = useRef<HTMLDivElement>(null);

  const handleSendPrompt = async (prompt: string) => {
    const contextMessage = `Candidate: ${candidateName}. Position: ${jobTitle}. Round: ${round.roundType}. ${prompt}`;
    try {
      const res = await aiChat({ message: contextMessage, context: 'hr-recruitment' }).unwrap();
      const text = res?.data?.response || res?.data?.message || JSON.stringify(res?.data);
      setAiResponse(text);
      setTimeout(() => responseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } catch {
      toast.error('AI assistant is unavailable');
    }
  };

  const handleCopyAll = () => {
    if (aiResponse) {
      navigator.clipboard.writeText(aiResponse);
      toast.success('Copied to clipboard');
    }
  };

  const handleSaveToRound = async () => {
    try {
      await generateQuestions(round.id).unwrap();
      toast.success('Questions saved to this round');
      onQuestionsGenerated();
    } catch {
      toast.error('Failed to save questions');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="layer-card mb-6 overflow-hidden">
      {/* Header */}
      <button onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-left">
            <h3 className="font-display font-bold text-gray-900 text-sm">AI Interview Assistant</h3>
            <p className="text-xs text-gray-400">{round.roundType} Round — You are the assigned interviewer</p>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-4">
              {/* Prompt suggestions */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Quick prompts:</p>
                <div className="flex flex-wrap gap-2">
                  {PROMPT_SUGGESTIONS.map((prompt, idx) => (
                    <button key={idx} onClick={() => handleSendPrompt(prompt)} disabled={isChatting}
                      className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors disabled:opacity-50">
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom input */}
              <div className="flex gap-2">
                <input type="text" value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customPrompt.trim()) { handleSendPrompt(customPrompt.trim()); setCustomPrompt(''); } }}
                  placeholder="Type a custom question for the AI..."
                  className="input-glass flex-1 text-sm" />
                <button onClick={() => { if (customPrompt.trim()) { handleSendPrompt(customPrompt.trim()); setCustomPrompt(''); } }}
                  disabled={isChatting || !customPrompt.trim()}
                  className="btn-primary px-3 flex items-center gap-1.5 text-sm disabled:opacity-50">
                  {isChatting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Ask
                </button>
              </div>

              {/* AI Response */}
              {(isChatting || aiResponse) && (
                <div ref={responseRef} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  {isChatting && !aiResponse ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 size={14} className="animate-spin" /> AI is thinking...
                    </div>
                  ) : (
                    <>
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{aiResponse}</pre>
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
                        <button onClick={handleCopyAll}
                          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 transition-colors">
                          <Copy size={12} /> Copy all questions
                        </button>
                        <button onClick={handleSaveToRound} disabled={isSaving}
                          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-600 border border-brand-200 transition-colors disabled:opacity-50">
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save questions to this round
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Schedule Interview Modal ─── */
function ScheduleInterviewModal({ applicationId, onClose, onSuccess }: {
  applicationId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [scheduleInterview, { isLoading }] = useScheduleInterviewMutation();
  const { data: interviewersData, isLoading: loadingInterviewers } = useGetInterviewersQuery();
  const interviewers: any[] = interviewersData?.data || [];

  const [form, setForm] = useState({
    interviewerId: '',
    interviewerName: '',
    scheduledAt: '',
    location: '',
    roundType: 'HR' as 'HR' | 'MANAGER' | 'SUPERADMIN',
  });
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = interviewers.filter(iv => {
    const name = `${iv.employee?.firstName || ''} ${iv.employee?.lastName || ''}`.trim() || iv.email;
    return name.toLowerCase().includes(search.toLowerCase()) || iv.email.toLowerCase().includes(search.toLowerCase());
  });

  const selectInterviewer = (iv: any) => {
    const name = `${iv.employee?.firstName || ''} ${iv.employee?.lastName || ''}`.trim() || iv.email;
    setForm(f => ({ ...f, interviewerId: iv.id, interviewerName: name }));
    setSearch(name);
    setShowDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.scheduledAt || !form.roundType) {
      toast.error('Please fill in required fields');
      return;
    }
    try {
      await scheduleInterview({ applicationId, data: form }).unwrap();
      toast.success('Interview round scheduled');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to schedule');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">Schedule Interview Round</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Round Type *</label>
            <select value={form.roundType} onChange={e => setForm({ ...form, roundType: e.target.value as any })} className="input-glass w-full">
              <option value="HR">HR Round</option>
              <option value="MANAGER">Manager Round</option>
              <option value="SUPERADMIN">Super Admin Round</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Scheduled At *</label>
            <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} className="input-glass w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Location</label>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="input-glass w-full" placeholder="e.g. Conference Room A" />
          </div>

          {/* Interviewer — searchable employee dropdown */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Assign Interviewer
              {form.interviewerId && <span className="ml-2 text-xs text-emerald-600 font-normal">✓ Selected</span>}
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setShowDropdown(true); if (!e.target.value) setForm(f => ({ ...f, interviewerId: '', interviewerName: '' })); }}
                onFocus={() => setShowDropdown(true)}
                className="input-glass w-full pl-8"
                placeholder={loadingInterviewers ? 'Loading employees…' : 'Search employee by name or email…'}
              />
            </div>
            {showDropdown && search.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-xs text-gray-400 px-3 py-2">No employees found</p>
                ) : (
                  filtered.map(iv => {
                    const fullName = `${iv.employee?.firstName || ''} ${iv.employee?.lastName || ''}`.trim() || '—';
                    return (
                      <button key={iv.id} type="button"
                        onClick={() => selectInterviewer(iv)}
                        className="w-full text-left px-3 py-2.5 hover:bg-brand-50 transition-colors border-b border-gray-50 last:border-0">
                        <p className="text-sm font-medium text-gray-800">{fullName}</p>
                        <p className="text-xs text-gray-400">{iv.email} · {iv.role}</p>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <Loader2 size={16} className="animate-spin" />} Schedule
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

/* ─── Score Round Modal ─── */
function ScoreRoundModal({ roundId, onClose, onSuccess }: {
  roundId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [scoreRound, { isLoading }] = useScoreRoundMutation();
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!score) { toast.error('Please enter a score'); return; }
    try {
      await scoreRound({ roundId, score: parseFloat(score), feedback }).unwrap();
      toast.success('Round scored successfully');
      onSuccess();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to score round');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">Score Interview Round</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Score (0-10) *</label>
            <input type="number" min={0} max={10} step={0.5} value={score}
              onChange={e => setScore(e.target.value)} className="input-glass w-full" placeholder="e.g. 7.5" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Feedback</label>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
              className="input-glass w-full h-24 resize-none" placeholder="Write interviewer feedback..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={isLoading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <Loader2 size={16} className="animate-spin" />} Save Score
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

/* ─── Candidate Invite Modal — same form as Manage Employees, pre-filled with candidate email ─── */
function CandidateInviteModal({ open, onClose, candidateEmail, candidateName }: {
  open: boolean;
  onClose: () => void;
  candidateEmail: string;
  candidateName: string;
}) {
  const [role, setRole] = useState('EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [employmentType, setEmploymentType] = useState('FULL_TIME');
  const [proposedJoiningDate, setProposedJoiningDate] = useState('');
  const [notes, setNotes] = useState('');
  const [inviteResult, setInviteResult] = useState<any>(null);

  const [createInvitation, { isLoading }] = useCreateInvitationMutation();
  const { data: deptData } = useGetDepartmentsQuery();
  const { data: desigData } = useGetDesignationsQuery();
  const departments: any[] = deptData?.data || [];
  const designations: any[] = (desigData?.data || []).filter((d: any) => !departmentId || !d.departmentId || d.departmentId === departmentId);

  const handleSubmit = async () => {
    if (!candidateEmail) { toast.error('Candidate has no email on file'); return; }
    try {
      const body: any = {
        email: candidateEmail.toLowerCase().trim(),
        role,
        employmentType: employmentType || undefined,
        departmentId: departmentId || undefined,
        designationId: designationId || undefined,
        proposedJoiningDate: proposedJoiningDate || undefined,
        notes: notes || undefined,
        sendWelcomeEmail: true,
      };
      const res = await createInvitation(body).unwrap();
      setInviteResult(res.data);
      toast.success('Onboarding invitation sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send invitation');
    }
  };

  const handleClose = () => {
    setRole('EMPLOYEE'); setDepartmentId(''); setDesignationId('');
    setEmploymentType('FULL_TIME'); setProposedJoiningDate(''); setNotes('');
    setInviteResult(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={handleClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-display font-semibold text-gray-800">Send Onboarding Invitation</h3>
            <p className="text-xs text-gray-400 mt-0.5">Invite <strong>{candidateName}</strong> to complete their profile and join the team</p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {inviteResult ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={20} className="text-green-600" />
                <span className="text-sm font-semibold text-green-700">Invitation Created!</span>
              </div>
              <div className="space-y-1.5 mt-2">
                {inviteResult.email && (
                  <div className="flex items-center gap-2 text-xs">
                    <Mail size={14} className={inviteResult.emailStatus === 'SENT' ? 'text-green-600' : inviteResult.emailStatus === 'FAILED' ? 'text-red-500' : 'text-gray-400'} />
                    <span className={inviteResult.emailStatus === 'SENT' ? 'text-green-700' : inviteResult.emailStatus === 'FAILED' ? 'text-red-600' : 'text-gray-500'}>
                      Email {inviteResult.emailStatus === 'SENT' ? 'sent' : inviteResult.emailStatus === 'FAILED' ? 'failed' : 'pending'} to {inviteResult.email}
                    </span>
                  </div>
                )}
                {inviteResult.mobileNumber && (
                  <div className="flex items-center gap-2 text-xs">
                    <MessageSquare size={14} className={inviteResult.whatsappStatus === 'SENT' ? 'text-green-600' : inviteResult.whatsappStatus === 'FAILED' ? 'text-amber-500' : 'text-gray-400'} />
                    <span className={inviteResult.whatsappStatus === 'SENT' ? 'text-green-700' : inviteResult.whatsappStatus === 'FAILED' ? 'text-amber-600' : 'text-gray-500'}>
                      WhatsApp {inviteResult.whatsappStatus === 'SENT' ? 'sent' : inviteResult.whatsappStatus === 'FAILED' ? 'failed (WA may not be connected)' : 'pending'} to {inviteResult.mobileNumber}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invite Link (share manually if needed)</label>
              <div className="flex items-center gap-2">
                <input readOnly value={inviteResult.inviteUrl || ''} className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs" />
                <button onClick={() => { navigator.clipboard.writeText(inviteResult.inviteUrl); toast.success('Invite link copied!'); }}
                  className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50"><Copy size={16} /></button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Expires: {new Date(inviteResult.expiresAt).toLocaleString('en-IN')}</p>
            </div>
            <button onClick={handleClose} className="btn-primary w-full text-sm mt-4">Done</button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Email — read-only, pre-filled from candidate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><Mail size={13} className="inline mr-1.5 -mt-0.5" />Email Address</label>
              <input readOnly value={candidateEmail}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed" />
              <p className="text-xs text-gray-400 mt-1">Pre-filled from candidate application</p>
            </div>

            {/* Role + Employment Type */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select value={role} onChange={e => setRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="EMPLOYEE">Employee</option>
                  <option value="INTERN">Intern</option>
                  <option value="MANAGER">Manager</option>
                  <option value="HR">HR</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
                <select value={employmentType} onChange={e => setEmploymentType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="FULL_TIME">Full Time</option>
                  <option value="PART_TIME">Part Time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                </select>
              </div>
            </div>

            {/* Department + Designation */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select value={departmentId} onChange={e => { setDepartmentId(e.target.value); setDesignationId(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— Select —</option>
                  {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
                <select value={designationId} onChange={e => setDesignationId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— Select —</option>
                  {designations.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            {/* Joining Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"><Calendar size={13} className="inline mr-1.5 -mt-0.5" />Proposed Joining Date</label>
              <input type="date" value={proposedJoiningDate} onChange={e => setProposedJoiningDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Internal notes about this candidate..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
            </div>

            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <button onClick={handleClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={isLoading || !candidateEmail}
                className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm">
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Send Invitation
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
