import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Package, Undo2, UserX, Loader2,
  ClipboardList, Plus, Trash2, FileText, Download, Calendar, ChevronDown, ChevronUp,
  BookOpen, FileCheck, Briefcase, UserCheck, Monitor, Shield, Star, MessageSquare,
} from 'lucide-react';
import {
  useGetExitDetailsQuery, useApproveExitMutation, useCompleteExitMutation,
  useWithdrawResignationMutation,
  useSetLastWorkingDayMutation, useGetHandoverDataQuery, useAddHandoverTaskMutation,
  useUpdateHandoverTaskMutation, useDeleteHandoverTaskMutation,
  useGetFnFDetailsQuery, useGenerateExperienceLetterMutation,
  useGetITChecklistQuery, useUpdateITChecklistMutation, useSaveITNotesMutation,
  useGetExitInterviewQuery, useSaveExitInterviewMutation,
} from './exitApi';
import { useMarkChecklistItemMutation } from '../assets/assetApi';
import ExitAccessConfig from './ExitAccessConfig';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const statusColors: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-blue-50 text-blue-700 border-blue-200',
  NO_DUES_PENDING: 'bg-orange-50 text-orange-700 border-orange-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WITHDRAWN: 'bg-gray-50 text-gray-500 border-gray-200',
};

