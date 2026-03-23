import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Star, ChevronDown, ExternalLink } from 'lucide-react';
import { useMoveApplicationStageMutation } from './recruitmentApi';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const STAGES = [
  { key: 'APPLIED', label: 'Applied', color: 'bg-gray-100 text-gray-700' },
  { key: 'SCREENING', label: 'Screening', color: 'bg-blue-50 text-blue-700' },
  { key: 'ASSESSMENT', label: 'Assessment', color: 'bg-indigo-50 text-indigo-700' },
  { key: 'INTERVIEW_1', label: 'Interview 1', color: 'bg-purple-50 text-purple-700' },
  { key: 'INTERVIEW_2', label: 'Interview 2', color: 'bg-violet-50 text-violet-700' },
  { key: 'HR_ROUND', label: 'HR Round', color: 'bg-amber-50 text-amber-700' },
  { key: 'FINAL_ROUND', label: 'Final', color: 'bg-orange-50 text-orange-700' },
  { key: 'OFFER', label: 'Offer', color: 'bg-emerald-50 text-emerald-700' },
];

const SOURCE_BADGE: Record<string, string> = {
  PORTAL: 'badge-info',
  NAUKRI: 'badge-warning',
  LINKEDIN: 'badge-info',
  REFERENCE: 'badge-success',
  CAMPUS: 'badge-neutral',
  WALK_IN: 'badge-danger',
};

interface KanbanBoardProps {
  applications: any[];
  jobId: string;
}

export default function KanbanBoard({ applications, jobId }: KanbanBoardProps) {
  const [moveStage] = useMoveApplicationStageMutation();
  const navigate = useNavigate();

  const handleMoveStage = async (appId: string, newStatus: string) => {
    try {
      await moveStage({ id: appId, status: newStatus }).unwrap();
      toast.success(`Moved to ${STAGES.find(s => s.key === newStatus)?.label}`);
    } catch {
      toast.error('Failed to move application');
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 custom-scrollbar">
      {STAGES.map((stage) => {
        const stageApps = applications.filter((a: any) => a.status === stage.key);
        return (
          <div key={stage.key} className="min-w-[260px] w-[260px] shrink-0">
            {/* Column Header */}
            <div className={`rounded-t-lg px-3 py-2 ${stage.color} flex items-center justify-between`}>
              <span className="text-sm font-medium">{stage.label}</span>
              <span className="text-xs font-mono opacity-70">{stageApps.length}</span>
            </div>

            {/* Column Body */}
            <div className="bg-gray-50/50 rounded-b-lg border border-gray-100 border-t-0 p-2 space-y-2 min-h-[200px]">
              {stageApps.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-300">No candidates</div>
              ) : (
                stageApps.map((app: any) => (
                  <CandidateCard
                    key={app.id}
                    app={app}
                    currentStage={stage.key}
                    onMoveStage={handleMoveStage}
                    onViewDetail={() => navigate(`/recruitment/candidate/${app.id}`)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}

      {/* Terminal columns */}
      {['OFFER_ACCEPTED', 'JOINED', 'REJECTED', 'WITHDRAWN'].map((status) => {
        const stageApps = applications.filter((a: any) => a.status === status);
        if (stageApps.length === 0) return null;
        const labels: Record<string, string> = {
          OFFER_ACCEPTED: 'Accepted', JOINED: 'Joined', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
        };
        const colors: Record<string, string> = {
          OFFER_ACCEPTED: 'bg-emerald-100 text-emerald-800', JOINED: 'bg-green-100 text-green-800',
          REJECTED: 'bg-red-50 text-red-700', WITHDRAWN: 'bg-gray-100 text-gray-600',
        };
        return (
          <div key={status} className="min-w-[220px] w-[220px] shrink-0">
            <div className={`rounded-t-lg px-3 py-2 ${colors[status]} flex items-center justify-between`}>
              <span className="text-sm font-medium">{labels[status]}</span>
              <span className="text-xs font-mono opacity-70">{stageApps.length}</span>
            </div>
            <div className="bg-gray-50/50 rounded-b-lg border border-gray-100 border-t-0 p-2 space-y-2 min-h-[100px]">
              {stageApps.map((app: any) => (
                <CandidateCard
                  key={app.id}
                  app={app}
                  currentStage={status}
                  onMoveStage={handleMoveStage}
                  onViewDetail={() => navigate(`/recruitment/candidate/${app.id}`)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CandidateCard({ app, currentStage, onMoveStage, onViewDetail }: {
  app: any; currentStage: string; onMoveStage: (id: string, stage: string) => void; onViewDetail: () => void;
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onViewDetail}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center">
            <span className="text-[10px] font-bold text-brand-600">
              {app.candidateName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 leading-tight">{app.candidateName}</p>
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <Mail className="w-3 h-3" /> {app.email}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className={`badge text-[10px] ${SOURCE_BADGE[app.source] || 'badge-neutral'}`}>
          {app.source}
        </span>

        {app.aiScore && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
            <Star className="w-3 h-3 fill-amber-400" /> {Number(app.aiScore).toFixed(1)}
          </span>
        )}
      </div>

      {/* Move Stage Dropdown */}
      <div className="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowMoveMenu(!showMoveMenu); }}
            className="text-[10px] text-brand-600 hover:bg-brand-50 px-1.5 py-0.5 rounded flex items-center gap-0.5"
          >
            Move <ChevronDown className="w-3 h-3" />
          </button>
          {showMoveMenu && (
            <div
              className="absolute left-0 top-6 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]"
              onMouseLeave={() => setShowMoveMenu(false)}
            >
              {STAGES.filter(s => s.key !== currentStage).map(stage => (
                <button
                  key={stage.key}
                  onClick={(e) => { e.stopPropagation(); onMoveStage(app.id, stage.key); setShowMoveMenu(false); }}
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-700"
                >
                  {stage.label}
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onMoveStage(app.id, 'REJECTED'); setShowMoveMenu(false); }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}
