import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Mail, Star, ChevronDown, ExternalLink, CheckSquare, Square,
  Trash2, ArrowRight, XCircle, Loader2,
} from 'lucide-react';
import { useMoveApplicationStageMutation } from './recruitmentApi';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const STAGES = [
  { key: 'APPLIED', label: 'Applied', color: 'bg-gray-100 text-gray-700', border: 'border-gray-300' },
  { key: 'SCREENING', label: 'Screening', color: 'bg-blue-50 text-blue-700', border: 'border-blue-300' },
  { key: 'ASSESSMENT', label: 'Assessment', color: 'bg-indigo-50 text-indigo-700', border: 'border-indigo-300' },
  { key: 'INTERVIEW_1', label: 'Interview 1', color: 'bg-purple-50 text-purple-700', border: 'border-purple-300' },
  { key: 'INTERVIEW_2', label: 'Interview 2', color: 'bg-violet-50 text-violet-700', border: 'border-violet-300' },
  { key: 'HR_ROUND', label: 'HR Round', color: 'bg-amber-50 text-amber-700', border: 'border-amber-300' },
  { key: 'FINAL_ROUND', label: 'Final', color: 'bg-orange-50 text-orange-700', border: 'border-orange-300' },
  { key: 'OFFER', label: 'Offer', color: 'bg-emerald-50 text-emerald-700', border: 'border-emerald-300' },
];

