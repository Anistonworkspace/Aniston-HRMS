import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, User, Mail, Phone, MapPin, Briefcase, FileText, Clock,
  CheckCircle2, XCircle, PauseCircle, Plus, Edit3, Save, X, Send,
  Trash2, Calendar, Star, MessageSquare, ExternalLink, Loader2,
  ChevronDown, Award, Eye, AlertTriangle,
} from 'lucide-react';
import {
  useGetWalkInByIdQuery,
  useUpdateWalkInStatusMutation,
  useUpdateWalkInCandidateMutation,
  useAddWalkInNotesMutation,
  useAddInterviewRoundMutation,
  useUpdateInterviewRoundMutation,
  useDeleteInterviewRoundMutation,
  useConvertWalkInMutation,
  useDeleteWalkInMutation,
  useHireWalkInMutation,
} from './walkInApi';
import toast from 'react-hot-toast';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  WAITING:      { label: 'Waiting',      color: 'text-amber-700',   bg: 'bg-amber-50',   icon: Clock },
  IN_INTERVIEW: { label: 'In Interview', color: 'text-blue-700',    bg: 'bg-blue-50',    icon: Briefcase },
  ON_HOLD:      { label: 'On Hold',      color: 'text-orange-700',  bg: 'bg-orange-50',  icon: PauseCircle },
  SELECTED:     { label: 'Selected',     color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  REJECTED:     { label: 'Rejected',     color: 'text-red-700',     bg: 'bg-red-50',     icon: XCircle },
  COMPLETED:    { label: 'Completed',    color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  NO_SHOW:      { label: 'No Show',      color: 'text-red-700',     bg: 'bg-red-50',     icon: XCircle },
};

const ROUND_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:     { label: 'Pending',     color: 'text-gray-500' },
  SCHEDULED:   { label: 'Scheduled',   color: 'text-blue-600' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-600' },
  COMPLETED:   { label: 'Completed',   color: 'text-emerald-600' },
  CANCELLED:   { label: 'Cancelled',   color: 'text-red-500' },
};

const ROUND_RESULT: Record<string, { label: string; color: string; bg: string }> = {
  PASSED:  { label: 'Passed',  color: 'text-emerald-700', bg: 'bg-emerald-50' },
  FAILED:  { label: 'Failed',  color: 'text-red-700',     bg: 'bg-red-50' },
  ON_HOLD: { label: 'On Hold', color: 'text-orange-700',  bg: 'bg-orange-50' },
};

const API_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000';

export default function WalkInDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: res, isLoading } = useGetWalkInByIdQuery(id!, { skip: !id });
  const candidate = res?.data;

  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'interviews' | 'actions'>('overview');
  const [showAddRound, setShowAddRound] = useState(false);
  const [showHireModal, setShowHireModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRound, setEditingRound] = useState<string | null>(null);
  const [notesInput, setNotesInput] = useState('');

  const [updateStatus] = useUpdateWalkInStatusMutation();
  const [updateCandidate] = useUpdateWalkInCandidateMutation();
  const [addNotes] = useAddWalkInNotesMutation();
  const [addRound] = useAddInterviewRoundMutation();
  const [updateRound] = useUpdateInterviewRoundMutation();
  const [deleteRound] = useDeleteInterviewRoundMutation();
  const [convertWalkIn] = useConvertWalkInMutation();
  const [deleteWalkIn] = useDeleteWalkInMutation();
  const [hireWalkIn, { isLoading: isHiring }] = useHireWalkInMutation();

  if (isLoading) {
    return (
      <div className="page-container flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="page-container text-center py-20">
        <XCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Candidate not found</p>
        <button onClick={() => navigate('/walk-in-management')} className="btn-primary mt-4 text-sm">
          Back to List
        </button>
      </div>
    );
  }

  const sc = STATUS_CONFIG[candidate.status] || STATUS_CONFIG.WAITING;
  const StatusIcon = sc.icon;
  const rounds = candidate.interviewRounds || [];
  const completedRounds = rounds.filter((r: any) => r.status === 'COMPLETED').length;

  const handleStatusChange = async (status: string) => {
    try {
      await updateStatus({ id: candidate.id, status }).unwrap();
      toast.success(`Status updated to ${STATUS_CONFIG[status]?.label || status}`);
    } catch { toast.error('Failed to update status'); }
  };

  const handleAddNotes = async () => {
    if (!notesInput.trim()) return;
    try {
      await addNotes({ id: candidate.id, notes: notesInput.trim() }).unwrap();
      toast.success('Notes saved');
      setNotesInput('');
    } catch { toast.error('Failed to save notes'); }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this walk-in record permanently?')) return;
    try {
      await deleteWalkIn(candidate.id).unwrap();
      toast.success('Record deleted');
      navigate('/walk-in-management');
    } catch { toast.error('Failed to delete'); }
  };

  const handleConvert = async () => {
    try {
      await convertWalkIn(candidate.id).unwrap();
      toast.success('Converted to recruitment application');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Conversion failed'); }
  };

  const tabs = [
    { key: 'overview', label: 'Overview', icon: User },
    { key: 'documents', label: 'Documents & KYC', icon: FileText },
    { key: 'interviews', label: 'Interview Rounds', icon: Award },
    { key: 'actions', label: 'Actions', icon: Briefcase },
  ];

  return (
    <div className="page-container">
      {/* Back Button + Header */}
      <div className="flex items-start gap-4 mb-6">
        <button onClick={() => navigate('/walk-in-management')} className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div className="flex-1">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center">
                <span className="text-lg font-bold text-brand-600">
                  {candidate.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                </span>
              </div>
              <div>
                <h1 className="text-xl font-display font-bold text-gray-900">{candidate.fullName}</h1>
                <p className="text-sm text-gray-400 font-mono" data-mono>{candidate.tokenNumber}</p>
              </div>
            </div>
            <div className="sm:ml-auto flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${sc.bg} ${sc.color}`}>
                <StatusIcon className="w-4 h-4" />
                {sc.label}
              </div>
              {rounds.length > 0 && (
                <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-full">
                  Round {completedRounds}/{candidate.totalRounds || rounds.length}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
            {candidate.jobOpening?.title && (
              <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" /> {candidate.jobOpening.title}</span>
            )}
            <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {candidate.email}</span>
            <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> +91 {candidate.phone}</span>
            {candidate.city && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {candidate.city}</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-100 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab candidate={candidate} onEdit={() => setShowEditModal(true)} />
      )}
      {activeTab === 'documents' && (
        <DocumentsTab candidate={candidate} />
      )}
      {activeTab === 'interviews' && (
        <InterviewsTab
          candidate={candidate}
          rounds={rounds}
          showAddRound={showAddRound}
          setShowAddRound={setShowAddRound}
          editingRound={editingRound}
          setEditingRound={setEditingRound}
          addRound={addRound}
          updateRound={updateRound}
          deleteRound={deleteRound}
        />
      )}
      {activeTab === 'actions' && (
        <ActionsTab
          candidate={candidate}
          notesInput={notesInput}
          setNotesInput={setNotesInput}
          onStatusChange={handleStatusChange}
          onAddNotes={handleAddNotes}
          onConvert={handleConvert}
          onHire={() => setShowHireModal(true)}
          onDelete={handleDelete}
        />
      )}

      {/* Hire Modal */}
      <AnimatePresence>
        {showHireModal && (
          <HireModal
            candidate={candidate}
            isHiring={isHiring}
            onHire={async (email) => {
              try {
                const result = await hireWalkIn({ id: candidate.id, teamsEmail: email }).unwrap();
                toast.success(`Hired! Employee code: ${result?.data?.employeeCode || 'N/A'}`, { duration: 6000 });
                setShowHireModal(false);
              } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to hire candidate'); }
            }}
            onClose={() => setShowHireModal(false)}
          />
        )}
      </AnimatePresence>

      {/* Edit Candidate Modal */}
      <AnimatePresence>
        {showEditModal && (
          <EditCandidateModal
            candidate={candidate}
            onSave={async (data) => {
              try {
                await updateCandidate({ id: candidate.id, data }).unwrap();
                toast.success('Details updated');
                setShowEditModal(false);
              } catch { toast.error('Failed to update'); }
            }}
            onClose={() => setShowEditModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ===================== Overview Tab =====================
function OverviewTab({ candidate, onEdit }: { candidate: any; onEdit: () => void }) {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Personal Info */}
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2"><User className="w-4 h-4 text-gray-400" /> Personal Details</h3>
          <button onClick={onEdit} className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
            <Edit3 className="w-3 h-3" /> Edit
          </button>
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <InfoField label="Full Name" value={candidate.fullName} />
          <InfoField label="Email" value={candidate.email} />
          <InfoField label="Phone" value={`+91 ${candidate.phone}`} />
          <InfoField label="City" value={candidate.city || '—'} />
          <InfoField label="Position" value={candidate.jobOpening?.title || 'Not selected'} />
          <InfoField label="Department" value={candidate.jobOpening?.department || '—'} />
          <InfoField label="Registered" value={new Date(candidate.registrationDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
        </div>
      </div>

      {/* Professional Info */}
      <div className="layer-card p-5">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4"><Briefcase className="w-4 h-4 text-gray-400" /> Professional Details</h3>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <InfoField label="Qualification" value={candidate.qualification || '—'} />
          <InfoField label="Field of Study" value={candidate.fieldOfStudy || '—'} />
          <InfoField label="Experience" value={candidate.isFresher ? 'Fresher' : `${candidate.experienceYears}y ${candidate.experienceMonths}m`} />
          <InfoField label="Current Company" value={candidate.currentCompany || '—'} />
          <InfoField label="Current CTC" value={candidate.currentCtc ? `₹${Number(candidate.currentCtc).toLocaleString('en-IN')} LPA` : '—'} />
          <InfoField label="Expected CTC" value={candidate.expectedCtc ? `₹${Number(candidate.expectedCtc).toLocaleString('en-IN')} LPA` : '—'} />
          <InfoField label="Notice Period" value={candidate.noticePeriod || '—'} />
        </div>
        {candidate.skills?.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-50">
            <p className="text-xs text-gray-400 mb-2">Skills</p>
            <div className="flex flex-wrap gap-1.5">
              {candidate.skills.map((s: string) => (
                <span key={s} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-md">{s}</span>
              ))}
            </div>
          </div>
        )}
        {candidate.aboutMe && (
          <div className="mt-4 pt-3 border-t border-gray-50">
            <p className="text-xs text-gray-400 mb-1">About</p>
            <p className="text-sm text-gray-600">{candidate.aboutMe}</p>
          </div>
        )}
      </div>

      {/* HR Notes */}
      <div className="layer-card p-5 lg:col-span-2">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-3"><MessageSquare className="w-4 h-4 text-gray-400" /> HR Notes</h3>
        {candidate.hrNotes ? (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{candidate.hrNotes}</p>
        ) : (
          <p className="text-sm text-gray-400 italic">No notes yet</p>
        )}
      </div>
    </div>
  );
}

// ===================== Documents Tab =====================
function DocumentsTab({ candidate }: { candidate: any }) {
  const docs = [
    { label: 'Aadhaar Front', url: candidate.aadhaarFrontUrl },
    { label: 'Aadhaar Back', url: candidate.aadhaarBackUrl },
    { label: 'PAN Card', url: candidate.panCardUrl },
    { label: 'Selfie / Photo', url: candidate.selfieUrl },
    { label: 'Resume', url: candidate.resumeUrl },
  ];

  return (
    <div className="space-y-6">
      {/* OCR Verification Status */}
      {(candidate.ocrVerifiedName || candidate.tamperDetected) && (
        <div className={`layer-card p-4 ${candidate.tamperDetected ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-emerald-500'}`}>
          <div className="flex items-center gap-2 mb-2">
            {candidate.tamperDetected ? (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            )}
            <h3 className="font-semibold text-gray-800">
              {candidate.tamperDetected ? 'Document Verification — Warning' : 'Document Verification — Verified'}
            </h3>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            {candidate.ocrVerifiedName && <InfoField label="OCR Name" value={candidate.ocrVerifiedName} />}
            {candidate.ocrVerifiedDob && <InfoField label="OCR DOB" value={new Date(candidate.ocrVerifiedDob).toLocaleDateString('en-IN')} />}
            {candidate.ocrVerifiedAddress && <InfoField label="OCR Address" value={candidate.ocrVerifiedAddress} />}
          </div>
          {candidate.tamperDetails && (
            <p className="text-sm text-red-600 mt-2 bg-red-50 rounded-lg p-2">{candidate.tamperDetails}</p>
          )}
        </div>
      )}

      {/* KYC Numbers */}
      <div className="layer-card p-5">
        <h3 className="font-semibold text-gray-800 mb-3">KYC Details</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <InfoField label="Aadhaar Number" value={candidate.aadhaarNumber || 'Not provided'} />
          <InfoField label="PAN Number" value={candidate.panNumber || 'Not provided'} />
        </div>
      </div>

      {/* Document Previews */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {docs.map(doc => (
          <div key={doc.label} className="layer-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">{doc.label}</span>
              {doc.url ? (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Uploaded
                </span>
              ) : (
                <span className="text-xs text-gray-400">Not uploaded</span>
              )}
            </div>
            {doc.url ? (
              <div className="relative group">
                {doc.url.match(/\.(jpg|jpeg|png|webp|gif)$/i) || doc.label.includes('Selfie') || doc.label.includes('Aadhaar') || doc.label.includes('PAN') ? (
                  <img
                    src={`${API_URL}${doc.url}`}
                    alt={doc.label}
                    className="w-full h-36 object-cover rounded-lg bg-gray-50"
                    onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).className = 'hidden'; }}
                  />
                ) : (
                  <div className="w-full h-36 bg-gray-50 rounded-lg flex items-center justify-center">
                    <FileText className="w-8 h-8 text-gray-300" />
                  </div>
                )}
                <a
                  href={`${API_URL}${doc.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Eye className="w-5 h-5 text-white" />
                </a>
              </div>
            ) : (
              <div className="w-full h-36 bg-gray-50 rounded-lg flex items-center justify-center">
                <XCircle className="w-8 h-8 text-gray-200" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===================== Interviews Tab =====================
function InterviewsTab({
  candidate, rounds, showAddRound, setShowAddRound, editingRound, setEditingRound,
  addRound, updateRound, deleteRound,
}: any) {
  const [newRound, setNewRound] = useState({ roundName: '', interviewerName: '', scheduledAt: '' });
  const [scoreForm, setScoreForm] = useState<any>({});

  const handleAddRound = async () => {
    if (!newRound.roundName) { toast.error('Round name is required'); return; }
    try {
      await addRound({ walkInId: candidate.id, ...newRound }).unwrap();
      toast.success('Round added');
      setNewRound({ roundName: '', interviewerName: '', scheduledAt: '' });
      setShowAddRound(false);
    } catch { toast.error('Failed to add round'); }
  };

  const handleScoreRound = async (roundId: string) => {
    try {
      await updateRound({ walkInId: candidate.id, roundId, data: { ...scoreForm, status: 'COMPLETED' } }).unwrap();
      toast.success('Scores saved');
      setEditingRound(null);
      setScoreForm({});
    } catch { toast.error('Failed to save scores'); }
  };

  const handleStartRound = async (roundId: string) => {
    try {
      await updateRound({ walkInId: candidate.id, roundId, data: { status: 'IN_PROGRESS' } }).unwrap();
      toast.success('Round started');
    } catch { toast.error('Failed'); }
  };

  const handleDeleteRound = async (roundId: string) => {
    if (!confirm('Delete this interview round?')) return;
    try {
      await deleteRound({ walkInId: candidate.id, roundId }).unwrap();
      toast.success('Round deleted');
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div className="space-y-4">
      {/* Round Progress Bar */}
      <div className="layer-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Interview Progress</h3>
          <span className="text-sm text-gray-500">
            {rounds.filter((r: any) => r.status === 'COMPLETED').length} of {candidate.totalRounds} rounds completed
          </span>
        </div>
        <div className="flex gap-2">
          {rounds.length === 0 ? (
            <p className="text-sm text-gray-400">No interview rounds scheduled yet</p>
          ) : rounds.map((round: any) => {
            const isComplete = round.status === 'COMPLETED';
            const isActive = round.status === 'IN_PROGRESS' || round.status === 'SCHEDULED';
            return (
              <div
                key={round.id}
                className={`flex-1 h-2 rounded-full ${
                  isComplete
                    ? round.result === 'PASSED' ? 'bg-emerald-400'
                    : round.result === 'FAILED' ? 'bg-red-400'
                    : 'bg-orange-400'
                  : isActive ? 'bg-blue-400 animate-pulse'
                  : 'bg-gray-200'
                }`}
                title={`${round.roundName}: ${ROUND_STATUS[round.status]?.label}`}
              />
            );
          })}
        </div>
      </div>

      {/* Round Cards */}
      {rounds.map((round: any) => (
        <motion.div
          key={round.id}
          layout
          className="layer-card p-5"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono" data-mono>R{round.roundNumber}</span>
                <h4 className="font-semibold text-gray-800">{round.roundName}</h4>
              </div>
              {round.interviewerName && (
                <p className="text-xs text-gray-400 mt-1">Interviewer: {round.interviewerName}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {round.result && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROUND_RESULT[round.result]?.bg} ${ROUND_RESULT[round.result]?.color}`}>
                  {ROUND_RESULT[round.result]?.label}
                </span>
              )}
              <span className={`text-xs font-medium ${ROUND_STATUS[round.status]?.color}`}>
                {ROUND_STATUS[round.status]?.label}
              </span>
            </div>
          </div>

          {/* Schedule */}
          {round.scheduledAt && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mb-3">
              <Calendar className="w-3 h-3" />
              Scheduled: {new Date(round.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
          {round.completedAt && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mb-3">
              <CheckCircle2 className="w-3 h-3" />
              Completed: {new Date(round.completedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}

          {/* Scores (if completed) */}
          {round.status === 'COMPLETED' && round.overallScore && (
            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <div className="grid grid-cols-5 gap-3 text-center text-xs">
                <ScoreCell label="Communication" value={round.communication} />
                <ScoreCell label="Technical" value={round.technical} />
                <ScoreCell label="Problem Solving" value={round.problemSolving} />
                <ScoreCell label="Cultural Fit" value={round.culturalFit} />
                <ScoreCell label="Overall" value={round.overallScore} highlight />
              </div>
              {round.remarks && (
                <p className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-100">{round.remarks}</p>
              )}
            </div>
          )}

          {/* Actions for this round */}
          {editingRound === round.id ? (
            <ScoreForm
              initial={round}
              onChange={setScoreForm}
              onSave={() => handleScoreRound(round.id)}
              onCancel={() => { setEditingRound(null); setScoreForm({}); }}
            />
          ) : (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">
              {round.status === 'PENDING' && (
                <button onClick={() => handleStartRound(round.id)}
                  className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg">
                  Start Round
                </button>
              )}
              {round.status === 'SCHEDULED' && (
                <button onClick={() => handleStartRound(round.id)}
                  className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg">
                  Start Round
                </button>
              )}
              {(round.status === 'IN_PROGRESS' || round.status === 'COMPLETED') && (
                <button onClick={() => { setEditingRound(round.id); setScoreForm(round); }}
                  className="text-xs text-brand-600 hover:bg-brand-50 px-2 py-1 rounded-lg flex items-center gap-1">
                  <Star className="w-3 h-3" /> {round.status === 'COMPLETED' ? 'Edit Scores' : 'Add Scores & Complete'}
                </button>
              )}
              <button onClick={() => handleDeleteRound(round.id)}
                className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded-lg ml-auto">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </motion.div>
      ))}

      {/* Add Round */}
      {showAddRound ? (
        <div className="layer-card p-5 space-y-3">
          <h4 className="font-semibold text-gray-800">Add Interview Round</h4>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Round Name *</label>
              <input
                value={newRound.roundName}
                onChange={e => setNewRound({ ...newRound, roundName: e.target.value })}
                placeholder="e.g. HR Screening"
                className="input-glass w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Interviewer Name</label>
              <input
                value={newRound.interviewerName}
                onChange={e => setNewRound({ ...newRound, interviewerName: e.target.value })}
                placeholder="e.g. Priya Sharma"
                className="input-glass w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Schedule (optional)</label>
              <input
                type="datetime-local"
                value={newRound.scheduledAt}
                onChange={e => setNewRound({ ...newRound, scheduledAt: e.target.value })}
                className="input-glass w-full text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddRound} className="btn-primary text-sm">Add Round</button>
            <button onClick={() => setShowAddRound(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddRound(true)}
          className="w-full layer-card p-4 text-sm text-brand-600 hover:bg-brand-50 flex items-center justify-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Interview Round
        </button>
      )}
    </div>
  );
}

// ===================== Actions Tab =====================
function ActionsTab({ candidate, notesInput, setNotesInput, onStatusChange, onAddNotes, onConvert, onHire, onDelete }: any) {
  return (
    <div className="space-y-6">
      {/* Status Control */}
      <div className="layer-card p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Change Status</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const isActive = candidate.status === key;
            return (
              <button
                key={key}
                onClick={() => !isActive && onStatusChange(key)}
                disabled={isActive}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  isActive
                    ? `${cfg.bg} ${cfg.color} border-current`
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* HR Notes */}
      <div className="layer-card p-5">
        <h3 className="font-semibold text-gray-800 mb-3">HR Notes</h3>
        {candidate.hrNotes && (
          <div className="bg-gray-50 rounded-lg p-3 mb-3">
            <p className="text-sm text-gray-600">{candidate.hrNotes}</p>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={notesInput}
            onChange={e => setNotesInput(e.target.value)}
            placeholder="Add or update notes about this candidate..."
            className="input-glass flex-1 text-sm h-20 resize-none"
          />
        </div>
        <button onClick={onAddNotes} disabled={!notesInput.trim()} className="btn-primary text-sm mt-2">
          <MessageSquare className="w-3.5 h-3.5 mr-1 inline" /> Save Notes
        </button>
      </div>

      {/* HR Actions */}
      <div className="layer-card p-5">
        <h3 className="font-semibold text-gray-800 mb-3">HR Actions</h3>
        <div className="flex flex-wrap gap-3">
          {!candidate.convertedToApp && candidate.jobOpeningId && (
            <button onClick={onConvert} className="btn-primary text-sm flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" /> Convert to Application
            </button>
          )}
          {candidate.convertedToApp && (
            <span className="text-sm text-emerald-600 flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5" /> Already Converted
            </span>
          )}
          {(candidate.status === 'SELECTED' || candidate.status === 'COMPLETED' || candidate.status === 'IN_INTERVIEW') && (
            <button onClick={onHire}
              className="text-sm bg-purple-600 text-white hover:bg-purple-700 px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors">
              <Send className="w-3.5 h-3.5" /> Hire & Send Invite
            </button>
          )}
          <button onClick={onDelete}
            className="text-sm text-red-500 hover:bg-red-50 px-4 py-2 rounded-lg border border-red-200 flex items-center gap-1.5 transition-colors ml-auto">
            <Trash2 className="w-3.5 h-3.5" /> Delete Record
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== Helper Components =====================

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-gray-700 font-medium">{value}</p>
    </div>
  );
}

function ScoreCell({ label, value, highlight }: { label: string; value?: number; highlight?: boolean }) {
  return (
    <div>
      <p className={`text-lg font-bold ${highlight ? 'text-brand-600' : 'text-gray-800'}`} data-mono>
        {value ?? '—'}
      </p>
      <p className="text-[10px] text-gray-400 leading-tight">{label}</p>
    </div>
  );
}

function ScoreForm({ initial, onChange, onSave, onCancel }: any) {
  const [form, setForm] = useState({
    communication: initial.communication || '',
    technical: initial.technical || '',
    problemSolving: initial.problemSolving || '',
    culturalFit: initial.culturalFit || '',
    overallScore: initial.overallScore || '',
    remarks: initial.remarks || '',
    result: initial.result || '',
  });

  const update = (field: string, val: any) => {
    const updated = { ...form, [field]: val };
    setForm(updated);
    onChange(updated);
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      <div className="grid grid-cols-5 gap-3">
        {['communication', 'technical', 'problemSolving', 'culturalFit', 'overallScore'].map(field => (
          <div key={field}>
            <label className="block text-[10px] text-gray-400 mb-1 capitalize">{field.replace(/([A-Z])/g, ' $1')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={(form as any)[field]}
              onChange={e => update(field, e.target.value ? Number(e.target.value) : '')}
              className="input-glass w-full text-sm text-center"
              placeholder="1-10"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Remarks</label>
        <textarea
          value={form.remarks}
          onChange={e => update('remarks', e.target.value)}
          className="input-glass w-full text-sm h-16 resize-none"
          placeholder="Interview feedback..."
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Result</label>
        <div className="flex gap-2">
          {['PASSED', 'FAILED', 'ON_HOLD'].map(r => (
            <button
              key={r}
              onClick={() => update('result', r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                form.result === r
                  ? `${ROUND_RESULT[r].bg} ${ROUND_RESULT[r].color} border-current`
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {ROUND_RESULT[r].label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="btn-primary text-sm flex items-center gap-1">
          <Save className="w-3 h-3" /> Save Scores
        </button>
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  );
}

function HireModal({ candidate, isHiring, onHire, onClose }: any) {
  const [email, setEmail] = useState('');
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
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-display font-bold text-gray-900">Hire & Send Invite</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Candidate</label>
            <div className="text-sm font-medium text-gray-900 bg-gray-50 rounded-lg px-3 py-2.5">{candidate.fullName}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Position</label>
            <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2.5">{candidate.jobOpening?.title || 'Not specified'}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Teams Email <span className="text-red-500">*</span></label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="employee@aniston.in"
              className="input-glass w-full"
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">Onboarding invite will be sent to this email.</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button
            onClick={() => onHire(email)}
            disabled={isHiring || !email.trim()}
            className={`px-5 py-2 text-sm rounded-lg font-medium flex items-center gap-2 transition-colors ${
              isHiring || !email.trim() ? 'bg-gray-100 text-gray-400' : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
          >
            {isHiring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send Onboarding Invite
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EditCandidateModal({ candidate, onSave, onClose }: any) {
  const [form, setForm] = useState({
    fullName: candidate.fullName || '',
    email: candidate.email || '',
    phone: candidate.phone || '',
    city: candidate.city || '',
    qualification: candidate.qualification || '',
    fieldOfStudy: candidate.fieldOfStudy || '',
    experienceYears: candidate.experienceYears || 0,
    experienceMonths: candidate.experienceMonths || 0,
    isFresher: candidate.isFresher ?? true,
    currentCompany: candidate.currentCompany || '',
    currentCtc: candidate.currentCtc ? Number(candidate.currentCtc) : 0,
    expectedCtc: candidate.expectedCtc ? Number(candidate.expectedCtc) : 0,
    noticePeriod: candidate.noticePeriod || '',
    skills: candidate.skills?.join(', ') || '',
    aboutMe: candidate.aboutMe || '',
    totalRounds: candidate.totalRounds || 1,
  });

  const handleSubmit = () => {
    const data: any = { ...form };
    data.skills = form.skills.split(',').map((s: string) => s.trim()).filter(Boolean);
    data.currentCtc = form.currentCtc || undefined;
    data.expectedCtc = form.expectedCtc || undefined;
    onSave(data);
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
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-display font-bold text-gray-900">Edit Candidate Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Full Name</label>
              <input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">City</label>
              <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="input-glass w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Qualification</label>
              <input value={form.qualification} onChange={e => setForm({ ...form, qualification: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Field of Study</label>
              <input value={form.fieldOfStudy} onChange={e => setForm({ ...form, fieldOfStudy: e.target.value })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notice Period</label>
              <input value={form.noticePeriod} onChange={e => setForm({ ...form, noticePeriod: e.target.value })} className="input-glass w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Exp Years</label>
              <input type="number" min={0} value={form.experienceYears} onChange={e => setForm({ ...form, experienceYears: Number(e.target.value) })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Exp Months</label>
              <input type="number" min={0} max={11} value={form.experienceMonths} onChange={e => setForm({ ...form, experienceMonths: Number(e.target.value) })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Current CTC (LPA)</label>
              <input type="number" min={0} value={form.currentCtc} onChange={e => setForm({ ...form, currentCtc: Number(e.target.value) })} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expected CTC (LPA)</label>
              <input type="number" min={0} value={form.expectedCtc} onChange={e => setForm({ ...form, expectedCtc: Number(e.target.value) })} className="input-glass w-full text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Total Interview Rounds</label>
            <input type="number" min={1} max={10} value={form.totalRounds} onChange={e => setForm({ ...form, totalRounds: Number(e.target.value) })} className="input-glass w-32 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Skills (comma-separated)</label>
            <input value={form.skills} onChange={e => setForm({ ...form, skills: e.target.value })} className="input-glass w-full text-sm" placeholder="React, Node.js, TypeScript" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">About</label>
            <textarea value={form.aboutMe} onChange={e => setForm({ ...form, aboutMe: e.target.value })} className="input-glass w-full text-sm h-16 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleSubmit} className="btn-primary text-sm flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save Changes
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