export default function ExitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: res, isLoading, refetch } = useGetExitDetailsQuery(id!);
  const [approveExit, { isLoading: approving }] = useApproveExitMutation();
  const [completeExit, { isLoading: completing }] = useCompleteExitMutation();
  const [withdrawResignation, { isLoading: withdrawing }] = useWithdrawResignationMutation();
  const [setLWD, { isLoading: savingLWD }] = useSetLastWorkingDayMutation();

  const { data: handoverRes } = useGetHandoverDataQuery(id!);
  const exitStatusForSkip = res?.data?.employee?.exitStatus || '';
  const { data: itRes } = useGetITChecklistQuery(id!, {
    skip: !['APPROVED', 'NO_DUES_PENDING', 'COMPLETED'].includes(exitStatusForSkip),
  });

  const [approveNotes, setApproveNotes] = useState('');
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [lwdValue, setLwdValue] = useState('');
  const [showLwdEdit, setShowLwdEdit] = useState(false);

  if (isLoading) return (
    <div className="page-container animate-pulse">
      <div className="h-7 bg-gray-200 rounded w-48 mb-6" />
      <div className="layer-card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-50 rounded-lg" />)}</div>
      </div>
    </div>
  );

  const data = res?.data;
  if (!data) return <div className="page-container"><div className="layer-card p-12 text-center text-sm text-gray-400">Exit details not found</div></div>;

  const { employee: emp, assets, events } = data;
  const exitStatus = emp.exitStatus || '';
  const isApproved = ['APPROVED', 'NO_DUES_PENDING'].includes(exitStatus);
  const isActive = !['COMPLETED', 'WITHDRAWN'].includes(exitStatus);

  // Derive blocking conditions for "Complete Exit"
  const handoverChecklist = handoverRes?.data;
  const pendingTasks = (handoverChecklist?.handoverTasks || []).filter((t: any) => !t.isCompleted).length;
  const itChecklist = itRes?.data;
  const itIncomplete = itChecklist && !itChecklist.completedAt;
  const canComplete = assets.allReturned && pendingTasks === 0 && !itIncomplete;

  const handleApprove = async () => {
    try {
      await approveExit({ id: id!, body: { notes: approveNotes } }).unwrap();
      toast.success('Resignation approved');
      setShowApproveForm(false);
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleComplete = async () => {
    if (!canComplete) return;
    if (!confirm('Complete this exit? The employee will be deactivated.')) return;
    try {
      await completeExit(id!).unwrap();
      toast.success('Exit completed — employee separated');
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleWithdraw = async () => {
    if (!confirm('Withdraw this resignation?')) return;
    try {
      await withdrawResignation(id!).unwrap();
      toast.success('Resignation withdrawn');
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleSaveLWD = async () => {
    if (!lwdValue) { toast.error('Please select a date'); return; }
    try {
      await setLWD({ id: id!, lastWorkingDate: lwdValue }).unwrap();
      toast.success('Last working day updated');
      setShowLwdEdit(false);
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const completeBlockReason = !assets.allReturned
    ? `${assets.pending.length} asset(s) pending return`
    : pendingTasks > 0
    ? `${pendingTasks} handover task(s) still pending`
    : itIncomplete
    ? 'IT offboarding checklist not complete'
    : '';

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/exit-management')} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Exit Details</h1>
          <p className="text-sm text-gray-400">{emp.firstName} {emp.lastName} ({emp.employeeCode})</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Status Banner */}
          <div className={cn('layer-card p-4 flex items-center gap-3 border', statusColors[exitStatus] || 'border-gray-200')}>
            {exitStatus === 'COMPLETED' ? <CheckCircle2 size={20} /> : exitStatus === 'WITHDRAWN' ? <Undo2 size={20} /> : <AlertTriangle size={20} />}
            <div>
              <p className="font-semibold text-sm">{exitStatus.replace(/_/g, ' ')}</p>
              <p className="text-xs opacity-75">
                {exitStatus === 'NO_DUES_PENDING' && `${assets.pending.length} asset(s) pending return`}
                {exitStatus === 'COMPLETED' && 'Employee has been separated'}
                {exitStatus === 'PENDING' && 'Awaiting HR approval of resignation'}
                {exitStatus === 'APPROVED' && 'Resignation approved — complete handover & F&F'}
                {exitStatus === 'WITHDRAWN' && 'Resignation was withdrawn'}
              </p>
            </div>
          </div>

          {/* Exit Info */}
          <div className="layer-card p-6">
            <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">Exit Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <InfoField label="Exit Type" value={emp.exitType?.replace(/_/g, ' ') || '—'} />
              <InfoField label="Department" value={emp.department?.name || '—'} />
              <InfoField label="Resignation Date" value={emp.resignationDate ? new Date(emp.resignationDate).toLocaleDateString('en-IN') : '—'} />
              <InfoField label="Last Working Date" value={emp.lastWorkingDate ? new Date(emp.lastWorkingDate).toLocaleDateString('en-IN') : '—'} />
              <InfoField label="Joining Date" value={emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN') : '—'} />
              <InfoField label="Designation" value={emp.designation?.name || '—'} />
            </div>
            {emp.resignationReason && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Reason</p>
                <p className="text-sm text-gray-700">{emp.resignationReason}</p>
              </div>
            )}
            {emp.exitNotes && (
              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-1">HR Notes</p>
                <p className="text-sm text-gray-700">{emp.exitNotes}</p>
              </div>
            )}
          </div>

          {/* STEP 1 — Approve Resignation */}
          {exitStatus === 'PENDING' && (
            <div className="layer-card p-6 border-l-4 border-amber-400">
              <div className="flex items-center gap-2 mb-3">
                <StepBadge n={1} color="amber" />
                <h3 className="text-base font-semibold text-gray-800">Approve Resignation</h3>
              </div>
              <p className="text-sm text-gray-500 mb-4">Review the resignation request and approve it to begin the exit process.</p>
              {showApproveForm ? (
                <div className="space-y-3">
                  <textarea
                    value={approveNotes}
                    onChange={e => setApproveNotes(e.target.value)}
                    className="input-glass w-full text-sm"
                    rows={3}
                    placeholder="Notes for the employee (optional)"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleApprove} disabled={approving} className="btn-primary text-sm flex items-center gap-2">
                      {approving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Confirm Approval
                    </button>
                    <button onClick={() => setShowApproveForm(false)} className="btn-secondary text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowApproveForm(true)} className="btn-primary flex items-center gap-2 text-sm">
                  <CheckCircle2 size={16} /> Approve Resignation
                </button>
              )}
            </div>
          )}

          {/* STEP 2 — Last Working Day */}
          {isApproved && (
            <div className="layer-card p-6 border-l-4 border-blue-400">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <StepBadge n={2} color="blue" />
                  <h3 className="text-base font-semibold text-gray-800">Last Working Day</h3>
                </div>
                {emp.lastWorkingDate && !showLwdEdit && (
                  <button onClick={() => { setLwdValue(emp.lastWorkingDate?.slice(0, 10) || ''); setShowLwdEdit(true); }} className="text-xs text-brand-600 hover:underline">Edit</button>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-4 ml-8">
                {emp.lastWorkingDate
                  ? `Set to ${new Date(emp.lastWorkingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
                  : 'Set the official last working day for this employee.'}
              </p>
              {(!emp.lastWorkingDate || showLwdEdit) && (
                <div className="ml-8 flex items-center gap-3">
                  <input type="date" value={lwdValue} onChange={e => setLwdValue(e.target.value)} className="input-glass text-sm" />
                  <button onClick={handleSaveLWD} disabled={savingLWD || !lwdValue} className="btn-primary text-sm flex items-center gap-2">
                    {savingLWD ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                    {emp.lastWorkingDate ? 'Update' : 'Set Date'}
                  </button>
                  {showLwdEdit && <button onClick={() => setShowLwdEdit(false)} className="btn-secondary text-sm">Cancel</button>}
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — Handover */}
          {(isApproved || exitStatus === 'COMPLETED') && (
            <HandoverSection employeeId={id!} />
          )}

          {/* STEP 4 — Full & Final */}
          {(isApproved || exitStatus === 'COMPLETED') && (
            <FullFinalSection employeeId={id!} />
          )}

          {/* STEP 5 — IT Offboarding */}
          {(isApproved || exitStatus === 'COMPLETED') && (
            <ITChecklistSection employeeId={id!} />
          )}

          {/* STEP 6 — Exit Interview */}
          {(isApproved || exitStatus === 'COMPLETED') && (
            <ExitInterviewSection employeeId={id!} />
          )}

          {/* Action Buttons */}
          {isActive && exitStatus !== 'PENDING' && (
            <div className="flex flex-wrap gap-3">
              {isApproved && (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={handleComplete}
                    disabled={completing || !canComplete}
                    className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                    title={completeBlockReason}
                  >
                    {completing ? <Loader2 size={16} className="animate-spin" /> : <UserX size={16} />}
                    Complete Exit
                  </button>
                  {!canComplete && (
                    <p className="text-xs text-orange-600 ml-1">{completeBlockReason}</p>
                  )}
                </div>
              )}
              <button onClick={handleWithdraw} disabled={withdrawing} className="btn-secondary flex items-center gap-2 text-sm">
                {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                Withdraw Resignation
              </button>
            </div>
          )}
          {exitStatus === 'PENDING' && (
            <div className="flex gap-3">
              <button onClick={handleWithdraw} disabled={withdrawing} className="btn-secondary flex items-center gap-2 text-sm">
                {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                Withdraw Resignation
              </button>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <ExitAccessConfig employeeId={id!} exitStatus={exitStatus} />
          <div className="layer-card p-6">
            <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">Timeline</h2>
            {events.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No events yet</p>
            ) : (
              <div className="space-y-4">
                {events.map((evt: any) => (
                  <div key={evt.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-brand-400 mt-1.5" />
                      <div className="w-0.5 flex-1 bg-gray-100 mt-1" />
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-medium text-gray-800">{evt.title}</p>
                      {evt.description && <p className="text-xs text-gray-500 mt-0.5">{evt.description}</p>}
                      <p className="text-xs text-gray-400 font-mono mt-1" data-mono>
                        {new Date(evt.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepBadge({ n, color }: { n: number; color: string }) {
  const cls: Record<string, string> = {
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    violet: 'bg-violet-100 text-violet-700',
    pink: 'bg-pink-100 text-pink-700',
  };
  return (
    <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold', cls[color] || 'bg-gray-100 text-gray-600')}>
      {n}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}

// ─── Handover Section ──────────────────────────────────────────────────────────

function HandoverSection({ employeeId }: { employeeId: string }) {
  const { data: handoverRes, refetch: refetchHandover, isLoading } = useGetHandoverDataQuery(employeeId);
  const [markItem, { isLoading: marking }] = useMarkChecklistItemMutation();
  const [addTask, { isLoading: addingTask }] = useAddHandoverTaskMutation();
  const [updateTask] = useUpdateHandoverTaskMutation();
  const [deleteTask] = useDeleteHandoverTaskMutation();

  const [activeTab, setActiveTab] = useState<'tasks' | 'assets'>('tasks');
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', category: 'TASK', dueDate: '' });

  const checklist = handoverRes?.data;
  const tasks: any[] = checklist?.handoverTasks || [];
  const items: any[] = checklist?.items || [];
  const completedTaskCount = tasks.filter((t: any) => t.isCompleted).length;
  const returnedCount = items.filter((i: any) => i.isReturned).length;
  const allAssetsCleared = checklist?.salaryProcessingUnblocked || (items.length > 0 && returnedCount === items.length);

  const handleToggleAsset = async (itemId: string, isReturned: boolean) => {
    try {
      await markItem({ employeeId, itemId, isReturned }).unwrap();
      toast.success(isReturned ? 'Asset marked as returned' : 'Asset unmarked');
      refetchHandover();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleToggleTask = async (taskId: string, isCompleted: boolean) => {
    try {
      await updateTask({ taskId, body: { isCompleted } }).unwrap();
      refetchHandover();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleAddTask = async () => {
    if (!newTask.title.trim()) { toast.error('Title is required'); return; }
    try {
      await addTask({ id: employeeId, body: { ...newTask, dueDate: newTask.dueDate || undefined, description: newTask.description || undefined } }).unwrap();
      toast.success('Task added');
      setNewTask({ title: '', description: '', category: 'TASK', dueDate: '' });
      setShowAddTask(false);
      refetchHandover();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Delete this handover task?')) return;
    try {
      await deleteTask(taskId).unwrap();
      toast.success('Task deleted');
      refetchHandover();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const categoryIcon: Record<string, any> = { TASK: ClipboardList, DOCUMENT: FileText, KNOWLEDGE: BookOpen };
  const categoryColor: Record<string, string> = { TASK: 'text-brand-500', DOCUMENT: 'text-purple-500', KNOWLEDGE: 'text-teal-500' };

  return (
    <div className="layer-card p-6 border-l-4 border-indigo-400">
      <div className="flex items-center gap-2 mb-4">
        <StepBadge n={3} color="indigo" />
        <h3 className="text-base font-semibold text-gray-800">Handover</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
        {(['tasks', 'assets'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn('flex-1 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1.5',
              activeTab === tab ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700')}
          >
            {tab === 'tasks' ? <ClipboardList size={13} /> : <Package size={13} />}
            {tab === 'tasks' ? 'Tasks' : 'Assets'}
            {tab === 'tasks' && tasks.length > 0 && (
              <span className={cn('ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                completedTaskCount === tasks.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                {completedTaskCount}/{tasks.length}
              </span>
            )}
            {tab === 'assets' && items.length > 0 && (
              <span className={cn('ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                allAssetsCleared ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700')}>
                {returnedCount}/{items.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-400 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading...
        </div>
      )}

      {/* ── Tasks Tab ── */}
      {!isLoading && activeTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.length === 0 && !showAddTask && (
            <div className="text-center py-8">
              <ClipboardList size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-400">No handover tasks added yet</p>
              <p className="text-xs text-gray-300 mt-1">Add tasks the employee must complete before leaving</p>
            </div>
          )}
          {tasks.map((task: any) => {
            const Icon = categoryIcon[task.category] || ClipboardList;
            return (
              <div key={task.id} className={cn(
                'flex items-start gap-3 p-3 rounded-lg border transition-all',
                task.isCompleted ? 'bg-emerald-50/50 border-emerald-100' : 'bg-white border-gray-100 hover:border-gray-200'
              )}>
                <button
                  onClick={() => handleToggleTask(task.id, !task.isCompleted)}
                  className={cn('mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all',
                    task.isCompleted ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-brand-400')}
                >
                  {task.isCompleted && <CheckCircle2 size={10} className="text-white" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon size={12} className={categoryColor[task.category] || 'text-gray-400'} />
                    <p className={cn('text-sm font-medium', task.isCompleted ? 'line-through text-gray-400' : 'text-gray-800')}>
                      {task.title}
                    </p>
                  </div>
                  {task.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>}
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {task.assignedTo && (
                      <span className="text-[10px] text-gray-400">→ {task.assignedTo.firstName} {task.assignedTo.lastName}</span>
                    )}
                    {task.dueDate && (
                      <span className={cn('text-[10px]', new Date(task.dueDate) < new Date() && !task.isCompleted ? 'text-red-500' : 'text-gray-400')}>
                        Due {new Date(task.dueDate).toLocaleDateString('en-IN')}
                      </span>
                    )}
                    {task.completedAt && (
                      <span className="text-[10px] text-emerald-600">Done {new Date(task.completedAt).toLocaleDateString('en-IN')}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDeleteTask(task.id)} className="text-gray-300 hover:text-red-400 transition-colors p-0.5 flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}

          {showAddTask && (
            <div className="p-3 border border-dashed border-brand-300 rounded-lg bg-brand-50/30 space-y-2">
              <input
                type="text"
                value={newTask.title}
                onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                className="input-glass w-full text-sm"
                placeholder="Task title *"
                autoFocus
              />
              <input
                type="text"
                value={newTask.description}
                onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))}
                className="input-glass w-full text-sm"
                placeholder="Description (optional)"
              />
              <div className="flex gap-2">
                <select value={newTask.category} onChange={e => setNewTask(p => ({ ...p, category: e.target.value }))} className="input-glass text-sm flex-1">
                  <option value="TASK">Task</option>
                  <option value="DOCUMENT">Document</option>
                  <option value="KNOWLEDGE">Knowledge Transfer</option>
                </select>
                <input type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))} className="input-glass text-sm flex-1" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddTask} disabled={addingTask} className="btn-primary text-xs flex items-center gap-1.5">
                  {addingTask ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add Task
                </button>
                <button onClick={() => { setShowAddTask(false); setNewTask({ title: '', description: '', category: 'TASK', dueDate: '' }); }} className="btn-secondary text-xs">Cancel</button>
              </div>
            </div>
          )}
          {!showAddTask && (
            <button onClick={() => setShowAddTask(true)} className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-400 hover:text-brand-600 hover:border-brand-300 transition-colors flex items-center justify-center gap-1.5">
              <Plus size={13} /> Add Handover Task
            </button>
          )}
        </div>
      )}

      {/* ── Assets Tab ── */}
      {!isLoading && activeTab === 'assets' && (
        <div className="space-y-2">
          {!allAssetsCleared && items.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl mb-3">
              <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-700">Salary processing blocked until all assets are confirmed returned by HR</p>
            </div>
          )}
          {allAssetsCleared && items.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl mb-3">
              <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700">All assets cleared — salary processing unblocked</p>
            </div>
          )}

          {items.length > 0 && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Asset Return Progress</span>
                <span className="font-mono" data-mono>{returnedCount}/{items.length} confirmed</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: items.length > 0 ? `${(returnedCount / items.length) * 100}%` : '0%' }} />
              </div>
            </div>
          )}

          {items.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No assets in exit checklist</p>}

          {items.map((item: any) => (
            <div key={item.id} className={cn(
              'p-3 rounded-lg border transition-all',
              item.isReturned ? 'bg-emerald-50/50 border-emerald-100' : item.employeeConfirmedReturn ? 'bg-blue-50/50 border-blue-100' : 'bg-orange-50/50 border-orange-100'
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {item.isReturned
                    ? <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                    : item.employeeConfirmedReturn
                    ? <UserCheck size={16} className="text-blue-500 flex-shrink-0" />
                    : <Package size={16} className="text-orange-500 flex-shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.itemName}</p>
                    {item.asset && <p className="text-xs text-gray-400 font-mono" data-mono>{item.asset.category}</p>}
                    {/* Employee confirmation badge */}
                    {item.employeeConfirmedReturn && !item.isReturned && (
                      <p className="text-[10px] text-blue-600 mt-0.5">
                        Employee confirmed return on {new Date(item.employeeConfirmedAt).toLocaleDateString('en-IN')}
                        {item.employeeNotes && ` — "${item.employeeNotes}"`}
                      </p>
                    )}
                    {item.isReturned && item.returnedAt && (
                      <p className="text-[10px] text-emerald-600 mt-0.5">HR confirmed {new Date(item.returnedAt).toLocaleDateString('en-IN')}</p>
                    )}
                  </div>
                </div>
                {!item.isReturned && (
                  <button
                    onClick={() => handleToggleAsset(item.id, true)}
                    disabled={marking}
                    className="btn-primary text-xs px-3 py-1.5 flex-shrink-0"
                  >
                    {marking ? <Loader2 size={12} className="animate-spin" /> : 'Confirm Return'}
                  </button>
                )}
                {item.isReturned && (
                  <span className="text-xs text-emerald-600 font-medium flex-shrink-0">Returned ✓</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Full & Final Section ──────────────────────────────────────────────────────

function FullFinalSection({ employeeId }: { employeeId: string }) {
  const { data: fnfRes, refetch, isLoading } = useGetFnFDetailsQuery(employeeId);
  const [generateLetter, { isLoading: generating }] = useGenerateExperienceLetterMutation();
  const [expanded, setExpanded] = useState(true);

  const fnf = fnfRes?.data;

  const handleGenerateLetter = async () => {
    if (fnf?.experienceLetter && !confirm('This will regenerate the experience letter. The previous version will be replaced. Continue?')) return;
    try {
      await generateLetter(employeeId).unwrap();
      toast.success('Experience letter generated');
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to generate letter'); }
  };

  return (
    <div className="layer-card p-6 border-l-4 border-emerald-400">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <StepBadge n={4} color="emerald" />
          <h3 className="text-base font-semibold text-gray-800">Full &amp; Final</h3>
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 p-1">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-5">
          {/* Last 3 Salary Slips */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileCheck size={15} className="text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-700">Last 3 Salary Slips</h4>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : !fnf || fnf.payslips.length === 0 ? (
              <p className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-xl">No processed payslips found</p>
            ) : (
              <div className="space-y-2">
                {fnf.payslips.map((slip: any) => (
                  <div key={slip.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {MONTH_NAMES[(slip.payrollRun.month - 1)]} {slip.payrollRun.year}
                      </p>
                      <p className="text-xs text-gray-500 font-mono" data-mono>
                        Net ₹{Number(slip.netPay).toLocaleString('en-IN')} · Gross ₹{Number(slip.grossPay).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <a
                      href={`/api/payroll/records/${slip.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
                    >
                      <Download size={12} /> Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Experience Letter */}
          <div className="border-t border-gray-100 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase size={15} className="text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-700">Experience Letter</h4>
            </div>
            {fnf?.experienceLetter ? (
              <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <div>
                  <p className="text-sm font-medium text-emerald-800">{fnf.experienceLetter.title}</p>
                  <p className="text-xs text-emerald-600">Generated {new Date(fnf.experienceLetter.createdAt).toLocaleDateString('en-IN')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/letters/${fnf.experienceLetter.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium px-3 py-1.5 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    <Download size={12} /> Download
                  </a>
                  <button
                    onClick={handleGenerateLetter}
                    disabled={generating}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    {generating ? <Loader2 size={12} className="animate-spin" /> : 'Regenerate'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-5 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <Briefcase size={24} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500 mb-3">No experience letter generated yet</p>
                <button onClick={handleGenerateLetter} disabled={generating} className="btn-primary text-xs flex items-center gap-1.5 mx-auto">
                  {generating ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                  Generate Experience Letter
                </button>
              </div>
            )}
          </div>

          {/* FnF Adjustment */}
          {fnf?.fnfAdjustment && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                <AlertTriangle size={14} className="text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-blue-800">Full &amp; Final Settlement Pending</p>
                  <p className="text-xs text-blue-600">
                    {fnf.fnfAdjustment.amount === 0
                      ? 'A settlement entry exists in payroll. HR needs to fill in the final amount.'
                      : `Settlement amount: ₹${Number(fnf.fnfAdjustment.amount).toLocaleString('en-IN')}`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── IT Offboarding Checklist Section ─────────────────────────────────────────

const IT_ITEMS: { field: string; label: string; description: string }[] = [
  { field: 'emailDisabled',     label: 'Email Account Disabled',    description: 'Disable company email & set auto-reply' },
  { field: 'ssoRevoked',        label: 'SSO / AD Account Revoked',  description: 'Remove from Active Directory / SSO provider' },
  { field: 'vpnRevoked',        label: 'VPN Access Revoked',        description: 'Remove VPN credentials / certificates' },
  { field: 'githubRemoved',     label: 'GitHub / GitLab Removed',   description: 'Remove from org repos and teams' },
  { field: 'jiraRemoved',       label: 'Jira / Project Tool Removed', description: 'Deactivate Jira, ClickUp, or Asana account' },
  { field: 'slackRemoved',      label: 'Slack / Teams Removed',     description: 'Deactivate Slack/Teams account' },
  { field: 'licensesReclaimed', label: 'Software Licenses Reclaimed', description: 'Reassign paid licenses (Adobe, Figma, etc.)' },
  { field: 'deviceWiped',       label: 'Device Wiped & Collected',  description: 'Factory reset or wipe company devices' },
];

function ITChecklistSection({ employeeId }: { employeeId: string }) {
  const { data: res, refetch, isLoading } = useGetITChecklistQuery(employeeId);
  const [updateItem, { isLoading: saving }] = useUpdateITChecklistMutation();
  const [expanded, setExpanded] = useState(true);
  const [saveNotesMutation, { isLoading: savingNotes }] = useSaveITNotesMutation();
  const [notes, setNotes] = useState('');

  const checklist = res?.data;
  const completedCount = checklist
    ? IT_ITEMS.filter(i => (checklist as any)[i.field]).length
    : 0;
  const allDone = completedCount === IT_ITEMS.length;

  // Sync notes from server once on load
  const notesInitRef = useRef(false);
  useEffect(() => {
    if (checklist && !notesInitRef.current) {
      notesInitRef.current = true;
      setNotes(checklist.notes || '');
    }
  }, [checklist]);

  const handleToggle = async (field: string, value: boolean) => {
    try {
      await updateItem({ employeeId, field, value }).unwrap();
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleSaveNotes = async () => {
    try {
      await saveNotesMutation({ employeeId, notes }).unwrap();
      toast.success('Notes saved');
      notesInitRef.current = false; // allow re-sync from server after refetch
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="layer-card p-6 border-l-4 border-violet-400">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <StepBadge n={5} color="violet" />
          <Monitor size={16} className="text-violet-500" />
          <h3 className="text-base font-semibold text-gray-800">IT Offboarding</h3>
          {allDone && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Complete</span>}
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 p-1">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4 ml-8">IT admin must complete all access revocation items before exit is fully processed.</p>

      {expanded && (
        <div className="space-y-2">
          {isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading...
            </div>
          )}
          {!isLoading && (
            <>
              <div className="flex justify-between items-center mb-3 px-1">
                <span className="text-xs text-gray-500">Progress</span>
                <span className="text-xs font-mono text-gray-600" data-mono>{completedCount}/{IT_ITEMS.length} completed</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-4">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', allDone ? 'bg-emerald-500' : 'bg-violet-500')}
                  style={{ width: `${(completedCount / IT_ITEMS.length) * 100}%` }}
                />
              </div>

              {IT_ITEMS.map((item) => {
                const isDone = checklist ? (checklist as any)[item.field] : false;
                const doneAt = checklist ? (checklist as any)[`${item.field}At`] : null;
                return (
                  <div key={item.field} className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border transition-all',
                    isDone ? 'bg-emerald-50/50 border-emerald-100' : 'bg-white border-gray-100 hover:border-gray-200'
                  )}>
                    <button
                      onClick={() => handleToggle(item.field, !isDone)}
                      disabled={saving}
                      className={cn(
                        'mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all',
                        isDone ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-violet-400'
                      )}
                    >
                      {isDone && <CheckCircle2 size={10} className="text-white" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Shield size={12} className={isDone ? 'text-emerald-500' : 'text-violet-400'} />
                        <p className={cn('text-sm font-medium', isDone ? 'line-through text-gray-400' : 'text-gray-800')}>{item.label}</p>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                      {doneAt && (
                        <p className="text-[10px] text-emerald-600 mt-0.5">
                          Completed {new Date(doneAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* M-1: notes textarea — editable by IT/HR */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">IT Notes</label>
                <textarea
                  value={notes || checklist?.notes || ''}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="input-glass w-full text-sm resize-none"
                  placeholder="Add notes for IT team (handover details, special instructions...)"
                />
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="mt-2 btn-secondary text-xs flex items-center gap-1.5"
                >
                  {savingNotes ? <Loader2 size={12} className="animate-spin" /> : null}
                  Save Notes
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Exit Interview Section ────────────────────────────────────────────────────

const EXIT_REASON_LABELS: Record<string, string> = {
  BETTER_OPPORTUNITY:  'Better Opportunity',
  HIGHER_COMPENSATION: 'Higher Compensation',
  WORK_LIFE_BALANCE:   'Work-Life Balance',
  CAREER_GROWTH:       'Career Growth',
  MANAGEMENT_ISSUES:   'Management Issues',
  CULTURE_MISMATCH:    'Culture Mismatch',
  PERSONAL_REASONS:    'Personal Reasons',
  RELOCATION:          'Relocation',
  HEALTH:              'Health',
  HIGHER_EDUCATION:    'Higher Education',
  RETIREMENT:          'Retirement',
  OTHER:               'Other',
};

const RATING_LABELS = ['', 'Very Poor', 'Poor', 'Average', 'Good', 'Excellent'];

function RatingStars({ value, onChange, disabled }: { value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className={cn('transition-colors', disabled ? 'cursor-default' : 'hover:text-amber-400')}
        >
          <Star size={16} className={cn(value !== null && n <= value ? 'text-amber-400 fill-amber-400' : 'text-gray-300')} />
        </button>
      ))}
      {value && <span className="text-xs text-gray-400 ml-1">{RATING_LABELS[value]}</span>}
    </div>
  );
}

function ExitInterviewSection({ employeeId }: { employeeId: string }) {
  const { data: res, refetch, isLoading } = useGetExitInterviewQuery(employeeId);
  const [saveInterview, { isLoading: saving }] = useSaveExitInterviewMutation();
  const [expanded, setExpanded] = useState(true);

  const existing = res?.data;
  const isSubmitted = !!existing?.submittedAt;

  const [form, setForm] = useState({
    primaryReason: '',
    otherReasonDetail: '',
    overallSatisfaction: null as number | null,
    managementRating: null as number | null,
    compensationRating: null as number | null,
    cultureRating: null as number | null,
    growthRating: null as number | null,
    workLifeBalanceRating: null as number | null,
    likedMost: '',
    dislikedMost: '',
    improvementSuggestions: '',
    wouldRehire: null as boolean | null,
    additionalComments: '',
    rehireEligible: null as boolean | null,
    rehireNotes: '',
  });
  const initializedRef = useRef(false);

  // C-1: use useRef to avoid setting state during render (infinite re-render anti-pattern)
  useEffect(() => {
    if (existing && !initializedRef.current) {
      initializedRef.current = true;
      setForm({
        primaryReason: existing.primaryReason || '',
        otherReasonDetail: existing.otherReasonDetail || '',
        overallSatisfaction: existing.overallSatisfaction ?? null,
        managementRating: existing.managementRating ?? null,
        compensationRating: existing.compensationRating ?? null,
        cultureRating: existing.cultureRating ?? null,
        growthRating: existing.growthRating ?? null,
        workLifeBalanceRating: existing.workLifeBalanceRating ?? null,
        likedMost: existing.likedMost || '',
        dislikedMost: existing.dislikedMost || '',
        improvementSuggestions: existing.improvementSuggestions || '',
        wouldRehire: existing.wouldRehire ?? null,
        additionalComments: existing.additionalComments || '',
        rehireEligible: existing.rehireEligible ?? null,
        rehireNotes: existing.rehireNotes || '',
      });
    }
  }, [existing]);

  const handleSave = async (submit = false) => {
    if (!form.primaryReason) { toast.error('Please select the primary exit reason'); return; }
    try {
      await saveInterview({
        employeeId,
        body: { ...form, submit },
      }).unwrap();
      toast.success(submit ? 'Exit interview submitted' : 'Exit interview saved as draft');
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="layer-card p-6 border-l-4 border-pink-400">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <StepBadge n={6} color="pink" />
          <MessageSquare size={16} className="text-pink-500" />
          <h3 className="text-base font-semibold text-gray-800">Exit Interview</h3>
          {isSubmitted && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Submitted</span>}
          {!isSubmitted && existing && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Draft</span>}
        </div>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 p-1">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-4 ml-8">Conduct a structured exit interview to understand the employee's experience and gather improvement insights.</p>

      {expanded && (
        <div className="space-y-5 mt-2">
          {isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading...
            </div>
          )}

          {!isLoading && (
            <>
              {/* Primary Reason */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Primary Reason for Leaving *</label>
                <select
                  value={form.primaryReason}
                  onChange={e => setForm(p => ({ ...p, primaryReason: e.target.value }))}
                  disabled={isSubmitted}
                  className="input-glass w-full text-sm"
                >
                  <option value="">— Select reason —</option>
                  {Object.entries(EXIT_REASON_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                {form.primaryReason === 'OTHER' && (
                  <input
                    type="text"
                    value={form.otherReasonDetail}
                    onChange={e => setForm(p => ({ ...p, otherReasonDetail: e.target.value }))}
                    disabled={isSubmitted}
                    className="input-glass w-full text-sm mt-2"
                    placeholder="Please specify..."
                  />
                )}
              </div>

              {/* Ratings */}
              <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50/50">
                <p className="text-xs font-semibold text-gray-600 mb-2">Satisfaction Ratings</p>
                {([
                  ['overallSatisfaction', 'Overall Satisfaction'],
                  ['managementRating', 'Management & Leadership'],
                  ['compensationRating', 'Compensation & Benefits'],
                  ['cultureRating', 'Company Culture'],
                  ['growthRating', 'Career Growth Opportunities'],
                  ['workLifeBalanceRating', 'Work-Life Balance'],
                ] as [keyof typeof form, string][]).map(([field, label]) => (
                  <div key={field} className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 w-44">{label}</span>
                    <RatingStars
                      value={form[field] as number | null}
                      onChange={(v) => setForm(p => ({ ...p, [field]: v }))}
                      disabled={isSubmitted}
                    />
                  </div>
                ))}
              </div>

              {/* Open-ended */}
              <div className="space-y-3">
                {([
                  ['likedMost', 'What did you like most about working here?'],
                  ['dislikedMost', 'What could we have done better?'],
                  ['improvementSuggestions', 'Suggestions for improvement'],
                  ['additionalComments', 'Any other comments'],
                ] as [keyof typeof form, string][]).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                    <textarea
                      value={(form[field] as string) || ''}
                      onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                      disabled={isSubmitted}
                      rows={2}
                      className="input-glass w-full text-sm resize-none"
                      placeholder="Optional..."
                    />
                  </div>
                ))}
              </div>

              {/* Would Rehire */}
              <div className="flex items-center gap-4">
                <span className="text-xs font-semibold text-gray-600">Would employee recommend us to others?</span>
                <div className="flex gap-2">
                  {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(({ v, l }) => (
                    <button
                      key={String(v)}
                      type="button"
                      disabled={isSubmitted}
                      onClick={() => setForm(p => ({ ...p, wouldRehire: v }))}
                      className={cn('px-3 py-1 text-xs rounded-lg border transition-all',
                        form.wouldRehire === v
                          ? (v ? 'bg-emerald-100 border-emerald-300 text-emerald-700 font-medium' : 'bg-red-100 border-red-300 text-red-700 font-medium')
                          : 'border-gray-200 text-gray-500 hover:border-gray-300')}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* HR — Rehire Eligibility */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-600 mb-2">HR Assessment — Rehire Eligibility</p>
                <div className="flex gap-2 mb-2">
                  {[{ v: true, l: 'Eligible for Rehire' }, { v: false, l: 'Not Eligible' }].map(({ v, l }) => (
                    <button
                      key={String(v)}
                      type="button"
                      disabled={isSubmitted}
                      onClick={() => setForm(p => ({ ...p, rehireEligible: v }))}
                      className={cn('px-3 py-1 text-xs rounded-lg border transition-all',
                        form.rehireEligible === v
                          ? (v ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium' : 'bg-red-100 border-red-300 text-red-700 font-medium')
                          : 'border-gray-200 text-gray-500 hover:border-gray-300')}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <textarea
                  value={form.rehireNotes}
                  onChange={e => setForm(p => ({ ...p, rehireNotes: e.target.value }))}
                  disabled={isSubmitted}
                  rows={2}
                  className="input-glass w-full text-sm resize-none"
                  placeholder="HR notes on rehire decision (optional)"
                />
              </div>

              {/* Actions */}
              {!isSubmitted && (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => handleSave(false)}
                    disabled={saving}
                    className="btn-secondary text-sm flex items-center gap-1.5"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                    Save Draft
                  </button>
                  <button
                    onClick={() => {
                      if (!form.primaryReason) { toast.error('Select a primary reason first'); return; }
                      if (!confirm('Submit the exit interview? This cannot be edited after submission.')) return;
                      handleSave(true);
                    }}
                    disabled={saving || !form.primaryReason}
                    className="btn-primary text-sm flex items-center gap-1.5"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Submit Interview
                  </button>
                </div>
              )}

              {isSubmitted && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  <p className="text-xs text-emerald-700">
                    Submitted on {new Date(existing.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {existing.conductedBy && ` by ${existing.conductedBy.firstName} ${existing.conductedBy.lastName}`}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
