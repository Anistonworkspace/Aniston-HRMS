import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Briefcase, MapPin, Users, Calendar, Loader2 } from 'lucide-react';
import { useGetJobByIdQuery, useGetApplicationsQuery } from './recruitmentApi';
import KanbanBoard from './KanbanBoard';

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

  const { data: jobData, isLoading: jobLoading } = useGetJobByIdQuery(jobId!);
  const { data: appsData, isLoading: appsLoading } = useGetApplicationsQuery({ jobId: jobId! });

  const job = jobData?.data;
  const applications = appsData?.data || job?.applications || [];

  if (jobLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
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
            <div className="text-right">
              <p className="text-2xl font-display font-bold text-brand-600" data-mono>{applications.length}</p>
              <p className="text-xs text-gray-400">Total Applicants</p>
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
            <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
          </div>
        ) : (
          <KanbanBoard applications={applications} jobId={jobId!} />
        )}
      </motion.div>
    </div>
  );
}
