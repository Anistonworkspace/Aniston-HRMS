import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, User, Mail, Phone, FileText, Star, Calendar, Briefcase,
  Loader2, Download, Plus,
} from 'lucide-react';
import {
  useGetApplicationByIdQuery,
  useAddInterviewScoreMutation,
  useTriggerAIScoringMutation,
  useCreateOfferMutation,
} from './recruitmentApi';
import toast from 'react-hot-toast';

const TABS = ['Profile', 'Interview Scores', 'Offer'];

export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);

  const { data, isLoading } = useGetApplicationByIdQuery(id!);
  const [addScore, { isLoading: isScoring }] = useAddInterviewScoreMutation();
  const [triggerAI, { isLoading: isAIScoring }] = useTriggerAIScoringMutation();
  const [createOffer, { isLoading: isCreatingOffer }] = useCreateOfferMutation();

  const app = data?.data;

  // Score form state
  const [scoreForm, setScoreForm] = useState({
    round: 1, communicationScore: '', technicalScore: '', problemSolving: '', culturalFit: '', notes: '',
  });
  const [showScoreForm, setShowScoreForm] = useState(false);

  // Offer form state
  const [offerForm, setOfferForm] = useState({ ctc: '', basicSalary: '', joiningDate: '' });
  const [showOfferForm, setShowOfferForm] = useState(false);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>;
  }

  if (!app) {
    return <div className="page-container text-center py-16"><p className="text-gray-500">Application not found</p></div>;
  }

  const handleAddScore = async () => {
    try {
      await addScore({
        applicationId: id,
        round: scoreForm.round,
        communicationScore: scoreForm.communicationScore ? parseFloat(scoreForm.communicationScore) : undefined,
        technicalScore: scoreForm.technicalScore ? parseFloat(scoreForm.technicalScore) : undefined,
        problemSolving: scoreForm.problemSolving ? parseFloat(scoreForm.problemSolving) : undefined,
        culturalFit: scoreForm.culturalFit ? parseFloat(scoreForm.culturalFit) : undefined,
        notes: scoreForm.notes || undefined,
      }).unwrap();
      toast.success('Score recorded');
      setShowScoreForm(false);
      setScoreForm({ round: (app.interviewScores?.length || 0) + 2, communicationScore: '', technicalScore: '', problemSolving: '', culturalFit: '', notes: '' });
    } catch { toast.error('Failed to add score'); }
  };

  const handleTriggerAI = async () => {
    try {
      await triggerAI(id!).unwrap();
      toast.success('AI scoring complete');
    } catch { toast.error('AI scoring failed'); }
  };

  const handleCreateOffer = async () => {
    try {
      await createOffer({
        applicationId: id,
        candidateEmail: app.email,
        ctc: parseFloat(offerForm.ctc),
        basicSalary: parseFloat(offerForm.basicSalary),
        joiningDate: offerForm.joiningDate || undefined,
      }).unwrap();
      toast.success('Offer created');
      setShowOfferForm(false);
    } catch { toast.error('Failed to create offer'); }
  };

  return (
    <div className="page-container max-w-4xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Header */}
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
              <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {app.email}</span>
              <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {app.phone}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="badge badge-info">{app.status?.replace(/_/g, ' ')}</span>
              <span className="badge badge-neutral">{app.source}</span>
              {app.jobOpening && (
                <span className="text-xs text-gray-400">
                  <Briefcase className="w-3 h-3 inline mr-1" />{app.jobOpening.title}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            {app.aiScore && (
              <div className="flex items-center gap-1 text-amber-600">
                <Star className="w-5 h-5 fill-amber-400" />
                <span className="text-2xl font-display font-bold" data-mono>{Number(app.aiScore).toFixed(1)}</span>
              </div>
            )}
            <button onClick={handleTriggerAI} disabled={isAIScoring}
              className="text-xs text-brand-600 hover:underline mt-1">
              {isAIScoring ? 'Scoring...' : 'Run AI Score'}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${i === activeTab ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {activeTab === 0 && (
          <div className="layer-card p-5 space-y-4">
            <h3 className="font-display font-bold text-gray-900">Application Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-400">Applied:</span> <span className="text-gray-700">{new Date(app.createdAt).toLocaleDateString('en-IN')}</span></div>
              <div><span className="text-gray-400">Stage:</span> <span className="text-gray-700">{app.currentStage}</span></div>
              <div><span className="text-gray-400">Source:</span> <span className="text-gray-700">{app.source}</span></div>
              {app.isIntern && <div><span className="badge badge-warning">Intern</span></div>}
            </div>
            {app.resumeUrl && (
              <a href={app.resumeUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-brand-600 hover:underline">
                <Download className="w-4 h-4" /> Download Resume
              </a>
            )}
            {app.coverLetter && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">Cover Letter</h4>
                <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{app.coverLetter}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 1 && (
          <div className="space-y-4">
            {/* Existing Scores */}
            {app.interviewScores?.length > 0 ? (
              app.interviewScores.map((score: any) => (
                <div key={score.id} className="layer-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-900">Round {score.round}</h4>
                    {score.overallScore && (
                      <span className="text-lg font-bold text-brand-600" data-mono>{Number(score.overallScore).toFixed(1)}/10</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    {score.communicationScore && <ScoreBar label="Communication" value={Number(score.communicationScore)} />}
                    {score.technicalScore && <ScoreBar label="Technical" value={Number(score.technicalScore)} />}
                    {score.problemSolving && <ScoreBar label="Problem Solving" value={Number(score.problemSolving)} />}
                    {score.culturalFit && <ScoreBar label="Cultural Fit" value={Number(score.culturalFit)} />}
                  </div>
                  {score.notes && <p className="text-sm text-gray-500 mt-2 bg-gray-50 rounded p-2">{score.notes}</p>}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-400">No interview scores yet</div>
            )}

            {/* Add Score Form */}
            {showScoreForm ? (
              <div className="layer-card p-4 space-y-3">
                <h4 className="font-medium text-gray-900">Add Interview Score</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Round</label>
                    <input type="number" min={1} value={scoreForm.round} onChange={e => setScoreForm({ ...scoreForm, round: parseInt(e.target.value) })} className="input-glass w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Communication (0-10)</label>
                    <input type="number" min={0} max={10} step={0.5} value={scoreForm.communicationScore} onChange={e => setScoreForm({ ...scoreForm, communicationScore: e.target.value })} className="input-glass w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Technical (0-10)</label>
                    <input type="number" min={0} max={10} step={0.5} value={scoreForm.technicalScore} onChange={e => setScoreForm({ ...scoreForm, technicalScore: e.target.value })} className="input-glass w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Problem Solving (0-10)</label>
                    <input type="number" min={0} max={10} step={0.5} value={scoreForm.problemSolving} onChange={e => setScoreForm({ ...scoreForm, problemSolving: e.target.value })} className="input-glass w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Cultural Fit (0-10)</label>
                    <input type="number" min={0} max={10} step={0.5} value={scoreForm.culturalFit} onChange={e => setScoreForm({ ...scoreForm, culturalFit: e.target.value })} className="input-glass w-full" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Notes</label>
                  <textarea value={scoreForm.notes} onChange={e => setScoreForm({ ...scoreForm, notes: e.target.value })} className="input-glass w-full h-20 resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddScore} disabled={isScoring} className="btn-primary text-sm">
                    {isScoring ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Score'}
                  </button>
                  <button onClick={() => setShowScoreForm(false)} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setShowScoreForm(true); setScoreForm({ ...scoreForm, round: (app.interviewScores?.length || 0) + 1 }); }}
                className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
                <Plus className="w-4 h-4" /> Add Interview Score
              </button>
            )}
          </div>
        )}

        {activeTab === 2 && (
          <div className="space-y-4">
            {app.offerLetter ? (
              <div className="layer-card p-5">
                <h3 className="font-display font-bold text-gray-900 mb-3">Offer Letter</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-400">CTC:</span> <span className="text-gray-700 font-mono" data-mono>₹{Number(app.offerLetter.ctc).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-400">Basic:</span> <span className="text-gray-700 font-mono" data-mono>₹{Number(app.offerLetter.basicSalary).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-gray-400">Status:</span> <span className={`badge ${app.offerLetter.status === 'ACCEPTED' ? 'badge-success' : app.offerLetter.status === 'REJECTED' ? 'badge-danger' : 'badge-info'}`}>{app.offerLetter.status}</span></div>
                  {app.offerLetter.joiningDate && <div><span className="text-gray-400">Joining:</span> <span className="text-gray-700">{new Date(app.offerLetter.joiningDate).toLocaleDateString('en-IN')}</span></div>}
                </div>
              </div>
            ) : showOfferForm ? (
              <div className="layer-card p-5 space-y-3">
                <h3 className="font-display font-bold text-gray-900">Create Offer</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">CTC (Annual)</label>
                    <input type="number" value={offerForm.ctc} onChange={e => setOfferForm({ ...offerForm, ctc: e.target.value })} className="input-glass w-full" placeholder="e.g. 1200000" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Basic Salary (Monthly)</label>
                    <input type="number" value={offerForm.basicSalary} onChange={e => setOfferForm({ ...offerForm, basicSalary: e.target.value })} className="input-glass w-full" placeholder="e.g. 50000" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Joining Date</label>
                    <input type="date" value={offerForm.joiningDate} onChange={e => setOfferForm({ ...offerForm, joiningDate: e.target.value })} className="input-glass w-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreateOffer} disabled={isCreatingOffer || !offerForm.ctc || !offerForm.basicSalary} className="btn-primary text-sm">
                    {isCreatingOffer ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Offer'}
                  </button>
                  <button onClick={() => setShowOfferForm(false)} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowOfferForm(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create Offer Letter
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = (value / 10) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="font-mono text-gray-700" data-mono>{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
