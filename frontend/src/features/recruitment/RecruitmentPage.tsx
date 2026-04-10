import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Briefcase, Search, Users, Eye, Sparkles, X, MapPin, Clock, Pencil, Trash2, Upload,
  Award, Mail, UserPlus, Star, Loader2, MoreHorizontal, XCircle, PauseCircle, RotateCcw,
  AlertCircle, CheckCircle2, UserCheck, UserX, ChevronRight, ChevronLeft, RefreshCw, Link, Brain,
  Share2, MessageCircle, ExternalLink, Copy, Send, Target, ClipboardCheck,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetJobOpeningsQuery, useCreateJobMutation, useUpdateJobMutation, useDeleteJobMutation, useGetPipelineStatsQuery } from './recruitmentApi';
import {
  useGetAllWalkInsQuery, useGetWalkInStatsQuery, useGetSelectedCandidatesQuery,
  useHireWalkInMutation, useUpdateWalkInStatusMutation, useDeleteWalkInMutation,
  useGetWalkInByIdQuery, useAddWalkInNotesMutation, useAddInterviewRoundMutation,
  useUpdateInterviewRoundMutation, useDeleteInterviewRoundMutation, useGetInterviewersQuery,
} from '../walkIn/walkInApi';
import { useGetPublicApplicationsQuery, useGenerateJobQuestionsMutation } from '../public-apply/publicApplyApi';
import { useAiChatMutation } from '../ai-assistant/aiAssistantApi';
import { useAppSelector } from '../../app/store';
import { useSendWhatsAppToNumberMutation, useGetWhatsAppStatusQuery } from '../whatsapp/whatsappApi';
import { useShareJobEmailMutation } from './recruitmentApi';
import { cn, formatDate, getInitials, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';
import BulkResumeModal from './BulkResumeModal';
import AiAssistantFab from '../ai-assistant/AiAssistantPanel';

type RecruitmentTab = 'jobs' | 'walkin' | 'ai-screened' | 'hiring-passed';

// =================== Main Tabbed Page ===================
export default function RecruitmentPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as RecruitmentTab | null;
  const [activeTab, setActiveTab] = useState<RecruitmentTab>(tabParam || 'jobs');

  useEffect(() => {
    if (tabParam && ['jobs', 'walkin', 'ai-screened', 'hiring-passed'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tab: RecruitmentTab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'jobs' ? {} : { tab });
  };

  const TABS: { key: RecruitmentTab; label: string; icon: React.ElementType }[] = [
    { key: 'jobs', label: t('recruitment.jobOpenings'), icon: Briefcase },
    { key: 'walkin', label: t('recruitment.walkInCandidates'), icon: Users },
    { key: 'ai-screened', label: t('recruitment.aiScreened'), icon: Sparkles },
    { key: 'hiring-passed', label: t('recruitment.hiringPassed'), icon: Award },
  ];

  return (
    <>
      <div className="page-container">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-gray-900">{t('recruitment.title')}</h1>
            <p className="text-gray-500 text-sm mt-0.5">{t('recruitment.subtitle')}</p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="border-b border-gray-200 mb-6">
          <div className="flex gap-1 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.key
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'jobs' && <JobOpeningsTab />}
        {activeTab === 'walkin' && <WalkInTab />}
        {activeTab === 'ai-screened' && <AIScreenedTab />}
        {activeTab === 'hiring-passed' && <HiringPassedTab />}
      </div>
      <AiAssistantFab context="hr-recruitment" label="HR Recruitment Assistant" />
    </>
  );
}

// =================== Tab 1: Job Openings ===================
const JOB_STATUS_CLASSES: Record<string, string> = {
  DRAFT: 'badge-neutral',
  OPEN: 'badge-success',
  ON_HOLD: 'badge-warning',
  CLOSED: 'badge-danger',
};

function JobOpeningsTab() {
  const { t } = useTranslation();
  const JOB_STATUS_MAP: Record<string, { label: string; class: string }> = {
    DRAFT: { label: t('recruitment.draft'), class: 'badge-neutral' },
    OPEN: { label: t('recruitment.open'), class: 'badge-success' },
    ON_HOLD: { label: t('recruitment.onHold'), class: 'badge-warning' },
    CLOSED: { label: t('recruitment.closed'), class: 'badge-danger' },
  };
  const JOB_TYPE_MAP: Record<string, string> = {
    FULL_TIME: t('recruitment.fullTime'),
    PART_TIME: t('recruitment.partTime'),
    CONTRACT: t('recruitment.contract'),
    INTERNSHIP: t('recruitment.internship'),
    RESEARCH: t('recruitment.research'),
  };
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [questionsPreview, setQuestionsPreview] = useState<{ jobTitle: string; questions: any[] } | null>(null);
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const [shareJob, setShareJob] = useState<any>(null);
  const { data: jobsRes, isLoading } = useGetJobOpeningsQuery({
    page: 1, limit: 50, status: statusFilter || undefined, search: search || undefined,
  });
  const [updateJob] = useUpdateJobMutation();
  const [deleteJob] = useDeleteJobMutation();
  const [generateQuestions] = useGenerateJobQuestionsMutation();
  const { data: pipelineData } = useGetPipelineStatsQuery();
  const navigate = useNavigate();
  const jobs = jobsRes?.data || [];

  const handleGenerateQuestions = async (job: any, forceRegenerate = false) => {
    // If job already has questions and not force-regenerating, just show preview
    const existingCount = job._count?.questions || job.questions?.length || 0;
    if (existingCount > 0 && !forceRegenerate) {
      // Fetch job details to get actual questions
      try {
        setGeneratingJobId(job.id);
        const detail = await fetch(`/api/recruitment/jobs/${job.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}` },
        });
        const json = await detail.json();
        if (json.success && json.data?.questions?.length > 0) {
          setQuestionsPreview({ jobTitle: job.title, questions: json.data.questions });
          setGeneratingJobId(null);
          return;
        }
      } catch {
        // Fall through to generate
      }
    }

    setGeneratingJobId(job.id);
    try {
      const result = await generateQuestions(job.id).unwrap();
      const questions = result?.data || result || [];
      toast.success(`${Array.isArray(questions) ? questions.length : 6} screening questions ${forceRegenerate ? 'regenerated' : 'generated'}!`);
      setQuestionsPreview({ jobTitle: job.title, questions: Array.isArray(questions) ? questions : [] });
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to generate questions. Is AI configured?');
    } finally {
      setGeneratingJobId(null);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateJob({ id, data: { status } }).unwrap();
      const labels: Record<string, string> = { OPEN: 'Published', DRAFT: 'Unpublished', ON_HOLD: 'Put on hold', CLOSED: 'Closed' };
      toast.success(`Job ${labels[status] || status.toLowerCase()}!`);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleDeleteJob = async (id: string) => {
    try {
      await deleteJob(id).unwrap();
      toast.success('Job deleted!');
      setDeleteConfirm(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Cannot delete job'); setDeleteConfirm(null); }
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs..." className="input-glass w-full pl-9 text-sm" />
        </div>
        <div className="flex gap-2">
          {['', 'OPEN', 'DRAFT', 'CLOSED'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                statusFilter === s ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50')}>
              {s || 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowBulkUpload(true)} className="btn-secondary flex items-center gap-2">
            <Upload size={16} /> {t('common.upload')}
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> {t('recruitment.createJob')}
          </motion.button>
        </div>
      </div>

      {pipelineData?.data && (
        <div className="layer-card p-4 mb-6 flex items-center gap-6 overflow-x-auto">
          <span className="text-xs font-medium text-gray-400 shrink-0">Pipeline:</span>
          <div className="flex gap-4">
            {Object.entries(pipelineData.data.pipeline || {}).map(([status, count]) => (
              <div key={status} className="text-center min-w-[50px]">
                <p className="text-lg font-bold text-gray-800" data-mono>{count as number}</p>
                <p className="text-[10px] text-gray-400">{(status as string).replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
          <div className="ml-auto text-right shrink-0">
            <p className="text-lg font-bold text-brand-600" data-mono>{pipelineData.data.openJobs}</p>
            <p className="text-[10px] text-gray-400">Open Jobs</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="layer-card p-5 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-3/4 mb-3" />
              <div className="h-4 bg-gray-50 rounded w-1/2 mb-4" />
              <div className="h-8 bg-gray-50 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Briefcase size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600 mb-1">No job openings</h3>
          <p className="text-sm text-gray-400">Create your first job posting to get started</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job: any, index: number) => (
            <motion.div key={job.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }} className="layer-card p-5 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 text-sm leading-tight">{job.title}</h3>
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><MapPin size={12} /> {job.location}</p>
                </div>
                <span className={`badge ${JOB_STATUS_MAP[job.status]?.class || 'badge-neutral'} text-xs`}>
                  {JOB_STATUS_MAP[job.status]?.label || job.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-xs bg-surface-2 text-gray-500 px-2 py-0.5 rounded">{job.department}</span>
                <span className="text-xs bg-surface-2 text-gray-500 px-2 py-0.5 rounded">{JOB_TYPE_MAP[job.type] || job.type}</span>
                {job.openings > 1 && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{job.openings} openings</span>}
              </div>
              <div className="mt-auto pt-3 border-t border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Users size={14} />
                  <span className="font-mono" data-mono>{job._count?.applications || 0}</span> applicants
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {job.status === 'DRAFT' && <button onClick={() => handleStatusChange(job.id, 'OPEN')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">{t('recruitment.open')}</button>}
                  {job.status === 'OPEN' && (
                    <>
                      <button onClick={() => handleStatusChange(job.id, 'DRAFT')} className="text-xs text-amber-600 hover:text-amber-700 font-medium">{t('recruitment.draft')}</button>
                      <button onClick={() => handleStatusChange(job.id, 'ON_HOLD')} className="text-xs text-orange-600 hover:text-orange-700 font-medium">{t('recruitment.onHold')}</button>
                      <button onClick={() => handleStatusChange(job.id, 'CLOSED')} className="text-xs text-red-500 hover:text-red-600 font-medium">{t('recruitment.closed')}</button>
                    </>
                  )}
                  {job.status === 'ON_HOLD' && (
                    <>
                      <button onClick={() => handleStatusChange(job.id, 'OPEN')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">{t('recruitment.open')}</button>
                      <button onClick={() => handleStatusChange(job.id, 'CLOSED')} className="text-xs text-red-500 hover:text-red-600 font-medium">{t('recruitment.closed')}</button>
                    </>
                  )}
                  {job.status === 'CLOSED' && <button onClick={() => handleStatusChange(job.id, 'OPEN')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">{t('recruitment.open')}</button>}
                  <button onClick={() => setEditingJob(job)} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"><Pencil size={12} /> {t('common.edit')}</button>
                  {(job._count?.applications || 0) === 0 && (
                    <button onClick={() => setDeleteConfirm(job.id)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1"><Trash2 size={12} /></button>
                  )}
                  <button onClick={() => navigate(`/recruitment/${job.id}`)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Eye size={14} /> {t('common.viewAll')}</button>
                  <button
                    onClick={() => setShareJob(job)}
                    className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1 font-medium"
                    title="Share job opening link"
                  >
                    <Share2 size={12} /> {t('recruitment.shareJob')}
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>{showCreateModal && <CreateJobModal onClose={() => setShowCreateModal(false)} />}</AnimatePresence>
      <AnimatePresence>{showBulkUpload && <BulkResumeModal onClose={() => setShowBulkUpload(false)} />}</AnimatePresence>
      <AnimatePresence>{editingJob && <EditJobModal job={editingJob} onClose={() => setEditingJob(null)} />}</AnimatePresence>
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setDeleteConfirm(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 max-w-sm">
              <h3 className="text-lg font-display font-semibold text-gray-800 mb-2">{t('recruitment.deleteJob')}?</h3>
              <p className="text-sm text-gray-500 mb-5">{t('common.cannotBeUndone')}</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">{t('common.cancel')}</button>
                <button onClick={() => handleDeleteJob(deleteConfirm)} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">{t('common.delete')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {questionsPreview && (
          <QuestionsPreviewModal
            jobTitle={questionsPreview.jobTitle}
            questions={questionsPreview.questions}
            onClose={() => setQuestionsPreview(null)}
            onRegenerate={() => {
              const job = jobs.find((j: any) => j.title === questionsPreview.jobTitle);
              if (job) handleGenerateQuestions(job, true);
            }}
            isRegenerating={!!generatingJobId}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {shareJob && (
          <ShareJobModal
            isOpen={!!shareJob}
            onClose={() => setShareJob(null)}
            job={shareJob}
            allJobs={jobs}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// =================== Questions Preview Modal ===================
const CATEGORY_BADGE: Record<string, { bg: string; text: string }> = {
  INTELLIGENCE: { bg: 'bg-blue-50', text: 'text-blue-700' },
  INTEGRITY: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  ENERGY: { bg: 'bg-amber-50', text: 'text-amber-700' },
};

function QuestionsPreviewModal({ jobTitle, questions, onClose, onRegenerate, isRegenerating }: {
  jobTitle: string;
  questions: any[];
  onClose: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
              <Brain size={20} className="text-purple-600" /> AI Screening Questions
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">{jobTitle} -- {questions.length} questions generated</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onRegenerate} disabled={isRegenerating}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
              {isRegenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Regenerate
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <X size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Questions List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {questions.length === 0 ? (
            <div className="text-center py-12">
              <Brain size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">No questions to display</p>
            </div>
          ) : (
            questions.map((q: any, i: number) => {
              const cat = CATEGORY_BADGE[q.category] || { bg: 'bg-gray-50', text: 'text-gray-600' };
              return (
                <div key={q.id || i} className="layer-card p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-medium text-gray-800 flex-1">
                      <span className="text-gray-400 mr-1.5 font-mono" data-mono>Q{i + 1}.</span>
                      {q.questionText}
                    </p>
                    <span className={`shrink-0 ml-3 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cat.bg} ${cat.text}`}>
                      {q.category}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {['A', 'B', 'C', 'D'].map(opt => {
                      const isCorrect = q.correctOption === opt;
                      return (
                        <div key={opt} className={cn(
                          'text-xs px-3 py-2 rounded-lg border transition-colors',
                          isCorrect
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-medium'
                            : 'bg-gray-50 border-gray-100 text-gray-600'
                        )}>
                          <span className="font-semibold mr-1.5">{opt}.</span>
                          {q[`option${opt}`]}
                          {isCorrect && <CheckCircle2 size={12} className="inline ml-1.5 text-emerald-500" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="btn-primary text-sm">Done</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// =================== Share Job Modal ===================
function ShareJobModal({ isOpen, onClose, job, allJobs }: {
  isOpen: boolean;
  onClose: () => void;
  job: { id: string; title: string; publicFormToken?: string | null; department?: string };
  allJobs?: any[];
}) {
  const { t } = useTranslation();
  const [selectedJobId, setSelectedJobId] = useState(job.id);
  const selectedJob = allJobs?.find((j: any) => j.id === selectedJobId) || job;
  const jobUrl = selectedJob.publicFormToken ? `${window.location.origin}/apply/${selectedJob.publicFormToken}` : '';
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sendWhatsApp, { isLoading: sendingWA }] = useSendWhatsAppToNumberMutation();
  const { data: waStatus } = useGetWhatsAppStatusQuery();
  const [shareEmail, { isLoading: sendingEmail }] = useShareJobEmailMutation();
  const isWhatsAppConnected = waStatus?.data?.isConnected === true;

  const whatsappMsg = `Hi! We have an exciting job opening for *${selectedJob.title}* at Aniston Technologies LLP.\n\nApply here: ${jobUrl}\n\nFeel free to reach out for more details!\n— HR Team, Aniston Technologies`;

  const handleCopyLink = () => {
    if (!jobUrl) { toast.error('Please save the job first to generate a link'); return; }
    navigator.clipboard.writeText(jobUrl).then(() => toast.success('Link copied!')).catch(() => toast.error('Failed to copy'));
  };

  const handleWhatsAppSend = async () => {
    if (!phone.trim()) { toast.error('Enter a phone number'); return; }
    if (!jobUrl) { toast.error('No application link for this job'); return; }
    try {
      await sendWhatsApp({ phone: phone.trim(), message: whatsappMsg }).unwrap();
      toast.success('WhatsApp message sent!');
      setPhone('');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to send'); }
  };

  const handleWhatsAppOpen = () => {
    if (!jobUrl) { toast.error('Please save the job first to generate a link'); return; }
    // Open WhatsApp Web with the pre-filled message (external link)
    const encodedMsg = encodeURIComponent(whatsappMsg);
    if (phone.trim()) {
      // Direct send to number via wa.me
      window.open(`https://wa.me/${phone.trim()}?text=${encodedMsg}`, '_blank');
    } else {
      // Store the message in sessionStorage so the internal WhatsApp page can pick it up
      sessionStorage.setItem('whatsapp_prefill_message', whatsappMsg);
      window.open('/whatsapp', '_blank');
    }
  };

  const handleSendEmail = async () => {
    if (!email.trim()) { toast.error('Enter an email address'); return; }
    try {
      await shareEmail({ jobId: selectedJob.id, email: email.trim() }).unwrap();
      toast.success('Job link sent via email!');
      setEmail('');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to send email'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
              <Share2 size={20} className="text-teal-600" /> {t('recruitment.shareJob')}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Job Selector */}
          {allJobs && allJobs.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Select Job to Share</label>
              <div className="space-y-1.5 max-h-32 overflow-y-auto border border-gray-200 rounded-xl p-2">
                {allJobs.map((j: any) => (
                  <button key={j.id} onClick={() => setSelectedJobId(j.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between',
                      selectedJobId === j.id ? 'bg-brand-50 text-brand-700 font-medium ring-1 ring-brand-200' : 'hover:bg-gray-50 text-gray-600'
                    )}>
                    <span>{j.title} — {j.department || 'General'}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', j.status === 'OPEN' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>{j.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Non-OPEN warning */}
          {selectedJob.status && selectedJob.status !== 'OPEN' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <AlertCircle size={14} className="shrink-0" />
              This job is <strong>{selectedJob.status}</strong> — candidates can still apply via the link but the position may not be actively recruiting.
            </div>
          )}

          {/* Copy Link */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
              <Link size={14} className="text-indigo-500" /> Application Link
            </h4>
            {jobUrl ? (
              <div className="flex items-center gap-2">
                <input type="text" readOnly value={jobUrl} className="input-glass flex-1 text-xs text-gray-600 bg-gray-50" />
                <button onClick={handleCopyLink} className="btn-primary text-xs px-3 py-2 shrink-0">{t('common.copy')}</button>
              </div>
            ) : (
              <p className="text-xs text-amber-600">This job doesn't have a public form token yet.</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-gray-400">Share on:</span>
              <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(jobUrl)}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-brand-600 hover:underline">LinkedIn</a>
              <a href={`https://www.naukri.com/post-job?title=${encodeURIComponent(selectedJob.title || '')}&location=${encodeURIComponent(selectedJob.location || '')}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-brand-600 hover:underline">Naukri</a>
              <a href={`https://employers.indeed.com/p#/post-job?title=${encodeURIComponent(selectedJob.title || '')}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-brand-600 hover:underline">Indeed</a>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`We're hiring! ${selectedJob.title} at Aniston Technologies. Apply here:`)}&url=${encodeURIComponent(jobUrl)}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-brand-600 hover:underline">X/Twitter</a>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* WhatsApp */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
              <MessageCircle size={14} className="text-emerald-500" /> Send via WhatsApp
            </h4>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="Enter number (e.g. 919876543210) or leave blank to choose contact"
              className="input-glass w-full text-sm mb-2" />
            <div className="flex items-center gap-2">
              <button onClick={handleWhatsAppOpen}
                className="flex-1 bg-emerald-600 text-white text-xs font-medium px-3 py-2.5 rounded-lg hover:bg-emerald-700 flex items-center justify-center gap-1.5">
                <ExternalLink size={13} /> Open WhatsApp & Send
              </button>
              {isWhatsAppConnected && phone.trim() && (
                <button onClick={handleWhatsAppSend} disabled={sendingWA}
                  className="bg-emerald-100 text-emerald-700 text-xs font-medium px-3 py-2.5 rounded-lg hover:bg-emerald-200 flex items-center gap-1.5 disabled:opacity-50">
                  {sendingWA ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Quick Send
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">"Open WhatsApp" opens wa.me — choose contact there. "Quick Send" sends via connected session.</p>
          </div>

          <div className="border-t border-gray-100" />

          {/* Email */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
              <Mail size={14} className="text-rose-500" /> Send via Email
            </h4>
            <div className="flex items-center gap-2">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="candidate@example.com" className="input-glass flex-1 text-sm" />
              <button onClick={handleSendEmail} disabled={sendingEmail}
                className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5 shrink-0 disabled:opacity-50">
                {sendingEmail ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Send
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">{t('common.close')}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// =================== Tab 2: Walk-In Candidates ===================
const WI_STATUS: Record<string, { label: string; color: string; badge: string; icon: any }> = {
  WAITING:      { label: 'Waiting',      color: 'text-amber-600',   badge: 'bg-amber-50 text-amber-700 border-amber-200',   icon: Clock },
  IN_INTERVIEW: { label: 'In Interview', color: 'text-blue-600',    badge: 'bg-blue-50 text-blue-700 border-blue-200',       icon: Users },
  ON_HOLD:      { label: 'On Hold',      color: 'text-orange-600',  badge: 'bg-orange-50 text-orange-700 border-orange-200', icon: PauseCircle },
  SELECTED:     { label: 'Selected',     color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  REJECTED:     { label: 'Rejected',     color: 'text-red-600',     badge: 'bg-red-50 text-red-700 border-red-200',          icon: XCircle },
  COMPLETED:    { label: 'Completed',    color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: UserCheck },
  NO_SHOW:      { label: 'No Show',      color: 'text-red-600',     badge: 'bg-red-50 text-red-700 border-red-200',          icon: UserX },
};

const WI_STAT_CARDS = [
  { key: '', label: 'Total', icon: Users, color: 'text-gray-600', bg: 'bg-gray-50', ring: 'ring-gray-300' },
  { key: 'WAITING', label: 'Waiting', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-300' },
  { key: 'IN_INTERVIEW', label: 'In Interview', icon: AlertCircle, color: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-300' },
  { key: 'ON_HOLD', label: 'On Hold', icon: PauseCircle, color: 'text-orange-600', bg: 'bg-orange-50', ring: 'ring-orange-300' },
  { key: 'SELECTED', label: 'Selected', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-300' },
  { key: 'REJECTED', label: 'Rejected', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-300' },
  { key: 'COMPLETED', label: 'Completed', icon: UserCheck, color: 'text-emerald-600', bg: 'bg-green-50', ring: 'ring-green-300' },
  { key: 'NO_SHOW', label: 'No Show', icon: UserX, color: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-300' },
];

function WalkInTab() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useGetAllWalkInsQuery({
    search: search || undefined, status: statusFilter || undefined,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page, limit: 20,
  });
  const { data: statsRes } = useGetWalkInStatsQuery();
  const candidates = data?.data || [];
  const meta = data?.meta;
  const stats = statsRes?.data || {};

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {WI_STAT_CARDS.map(card => {
          const count = card.key ? (stats[card.key] || 0) : (stats.total || 0);
          return (
            <button key={card.key} onClick={() => { setStatusFilter(card.key); setPage(1); }}
              className={cn('stat-card flex items-center gap-3 cursor-pointer transition-all text-left',
                statusFilter === card.key && `ring-2 ${card.ring}`)}>
              <div className={`w-9 h-9 ${card.bg} rounded-lg flex items-center justify-center shrink-0`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-xl font-display font-bold text-gray-900" data-mono>{count}</p>
                <p className="text-[10px] text-gray-400 leading-tight">{card.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, email, phone, or token..." className="input-glass w-full pl-10" />
        </div>
        <div className="flex gap-2 items-center">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="input-glass w-36 text-sm" />
          <span className="text-gray-300">—</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="input-glass w-36 text-sm" />
        </div>
        <button onClick={() => refetch()} className="btn-secondary text-sm flex items-center gap-2 shrink-0">
          <RefreshCw size={14} /> Refresh
        </button>
        {(statusFilter || dateFrom || dateTo || search) && (
          <button onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); setSearch(''); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">Clear All</button>
        )}
      </div>

      {/* Candidate List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-16 layer-card">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No walk-in candidates{statusFilter ? ` with status "${WI_STATUS[statusFilter]?.label}"` : ''}</p>
          <p className="text-gray-400 text-sm mt-1">Candidates will appear here when they register via the kiosk</p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate: any, index: number) => {
            const sc = WI_STATUS[candidate.status] || WI_STATUS.WAITING;
            const StatusIcon = sc.icon;
            const roundsCompleted = candidate.interviewRounds?.filter((r: any) => r.status === 'COMPLETED').length || 0;
            const totalRounds = candidate.totalRounds || 1;
            return (
              <motion.div key={candidate.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => setSelectedId(candidate.id)}
                className="layer-card p-4 cursor-pointer hover:shadow-layer-md transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-brand-600">
                      {candidate.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 truncate">{candidate.fullName}</h3>
                      <span className="text-xs font-mono text-gray-400 shrink-0" data-mono>{candidate.tokenNumber}</span>
                      {candidate.aiScore && (
                        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5',
                          Number(candidate.aiScore) >= 70 ? 'bg-emerald-50 text-emerald-600' :
                          Number(candidate.aiScore) >= 50 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600')}>
                          <Star size={10} /> AI: {Number(candidate.aiScore).toFixed(0)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {candidate.jobOpening?.title || 'No position selected'}
                      {candidate.jobOpening?.department ? ` · ${candidate.jobOpening.department}` : ''}
                      <span className="text-xs text-gray-300 ml-2">
                        {new Date(candidate.registrationDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </p>
                  </div>
                  {candidate.status !== 'WAITING' && candidate.status !== 'NO_SHOW' && (
                    <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                      <div className="flex gap-0.5">
                        {Array.from({ length: totalRounds }).map((_, i) => (
                          <div key={i} className={`w-2 h-2 rounded-full ${i < roundsCompleted ? 'bg-emerald-400' : i === roundsCompleted ? 'bg-blue-400 animate-pulse' : 'bg-gray-200'}`} />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">{roundsCompleted}/{totalRounds}</span>
                    </div>
                  )}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border shrink-0 ${sc.badge}`}>
                    <StatusIcon className="w-3.5 h-3.5" /> {sc.label}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-500 transition-colors shrink-0" />
                </div>
              </motion.div>
            );
          })}

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-gray-400">Page {meta.page} of {meta.totalPages} ({meta.total} total)</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg disabled:opacity-30 hover:bg-gray-50">
                  <ChevronLeft size={14} /> Prev
                </button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg disabled:opacity-30 hover:bg-gray-50">
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Walk-In Detail Slide-Over */}
      <AnimatePresence>
        {selectedId && (
          <WalkInDetailSlideOver
            candidateId={selectedId}
            onClose={() => setSelectedId(null)}
            onStatusChange={() => refetch()}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// =================== Tab 3: Hiring Passed ===================
function HiringPassedTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hireModal, setHireModal] = useState<any>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: res, isLoading, refetch } = useGetSelectedCandidatesQuery({ page, limit: 20, search: search || undefined });
  const [updateStatus] = useUpdateWalkInStatusMutation();
  const [deleteWalkIn] = useDeleteWalkInMutation();

  const handleAction = async (id: string, action: string) => {
    setOpenMenu(null);
    if (action === 'REJECTED' || action === 'ON_HOLD' || action === 'WAITING') {
      const labels: Record<string, string> = { REJECTED: 'reject', ON_HOLD: 'put on hold', WAITING: 'move back to walk-in' };
      if (!confirm(`Are you sure you want to ${labels[action]} this candidate?`)) return;
      try {
        await updateStatus({ id, status: action }).unwrap();
        toast.success(`Candidate ${labels[action]}!`);
      } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
    } else if (action === 'DELETE') {
      if (!confirm('Permanently delete this candidate record?')) return;
      try {
        await deleteWalkIn(id).unwrap();
        toast.success('Candidate deleted');
      } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
    }
  };

  const candidates = res?.data || [];
  const meta = res?.meta;

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Award className="text-emerald-500" size={24} />
        <div>
          <p className="text-sm font-medium text-gray-600">Candidates who passed all interview rounds — ready for onboarding</p>
        </div>
      </div>

      <div className="relative max-w-sm mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or token..." className="input-glass w-full pl-9 text-sm" />
      </div>

      {isLoading ? (
        <div className="layer-card p-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" /></div>
      ) : candidates.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Award size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600 mb-1">No candidates ready</h3>
          <p className="text-sm text-gray-400">Candidates who pass all interview rounds will appear here</p>
        </div>
      ) : (
        <div className="layer-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Candidate</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Token</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Position</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">AI Score</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Interviews</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c: any) => {
                const avgScore = c.interviewRounds?.length > 0
                  ? Math.round(c.interviewRounds.reduce((sum: number, r: any) => sum + (r.overallScore || 0), 0) / c.interviewRounds.filter((r: any) => r.overallScore).length)
                  : null;
                return (
                  <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-sm font-bold">
                          {getInitials(c.fullName)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{c.fullName}</p>
                          <p className="text-xs text-gray-400">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell"><span className="text-xs font-mono text-gray-500" data-mono>{c.tokenNumber}</span></td>
                    <td className="py-3 px-4 hidden lg:table-cell"><span className="text-sm text-gray-600">{c.jobOpening?.title || '—'}</span></td>
                    <td className="py-3 px-4 text-center">
                      {c.aiScore ? (
                        <div className="inline-flex items-center gap-1 text-sm font-semibold">
                          <Star size={14} className={Number(c.aiScore) >= 70 ? 'text-amber-400 fill-amber-400' : 'text-gray-300'} />
                          <span className={Number(c.aiScore) >= 70 ? 'text-emerald-600' : Number(c.aiScore) >= 50 ? 'text-amber-600' : 'text-red-500'}>
                            {Number(c.aiScore).toFixed(0)}
                          </span>
                        </div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-4 text-center hidden md:table-cell">
                      <span className="text-sm font-mono text-gray-600" data-mono>{avgScore ? `${avgScore}/10` : '—'}</span>
                      <span className="text-xs text-gray-400 ml-1">({c.interviewRounds?.length || 0} rounds)</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setSelectedId(c.id)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                          <Eye size={14} /> View
                        </button>
                        <button onClick={() => setHireModal(c)}
                          className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1">
                          <UserPlus size={12} /> {t('recruitment.hire')}
                        </button>
                        <div className="relative">
                          <button onClick={() => setOpenMenu(openMenu === c.id ? null : c.id)}
                            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                            <MoreHorizontal size={16} />
                          </button>
                          {openMenu === c.id && (
                            <div className="absolute right-0 top-8 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20 w-44"
                              onMouseLeave={() => setOpenMenu(null)}>
                              <button onClick={() => handleAction(c.id, 'ON_HOLD')} className="w-full text-left px-3 py-2 text-xs text-orange-600 hover:bg-orange-50 flex items-center gap-2"><PauseCircle size={14} /> Put on Hold</button>
                              <button onClick={() => handleAction(c.id, 'REJECTED')} className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"><XCircle size={14} /> Reject</button>
                              <button onClick={() => handleAction(c.id, 'WAITING')} className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center gap-2"><RotateCcw size={14} /> Back to Walk-In</button>
                              <div className="border-t border-gray-100 my-1" />
                              <button onClick={() => handleAction(c.id, 'DELETE')} className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2"><Trash2 size={14} /> Delete Record</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">Page {meta.page} of {meta.totalPages} ({meta.total} total)</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Prev</button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {hireModal && <HireModal candidate={hireModal} onClose={() => setHireModal(null)} onSuccess={() => refetch()} />}

      <AnimatePresence>
        {selectedId && (
          <WalkInDetailSlideOver candidateId={selectedId} onClose={() => setSelectedId(null)} onStatusChange={() => refetch()} />
        )}
      </AnimatePresence>
    </>
  );
}

// =================== Walk-In Detail Slide-Over ===================
function WalkInDetailSlideOver({ candidateId, onClose, onStatusChange }: { candidateId: string; onClose: () => void; onStatusChange: () => void }) {
  const { t } = useTranslation();
  const { data: res, isLoading } = useGetWalkInByIdQuery(candidateId);
  const [updateStatus] = useUpdateWalkInStatusMutation();
  const [addNotes] = useAddWalkInNotesMutation();
  const [deleteWalkIn] = useDeleteWalkInMutation();
  const [addRound] = useAddInterviewRoundMutation();
  const [updateRound] = useUpdateInterviewRoundMutation();
  const [deleteRound] = useDeleteInterviewRoundMutation();
  const { data: interviewersRes } = useGetInterviewersQuery();
  const [tab, setTab] = useState<'overview' | 'interviews' | 'actions'>('overview');
  const [notes, setNotes] = useState('');
  const [newRound, setNewRound] = useState({ roundName: '', interviewerId: '' });
  const [resumePreview, setResumePreview] = useState<string | null>(null);
  const [showAddRound, setShowAddRound] = useState(false);
  const [hireModal, setHireModal] = useState(false);
  const [showInterviewPanel, setShowInterviewPanel] = useState(false);
  const [showAssignManager, setShowAssignManager] = useState(false);
  const [assignManagerId, setAssignManagerId] = useState('');

  const user = useAppSelector(s => s.auth.user);
  const isHR = user?.role ? ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role) : false;

  const candidate = res?.data;
  const interviewers = interviewersRes?.data || [];

  // Notes input starts empty for new entries (saved notes shown below)
  useEffect(() => {
    setNotes('');
  }, [candidateId]);

  const handleStatusChange = async (status: string) => {
    try {
      await updateStatus({ id: candidateId, status }).unwrap();
      toast.success(`Status updated to ${status}`);
      onStatusChange();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleSaveNotes = async () => {
    try {
      await addNotes({ id: candidateId, notes }).unwrap();
      toast.success('Notes saved');
    } catch (err: any) { toast.error('Failed to save notes'); }
  };

  const handleAddRound = async () => {
    if (!newRound.roundName) return;
    try {
      await addRound({ walkInId: candidateId, ...newRound }).unwrap();
      toast.success('Round added');
      setNewRound({ roundName: '', interviewerId: '' });
      setShowAddRound(false);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleScoreRound = async (roundId: string, data: any) => {
    try {
      await updateRound({ walkInId: candidateId, roundId, data }).unwrap();
      toast.success('Score saved');
      onStatusChange();
    } catch (err: any) { toast.error('Failed to save score'); }
  };

  const handleDeleteRound = async (roundId: string) => {
    if (!confirm('Delete this interview round?')) return;
    try {
      await deleteRound({ walkInId: candidateId, roundId }).unwrap();
      toast.success('Round deleted');
    } catch (err: any) { toast.error('Failed'); }
  };

  const sc = candidate ? (WI_STATUS[candidate.status] || WI_STATUS.WAITING) : WI_STATUS.WAITING;

  // Compute final score summary from walk-in rounds
  const completedRounds = (candidate?.interviewRounds || []).filter((r: any) => r.status === 'COMPLETED' && r.overallScore);
  const avgRoundScore = completedRounds.length > 0
    ? completedRounds.reduce((sum: number, r: any) => sum + Number(r.overallScore), 0) / completedRounds.length
    : null;
  const aiScore = candidate?.aiScore ? Number(candidate.aiScore) : null;

  return (
    <>
      {/* Backdrop */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.3 }}
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            {candidate && (
              <>
                <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
                  <span className="text-sm font-bold text-brand-600">{getInitials(candidate.fullName)}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">{candidate.fullName}</h3>
                  <p className="text-xs text-gray-400">{candidate.tokenNumber} · {candidate.email}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {candidate && <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${sc.badge}`}><sc.icon className="w-3.5 h-3.5" /> {sc.label}</span>}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-400" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 shrink-0">
          {(['overview', 'interviews', 'actions'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-4 py-3 text-sm font-medium border-b-2 transition-colors capitalize',
                tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>
          ) : !candidate ? (
            <p className="text-center text-gray-400 py-8">Candidate not found</p>
          ) : (
            <>
              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="layer-card p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Position</h4>
                    <p className="text-sm text-gray-800">{candidate.jobOpening?.title || '\u2014'}</p>
                    <p className="text-xs text-gray-400">{candidate.jobOpening?.department} · {candidate.jobOpening?.location}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="layer-card p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Contact</h4>
                      <p className="text-sm text-gray-600">{candidate.email}</p>
                      <p className="text-sm text-gray-600">{candidate.phone}</p>
                      {candidate.city && <p className="text-sm text-gray-600">{candidate.city}</p>}
                    </div>
                    <div className="layer-card p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Experience</h4>
                      <p className="text-sm text-gray-600">{candidate.isFresher ? 'Fresher' : `${candidate.experienceYears || 0}y ${candidate.experienceMonths || 0}m`}</p>
                      {candidate.currentCompany && <p className="text-xs text-gray-400">at {candidate.currentCompany}</p>}
                      {candidate.qualification && <p className="text-xs text-gray-400 mt-1">{candidate.qualification} \u2014 {candidate.fieldOfStudy}</p>}
                    </div>
                  </div>
                  {candidate.skills?.length > 0 && (
                    <div className="layer-card p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Skills</h4>
                      <div className="flex flex-wrap gap-2">
                        {candidate.skills.map((s: string, i: number) => (
                          <span key={i} className="text-xs bg-brand-50 text-brand-600 px-2 py-1 rounded-lg">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {candidate.aiScore && (
                    <div className="layer-card p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">AI Resume Score</h4>
                      <div className="flex items-center gap-3">
                        <div className={cn('text-2xl font-bold', Number(candidate.aiScore) >= 70 ? 'text-emerald-600' : Number(candidate.aiScore) >= 50 ? 'text-amber-600' : 'text-red-500')}>
                          {Number(candidate.aiScore).toFixed(0)}/100
                        </div>
                        <Star size={20} className="text-amber-400 fill-amber-400" />
                      </div>
                    </div>
                  )}
                  {candidate.resumeUrl && (
                    <button onClick={() => {
                      setResumePreview(getUploadUrl(candidate.resumeUrl));
                    }}
                      className="btn-secondary text-sm flex items-center gap-2 w-fit">
                      <Eye size={14} /> View Resume
                    </button>
                  )}
                </div>
              )}

              {tab === 'interviews' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-700">Interview Rounds ({candidate.interviewRounds?.length || 0})</h4>
                    <div className="flex items-center gap-2">
                      {isHR && !showInterviewPanel && (
                        <button onClick={() => setShowInterviewPanel(true)}
                          className="bg-brand-600 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-brand-700 transition-colors">
                          <ClipboardCheck size={12} /> Take Interview
                        </button>
                      )}
                      <button onClick={() => setShowAddRound(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> {t('recruitment.addInterviewRound')}</button>
                    </div>
                  </div>

                  {showAddRound && (
                    <div className="layer-card p-4 space-y-3">
                      <input value={newRound.roundName} onChange={e => setNewRound(r => ({ ...r, roundName: e.target.value }))}
                        placeholder="Round name (e.g. Technical Interview)" className="input-glass w-full text-sm" />
                      <select value={newRound.interviewerId} onChange={e => setNewRound(r => ({ ...r, interviewerId: e.target.value }))} className="input-glass w-full text-sm">
                        <option value="">Select interviewer (optional)</option>
                        {interviewers.map((i: any) => <option key={i.id} value={i.id}>{i.email}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button onClick={handleAddRound} className="btn-primary text-xs">{t('recruitment.addInterviewRound')}</button>
                        <button onClick={() => setShowAddRound(false)} className="btn-secondary text-xs">{t('common.cancel')}</button>
                      </div>
                    </div>
                  )}

                  {/* Interview Execution Panel */}
                  <AnimatePresence>
                    {showInterviewPanel && candidate && (
                      <InterviewExecutionPanel
                        candidate={candidate}
                        interviewers={interviewers}
                        onClose={() => setShowInterviewPanel(false)}
                        onStatusChange={onStatusChange}
                      />
                    )}
                  </AnimatePresence>

                  {/* Assign to Manager */}
                  {isHR && (
                    <div className="layer-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                          <UserPlus size={14} className="text-brand-600" /> Assign to Manager
                        </h5>
                        <button onClick={() => setShowAssignManager(!showAssignManager)}
                          className="text-xs text-brand-600 hover:text-brand-700">
                          {showAssignManager ? 'Cancel' : 'Assign'}
                        </button>
                      </div>
                      {showAssignManager && (
                        <AssignManagerPanel
                          candidateId={candidateId}
                          interviewers={interviewers}
                          onAssigned={() => { setShowAssignManager(false); onStatusChange(); }}
                        />
                      )}
                    </div>
                  )}

                  {(candidate.interviewRounds || []).map((round: any) => (
                    <InterviewRoundCard key={round.id} round={round}
                      onScore={(data) => handleScoreRound(round.id, data)}
                      onDelete={() => handleDeleteRound(round.id)} />
                  ))}

                  {(!candidate.interviewRounds || candidate.interviewRounds.length === 0) && !showInterviewPanel && (
                    <p className="text-center text-gray-400 text-sm py-8">No interview rounds yet</p>
                  )}

                  {/* Final Score Display */}
                  {(completedRounds.length > 0 || aiScore != null) && (
                    <div className="layer-card p-4 mt-4 border-l-4 border-brand-500">
                      <h5 className="text-sm font-display font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <Target size={16} className="text-brand-600" /> Score Summary
                      </h5>
                      <div className="space-y-2 text-sm">
                        {candidate.integrityScore != null && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Registration Integrity</span>
                            <span className="font-medium text-gray-800" data-mono>{Number(candidate.integrityScore).toFixed(0)}%</span>
                          </div>
                        )}
                        {candidate.energyScore != null && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Registration Energy</span>
                            <span className="font-medium text-gray-800" data-mono>{Number(candidate.energyScore).toFixed(0)}%</span>
                          </div>
                        )}
                        {candidate.intelligenceScore != null && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">Registration Potential</span>
                            <span className="font-medium text-gray-800" data-mono>{Number(candidate.intelligenceScore).toFixed(0)}%</span>
                          </div>
                        )}
                        {aiScore != null && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">AI Resume Score</span>
                            <span className="font-medium text-gray-800" data-mono>{aiScore.toFixed(0)}/100</span>
                          </div>
                        )}
                        {completedRounds.map((r: any, i: number) => (
                          <div key={r.id} className="flex justify-between">
                            <span className="text-gray-500">Round {r.roundNumber}: {r.roundName}</span>
                            <span className="font-medium text-gray-800" data-mono>{r.overallScore}/10</span>
                          </div>
                        ))}
                        <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between">
                          <span className="font-display font-bold text-gray-900">FINAL SCORE</span>
                          <span className="font-display font-bold text-brand-600 text-lg" data-mono>
                            {avgRoundScore != null ? avgRoundScore.toFixed(1) : '\u2014'}/10
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* HR Final Actions */}
                  {isHR && (
                    <div className="layer-card p-4 mt-4">
                      <h5 className="text-sm font-display font-bold text-gray-900 mb-3">Final Decision</h5>
                      <div className="flex gap-2">
                        <button onClick={() => handleStatusChange('SELECTED')}
                          disabled={candidate.status === 'SELECTED'}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-40">
                          <CheckCircle2 size={14} /> Selected
                        </button>
                        <button onClick={() => handleStatusChange('REJECTED')}
                          disabled={candidate.status === 'REJECTED'}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-40">
                          <XCircle size={14} /> Rejected
                        </button>
                        <button onClick={() => handleStatusChange('ON_HOLD')}
                          disabled={candidate.status === 'ON_HOLD'}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-40">
                          <PauseCircle size={14} /> On Hold
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tab === 'actions' && (
                <div className="space-y-6">
                  <div className="layer-card p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Change Status</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(WI_STATUS).map(([key, val]) => (
                        <button key={key} onClick={() => handleStatusChange(key)}
                          disabled={candidate.status === key}
                          className={cn('text-xs px-3 py-1.5 rounded-lg border transition-colors', candidate.status === key ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'hover:bg-gray-50', val.badge)}>
                          {val.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="layer-card p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Add Note</h4>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      className="input-glass w-full h-20 resize-none text-sm mb-2" placeholder="Write a note about this candidate..." />
                    <button onClick={async () => {
                      if (!notes.trim()) return;
                      await handleSaveNotes();
                      setNotes('');
                    }} className="btn-primary text-xs">Save Note</button>

                    {/* Saved notes list */}
                    {candidate.hrNotes && (
                      <div className="mt-4 space-y-2">
                        <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Previous Notes</h5>
                        {candidate.hrNotes.split('\n---\n').map((entry: string, i: number) => {
                          const match = entry.match(/^\[(.+?) — (.+?)\] (.+)$/s);
                          return (
                            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                              {match ? (
                                <>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-brand-600">{match[2]}</span>
                                    <span className="text-[10px] text-gray-400">{match[1]}</span>
                                  </div>
                                  <p className="text-xs text-gray-700">{match[3]}</p>
                                </>
                              ) : (
                                <p className="text-xs text-gray-700">{entry}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {candidate.status === 'SELECTED' && (
                    <button onClick={() => setHireModal(true)}
                      className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                      <UserPlus size={18} /> {t('recruitment.hire')}
                    </button>
                  )}

                  {/* Delete Candidate */}
                  <div className="layer-card p-4 border border-red-200 bg-red-50/50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-red-700">Delete Candidate</p>
                        <p className="text-xs text-red-500">Permanently remove this candidate and their WhatsApp messages</p>
                      </div>
                      <button onClick={async () => {
                        if (!confirm(`Delete ${candidate.name || candidate.firstName || 'this candidate'} permanently? This cannot be undone.`)) return;
                        try {
                          await deleteWalkIn(candidateId).unwrap();
                          toast.success('Candidate deleted');
                          onClose();
                          onStatusChange();
                        } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to delete'); }
                      }}
                        className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors flex items-center gap-1.5">
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>

      {hireModal && candidate && (
        <HireModal candidate={candidate} onClose={() => setHireModal(false)} onSuccess={() => { onStatusChange(); onClose(); }} />
      )}

      {/* Resume Preview Modal */}
      <AnimatePresence>
        {resumePreview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
            onClick={() => setResumePreview(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">Resume Preview</h3>
                <div className="flex items-center gap-2">
                  <a href={resumePreview} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
                    <ExternalLink size={12} /> Open in new tab
                  </a>
                  <button onClick={() => setResumePreview(null)}
                    className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} className="text-gray-400" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <iframe src={resumePreview} className="w-full h-full border-0" title="Resume" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// =================== Interview Execution Panel ===================
function InterviewExecutionPanel({ candidate, interviewers, onClose, onStatusChange }: {
  candidate: any; interviewers: any[]; onClose: () => void; onStatusChange: () => void;
}) {
  const [aiChat, { isLoading: isChatting }] = useAiChatMutation();
  const [aiResponse, setAiResponse] = useState('');
  const [score, setScore] = useState(50);
  const [feedback, setFeedback] = useState('');
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [addRound] = useAddInterviewRoundMutation();
  const [updateRound] = useUpdateInterviewRoundMutation();

  const jobTitle = candidate.jobOpening?.title || 'this position';

  const handleGenerateQuestions = async () => {
    const prompt = `Generate 8 interview questions with expected answers for a candidate applying for ${jobTitle}. Include 3 behavioral, 3 technical, and 2 situational questions. Format as numbered list with expected answer after each question.`;
    try {
      const res = await aiChat({ message: prompt, context: 'hr-recruitment' }).unwrap();
      const text = res?.data?.response || res?.data?.message || JSON.stringify(res?.data);
      setAiResponse(text);
    } catch {
      toast.error('AI assistant unavailable. Please configure AI in settings.');
    }
  };

  const handleCopyAll = () => {
    if (aiResponse) {
      navigator.clipboard.writeText(aiResponse);
      toast.success('Copied to clipboard');
    }
  };

  const handleSubmitScore = async () => {
    // Create an HR round and immediately score it
    try {
      const roundRes = await addRound({
        walkInId: candidate.id,
        roundName: 'HR Interview',
        interviewerId: '',
      }).unwrap();
      const newRoundId = roundRes?.data?.id;
      if (newRoundId) {
        await updateRound({
          walkInId: candidate.id,
          roundId: newRoundId,
          data: {
            overallScore: Math.round(score / 10), // Convert 0-100 to 0-10 scale
            remarks: feedback,
            result: score >= 50 ? 'PASSED' : 'FAILED',
            status: 'COMPLETED',
          },
        }).unwrap();
      }
      setScoreSubmitted(true);
      toast.success('Interview score submitted');
      onStatusChange();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit score');
    }
  };

  const SCORE_LABELS: Record<number, { label: string; color: string }> = {
    0: { label: 'Poor', color: 'text-red-600' },
    25: { label: 'Below Average', color: 'text-orange-600' },
    50: { label: 'Average', color: 'text-amber-600' },
    75: { label: 'Good', color: 'text-emerald-600' },
    100: { label: 'Excellent', color: 'text-emerald-700' },
  };

  const getScoreLabel = (val: number) => {
    if (val <= 12) return SCORE_LABELS[0];
    if (val <= 37) return SCORE_LABELS[25];
    if (val <= 62) return SCORE_LABELS[50];
    if (val <= 87) return SCORE_LABELS[75];
    return SCORE_LABELS[100];
  };

  const currentLabel = getScoreLabel(score);

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      className="layer-card border-2 border-brand-200 overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-brand-50 border-b border-brand-100">
        <h5 className="text-sm font-display font-bold text-brand-800 flex items-center gap-2">
          <ClipboardCheck size={16} /> Interview Execution Panel
        </h5>
        <button onClick={onClose} className="text-brand-400 hover:text-brand-600"><X size={16} /></button>
      </div>

      <div className="p-5 space-y-5">
        {/* Top: Candidate Info + AI Questions side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT: Candidate Info */}
          <div className="space-y-3">
            <h6 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Candidate Info</h6>
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center">
                  <span className="text-xs font-bold text-brand-600">{getInitials(candidate.fullName)}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{candidate.fullName}</p>
                  <p className="text-xs text-gray-400">{candidate.email} {candidate.phone ? `| ${candidate.phone}` : ''}</p>
                </div>
              </div>
              {candidate.aiScore && (
                <div className="flex items-center gap-2 text-xs">
                  <Star size={12} className="text-amber-400 fill-amber-400" />
                  <span className="text-gray-500">AI Resume Score:</span>
                  <span className="font-bold text-gray-800" data-mono>{Number(candidate.aiScore).toFixed(0)}/100</span>
                </div>
              )}
              <p className="text-xs text-gray-500">
                {candidate.jobOpening?.title} {candidate.jobOpening?.department ? `| ${candidate.jobOpening.department}` : ''}
              </p>
            </div>
          </div>

          {/* RIGHT: AI Question Generator */}
          <div className="space-y-3">
            <h6 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Question Generator</h6>
            <div className="flex gap-2">
              <button onClick={handleGenerateQuestions} disabled={isChatting}
                className="btn-primary text-xs flex items-center gap-1.5 flex-1 justify-center disabled:opacity-50">
                {isChatting ? <Loader2 size={12} className="animate-spin" /> : <Brain size={12} />}
                {aiResponse ? 'Regenerate' : 'Generate Interview Questions'}
              </button>
              {aiResponse && (
                <button onClick={handleCopyAll} className="btn-secondary text-xs flex items-center gap-1.5">
                  <Copy size={12} /> Copy All
                </button>
              )}
            </div>
            {(isChatting || aiResponse) && (
              <div className="bg-gray-50 rounded-xl p-3 max-h-48 overflow-y-auto border border-gray-100">
                {isChatting && !aiResponse ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin" /> Generating questions...
                  </div>
                ) : (
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{aiResponse}</pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM: Score Submission */}
        {!scoreSubmitted ? (
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <h6 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score Submission</h6>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Interview Score</span>
                <span className={cn('text-sm font-bold', currentLabel.color)} data-mono>
                  {score}/100 - {currentLabel.label}
                </span>
              </div>
              <input type="range" min={0} max={100} step={1} value={score}
                onChange={e => setScore(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-600" />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>0 Poor</span><span>25 Below Avg</span><span>50 Average</span><span>75 Good</span><span>100 Excellent</span>
              </div>
            </div>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
              className="input-glass w-full h-20 resize-none text-sm" placeholder="Interview feedback and observations..." />
            <button onClick={handleSubmitScore}
              className="btn-primary text-sm flex items-center gap-2 w-full justify-center">
              <Send size={14} /> Submit Score
            </button>
          </div>
        ) : (
          <div className="border-t border-gray-100 pt-4">
            <div className="bg-emerald-50 rounded-xl p-4 text-center">
              <CheckCircle2 size={28} className="text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-emerald-800">Score submitted ({score}/100)</p>
              <p className="text-xs text-emerald-600 mt-1">{feedback && `"${feedback.slice(0, 80)}${feedback.length > 80 ? '...' : ''}"`}</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// =================== Assign Manager Panel ===================
function AssignManagerPanel({ candidateId, interviewers, onAssigned }: {
  candidateId: string; interviewers: any[]; onAssigned: () => void;
}) {
  const [selectedManager, setSelectedManager] = useState('');
  const [addRound, { isLoading }] = useAddInterviewRoundMutation();

  const managers = interviewers.filter((i: any) =>
    i.role === 'MANAGER' || i.role === 'SUPER_ADMIN' || i.role === 'ADMIN'
  );

  const handleAssign = async () => {
    if (!selectedManager) { toast.error('Please select a manager'); return; }
    try {
      await addRound({
        walkInId: candidateId,
        roundName: 'Manager Interview',
        interviewerId: selectedManager,
      }).unwrap();
      const managerName = managers.find((m: any) => m.id === selectedManager)?.email || 'Manager';
      toast.success(`Interview assigned to ${managerName}`);
      onAssigned();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to assign');
    }
  };

  return (
    <div className="space-y-3 mt-2">
      <select value={selectedManager} onChange={e => setSelectedManager(e.target.value)}
        className="input-glass w-full text-sm">
        <option value="">Select a manager...</option>
        {managers.map((m: any) => (
          <option key={m.id} value={m.id}>{m.email} {m.role ? `(${m.role})` : ''}</option>
        ))}
        {managers.length === 0 && interviewers.map((i: any) => (
          <option key={i.id} value={i.id}>{i.email}</option>
        ))}
      </select>
      <button onClick={handleAssign} disabled={isLoading || !selectedManager}
        className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
        {isLoading ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
        Assign Interview
      </button>
    </div>
  );
}

// =================== Interview Round Card ===================
function InterviewRoundCard({ round, onScore, onDelete }: { round: any; onScore: (data: any) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [scores, setScores] = useState({
    communication: round.communication || '',
    technical: round.technical || '',
    problemSolving: round.problemSolving || '',
    culturalFit: round.culturalFit || '',
    overallScore: round.overallScore || '',
    remarks: round.remarks || '',
    result: round.result || '',
    status: round.status || 'PENDING',
  });

  const RESULT_COLORS: Record<string, string> = {
    PASSED: 'bg-emerald-50 text-emerald-700',
    FAILED: 'bg-red-50 text-red-700',
    ON_HOLD: 'bg-amber-50 text-amber-700',
  };

  return (
    <div className="layer-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h5 className="text-sm font-semibold text-gray-800">Round {round.roundNumber}: {round.roundName}</h5>
          <p className="text-xs text-gray-400">
            {round.interviewerName || round.interviewer?.email || 'No interviewer assigned'}
            {round.scheduledAt && ` \u00B7 ${formatDate(round.scheduledAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {round.result && <span className={`text-xs font-medium px-2 py-1 rounded-lg ${RESULT_COLORS[round.result] || ''}`}>{round.result}</span>}
          <button onClick={() => setEditing(!editing)} className="text-xs text-brand-600 hover:text-brand-700">
            {editing ? 'Cancel' : 'Score'}
          </button>
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
        </div>
      </div>

      {round.overallScore && !editing && (
        <div className="flex gap-4 text-xs text-gray-500">
          {round.communication && <span>Comm: {round.communication}/10</span>}
          {round.technical && <span>Tech: {round.technical}/10</span>}
          {round.problemSolving && <span>PS: {round.problemSolving}/10</span>}
          {round.culturalFit && <span>Fit: {round.culturalFit}/10</span>}
          <span className="font-semibold text-gray-700">Overall: {round.overallScore}/10</span>
        </div>
      )}

      {editing && (
        <div className="space-y-3 mt-3 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-5 gap-2">
            {(['communication', 'technical', 'problemSolving', 'culturalFit', 'overallScore'] as const).map(field => (
              <div key={field}>
                <label className="block text-[10px] text-gray-400 mb-1 capitalize">{field === 'problemSolving' ? 'Problem' : field === 'overallScore' ? 'Overall' : field === 'culturalFit' ? 'Culture' : field}</label>
                <input type="number" min={1} max={10} value={scores[field]}
                  onChange={e => setScores(s => ({ ...s, [field]: Number(e.target.value) }))}
                  className="input-glass w-full text-sm text-center" placeholder="1-10" />
              </div>
            ))}
          </div>
          <select value={scores.result} onChange={e => setScores(s => ({ ...s, result: e.target.value }))} className="input-glass w-full text-sm">
            <option value="">Select result</option>
            <option value="PASSED">Passed</option>
            <option value="FAILED">Failed</option>
            <option value="ON_HOLD">On Hold</option>
          </select>
          <textarea value={scores.remarks} onChange={e => setScores(s => ({ ...s, remarks: e.target.value }))}
            className="input-glass w-full text-sm h-16 resize-none" placeholder="Remarks..." />
          <button onClick={() => { onScore({ ...scores, status: 'COMPLETED' }); setEditing(false); }}
            className="btn-primary text-xs">Save Score</button>
        </div>
      )}
    </div>
  );
}

// =================== Tab: AI Screened (Public Applications) ===================
function AIScreenedTab() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data: res, isLoading } = useGetPublicApplicationsQuery({ page, limit: 20 });
  const applications = res?.data || [];
  const meta = res?.meta;

  const scoreColor = (s: number | null | undefined) => {
    if (s == null) return 'text-gray-400 bg-gray-50';
    if (s >= 70) return 'text-emerald-600 bg-emerald-50';
    if (s >= 50) return 'text-amber-600 bg-amber-50';
    return 'text-red-500 bg-red-50';
  };

  const STATUS_BADGE: Record<string, { label: string; class: string }> = {
    SUBMITTED: { label: 'Submitted', class: 'bg-blue-50 text-blue-600' },
    SHORTLISTED: { label: 'Shortlisted', class: 'bg-indigo-50 text-indigo-600' },
    INTERVIEW_SCHEDULED: { label: 'Interview Scheduled', class: 'bg-purple-50 text-purple-600' },
    SELECTED: { label: 'Selected', class: 'bg-emerald-50 text-emerald-600' },
    REJECTED: { label: 'Rejected', class: 'bg-red-50 text-red-500' },
    ON_HOLD: { label: 'On Hold', class: 'bg-amber-50 text-amber-600' },
  };

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="text-brand-500" size={24} />
        <div>
          <p className="text-sm font-medium text-gray-600">Public applications submitted via AI-powered job forms</p>
        </div>
      </div>

      {isLoading ? (
        <div className="layer-card p-16 text-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" /></div>
      ) : applications.length === 0 ? (
        <div className="layer-card p-16 text-center">
          <Sparkles size={48} className="mx-auto text-gray-200 mb-4" />
          <h3 className="text-lg font-display font-semibold text-gray-600 mb-1">No public applications yet</h3>
          <p className="text-sm text-gray-400">Candidates can apply via the public job application link with AI-generated MCQ questions</p>
        </div>
      ) : (
        <div className="layer-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Candidate UID</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Job</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Applied At</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">Resume</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">MCQ</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Intelligence</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Integrity</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500 hidden lg:table-cell">Energy</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">Total AI</th>
                  <th className="text-center py-3 px-4 text-xs font-medium text-gray-500">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app: any) => {
                  const resumeScore = typeof app.resumeScoreData === 'object' && app.resumeScoreData?.score != null
                    ? Number(app.resumeScoreData.score) : null;
                  const badge = STATUS_BADGE[app.status] || { label: app.status, class: 'bg-gray-100 text-gray-500' };
                  return (
                    <tr key={app.id} className="border-b border-gray-50 hover:bg-gray-50/30 cursor-pointer"
                      onClick={() => navigate(`/recruitment/public-applications/${app.id}`)}>
                      <td className="py-3 px-4">
                        <span className="text-xs font-mono text-brand-600 bg-brand-50 px-2 py-0.5 rounded" data-mono>{app.candidateUid}</span>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-gray-800">{app.candidateName}</p>
                        {app.email && <p className="text-xs text-gray-400">{app.email}</p>}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="text-xs text-gray-500">{app.jobOpening?.title || '—'}</span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-xs text-gray-500">{formatDate(app.createdAt)}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {resumeScore != null ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${scoreColor(resumeScore)}`} data-mono>
                            {resumeScore.toFixed(0)}
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {app.mcqScore != null ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${scoreColor(Number(app.mcqScore))}`} data-mono>
                            {Number(app.mcqScore).toFixed(0)}
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        {app.intelligenceScore != null ? (
                          <span className="text-xs font-medium text-gray-700" data-mono>{Number(app.intelligenceScore).toFixed(1)}</span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        {app.integrityScore != null ? (
                          <span className="text-xs font-medium text-gray-700" data-mono>{Number(app.integrityScore).toFixed(1)}</span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        {app.energyScore != null ? (
                          <span className="text-xs font-medium text-gray-700" data-mono>{Number(app.energyScore).toFixed(1)}</span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {app.totalAiScore != null ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${scoreColor(Number(app.totalAiScore))}`} data-mono>
                            {Number(app.totalAiScore).toFixed(1)}
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs px-2 py-1 rounded-lg font-medium ${badge.class}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/recruitment/public-applications/${app.id}`); }}
                          className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 ml-auto">
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Showing {((meta.page - 1) * meta.limit) + 1}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
              </p>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={!meta.hasPrev}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={16} />
                </button>
                <span className="px-3 py-1.5 text-xs text-gray-600 font-medium" data-mono>{meta.page} / {meta.totalPages}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={!meta.hasNext}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// =================== Hire Modal ===================
function HireModal({ candidate, onClose, onSuccess }: { candidate: any; onClose: () => void; onSuccess?: () => void }) {
  const { t } = useTranslation();
  const [teamsEmail, setTeamsEmail] = useState('');
  const [hireWalkIn, { isLoading }] = useHireWalkInMutation();
  const [result, setResult] = useState<any>(null);

  const handleHire = async () => {
    if (!teamsEmail) return toast.error('Please enter a Teams email');
    try {
      const res = await hireWalkIn({ id: candidate.id, teamsEmail }).unwrap();
      setResult(res.data);
      toast.success(`Employee ${res.data.employeeCode} created!`);
      onSuccess?.();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Hire failed'); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-semibold text-gray-800">{result ? 'Employee Created' : 'Create Employee'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {result ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <p className="text-lg font-semibold text-gray-800 mb-1">{candidate.fullName}</p>
            <p className="text-2xl font-display font-bold text-brand-600 mb-2" data-mono>{result.employeeCode}</p>
            <p className="text-sm text-gray-500 mb-1">Teams Email: {teamsEmail}</p>
            <p className="text-xs text-gray-400">Onboarding invitation has been sent</p>
            <button onClick={onClose} className="btn-primary mt-5 w-full">{t('profile.done')}</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-sm font-medium text-gray-800">{candidate.fullName}</p>
              <p className="text-xs text-gray-500">{candidate.email} · {candidate.phone}</p>
              {candidate.jobOpening && <p className="text-xs text-brand-600 mt-1">{candidate.jobOpening.title} — {candidate.jobOpening.department}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Teams / Work Email *</label>
              <input type="email" value={teamsEmail} onChange={e => setTeamsEmail(e.target.value)}
                placeholder="firstname.lastname@aniston.in" className="input-glass w-full" required />
              <p className="text-xs text-gray-400 mt-1">This will be used as the employee's login email</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
              <button onClick={handleHire} disabled={isLoading || !teamsEmail}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                <Mail size={16} /> {t('recruitment.hire')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// =================== Edit Job Modal ===================
function EditJobModal({ job, onClose }: { job: any; onClose: () => void }) {
  const { t } = useTranslation();
  const [updateJob, { isLoading }] = useUpdateJobMutation();
  const [form, setForm] = useState({
    title: job.title || '', department: job.department || '', location: job.location || '',
    type: job.type || 'FULL_TIME', experience: job.experience || '', openings: job.openings || 1,
    description: job.description || '', requirements: (job.requirements || []).join('\n'),
  });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateJob({ id: job.id, data: { ...form, requirements: form.requirements.split('\n').filter(Boolean) } }).unwrap();
      toast.success('Job updated!'); onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to update job'); }
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">{t('recruitment.editJob')}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><X size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Job Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-glass w-full" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Department *</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input-glass w-full" required /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Location *</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="input-glass w-full" required /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-glass w-full">
                <option value="FULL_TIME">{t('recruitment.fullTime')}</option><option value="PART_TIME">{t('recruitment.partTime')}</option>
                <option value="CONTRACT">{t('recruitment.contract')}</option><option value="INTERNSHIP">{t('recruitment.internship')}</option>
              </select></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Experience</label>
              <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className="input-glass w-full" /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Openings</label>
              <input type="number" value={form.openings} min={1} onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })} className="input-glass w-full" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-glass w-full h-24 resize-none" required minLength={20} /></div>
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Requirements (one per line)</label>
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} className="input-glass w-full h-20 resize-none" /></div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}{t('common.save')}</motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// =================== Create Job Modal ===================
function CreateJobModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [createJob, { isLoading }] = useCreateJobMutation();
  const [generateQuestions] = useGenerateJobQuestionsMutation();
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [form, setForm] = useState({ title: '', department: '', location: '', type: 'FULL_TIME', experience: '', openings: 1, description: '', requirements: '' });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createJob({ ...form, requirements: form.requirements.split('\n').filter(Boolean) }).unwrap();
      toast.success('Job opening created!');
      // Auto-generate screening questions for the new job
      if (autoGenerate && result?.data?.id) {
        try {
          await generateQuestions(result.data.id).unwrap();
          toast.success('AI screening questions generated!');
        } catch {
          toast.success('Job created! AI questions will use fallback set.');
        }
      }
      onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to create job'); }
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">{t('recruitment.createJob')}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><X size={18} className="text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Job Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-glass w-full" placeholder="e.g. Senior Software Engineer" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Department *</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input-glass w-full" placeholder="e.g. Engineering" required /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Location *</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="input-glass w-full" placeholder="e.g. New Delhi" required /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-glass w-full">
                <option value="FULL_TIME">{t('recruitment.fullTime')}</option><option value="PART_TIME">{t('recruitment.partTime')}</option>
                <option value="CONTRACT">{t('recruitment.contract')}</option><option value="INTERNSHIP">{t('recruitment.internship')}</option>
              </select></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Experience</label>
              <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className="input-glass w-full" placeholder="e.g. 3-5 years" /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Openings</label>
              <input type="number" value={form.openings} min={1} onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })} className="input-glass w-full" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-glass w-full h-24 resize-none" placeholder="Describe the role..." required minLength={20} /></div>
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Requirements (one per line)</label>
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} className="input-glass w-full h-20 resize-none" placeholder="3+ years React experience&#10;TypeScript proficiency" /></div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={autoGenerate} onChange={e => setAutoGenerate(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <span className="text-sm text-gray-600">Auto-generate AI screening questions (Intelligence, Integrity, Energy)</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}{t('recruitment.createJob')}</motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
