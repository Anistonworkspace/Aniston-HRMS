import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Briefcase, MapPin, Users, Calendar, Loader2, MessageCircle, X, Send, Link } from 'lucide-react';
import { useGetJobByIdQuery, useGetApplicationsQuery } from './recruitmentApi';
import { useShareJobViaWhatsAppMutation } from '../walkIn/walkInApi';
import KanbanBoard from './KanbanBoard';
import toast from 'react-hot-toast';

const JOB_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACT: 'Contract',
  INTERNSHIP: 'Internship', RESEARCH: 'Research',
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-neutral', OPEN: 'badge-success', ON_HOLD: 'badge-warning', CLOSED: 'badge-danger',
};

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [showWaShare, setShowWaShare] = useState(false);
  const [waPhone, setWaPhone] = useState('');
  const [shareJobViaWhatsApp, { isLoading: isSharingWa }] = useShareJobViaWhatsAppMutation();

  const { data: jobData, isLoading: jobLoading } = useGetJobByIdQuery(jobId!, { pollingInterval: 30_000 });
  const { data: appsData, isLoading: appsLoading } = useGetApplicationsQuery({ jobId: jobId! }, { pollingInterval: 15_000 });

  const job = jobData?.data;
  const applications = appsData?.data || job?.applications || [];

  if (jobLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary-color)' }} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="page-container text-center py-16">
        <p className="text-gray-500">Job opening not found</p>
      </div>
    );
  }

  // Pipeline stats
  const stageCounts: Record<string, number> = {};
  applications.forEach((a: any) => {
    stageCounts[a.status] = (stageCounts[a.status] || 0) + 1;
  });

  return (
    <div className="page-container">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <button
          onClick={() => navigate('/recruitment')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Recruitment
        </button>

        <div className="layer-card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-display font-bold text-gray-900">{job.title}</h1>
                <span className={`badge ${STATUS_BADGE[job.status] || 'badge-neutral'}`}>{job.status}</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1"><Briefcase className="w-4 h-4" /> {job.department}</span>
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {job.location}</span>
                <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {job.openings} opening{job.openings > 1 ? 's' : ''}</span>
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" /> {JOB_TYPE_LABEL[job.type] || job.type}</span>
              </div>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div>
                <p className="text-2xl font-display font-bold" style={{ color: 'var(--primary-color)' }} data-mono>{applications.length}</p>
                <p className="text-xs text-gray-400">Total Applicants</p>
              </div>
              {job.publicFormEnabled && job.publicFormToken && (
                <div className="flex gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/apply/${job.publicFormToken}`); toast.success('Application link copied!'); }}
                    className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3"
                  >
                    <Link size={12} /> Copy Link
                  </button>
                  <button
                    onClick={() => setShowWaShare(true)}
                    className="text-xs flex items-center gap-1 py-1.5 px-3 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                  >
                    <MessageCircle size={12} /> Share via WhatsApp
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Pipeline Summary Bar */}
          {applications.length > 0 && (
            <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100 overflow-x-auto">
              {Object.entries(stageCounts).map(([status, count]) => (
                <div key={status} className="text-center min-w-[60px]">
                  <p className="text-lg font-bold text-gray-800" data-mono>{count}</p>
                  <p className="text-[10px] text-gray-400">{status.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Kanban Board */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {appsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary-color)' }} />
          </div>
        ) : (
          <KanbanBoard applications={applications} jobId={jobId!} />
        )}
      </motion.div>

      {/* WhatsApp Job Link Share Modal */}
      <AnimatePresence>
        {showWaShare && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold text-gray-900">Share Job via WhatsApp</h3>
                </div>
                <button onClick={() => setShowWaShare(false)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Candidate Phone Number <span className="text-red-500">*</span></label>
                  <input value={waPhone} onChange={e => setWaPhone(e.target.value)} className="input-glass w-full text-sm" placeholder="10-digit mobile number" maxLength={10} />
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-gray-600 leading-relaxed">
                  <p className="font-medium text-green-700 mb-1">Message Preview:</p>
                  <p>Hello! Aniston Technologies LLP is hiring for <strong>{job.title}</strong> ({job.department} | {job.location}).<br />Apply here: <span className="text-blue-600">https://hr.anistonav.com/apply/{job.publicFormToken}</span></p>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setShowWaShare(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                  <button
                    onClick={async () => {
                      if (!waPhone.trim()) { toast.error('Phone number required'); return; }
                      try {
                        await shareJobViaWhatsApp({ jobId: jobId!, phone: waPhone.trim() }).unwrap();
                        toast.success('Job link sent via WhatsApp');
                        setShowWaShare(false);
                        setWaPhone('');
                      } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to send WhatsApp message'); }
                    }}
                    disabled={isSharingWa}
                    className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
                  >
                    {isSharingWa ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Send via WhatsApp
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
