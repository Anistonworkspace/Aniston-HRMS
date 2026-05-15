import { useState } from 'react';
import {
  CheckCircle2, AlertTriangle, Package, Clock, Loader2, Download,
  ClipboardList, UserCheck, Undo2, FileText, Briefcase, ChevronDown, ChevronUp,
  Monitor, Shield, MessageSquare,
} from 'lucide-react';
import {
  useGetMyExitStatusQuery,
  useConfirmAssetReturnMutation,
  useUndoAssetReturnConfirmationMutation,
  useUpdateHandoverTaskMutation,
} from './exitApi';
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

const statusLabel: Record<string, string> = {
  PENDING: 'Resignation submitted — awaiting HR approval',
  APPROVED: 'Resignation approved — please complete your handover',
  NO_DUES_PENDING: 'Approved — some assets still pending return',
  COMPLETED: 'Exit process complete. All the best!',
  WITHDRAWN: 'Your resignation has been withdrawn',
};

export default function MyExitPage() {
  const { data: res, isLoading, refetch } = useGetMyExitStatusQuery();
  const [confirmReturn, { isLoading: confirming }] = useConfirmAssetReturnMutation();
  const [undoReturn, { isLoading: undoing }] = useUndoAssetReturnConfirmationMutation();
  const [updateTask] = useUpdateHandoverTaskMutation();

  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null);
  const [docsExpanded, setDocsExpanded] = useState(false);

  if (isLoading) return (
    <div className="page-container animate-pulse space-y-4">
      <div className="h-7 bg-gray-200 rounded w-48" />
      <div className="layer-card p-6 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl" />)}
      </div>
    </div>
  );

  if (!res?.data) return (
    <div className="page-container">
      <div className="layer-card p-12 text-center">
        <CheckCircle2 size={36} className="mx-auto mb-3 text-gray-300" />
        <p className="text-base font-medium text-gray-500">No active exit process</p>
        <p className="text-sm text-gray-400 mt-1">You have no pending resignation or exit in progress.</p>
      </div>
    </div>
  );

  const { employee: emp, checklist, payslips, experienceLetter, itChecklist, exitInterview } = res.data;
  const exitStatus: string = emp.exitStatus || '';
  const isActive = !['COMPLETED', 'WITHDRAWN'].includes(exitStatus);

  const items: any[] = checklist?.items || [];
  const tasks: any[] = checklist?.handoverTasks || [];
  const pendingItems = items.filter((i: any) => !i.isReturned);
  const employeeConfirmedCount = items.filter((i: any) => i.employeeConfirmedReturn).length;
  const hrConfirmedCount = items.filter((i: any) => i.isReturned).length;

  const handleConfirmReturn = async (itemId: string) => {
    const notes = notesMap[itemId] || '';
    try {
      await confirmReturn({ itemId, employeeNotes: notes || undefined }).unwrap();
      toast.success('Return declared — HR will confirm receipt');
      setShowNotesFor(null);
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleUndoReturn = async (itemId: string) => {
    try {
      await undoReturn(itemId).unwrap();
      toast.success('Declaration removed');
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleToggleTask = async (taskId: string, isCompleted: boolean) => {
    try {
      await updateTask({ taskId, body: { isCompleted } }).unwrap();
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="page-container max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-gray-900">My Exit Status</h1>
        <p className="text-sm text-gray-400 mt-0.5">Track your resignation, handover, and final documents</p>
      </div>

      <div className="space-y-5">
        {/* Status Card */}
        <div className={cn('layer-card p-5 flex items-start gap-4 border', statusColors[exitStatus] || 'border-gray-200')}>
          <div className="mt-0.5">
            {exitStatus === 'COMPLETED' ? <CheckCircle2 size={22} /> : exitStatus === 'WITHDRAWN' ? <Undo2 size={22} /> : <Clock size={22} />}
          </div>
          <div className="flex-1">
            <p className="font-semibold">{exitStatus.replace(/_/g, ' ')}</p>
            <p className="text-sm opacity-80 mt-0.5">{statusLabel[exitStatus] || ''}</p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {emp.resignationDate && (
                <div>
                  <p className="text-[10px] opacity-60 uppercase tracking-wide">Resignation Date</p>
                  <p className="text-sm font-medium">{new Date(emp.resignationDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              )}
              {emp.lastWorkingDate && (
                <div>
                  <p className="text-[10px] opacity-60 uppercase tracking-wide">Last Working Day</p>
                  <p className="text-sm font-medium">{new Date(emp.lastWorkingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Asset Return Section */}
        {isActive && items.length > 0 && (
          <div className="layer-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-gray-500" />
                <h2 className="text-base font-semibold text-gray-800">Asset Return</h2>
              </div>
              <div className="text-xs text-gray-500 font-mono" data-mono>
                {hrConfirmedCount}/{items.length} confirmed by HR
              </div>
            </div>

            {/* Progress */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>You declared: {employeeConfirmedCount}/{items.length}</span>
                <span>HR confirmed: {hrConfirmedCount}/{items.length}</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden relative">
                <div className="absolute h-full bg-blue-200 rounded-full transition-all duration-500"
                  style={{ width: items.length > 0 ? `${(employeeConfirmedCount / items.length) * 100}%` : '0%' }} />
                <div className="absolute h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: items.length > 0 ? `${(hrConfirmedCount / items.length) * 100}%` : '0%' }} />
              </div>
              <div className="flex gap-4 mt-2 text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-200 inline-block" />You declared</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />HR confirmed</span>
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-3">
              Select each asset you have returned or are ready to return. HR will then verify receipt.
            </p>

            <div className="space-y-2">
              {items.map((item: any) => (
                <div key={item.id} className={cn(
                  'rounded-xl border p-3 transition-all',
                  item.isReturned ? 'bg-emerald-50 border-emerald-100' :
                  item.employeeConfirmedReturn ? 'bg-blue-50 border-blue-100' :
                  'bg-white border-gray-200'
                )}>
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => {
                        if (item.isReturned) return;
                        if (item.employeeConfirmedReturn) {
                          handleUndoReturn(item.id);
                        } else {
                          setShowNotesFor(showNotesFor === item.id ? null : item.id);
                        }
                      }}
                      disabled={item.isReturned || confirming || undoing}
                      className={cn(
                        'mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all',
                        item.isReturned ? 'bg-emerald-500 border-emerald-500 cursor-default' :
                        item.employeeConfirmedReturn ? 'bg-blue-500 border-blue-500' :
                        'border-gray-300 cursor-pointer'
                      )}
                    >
                      {(item.isReturned || item.employeeConfirmedReturn) && (
                        <CheckCircle2 size={11} className="text-white" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{item.itemName}</p>
                      {item.asset && (
                        <p className="text-xs text-gray-400 font-mono" data-mono>{item.asset.category} · {item.asset.assetCode}</p>
                      )}
                      {item.isReturned && (
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 size={11} className="text-emerald-500" />
                          <p className="text-[10px] text-emerald-600">HR confirmed return on {new Date(item.returnedAt).toLocaleDateString('en-IN')}</p>
                        </div>
                      )}
                      {!item.isReturned && item.employeeConfirmedReturn && (
                        <div className="flex items-center gap-1 mt-1">
                          <UserCheck size={11} className="text-blue-500" />
                          <p className="text-[10px] text-blue-600">
                            You declared return on {new Date(item.employeeConfirmedAt).toLocaleDateString('en-IN')}
                            {item.employeeNotes && ` — "${item.employeeNotes}"`}
                          </p>
                          <span className="text-[10px] text-gray-400 ml-1">· Awaiting HR confirmation</span>
                        </div>
                      )}
                    </div>

                    {!item.isReturned && !item.employeeConfirmedReturn && (
                      <span className="text-[10px] text-orange-500 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-full flex-shrink-0">Pending</span>
                    )}
                    {item.isReturned && (
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full flex-shrink-0">Returned ✓</span>
                    )}
                    {!item.isReturned && item.employeeConfirmedReturn && (
                      <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full flex-shrink-0">Awaiting HR</span>
                    )}
                  </div>

                  {/* Notes input shown when clicking to declare return */}
                  {showNotesFor === item.id && !item.employeeConfirmedReturn && (
                    <div className="mt-3 ml-8 space-y-2">
                      <input
                        type="text"
                        value={notesMap[item.id] || ''}
                        onChange={e => setNotesMap(p => ({ ...p, [item.id]: e.target.value }))}
                        className="input-glass w-full text-xs"
                        placeholder="Optional note (e.g. returned to IT desk, Aarav confirmed)"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirmReturn(item.id)}
                          disabled={confirming}
                          className="btn-primary text-xs flex items-center gap-1.5"
                        >
                          {confirming ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} />}
                          Confirm I Returned This
                        </button>
                        <button onClick={() => setShowNotesFor(null)} className="btn-secondary text-xs">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {pendingItems.length > 0 && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  Please return all {pendingItems.length} remaining asset(s) and declare them returned.
                  Your salary cannot be processed until HR confirms all returns.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Handover Tasks assigned to this employee */}
        {isActive && tasks.length > 0 && (
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList size={18} className="text-gray-500" />
              <h2 className="text-base font-semibold text-gray-800">My Handover Tasks</h2>
              <span className={cn('ml-auto text-xs font-medium px-2.5 py-1 rounded-full',
                tasks.filter(t => t.isCompleted).length === tasks.length
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700')}>
                {tasks.filter(t => t.isCompleted).length}/{tasks.length} done
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-3">Complete all assigned tasks before your last working day.</p>
            <div className="space-y-2">
              {tasks.map((task: any) => (
                <div key={task.id} className={cn(
                  'flex items-start gap-3 p-3 rounded-xl border',
                  task.isCompleted ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-gray-200'
                )}>
                  <button
                    onClick={() => handleToggleTask(task.id, !task.isCompleted)}
                    className={cn(
                      'mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all',
                      task.isCompleted ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                    )}
                  >
                    {task.isCompleted && <CheckCircle2 size={10} className="text-white" />}
                  </button>
                  <div className="flex-1">
                    <p className={cn('text-sm font-medium', task.isCompleted ? 'line-through text-gray-400' : 'text-gray-800')}>
                      {task.title}
                    </p>
                    {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                    {task.dueDate && (
                      <p className={cn('text-[10px] mt-1',
                        new Date(task.dueDate) < new Date() && !task.isCompleted ? 'text-red-500' : 'text-gray-400')}>
                        Due {new Date(task.dueDate).toLocaleDateString('en-IN')}
                      </p>
                    )}
                  </div>
                  {task.isCompleted && (
                    <span className="text-[10px] text-emerald-600 flex-shrink-0">Done ✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* IT Offboarding Progress — read-only employee view */}
        {['APPROVED', 'NO_DUES_PENDING', 'COMPLETED'].includes(exitStatus) && !itChecklist && (
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Monitor size={18} className="text-violet-400" />
              <h2 className="text-base font-semibold text-gray-800">IT Offboarding</h2>
              <span className="ml-auto text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Not Started</span>
            </div>
            <p className="text-xs text-gray-400">IT will begin revoking your system access (email, VPN, tools) once the process is initiated. No action needed from you.</p>
          </div>
        )}
        {itChecklist && (
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={18} className="text-violet-500" />
              <h2 className="text-base font-semibold text-gray-800">IT Offboarding</h2>
              {itChecklist.completedAt
                ? <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Complete</span>
                : <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">In Progress</span>}
            </div>
            <p className="text-xs text-gray-500 mb-3">IT is revoking your system access as part of the offboarding process.</p>
            {(() => {
              const itFields: [string, string][] = [
                ['emailDisabled', 'Email Account'],
                ['ssoRevoked', 'SSO / AD Account'],
                ['vpnRevoked', 'VPN Access'],
                ['githubRemoved', 'GitHub / GitLab'],
                ['jiraRemoved', 'Jira / Project Tools'],
                ['slackRemoved', 'Slack / Teams'],
                ['licensesReclaimed', 'Software Licenses'],
                ['deviceWiped', 'Device Wiped & Collected'],
              ];
              const done = itFields.filter(([f]) => (itChecklist as any)[f]).length;
              return (
                <>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span className="font-mono" data-mono>{done}/{itFields.length}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
                    <div className={cn('h-full rounded-full transition-all', done === itFields.length ? 'bg-emerald-500' : 'bg-violet-500')}
                      style={{ width: `${(done / itFields.length) * 100}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {itFields.map(([field, label]) => (
                      <div key={field} className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs',
                        (itChecklist as any)[field] ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-400')}>
                        <Shield size={11} className={(itChecklist as any)[field] ? 'text-emerald-500' : 'text-gray-300'} />
                        {label}
                        {(itChecklist as any)[field] && <CheckCircle2 size={10} className="text-emerald-500 ml-auto" />}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Exit Interview Status — read-only employee view */}
        {exitInterview && (
          <div className="layer-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={18} className="text-pink-500" />
              <h2 className="text-base font-semibold text-gray-800">Exit Interview</h2>
              {exitInterview.submittedAt
                ? <span className="ml-auto text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Submitted</span>
                : <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Draft</span>}
            </div>
            {exitInterview.submittedAt ? (
              <p className="text-xs text-gray-500">
                Submitted on {new Date(exitInterview.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                {exitInterview.conductedBy && ` · Conducted by ${exitInterview.conductedBy.firstName} ${exitInterview.conductedBy.lastName}`}
              </p>
            ) : (
              <p className="text-xs text-gray-400">HR has started drafting your exit interview. It will be finalized before your last working day.</p>
            )}
          </div>
        )}

        {/* F&F Documents */}
        <div className="layer-card p-5">
          <button
            onClick={() => setDocsExpanded(e => !e)}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-gray-500" />
              <h2 className="text-base font-semibold text-gray-800">Final Documents</h2>
            </div>
            {docsExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          </button>

          {docsExpanded && (
            <div className="mt-4 space-y-4">
              {/* Salary slips */}
              <div>
                <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Last 3 Salary Slips</p>
                {payslips.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4 bg-gray-50 rounded-xl">No processed payslips available yet</p>
                ) : (
                  <div className="space-y-2">
                    {payslips.map((slip: any) => (
                      <div key={slip.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {MONTH_NAMES[slip.payrollRun.month - 1]} {slip.payrollRun.year}
                          </p>
                          <p className="text-xs text-gray-400 font-mono" data-mono>
                            Net ₹{Number(slip.netPay).toLocaleString('en-IN')}
                          </p>
                        </div>
                        <a
                          href={`/api/payroll/records/${slip.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors" style={{ color: 'var(--primary-color)', background: 'var(--primary-highlighted-color)' }}
                        >
                          <Download size={12} /> Download
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Experience Letter */}
              <div>
                <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Experience Letter</p>
                {experienceLetter ? (
                  <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <div className="flex items-center gap-2">
                      <Briefcase size={15} className="text-emerald-600" />
                      <div>
                        <p className="text-sm font-medium text-emerald-800">{experienceLetter.title}</p>
                        <p className="text-xs text-emerald-600">
                          Generated {new Date(experienceLetter.createdAt).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                    </div>
                    <a
                      href={`/api/letters/${experienceLetter.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium px-3 py-1.5 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                    >
                      <Download size={12} /> Download
                    </a>
                  </div>
                ) : (
                  <div className="text-center py-5 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <Briefcase size={22} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm text-gray-400">Experience letter not generated yet</p>
                    <p className="text-xs text-gray-300 mt-1">HR will generate it before your last working day</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
