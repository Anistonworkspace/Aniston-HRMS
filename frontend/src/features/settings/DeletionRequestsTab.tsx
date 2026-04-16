import { useState } from 'react';
import {
  Trash2, CheckCircle2, XCircle, Clock, Loader2,
  ChevronLeft, ChevronRight, AlertTriangle, User, Calendar, X,
  IndianRupee,
} from 'lucide-react';
import {
  useGetDeletionRequestsQuery,
  useApproveDeletionRequestMutation,
  useRejectDeletionRequestMutation,
  useDismissDeletionRequestMutation,
} from '../employee/employeeDeletionApi';
import {
  useGetPayrollDeletionRequestsQuery,
  useApprovePayrollDeletionMutation,
  useRejectPayrollDeletionMutation,
  useDismissPayrollDeletionMutation,
} from '../payroll/payrollApi';
import type { DeletionRequest } from '../employee/employeeDeletionApi';
import { cn, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
    PENDING:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-700 border-amber-200',   icon: Clock },
    APPROVED:  { label: 'Approved',  cls: 'bg-green-100 text-green-700 border-green-200',   icon: CheckCircle2 },
    REJECTED:  { label: 'Rejected',  cls: 'bg-red-100   text-red-700   border-red-200',     icon: XCircle },
    CANCELLED: { label: 'Cancelled', cls: 'bg-gray-100  text-gray-600  border-gray-200',    icon: XCircle },
  };
  const cfg = map[status] || map.CANCELLED;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border', cfg.cls)}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ─── Employee Deletion Approve modal ──────────────────────────────────────────
