import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertTriangle, Package, Undo2, UserX, Loader2, Clock } from 'lucide-react';
import { useGetExitDetailsQuery, useApproveExitMutation, useCompleteExitMutation, useWithdrawResignationMutation, useReturnAssetForExitMutation } from './exitApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

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
  const [returnAsset, { isLoading: returning }] = useReturnAssetForExitMutation();

  const [approveNotes, setApproveNotes] = useState('');
  const [showApproveForm, setShowApproveForm] = useState(false);

  if (isLoading) return <div className="page-container"><div className="layer-card p-12 text-center text-sm text-gray-400">Loading...</div></div>;

  const data = res?.data;
  if (!data) return <div className="page-container"><div className="layer-card p-12 text-center text-sm text-gray-400">Exit details not found</div></div>;

  const { employee: emp, assets, events } = data;
  const exitStatus = emp.exitStatus || '';

  const handleApprove = async () => {
    try {
      await approveExit({ id: id!, body: { notes: approveNotes } }).unwrap();
      toast.success('Exit approved');
      setShowApproveForm(false);
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleComplete = async () => {
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

  const handleReturnAsset = async (assignmentId: string) => {
    try {
      await returnAsset(assignmentId).unwrap();
      toast.success('Asset returned');
      refetch();
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="page-container">
      {/* Header */}
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
        {/* Left Column — Info + Actions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status Banner */}
          <div className={cn('layer-card p-4 flex items-center gap-3 border', statusColors[exitStatus] || 'border-gray-200')}>
            {exitStatus === 'COMPLETED' ? <CheckCircle2 size={20} /> : exitStatus === 'WITHDRAWN' ? <Undo2 size={20} /> : <AlertTriangle size={20} />}
            <div>
              <p className="font-semibold text-sm">{exitStatus.replace(/_/g, ' ')}</p>
              <p className="text-xs opacity-75">
                {exitStatus === 'NO_DUES_PENDING' && `${assets.pending.length} asset(s) pending return`}
                {exitStatus === 'COMPLETED' && 'Employee has been separated'}
                {exitStatus === 'PENDING' && 'Awaiting HR approval'}
                {exitStatus === 'APPROVED' && 'Exit approved — ready for completion'}
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

          {/* Asset Clearance */}
          <div className="layer-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold text-gray-800">Asset Clearance</h2>
              <div className={cn('text-xs font-medium px-3 py-1 rounded-full', assets.allReturned ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700')}>
                {assets.allReturned ? 'All Cleared' : `${assets.pending.length} Pending`}
              </div>
            </div>

            {assets.pending.length === 0 && assets.returned.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No assets were assigned to this employee</p>
            ) : (
              <div className="space-y-2">
                {assets.pending.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between p-3 bg-orange-50/50 rounded-lg border border-orange-100">
                    <div className="flex items-center gap-3">
                      <Package size={18} className="text-orange-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{a.asset?.name}</p>
                        <p className="text-xs text-gray-400 font-mono" data-mono>{a.asset?.assetCode} · {a.asset?.category}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleReturnAsset(a.id)}
                      disabled={returning}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      {returning ? <Loader2 size={12} className="animate-spin" /> : 'Return'}
                    </button>
                  </div>
                ))}
                {assets.returned.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 size={18} className="text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{a.asset?.name}</p>
                        <p className="text-xs text-gray-400 font-mono" data-mono>{a.asset?.assetCode} · Returned {new Date(a.returnedAt).toLocaleDateString('en-IN')}</p>
                      </div>
                    </div>
                    <span className="text-xs text-emerald-600 font-medium">Returned</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Approve Form */}
          {exitStatus === 'PENDING' && showApproveForm && (
            <div className="layer-card p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Approve Exit</h3>
              <textarea
                value={approveNotes}
                onChange={e => setApproveNotes(e.target.value)}
                className="input-glass w-full text-sm mb-3"
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
          )}

          {/* Action Buttons */}
          {exitStatus !== 'COMPLETED' && exitStatus !== 'WITHDRAWN' && (
            <div className="flex flex-wrap gap-3">
              {exitStatus === 'PENDING' && !showApproveForm && (
                <button onClick={() => setShowApproveForm(true)} className="btn-primary flex items-center gap-2 text-sm">
                  <CheckCircle2 size={16} /> Approve Exit
                </button>
              )}
              {['APPROVED', 'NO_DUES_PENDING'].includes(exitStatus) && (
                <button
                  onClick={handleComplete}
                  disabled={completing || !assets.allReturned}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                  title={!assets.allReturned ? 'All assets must be returned first' : ''}
                >
                  {completing ? <Loader2 size={16} className="animate-spin" /> : <UserX size={16} />}
                  Complete Exit
                </button>
              )}
              <button onClick={handleWithdraw} disabled={withdrawing} className="btn-secondary flex items-center gap-2 text-sm">
                {withdrawing ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                Withdraw Resignation
              </button>
            </div>
          )}
        </div>

        {/* Right Column — Timeline */}
        <div>
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

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}
