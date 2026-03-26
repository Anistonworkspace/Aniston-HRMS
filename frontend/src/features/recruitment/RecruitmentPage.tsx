import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Briefcase, Search, Users, Eye, Sparkles, X, MapPin, Clock, Pencil, Trash2, Upload,
  Award, Mail, UserPlus, Star, Loader2, MoreHorizontal, XCircle, PauseCircle, RotateCcw,
  AlertCircle, CheckCircle2, UserCheck, UserX, ChevronRight, ChevronLeft, RefreshCw,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetJobOpeningsQuery, useCreateJobMutation, useUpdateJobMutation, useDeleteJobMutation, useGetPipelineStatsQuery } from './recruitmentApi';
import {
  useGetAllWalkInsQuery, useGetWalkInStatsQuery, useGetSelectedCandidatesQuery,
  useHireWalkInMutation, useUpdateWalkInStatusMutation, useDeleteWalkInMutation,
  useGetWalkInByIdQuery, useAddWalkInNotesMutation, useAddInterviewRoundMutation,
  useUpdateInterviewRoundMutation, useDeleteInterviewRoundMutation, useGetInterviewersQuery,
} from '../walkIn/walkInApi';
import { cn, formatDate, getInitials } from '../../lib/utils';
import toast from 'react-hot-toast';
import BulkResumeModal from './BulkResumeModal';

type RecruitmentTab = 'jobs' | 'walkin' | 'hiring-passed';

// =================== Main Tabbed Page ===================
export default function RecruitmentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as RecruitmentTab | null;
  const [activeTab, setActiveTab] = useState<RecruitmentTab>(tabParam || 'jobs');

  useEffect(() => {
    if (tabParam && ['jobs', 'walkin', 'hiring-passed'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tab: RecruitmentTab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'jobs' ? {} : { tab });
  };

  const TABS: { key: RecruitmentTab; label: string; icon: React.ElementType }[] = [
    { key: 'jobs', label: 'Job Openings', icon: Briefcase },
    { key: 'walkin', label: 'Walk-In Candidates', icon: Users },
    { key: 'hiring-passed', label: 'Hiring Passed', icon: Award },
  ];

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Recruitment</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage jobs, walk-in candidates, and hiring</p>
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
      {activeTab === 'hiring-passed' && <HiringPassedTab />}
    </div>
  );
}

// =================== Tab 1: Job Openings ===================
const JOB_STATUS_MAP: Record<string, { label: string; class: string }> = {
  DRAFT: { label: 'Draft', class: 'badge-neutral' },
  OPEN: { label: 'Open', class: 'badge-success' },
  ON_HOLD: { label: 'On Hold', class: 'badge-warning' },
  CLOSED: { label: 'Closed', class: 'badge-danger' },
};
const JOB_TYPE_MAP: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACT: 'Contract', INTERNSHIP: 'Internship', RESEARCH: 'Research',
};