const TERMINAL_STAGES = [
  { key: 'OFFER_ACCEPTED', label: 'Accepted', color: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-400' },
  { key: 'JOINED', label: 'Joined', color: 'bg-green-100 text-green-800', border: 'border-green-400' },
  { key: 'REJECTED', label: 'Rejected', color: 'bg-red-50 text-red-700', border: 'border-red-300' },
  { key: 'WITHDRAWN', label: 'Withdrawn', color: 'bg-gray-100 text-gray-600', border: 'border-gray-300' },
];

const SOURCE_BADGE: Record<string, string> = {
  PORTAL: 'badge-info',
  NAUKRI: 'badge-warning',
  LINKEDIN: 'badge-info',
  REFERENCE: 'badge-success',
  CAMPUS: 'badge-neutral',
  WALK_IN: 'badge-danger',
};

// Valid stage transitions (mirrors backend state machine)
const VALID_TRANSITIONS: Record<string, string[]> = {
  APPLIED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
  SCREENING: ['ASSESSMENT', 'INTERVIEW_1', 'REJECTED', 'WITHDRAWN'],
  ASSESSMENT: ['INTERVIEW_1', 'INTERVIEW_2', 'HR_ROUND', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW_1: ['INTERVIEW_2', 'HR_ROUND', 'FINAL_ROUND', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW_2: ['HR_ROUND', 'FINAL_ROUND', 'REJECTED', 'WITHDRAWN'],
  HR_ROUND: ['FINAL_ROUND', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  FINAL_ROUND: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['OFFER_ACCEPTED', 'OFFER_REJECTED', 'NEGOTIATING', 'WITHDRAWN'],
  OFFER_ACCEPTED: ['JOINED'],
};

interface KanbanBoardProps {
  applications: any[];
  jobId: string;
}

export default function KanbanBoard({ applications, jobId }: KanbanBoardProps) {
  const [moveStage, { isLoading: isMoving }] = useMoveApplicationStageMutation();
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const draggingId = useRef<string | null>(null);
  const draggingFromStage = useRef<string | null>(null);

  const handleMoveStage = useCallback(async (appId: string, newStatus: string, fromStage?: string) => {
    // Validate transition
    const from = fromStage || applications.find(a => a.id === appId)?.status;
    if (from && VALID_TRANSITIONS[from] && !VALID_TRANSITIONS[from].includes(newStatus)) {
      toast.error(`Cannot move from ${from} to ${newStatus}`);
      return;
    }
    try {
      await moveStage({ id: appId, status: newStatus }).unwrap();
      toast.success(`Moved to ${[...STAGES, ...TERMINAL_STAGES].find(s => s.key === newStatus)?.label || newStatus}`);
      setSelectedIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to move application');
    }
  }, [applications, moveStage]);

  const handleBulkMove = async (newStatus: string) => {
    if (selectedIds.size === 0) return;
    setBulkMoving(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    for (const id of ids) {
      try {
        await moveStage({ id, status: newStatus }).unwrap();
        successCount++;
      } catch { /* individual failures logged server-side */ }
    }
    setBulkMoving(false);
    setSelectedIds(new Set());
    toast.success(`Moved ${successCount}/${ids.length} candidates to ${[...STAGES, ...TERMINAL_STAGES].find(s => s.key === newStatus)?.label}`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // ── Drag handlers ──
  const onDragStart = (e: React.DragEvent, appId: string, fromStage: string) => {
    draggingId.current = appId;
    draggingFromStage.current = fromStage;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', appId);
  };

  const onDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stageKey);
  };

  const onDragLeave = () => setDragOverStage(null);

  const onDrop = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = draggingId.current;
    const from = draggingFromStage.current;
    draggingId.current = null;
    draggingFromStage.current = null;
    if (!id || stageKey === from) return;
    handleMoveStage(id, stageKey, from || undefined);
  };

  const onDragEnd = () => setDragOverStage(null);

  const allStages = [...STAGES, ...TERMINAL_STAGES];

  return (
    <div className="space-y-3">
      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3"
          >
            <span className="text-sm font-medium text-brand-700">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {['SCREENING', 'INTERVIEW_1', 'HR_ROUND', 'OFFER'].map(stage => (
                <button key={stage} disabled={bulkMoving} onClick={() => handleBulkMove(stage)}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-white border border-brand-200 text-brand-600 hover:bg-brand-100 transition-colors disabled:opacity-50">
                  {bulkMoving ? <Loader2 size={11} className="animate-spin" /> : <ArrowRight size={11} />}
                  {STAGES.find(s => s.key === stage)?.label}
                </button>
              ))}
              <button disabled={bulkMoving} onClick={() => handleBulkMove('REJECTED')}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50">
                <XCircle size={11} /> Reject all
              </button>
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-gray-400 hover:text-gray-600">
              <XCircle size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-4 custom-scrollbar">
        {STAGES.map((stage) => {
          const stageApps = applications.filter((a: any) => a.status === stage.key);
          const isOver = dragOverStage === stage.key;
          return (
            <div
              key={stage.key}
              className={`min-w-[260px] w-[260px] shrink-0 rounded-xl transition-all duration-150 ${isOver ? 'ring-2 ring-brand-400 ring-offset-1 scale-[1.01]' : ''}`}
              onDragOver={e => onDragOver(e, stage.key)}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, stage.key)}
            >
              {/* Column Header */}
              <div className={`rounded-t-xl px-3 py-2.5 ${stage.color} flex items-center justify-between`}>
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="text-xs font-mono opacity-70 tabular-nums">{stageApps.length}</span>
              </div>

              {/* Drop Zone Body */}
              <div className={`bg-gray-50/60 rounded-b-xl border border-t-0 p-2 space-y-2 min-h-[200px] transition-colors ${
                isOver ? 'bg-brand-50/40 border-brand-300' : 'border-gray-100'
              }`}>
                {stageApps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-xs text-gray-300 gap-1">
                    <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center">
                      <User size={14} className="opacity-40" />
                    </div>
                    Drop here
                  </div>
                ) : (
                  stageApps.map((app: any) => (
                    <CandidateCard
                      key={app.id}
                      app={app}
                      currentStage={stage.key}
                      isSelected={selectedIds.has(app.id)}
                      onSelect={() => toggleSelect(app.id)}
                      onMoveStage={handleMoveStage}
                      onViewDetail={() => navigate(`/recruitment/candidate/${app.id}`)}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}

        {/* Terminal columns — only shown when they have candidates */}
        {TERMINAL_STAGES.map((stage) => {
          const stageApps = applications.filter((a: any) => a.status === stage.key);
          if (stageApps.length === 0) return null;
          return (
            <div key={stage.key} className="min-w-[220px] w-[220px] shrink-0">
              <div className={`rounded-t-xl px-3 py-2.5 ${stage.color} flex items-center justify-between`}>
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="text-xs font-mono opacity-70">{stageApps.length}</span>
              </div>
              <div className="bg-gray-50/50 rounded-b-xl border border-gray-100 border-t-0 p-2 space-y-2 min-h-[100px]">
                {stageApps.map((app: any) => (
                  <CandidateCard
                    key={app.id}
                    app={app}
                    currentStage={stage.key}
                    isSelected={selectedIds.has(app.id)}
                    onSelect={() => toggleSelect(app.id)}
                    onMoveStage={handleMoveStage}
                    onViewDetail={() => navigate(`/recruitment/candidate/${app.id}`)}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CandidateCard({
  app, currentStage, isSelected, onSelect, onMoveStage, onViewDetail, onDragStart, onDragEnd,
}: {
  app: any;
  currentStage: string;
  isSelected: boolean;
  onSelect: () => void;
  onMoveStage: (id: string, stage: string, from?: string) => void;
  onViewDetail: () => void;
  onDragStart: (e: React.DragEvent, id: string, stage: string) => void;
  onDragEnd: () => void;
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const allowedNext = VALID_TRANSITIONS[currentStage] || [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      draggable
      onDragStart={e => onDragStart(e, app.id, currentStage)}
      onDragEnd={onDragEnd}
      className={`bg-white rounded-lg border shadow-sm p-3 cursor-grab active:cursor-grabbing select-none hover:shadow-md transition-all ${
        isSelected ? 'border-brand-400 ring-1 ring-brand-300 bg-brand-50/20' : 'border-gray-100'
      }`}
      onClick={onViewDetail}
    >
      <div className="flex items-start justify-between mb-2">
        {/* Checkbox — stops propagation so clicking it doesn't open detail page */}
        <button
          className="mt-0.5 mr-1.5 shrink-0 text-gray-300 hover:text-brand-500 transition-colors"
          onClick={e => { e.stopPropagation(); onSelect(); }}
        >
          {isSelected ? <CheckSquare size={14} className="text-brand-500" /> : <Square size={14} />}
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-brand-600">
              {app.candidateName?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 leading-tight truncate">{app.candidateName}</p>
            <p className="text-[10px] text-gray-400 flex items-center gap-1 truncate">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate">{app.email}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className={`badge text-[10px] ${SOURCE_BADGE[app.source] || 'badge-neutral'}`}>
          {app.source}
        </span>
        {(app.aiScore != null || app.totalAiScore != null) && (
          <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
            <Star className="w-3 h-3 fill-amber-400" />
            {Number(app.totalAiScore ?? app.aiScore).toFixed(1)}
          </span>
        )}
      </div>

      {/* Move Stage Dropdown + View button */}
      <div className="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); setShowMoveMenu(!showMoveMenu); }}
            className="text-[10px] text-brand-600 hover:bg-brand-50 px-1.5 py-0.5 rounded flex items-center gap-0.5"
          >
            Move <ChevronDown className="w-3 h-3" />
          </button>
          {showMoveMenu && (
            <div
              className="absolute left-0 top-6 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[150px]"
              onMouseLeave={() => setShowMoveMenu(false)}
            >
              {allowedNext.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">No further moves</p>
              ) : (
                allowedNext.map(stageKey => {
                  const stg = [...STAGES, ...TERMINAL_STAGES].find(s => s.key === stageKey);
                  const isTerminal = ['REJECTED', 'WITHDRAWN'].includes(stageKey);
                  return (
                    <button
                      key={stageKey}
                      onClick={e => { e.stopPropagation(); onMoveStage(app.id, stageKey, currentStage); setShowMoveMenu(false); }}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${
                        isTerminal ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
                      }`}
                    >
                      {stg?.label || stageKey}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onViewDetail(); }}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}
