import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Briefcase, Search, Users, Eye, Sparkles, X, MapPin, Clock, Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetJobOpeningsQuery, useCreateJobMutation, useUpdateJobMutation, useDeleteJobMutation, useGetPipelineStatsQuery } from './recruitmentApi';
import { cn, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

const JOB_STATUS_MAP: Record<string, { label: string; class: string }> = {
  DRAFT: { label: 'Draft', class: 'badge-neutral' },
  OPEN: { label: 'Open', class: 'badge-success' },
  ON_HOLD: { label: 'On Hold', class: 'badge-warning' },
  CLOSED: { label: 'Closed', class: 'badge-danger' },
};

const JOB_TYPE_MAP: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  RESEARCH: 'Research',
};

export default function RecruitmentPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
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
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed');
    }
  };

  const handleDeleteJob = async (id: string) => {
    try {
      await deleteJob(id).unwrap();
      toast.success('Job deleted!');
      setDeleteConfirm(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Cannot delete job');
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="page-container">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Recruitment</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage job openings and candidates</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2 self-start"
        >
          <Plus size={18} />
          Post Job
        </motion.button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs..."
            className="input-glass w-full pl-9 text-sm"
          />
        </div>
        <div className="flex gap-2">
          {['', 'OPEN', 'DRAFT', 'CLOSED'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                statusFilter === s ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              )}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline Stats */}
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

      {/* Job Cards Grid */}
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
            <motion.div
              key={job.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="layer-card p-5 flex flex-col"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 text-sm leading-tight">{job.title}</h3>
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <MapPin size={12} /> {job.location}
                  </p>
                </div>
                <span className={`badge ${JOB_STATUS_MAP[job.status]?.class || 'badge-neutral'} text-xs`}>
                  {JOB_STATUS_MAP[job.status]?.label || job.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-xs bg-surface-2 text-gray-500 px-2 py-0.5 rounded">{job.department}</span>
                <span className="text-xs bg-surface-2 text-gray-500 px-2 py-0.5 rounded">{JOB_TYPE_MAP[job.type] || job.type}</span>
                {job.openings > 1 && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{job.openings} openings</span>
                )}
              </div>

              <div className="mt-auto pt-3 border-t border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Users size={14} />
                  <span className="font-mono" data-mono>{job._count?.applications || 0}</span> applicants
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {job.status === 'DRAFT' && (
                    <button onClick={() => handleStatusChange(job.id, 'OPEN')}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Publish</button>
                  )}
                  {job.status === 'OPEN' && (
                    <>
                      <button onClick={() => handleStatusChange(job.id, 'DRAFT')}
                        className="text-xs text-amber-600 hover:text-amber-700 font-medium">Unpublish</button>
                      <button onClick={() => handleStatusChange(job.id, 'ON_HOLD')}
                        className="text-xs text-orange-600 hover:text-orange-700 font-medium">Hold</button>
                      <button onClick={() => handleStatusChange(job.id, 'CLOSED')}
                        className="text-xs text-red-500 hover:text-red-600 font-medium">Close</button>
                    </>
                  )}
                  {job.status === 'ON_HOLD' && (
                    <>
                      <button onClick={() => handleStatusChange(job.id, 'OPEN')}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Reopen</button>
                      <button onClick={() => handleStatusChange(job.id, 'CLOSED')}
                        className="text-xs text-red-500 hover:text-red-600 font-medium">Close</button>
                    </>
                  )}
                  {job.status === 'CLOSED' && (
                    <button onClick={() => handleStatusChange(job.id, 'OPEN')}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">Reopen</button>
                  )}
                  <button onClick={() => setEditingJob(job)}
                    className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
                    <Pencil size={12} /> Edit
                  </button>
                  {(job._count?.applications || 0) === 0 && (
                    <button onClick={() => setDeleteConfirm(job.id)}
                      className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                      <Trash2 size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/recruitment/${job.id}`)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                    <Eye size={14} /> View
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Job Modal */}
      <AnimatePresence>
        {showCreateModal && <CreateJobModal onClose={() => setShowCreateModal(false)} />}
      </AnimatePresence>

      {/* Edit Job Modal */}
      <AnimatePresence>
        {editingJob && <EditJobModal job={editingJob} onClose={() => setEditingJob(null)} />}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setDeleteConfirm(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl p-6 max-w-sm">
              <h3 className="text-lg font-display font-semibold text-gray-800 mb-2">Delete Job?</h3>
              <p className="text-sm text-gray-500 mb-5">This action cannot be undone. The job posting will be permanently removed.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={() => handleDeleteJob(deleteConfirm)} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors">Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EditJobModal({ job, onClose }: { job: any; onClose: () => void }) {
  const [updateJob, { isLoading }] = useUpdateJobMutation();
  const [form, setForm] = useState({
    title: job.title || '',
    department: job.department || '',
    location: job.location || '',
    type: job.type || 'FULL_TIME',
    experience: job.experience || '',
    openings: job.openings || 1,
    description: job.description || '',
    requirements: (job.requirements || []).join('\n'),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateJob({
        id: job.id,
        data: { ...form, requirements: form.requirements.split('\n').filter(Boolean) },
      }).unwrap();
      toast.success('Job updated!');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to update job');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Edit Job</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Job Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input-glass w-full" placeholder="e.g. Senior Software Engineer" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Department *</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="input-glass w-full" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Location *</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="input-glass w-full" required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-glass w-full">
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option>
                <option value="INTERNSHIP">Internship</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Experience</label>
              <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className="input-glass w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Openings</label>
              <input type="number" value={form.openings} min={1} onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })} className="input-glass w-full" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Job Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-glass w-full h-24 resize-none" required minLength={20} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Requirements (one per line)</label>
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              className="input-glass w-full h-20 resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Save Changes
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function CreateJobModal({ onClose }: { onClose: () => void }) {
  const [createJob, { isLoading }] = useCreateJobMutation();
  const [form, setForm] = useState({
    title: '',
    department: '',
    location: '',
    type: 'FULL_TIME',
    experience: '',
    openings: 1,
    description: '',
    requirements: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createJob({
        ...form,
        requirements: form.requirements.split('\n').filter(Boolean),
      }).unwrap();
      toast.success('Job opening created!');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create job');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Post New Job</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Job Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="input-glass w-full" placeholder="e.g. Senior Software Engineer" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Department *</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="input-glass w-full" placeholder="e.g. Engineering" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Location *</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="input-glass w-full" placeholder="e.g. New Delhi" required />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="input-glass w-full">
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option>
                <option value="INTERNSHIP">Internship</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Experience</label>
              <input value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })}
                className="input-glass w-full" placeholder="e.g. 3-5 years" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Openings</label>
              <input type="number" value={form.openings} min={1}
                onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })}
                className="input-glass w-full" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Job Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-glass w-full h-24 resize-none" placeholder="Describe the role..." required minLength={20} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Requirements (one per line)</label>
            <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              className="input-glass w-full h-20 resize-none" placeholder="3+ years React experience&#10;TypeScript proficiency&#10;Team leadership skills" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
              type="submit" disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Create Job
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