function JobOpeningsTab() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data: jobsRes, isLoading } = useGetJobOpeningsQuery({
    page: 1, limit: 50, status: statusFilter || undefined, search: search || undefined,
  });
  const [updateJob] = useUpdateJobMutation();
  const [deleteJob] = useDeleteJobMutation();
  const { data: pipelineData } = useGetPipelineStatsQuery();
  const navigate = useNavigate();
  const jobs = jobsRes?.data || [];

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
            <Upload size={16} /> Bulk Upload
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Post Job
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
                  {job.status === 'DRAFT' && <button onClick={() => handleStatusChange(job.id, 'OPEN')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Publish</button>}
                  {job.status === 'OPEN' && (
                    <>
                      <button onClick={() => handleStatusChange(job.id, 'DRAFT')} className="text-xs text-amber-600 hover:text-amber-700 font-medium">Unpublish</button>
                      <button onClick={() => handleStatusChange(job.id, 'ON_HOLD')} className="text-xs text-orange-600 hover:text-orange-700 font-medium">Hold</button>
                      <button onClick={() => handleStatusChange(job.id, 'CLOSED')} className="text-xs text-red-500 hover:text-red-600 font-medium">Close</button>
                    </>
                  )}
                  {job.status === 'ON_HOLD' && (
                    <>
                      <button onClick={() => handleStatusChange(job.id, 'OPEN')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Reopen</button>
                      <button onClick={() => handleStatusChange(job.id, 'CLOSED')} className="text-xs text-red-500 hover:text-red-600 font-medium">Close</button>
                    </>
                  )}
                  {job.status === 'CLOSED' && <button onClick={() => handleStatusChange(job.id, 'OPEN')} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Reopen</button>}
                  <button onClick={() => setEditingJob(job)} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"><Pencil size={12} /> Edit</button>
                  {(job._count?.applications || 0) === 0 && (
                    <button onClick={() => setDeleteConfirm(job.id)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1"><Trash2 size={12} /></button>
                  )}
                  <button onClick={() => navigate(`/recruitment/${job.id}`)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"><Eye size={14} /> View</button>
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
              <h3 className="text-lg font-display font-semibold text-gray-800 mb-2">Delete Job?</h3>
              <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={() => handleDeleteJob(deleteConfirm)} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
                          <UserPlus size={12} /> Hire
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
  const { data: res, isLoading } = useGetWalkInByIdQuery(candidateId);
  const [updateStatus] = useUpdateWalkInStatusMutation();
  const [addNotes] = useAddWalkInNotesMutation();
  const [addRound] = useAddInterviewRoundMutation();
  const [updateRound] = useUpdateInterviewRoundMutation();
  const [deleteRound] = useDeleteInterviewRoundMutation();
  const { data: interviewersRes } = useGetInterviewersQuery();
  const [tab, setTab] = useState<'overview' | 'interviews' | 'actions'>('overview');
  const [notes, setNotes] = useState('');
  const [newRound, setNewRound] = useState({ roundName: '', interviewerId: '' });
  const [showAddRound, setShowAddRound] = useState(false);
  const [hireModal, setHireModal] = useState(false);

  const candidate = res?.data;
  const interviewers = interviewersRes?.data || [];

  useEffect(() => {
    if (candidate?.hrNotes) setNotes(candidate.hrNotes);
  }, [candidate?.hrNotes]);

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
                    <p className="text-sm text-gray-800">{candidate.jobOpening?.title || '—'}</p>
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
                      {candidate.qualification && <p className="text-xs text-gray-400 mt-1">{candidate.qualification} — {candidate.fieldOfStudy}</p>}
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
                    <a href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer"
                      className="btn-secondary text-sm flex items-center gap-2 w-fit">
                      <Eye size={14} /> View Resume
                    </a>
                  )}
                </div>
              )}

              {tab === 'interviews' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-700">Interview Rounds ({candidate.interviewRounds?.length || 0})</h4>
                    <button onClick={() => setShowAddRound(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Round</button>
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
                        <button onClick={handleAddRound} className="btn-primary text-xs">Add</button>
                        <button onClick={() => setShowAddRound(false)} className="btn-secondary text-xs">Cancel</button>
                      </div>
                    </div>
                  )}

                  {(candidate.interviewRounds || []).map((round: any) => (
                    <InterviewRoundCard key={round.id} round={round}
                      onScore={(data) => handleScoreRound(round.id, data)}
                      onDelete={() => handleDeleteRound(round.id)} />
                  ))}

                  {(!candidate.interviewRounds || candidate.interviewRounds.length === 0) && (
                    <p className="text-center text-gray-400 text-sm py-8">No interview rounds yet</p>
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
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">HR Notes</h4>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      className="input-glass w-full h-24 resize-none text-sm mb-2" placeholder="Add notes about this candidate..." />
                    <button onClick={handleSaveNotes} className="btn-primary text-xs">Save Notes</button>
                  </div>

                  {candidate.status === 'SELECTED' && (
                    <button onClick={() => setHireModal(true)}
                      className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                      <UserPlus size={18} /> Hire Candidate
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>

      {hireModal && candidate && (
        <HireModal candidate={candidate} onClose={() => setHireModal(false)} onSuccess={() => { onStatusChange(); onClose(); }} />
      )}
    </>
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
            {round.scheduledAt && ` · ${formatDate(round.scheduledAt)}`}
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

// =================== Hire Modal ===================
function HireModal({ candidate, onClose, onSuccess }: { candidate: any; onClose: () => void; onSuccess?: () => void }) {
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
            <button onClick={onClose} className="btn-primary mt-5 w-full">Done</button>
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
              <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleHire} disabled={isLoading || !teamsEmail}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                <Mail size={16} /> Create & Send Invite
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
          <h2 className="text-lg font-display font-semibold text-gray-800">Edit Job</h2>
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
                <option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option><option value="INTERNSHIP">Internship</option>
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
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}Save Changes</motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// =================== Create Job Modal ===================
function CreateJobModal({ onClose }: { onClose: () => void }) {
  const [createJob, { isLoading }] = useCreateJobMutation();
  const [form, setForm] = useState({ title: '', department: '', location: '', type: 'FULL_TIME', experience: '', openings: 1, description: '', requirements: '' });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createJob({ ...form, requirements: form.requirements.split('\n').filter(Boolean) }).unwrap();
      toast.success('Job opening created!'); onClose();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to create job'); }
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Post New Job</h2>
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
                <option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option><option value="INTERNSHIP">Internship</option>
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
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}Create Job</motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