function ApproveModal({
  request,
  onClose,
  onConfirm,
  isLoading,
}: {
  request: DeletionRequest;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-red-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <Trash2 size={20} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Confirm Deletion Approval</h2>
            <p className="text-sm text-red-600 font-medium">This will permanently delete the employee</p>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          <p className="font-semibold mb-1">⚠ Irreversible Action</p>
          <p className="text-xs">
            Approving this request will permanently delete <strong>{request.employeeName} ({request.employeeCode})</strong>{' '}
            and all associated records. Recovery is only possible via database backup restore.
          </p>
        </div>

        <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm space-y-1">
          <p><span className="text-gray-500">Requested by:</span> <span className="font-medium">{request.requestedByName}</span> <span className="text-gray-400 text-xs">({request.requestedByRole})</span></p>
          <p><span className="text-gray-500">Reason:</span> <span className="font-medium">{request.reason}</span></p>
          {request.notes && <p><span className="text-gray-500">Notes:</span> {request.notes}</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {isLoading ? 'Deleting...' : 'Approve & Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Employee Deletion Reject modal ───────────────────────────────────────────
function RejectModal({
  request,
  onClose,
  onConfirm,
  isLoading,
}: {
  request: DeletionRequest;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
            <XCircle size={20} className="text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Reject Deletion Request</h2>
            <p className="text-sm text-gray-500">Employee will remain active</p>
          </div>
        </div>

        <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm">
          <p><span className="text-gray-500">Employee:</span> <span className="font-medium">{request.employeeName} ({request.employeeCode})</span></p>
          <p><span className="text-gray-500">Requested by:</span> {request.requestedByName}</p>
        </div>

        <div className="mb-5">
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Rejection reason <span className="text-gray-400">(optional)</span>
          </label>
          <textarea
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
            placeholder="Explain why this deletion request is rejected..."
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            {isLoading ? 'Rejecting...' : 'Reject Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payroll Reject inline modal ──────────────────────────────────────────────
function PayrollRejectModal({
  request,
  onClose,
  onConfirm,
  isLoading,
}: {
  request: any;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isLoading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
            <XCircle size={20} className="text-gray-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Reject Payroll Deletion Request</h2>
            <p className="text-sm text-gray-500">Payroll run will remain intact</p>
          </div>
        </div>
        <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm">
          <p><span className="text-gray-500">Payroll Period:</span> <span className="font-medium">{request.runLabel}</span></p>
          <p><span className="text-gray-500">Reason:</span> {request.reason}</p>
        </div>
        <div className="mb-5">
          <label className="text-sm font-medium text-gray-700 block mb-1">Rejection reason <span className="text-gray-400">(optional)</span></label>
          <textarea
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
            placeholder="Explain why this deletion request is rejected..."
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={isLoading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            {isLoading ? 'Rejecting...' : 'Reject Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payroll Deletion Requests Section ────────────────────────────────────────
function PayrollDeletionSection() {
  const [payrollRejectTarget, setPayrollRejectTarget] = useState<any>(null);
  const { data: payrollDelRes, refetch: refetchPayrollDels, isLoading: payrollDelLoading } = useGetPayrollDeletionRequestsQuery();
  const [approvePayrollDeletion, { isLoading: isApprovingPayroll }] = useApprovePayrollDeletionMutation();
  const [rejectPayrollDeletion, { isLoading: isRejectingPayroll }] = useRejectPayrollDeletionMutation();
  const [dismissPayrollDeletion] = useDismissPayrollDeletionMutation();

  const payrollRequests: any[] = payrollDelRes?.data || [];

  const handleApprovePayroll = async (req: any) => {
    if (!confirm(`Approve deletion of ${req.runLabel} payroll? This will permanently delete all payroll records for this period.`)) return;
    try {
      await approvePayrollDeletion(req.id).unwrap();
      toast.success(`Payroll run for ${req.runLabel} permanently deleted`);
      refetchPayrollDels();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to approve payroll deletion');
    }
  };

  const handleDismissPayroll = async (id: string) => {
    try {
      await dismissPayrollDeletion(id).unwrap();
      toast.success('Request dismissed');
      refetchPayrollDels();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to dismiss');
    }
  };

  const handleRejectPayroll = async (reason: string) => {
    if (!payrollRejectTarget) return;
    try {
      await rejectPayrollDeletion({ id: payrollRejectTarget.id, rejectionReason: reason }).unwrap();
      toast.success('Payroll deletion request rejected');
      setPayrollRejectTarget(null);
      refetchPayrollDels();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to reject');
    }
  };

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <IndianRupee size={20} className="text-amber-500" />
        <h2 className="text-xl font-bold text-gray-900">Payroll Deletion Requests</h2>
        {payrollRequests.filter(r => r.status === 'PENDING').length > 0 && (
          <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
            {payrollRequests.filter(r => r.status === 'PENDING').length} pending
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Payroll deletion requests submitted by HR. Approving will permanently delete all payroll records for that period.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {payrollDelLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" /> Loading...
          </div>
        ) : payrollRequests.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <IndianRupee size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No payroll deletion requests</p>
            <p className="text-sm mt-1">Payroll deletion requests submitted by HR will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Payroll Period</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Reason</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Requested On</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payrollRequests.map((req: any) => (
                  <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-semibold text-gray-800">{req.runLabel}</p>
                        {req.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{req.notes}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell max-w-xs">
                      <p className="text-gray-600 text-xs line-clamp-2">{req.reason}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-gray-500 text-xs">
                        <Calendar size={12} />
                        {formatDate(req.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {req.status === 'PENDING' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setPayrollRejectTarget(req)}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 transition-colors"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => handleApprovePayroll(req)}
                            disabled={isApprovingPayroll}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors flex items-center gap-1 disabled:opacity-50"
                          >
                            {isApprovingPayroll ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                            Approve &amp; Delete
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDismissPayroll(req.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors"
                        >
                          <X size={11} />
                          Dismiss
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payrollRejectTarget && (
        <PayrollRejectModal
          request={payrollRejectTarget}
          onClose={() => setPayrollRejectTarget(null)}
          onConfirm={handleRejectPayroll}
          isLoading={isRejectingPayroll}
        />
      )}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────
export default function DeletionRequestsTab() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [approveTarget, setApproveTarget] = useState<DeletionRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DeletionRequest | null>(null);

  const { data, isLoading } = useGetDeletionRequestsQuery({
    page,
    limit: 15,
    ...(statusFilter && { status: statusFilter }),
  });

  const [approveRequest, { isLoading: isApproving }] = useApproveDeletionRequestMutation();
  const [rejectRequest, { isLoading: isRejecting }] = useRejectDeletionRequestMutation();
  const [dismissRequest] = useDismissDeletionRequestMutation();

  const requests: DeletionRequest[] = data?.data || [];
  const meta = data?.meta;

  const handleApprove = async () => {
    if (!approveTarget) return;
    try {
      const res = await approveRequest(approveTarget.id).unwrap();
      toast.success(res.message || 'Employee permanently deleted');
      setApproveTarget(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to approve deletion');
    }
  };

  const handleDismiss = async (requestId: string) => {
    try {
      await dismissRequest(requestId).unwrap();
      toast.success('Request dismissed and removed from list');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to dismiss request');
    }
  };

  const handleReject = async (rejectionReason: string) => {
    if (!rejectTarget) return;
    try {
      const res = await rejectRequest({ requestId: rejectTarget.id, rejectionReason }).unwrap();
      toast.success(res.message || 'Deletion request rejected');
      setRejectTarget(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to reject request');
    }
  };

  return (
    <div>
      {/* ── Employee Deletion Requests ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Trash2 size={20} className="text-red-500" />
            Employee Deletion Requests
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Review HR-submitted deletion requests. Approval permanently removes the employee and all records.
          </p>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
        <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-red-700">
          <p className="font-semibold">Approval is irreversible.</p>
          <p className="text-xs mt-0.5">Approving a request permanently deletes the employee and all associated records. Recovery requires restoring from a database backup.</p>
        </div>
      </div>

      {/* Employee Deletion Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" /> Loading...
          </div>
        ) : requests.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Trash2 size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No employee deletion requests found</p>
            <p className="text-sm mt-1">Requests submitted by HR will appear here for your review.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Employee</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Requested By</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">Reason</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Requested On</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide hidden lg:table-cell">Reviewed By</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-semibold text-gray-800">{req.employeeName}</p>
                        <p className="text-xs text-gray-400 font-mono">{req.employeeCode}</p>
                        <p className="text-xs text-gray-400">{req.employeeEmail}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <User size={13} className="text-gray-400" />
                        <div>
                          <p className="font-medium text-gray-700">{req.requestedByName}</p>
                          <p className="text-xs text-gray-400">{req.requestedByRole}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell max-w-xs">
                      <p className="text-gray-600 text-xs line-clamp-2" title={req.reason}>{req.reason}</p>
                      {req.notes && <p className="text-gray-400 text-xs mt-0.5 line-clamp-1 italic">Note: {req.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-gray-500 text-xs">
                        <Calendar size={12} />
                        {formatDate(req.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {req.reviewedByName ? (
                        <div>
                          <p className="text-xs font-medium text-gray-700">{req.reviewedByName}</p>
                          {req.reviewedAt && <p className="text-xs text-gray-400">{formatDate(req.reviewedAt)}</p>}
                          {req.rejectionReason && (
                            <p className="text-xs text-red-500 mt-0.5 italic line-clamp-1">Reason: {req.rejectionReason}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {req.status === 'PENDING' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setRejectTarget(req)}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-50 transition-colors"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => setApproveTarget(req)}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors flex items-center gap-1"
                          >
                            <Trash2 size={12} />
                            Approve &amp; Delete
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDismiss(req.id)}
                          title="Dismiss — remove from list"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 text-xs font-medium hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors"
                        >
                          <X size={11} />
                          Dismiss
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Showing {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of{' '}
              <span className="font-mono" data-mono>{meta.total}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={!meta.hasPrev}
                className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-600 font-mono px-2" data-mono>{meta.page} / {meta.totalPages}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!meta.hasNext}
                className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Employee Deletion modals */}
      {approveTarget && (
        <ApproveModal
          request={approveTarget}
          onClose={() => setApproveTarget(null)}
          onConfirm={handleApprove}
          isLoading={isApproving}
        />
      )}
      {rejectTarget && (
        <RejectModal
          request={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={handleReject}
          isLoading={isRejecting}
        />
      )}

      {/* ── Payroll Deletion Requests ── */}
      <PayrollDeletionSection />
    </div>
  );
}
