import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, X, Clock, CheckCircle, XCircle, AlertCircle,
  Search, FileText, ThumbsUp, ThumbsDown, Pencil, Trash2, Loader2,
  Users, ChevronRight, TrendingUp, UserCheck, Info,
} from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import {
  useGetLeaveBalancesQuery,
  useGetLeaveTypesQuery,
  useGetMyLeavesQuery,
  useCancelLeaveMutation,
  useGetHolidaysQuery,
  useGetPendingApprovalsQuery,
  useGetAllLeavesQuery,
  useHandleLeaveActionMutation,
  useCreateLeaveTypeMutation,
  useUpdateLeaveTypeMutation,
  useDeleteLeaveTypeMutation,
  useCreateHolidayMutation,
  useBulkCreateHolidaysMutation,
  useDeleteHolidayMutation,
  useGetHolidaySuggestionsQuery,
  useGetAllEmployeeLeaveBalancesQuery,
  useGetEmployeeLeaveOverviewQuery,
  useGetOrgLeaveSettingsQuery,
  useUpdateOrgLeaveSettingsMutation,
} from './leaveApi';
import { useGetPendingRegularizationsQuery, useHandleRegularizationMutation } from '../attendance/attendanceApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { useGetPoliciesQuery, useAcknowledgePolicyMutation } from '../policies/policyApi';
import LeaveApplyWizard from './components/LeaveApplyWizard';
import ManagerReviewPanel from './components/ManagerReviewPanel';
import HRReviewPanel from './components/HRReviewPanel';
import toast from 'react-hot-toast';

const LEAVE_ICONS: Record<string, string> = {
  CL: '🏖️', EL: '✨', SL: '🤒', PL: '🌴', LWP: '📋',
};

export default function LeavePage() {
  const { t } = useTranslation();
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(user?.role || '');
  const isHRAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const [view, setView] = useState<'management' | 'personal'>(isManagement ? 'management' : 'personal');

  if (!isManagement) return <LeavePersonalView />;

  return (
    <>
      <div className="px-6 pt-6 pb-2 flex gap-2">
        <button
          onClick={() => setView('management')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === 'management' ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          {t('leaves.title')}
        </button>
        {!isHRAdmin && (
          <button
            onClick={() => setView('personal')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'personal' ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t('leaves.myLeaves')}
          </button>
        )}
      </div>
      {view === 'management' ? <LeaveManagementView /> : <LeavePersonalView />}
    </>
  );
}

/* =============================================================================
   MANAGEMENT VIEW
   ============================================================================= */

function LeaveManagementView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'approvals' | 'types' | 'holidays' | 'regularizations' | 'employee-balances' | 'employee-leaves'>('approvals');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showLeaveTypeModal, setShowLeaveTypeModal] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<any>(null);
  const [reviewLeaveId, setReviewLeaveId] = useState<string | null>(null);
  const [liveNewCount, setLiveNewCount] = useState(0);

  const user = useAppSelector((state) => state.auth.user);
  const isHRAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
  const dispatch = useAppDispatch();

  // Real-time: listen for new leave applications via Socket.io
  useEffect(() => {
    const handler = (data: { employeeName?: string; leaveType?: string; days?: number }) => {
      const name = data.employeeName || 'An employee';
      const type = data.leaveType || 'leave';
      const days = data.days ? ` (${data.days}d)` : '';
      toast.custom((t) => (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={cn(
            'flex items-center gap-3 bg-white border border-brand-100 shadow-lg rounded-xl px-4 py-3 max-w-sm',
            t.visible ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <span className="text-2xl">📋</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">New Leave Request</p>
            <p className="text-xs text-gray-500 truncate">{name} applied for {type}{days}</p>
          </div>
        </motion.div>
      ), { duration: 6000, position: 'top-right' });
      // Bump the live counter (shown on Approvals tab)
      setLiveNewCount((c) => c + 1);
      // Invalidate RTK cache so the approvals list auto-refreshes
      dispatch(api.util.invalidateTags(['Leave' as any]));
    };
    onSocketEvent('leave:applied', handler);
    return () => offSocketEvent('leave:applied', handler);
  }, [dispatch]);

  // Pending approvals (PENDING + MANAGER_APPROVED) — used for pending tab
  const { data: approvalsRes, isLoading: approvalsLoading } = useGetPendingApprovalsQuery(
    { page, limit: 20 },
    { skip: approvalStatusFilter !== 'pending' }
  );

  // All leaves with status filter — used for approved/rejected/all tabs
  const allLeavesStatus = approvalStatusFilter === 'approved' ? 'APPROVED'
    : approvalStatusFilter === 'rejected' ? 'REJECTED'
    : undefined;
  const { data: allLeavesRes, isLoading: allLeavesLoading } = useGetAllLeavesQuery(
    { page, limit: 20, status: allLeavesStatus },
    { skip: approvalStatusFilter === 'pending' }
  );

  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: holidaysRes } = useGetHolidaysQuery({});
  const [handleAction] = useHandleLeaveActionMutation();
  const [deleteLeaveType] = useDeleteLeaveTypeMutation();

  // Combine data based on active filter tab
  const activeRes = approvalStatusFilter === 'pending' ? approvalsRes : allLeavesRes;
  const isLoadingApprovals = approvalStatusFilter === 'pending' ? approvalsLoading : allLeavesLoading;
  const approvals = activeRes?.data || [];
  const leaveTypes = typesRes?.data || [];
  const holidays = holidaysRes?.data || [];

  // Reset page when filter changes
  const handleFilterChange = (filter: typeof approvalStatusFilter) => {
    setApprovalStatusFilter(filter);
    setPage(1);
  };

  // Filter approvals by search
  const filteredApprovals = searchQuery.trim()
    ? approvals.filter((a: any) => {
        const name = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`.toLowerCase();
        return name.includes(searchQuery.toLowerCase());
      })
    : approvals;

  const handleApprove = async (id: string, leave?: any) => {
    // Managers do first-step approval; HR/Admin do final approval
    const action = user?.role === 'MANAGER' ? 'MANAGER_APPROVED' : 'APPROVED';
    const name = leave?.employee ? `${leave.employee.firstName} ${leave.employee.lastName}` : 'employee';
    const leaveTypeName = leave?.leaveType?.name || 'Leave';
    try {
      await handleAction({ id, action }).unwrap();
      toast.success(user?.role === 'MANAGER'
        ? `${leaveTypeName} for ${name} forwarded to HR for final approval`
        : `${leaveTypeName} for ${name} approved`
      );
    } catch (err: any) {
      toast.error(err?.data?.error?.message || t('leaves.failedToApprove'));
    }
  };

  const handleReject = async (id: string, leave?: any) => {
    const name = leave?.employee ? `${leave.employee.firstName} ${leave.employee.lastName}` : 'employee';
    const leaveTypeName = leave?.leaveType?.name || 'Leave';
    try {
      await handleAction({ id, action: 'REJECTED' }).unwrap();
      toast.success(`${leaveTypeName} for ${name} rejected`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || t('leaves.failedToReject'));
    }
  };

  const handleDeleteLeaveType = async (id: string, name: string) => {
    if (!confirm(`Delete leave type "${name}"? This cannot be undone.`)) return;
    try {
      await deleteLeaveType(id).unwrap();
      toast.success(t('leaves.leaveTypeDeleted'));
    } catch (err: any) {
      toast.error(err?.data?.error?.message || t('leaves.failedToDeleteType'));
    }
  };

  const handleEditLeaveType = (lt: any) => {
    setEditingLeaveType(lt);
    setShowLeaveTypeModal(true);
  };

  const handleCreateLeaveType = () => {
    setEditingLeaveType(null);
    setShowLeaveTypeModal(true);
  };

  // Summary counts
  const pendingCount = approvalsRes?.meta?.total ?? 0;

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">{t('leaves.title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('leaves.subtitle')}</p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Clock size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-amber-600" data-mono>{pendingCount}</p>
              <p className="text-xs text-gray-400">Pending Approvals</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <FileText size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-blue-600" data-mono>{leaveTypes.length}</p>
              <p className="text-xs text-gray-400">Leave Types</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
              <CalendarDays size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-purple-600" data-mono>{holidays.length}</p>
              <p className="text-xs text-gray-400">Holidays This Year</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex gap-1 bg-surface-2 rounded-xl p-1 mb-6 w-fit">
        <button
          role="tab" aria-selected={activeTab === 'approvals'}
          onClick={() => { setActiveTab('approvals'); setLiveNewCount(0); }}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
            activeTab === 'approvals'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {t('leaves.approvals')}
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
          {liveNewCount > 0 && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-600" />
            </span>
          )}
        </button>
        <button
          role="tab" aria-selected={activeTab === 'types'}
          onClick={() => setActiveTab('types')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'types'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {t('leaves.types')}
        </button>
        <button
          role="tab" aria-selected={activeTab === 'holidays'}
          onClick={() => setActiveTab('holidays')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'holidays'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {t('leaves.holidays')}
          {holidays.length > 0 && (
            <span className="ml-2 bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {holidays.length}
            </span>
          )}
        </button>
        <button
          role="tab" aria-selected={activeTab === 'regularizations'}
          onClick={() => setActiveTab('regularizations')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'regularizations'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {t('attendance.regularizations')}
        </button>
        <button
          role="tab" aria-selected={activeTab === 'employee-balances'}
          onClick={() => setActiveTab('employee-balances')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'employee-balances'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Employee Balances
        </button>
        <button
          role="tab" aria-selected={activeTab === 'employee-leaves'}
          onClick={() => setActiveTab('employee-leaves')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
            activeTab === 'employee-leaves'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          <Users size={14} />
          Employee Leaves
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'approvals' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Status filter pills */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {[
              { key: 'pending', label: 'Pending', color: 'amber' },
              { key: 'approved', label: 'Approved', color: 'emerald' },
              { key: 'rejected', label: 'Rejected / Cancelled', color: 'red' },
              { key: 'all', label: 'All', color: 'gray' },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => handleFilterChange(f.key as any)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  approvalStatusFilter === f.key
                    ? f.color === 'amber' ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                      : f.color === 'emerald' ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
                      : f.color === 'red' ? 'bg-red-100 text-red-800 ring-1 ring-red-300'
                      : 'bg-gray-200 text-gray-800 ring-1 ring-gray-300'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                {f.label}
                {f.key === 'pending' && pendingCount > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}

            {/* Search */}
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-glass pl-8 pr-3 py-1.5 text-xs w-48"
              />
            </div>
          </div>

          {/* Approval cards */}
          {isLoadingApprovals ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="layer-card p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-32" />
                      <div className="h-3 bg-gray-100 rounded w-48" />
                    </div>
                    <div className="h-7 bg-gray-100 rounded-lg w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredApprovals.length === 0 ? (
            <div className="layer-card p-12 text-center">
              <CheckCircle size={40} className="mx-auto text-emerald-200 mb-3" />
              <p className="text-sm text-gray-400">
                {approvalStatusFilter === 'pending' ? 'No pending leave requests' : 'No leave requests found'}
              </p>
              <p className="text-xs text-gray-300 mt-1">
                {approvalStatusFilter === 'pending' ? 'All caught up!' : 'Try a different filter'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map((leave: any, idx: number) => {
                // Find leave balance for this leave type from employee's balance data (available in pending approvals)
                const leaveBalance = leave.employee?.leaveBalances?.find(
                  (b: any) => b.leaveType?.code === leave.leaveType?.code
                );
                const canAct = leave.status === 'PENDING' || leave.status === 'MANAGER_APPROVED';
                // HR/Admin can open the review panel on approved leaves to revoke them
                const canRevoke = isHRAdmin && (leave.status === 'APPROVED' || leave.status === 'APPROVED_WITH_CONDITION');

                return (
                  <motion.div
                    key={leave.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="layer-card p-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700 shrink-0">
                          {(leave.employee?.firstName?.[0] || '') + (leave.employee?.lastName?.[0] || '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">
                            {leave.employee?.firstName} {leave.employee?.lastName}
                            <span className="text-gray-400 font-normal ml-2 text-xs">
                              {leave.employee?.employeeCode}
                            </span>
                            {leave.employee?.department?.name && (
                              <span className="text-gray-400 font-normal ml-2 text-xs">
                                · {leave.employee.department.name}
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className={cn('badge text-xs', leave.leaveType?.isPaid !== false ? 'badge-info' : 'badge-warning')}>
                              {leave.leaveType?.name || 'Leave'}
                              {leave.leaveType?.isPaid === false && ' (Unpaid)'}
                            </span>
                            <span className="text-xs text-gray-500">
                              {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
                            </span>
                            <span className="text-xs font-mono text-gray-600 font-medium" data-mono>
                              {Number(leave.days)} {Number(leave.days) === 1 ? 'day' : 'days'}
                            </span>
                            {leave.isHalfDay && (
                              <span className="badge badge-neutral text-xs">Half Day</span>
                            )}
                            {leave.leaveType?.isPaid === false && (
                              <span className="badge badge-warning text-[10px]">Payroll Impact</span>
                            )}
                          </div>
                          {leave.reason && (
                            <p className="text-xs text-gray-400 mt-1.5 line-clamp-1 italic">"{leave.reason}"</p>
                          )}
                          {/* Balance info — shown when available (from pending approvals enriched data) */}
                          {leaveBalance && (
                            <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500 bg-gray-50 rounded-md px-2.5 py-1.5">
                              <span>Balance: <span className="font-medium text-gray-700">{Number(leaveBalance.allocated)} alloc</span></span>
                              <span>·</span>
                              <span>Used: <span className="font-medium text-amber-600">{Number(leaveBalance.used)}</span></span>
                              <span>·</span>
                              <span>Pending: <span className="font-medium text-blue-600">{Number(leaveBalance.pending)}</span></span>
                            </div>
                          )}
                          {/* Manager-approved note */}
                          {leave.status === 'MANAGER_APPROVED' && (
                            <p className="text-[11px] text-emerald-600 mt-1.5 flex items-center gap-1">
                              <CheckCircle size={11} /> Manager approved — awaiting HR final decision
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <span className={`badge ${getStatusColor(leave.status)} text-xs`}>
                          {leave.status.replace(/_/g, ' ')}
                        </span>
                        {canRevoke && (
                          <motion.button
                            aria-label="Revoke approved leave"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setReviewLeaveId(leave.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                          >
                            <XCircle size={14} />
                            Revoke
                          </motion.button>
                        )}
                        {canAct && (
                          <>
                            <motion.button
                              aria-label="Review leave with task impact"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setReviewLeaveId(leave.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-100 transition-colors"
                            >
                              <FileText size={14} />
                              Review
                            </motion.button>
                            <motion.button
                              aria-label="Approve leave"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleApprove(leave.id, leave)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors"
                            >
                              <ThumbsUp size={14} />
                              {t('leaves.approve')}
                            </motion.button>
                            <motion.button
                              aria-label="Reject leave"
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleReject(leave.id, leave)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                            >
                              <ThumbsDown size={14} />
                              {t('leaves.reject')}
                            </motion.button>
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {(activeRes?.meta?.totalPages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                {t('common.showing')} {((page - 1) * 20) + 1}–{Math.min(page * 20, activeRes?.meta?.total || 0)} {t('common.of')} {activeRes?.meta?.total || 0}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!activeRes?.meta?.hasPrev}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.previousPage')}
                </button>
                <span className="text-xs text-gray-500 font-mono" data-mono>
                  {page} / {activeRes?.meta?.totalPages || 1}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!activeRes?.meta?.hasNext}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t('common.nextPage')}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {activeTab === 'types' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Org Working Days Settings */}
          <OrgWorkingDaysCard />

          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{leaveTypes.length} leave types configured</p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCreateLeaveType}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              {t('leaves.createLeaveType')}
            </motion.button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {leaveTypes.map((lt: any, idx: number) => (
              <motion.div
                key={lt.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="layer-card p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{LEAVE_ICONS[lt.code] || '📅'}</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{lt.name}</p>
                      <p className="text-xs text-gray-400">{lt.code}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEditLeaveType(lt)}
                      className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors text-gray-400 hover:text-brand-600"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteLeaveType(lt.id, lt.name)}
                      className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-gray-400 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-surface-2 rounded-lg py-2 px-3">
                    <p className="text-lg font-bold font-mono text-brand-600" data-mono>
                      {Number(lt.defaultBalance) || 0}
                    </p>
                    <p className="text-xs text-gray-400">Default Days</p>
                  </div>
                  <div className="bg-surface-2 rounded-lg py-2 px-3">
                    <p className="text-lg font-bold font-mono text-gray-600" data-mono>
                      {lt.maxDays ?? 0}
                    </p>
                    <p className="text-xs text-gray-400">Max Days</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {lt.isPaid && <span className="badge badge-success text-xs">Paid</span>}
                  {!lt.isPaid && <span className="badge badge-neutral text-xs">Unpaid</span>}
                  {lt.carryForward && <span className="badge badge-info text-xs">Carry Forward</span>}
                  {lt.requiresApproval !== false && <span className="badge badge-warning text-xs">Needs Approval</span>}
                  {lt.allowSameDay && <span className="badge badge-neutral text-xs">Same-day OK</span>}
                  {lt.gender && <span className="badge badge-neutral text-xs">{lt.gender} only</span>}
                </div>
                {/* Policy details */}
                <div className="mt-2.5 pt-2.5 border-t border-gray-100">
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400">
                    {lt.noticeDays != null && lt.noticeDays > 0 && (
                      <span>Notice: <span className="text-gray-600 font-medium">{lt.noticeDays}d</span></span>
                    )}
                    {lt.maxPerMonth != null && lt.maxPerMonth > 0 && (
                      <span>Max/month: <span className="text-gray-600 font-medium">{lt.maxPerMonth}</span></span>
                    )}
                    {lt.minDays != null && lt.minDays > 0 && (
                      <span>Min: <span className="text-gray-600 font-medium">{lt.minDays}d</span></span>
                    )}
                    {lt.carryForward && lt.maxCarryForward != null && (
                      <span>Carry max: <span className="text-gray-600 font-medium">{lt.maxCarryForward}d</span></span>
                    )}
                    {lt.probationMonths != null && lt.probationMonths > 0 && (
                      <span>Probation: <span className="text-gray-600 font-medium">{lt.probationMonths}mo</span></span>
                    )}
                    <span>Same-day: <span className="text-gray-600 font-medium">{lt.allowSameDay ? 'Yes' : 'No'}</span></span>
                    <span>Wknd adj: <span className="text-gray-600 font-medium">{lt.allowWeekendAdjacent ? 'Yes' : 'No'}</span></span>
                    {lt.allowPastDates && <span>Past dates: <span className="text-gray-600 font-medium">Allowed</span></span>}
                    {lt.maxAdvanceDays != null && lt.maxAdvanceDays > 0 && (
                      <span>Max advance: <span className="text-gray-600 font-medium">{lt.maxAdvanceDays}d</span></span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Holidays & Events Tab */}
      {activeTab === 'holidays' && <HolidayManagementTab />}

      {/* Regularizations Tab */}
      {activeTab === 'regularizations' && <RegularizationApprovalTab />}

      {/* Employee Balances Tab */}
      {activeTab === 'employee-balances' && <EmployeeBalancesTab />}

      {/* Employee Leaves Tab */}
      {activeTab === 'employee-leaves' && <EmployeeOverviewTab />}

      {/* Create/Edit Leave Type Modal */}
      <AnimatePresence>
        {showLeaveTypeModal && (
          <LeaveTypeModal
            leaveType={editingLeaveType}
            onClose={() => { setShowLeaveTypeModal(false); setEditingLeaveType(null); }}
          />
        )}
      </AnimatePresence>

      {/* Review Panel — MANAGER gets first-step panel; HR/Admin get final-step panel */}
      {reviewLeaveId && (
        user?.role === 'MANAGER'
          ? <ManagerReviewPanel leaveId={reviewLeaveId} onClose={() => setReviewLeaveId(null)} />
          : <HRReviewPanel leaveId={reviewLeaveId} onClose={() => setReviewLeaveId(null)} />
      )}
    </div>
  );
}

/* =============================================================================
   EMPLOYEE BALANCES TAB
   ============================================================================= */

function EmployeeBalancesTab() {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = useGetAllEmployeeLeaveBalancesQuery({ year, search });
  const employees: any[] = data?.data || [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search employee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-glass pl-8 pr-3 py-1.5 text-xs w-48"
          />
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="input-glass text-xs py-1.5 px-3"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{employees.length} employees</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="layer-card p-4 animate-pulse h-14" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <p className="text-sm text-gray-400">No employees found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium text-center">Allocated</th>
                <th className="px-4 py-3 font-medium text-center">Used</th>
                <th className="px-4 py-3 font-medium text-center">Pending</th>
                <th className="px-4 py-3 font-medium text-center">Remaining</th>
                <th className="px-4 py-3 font-medium">Leave Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {employees.map((emp: any) => (
                <tr key={emp.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                    <p className="text-gray-400 font-mono text-[11px]" data-mono>{emp.employeeCode}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{emp.department}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-gray-700" data-mono>{emp.totalAllocated}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-amber-600" data-mono>{emp.totalUsed}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-blue-600" data-mono>{emp.totalPending}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-mono font-bold text-sm ${emp.totalRemaining < 2 ? 'text-red-600' : emp.totalRemaining < 5 ? 'text-amber-600' : 'text-emerald-600'}`} data-mono>
                      {emp.totalRemaining}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {emp.balances?.map((b: any) => (
                        <span key={b.leaveTypeId} className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 text-[10px]">
                          <span className="font-medium">{b.leaveTypeCode}</span>
                          <span className="text-gray-400">:</span>
                          <span className={b.remaining < 1 ? 'text-red-500 font-bold' : 'text-gray-700'}>{b.remaining}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

/* =============================================================================
   HOLIDAY MANAGEMENT TAB
   ============================================================================= */

function HolidayManagementTab() {
  const { t } = useTranslation();
  const { data: holidaysRes, refetch } = useGetHolidaysQuery({});
  const { data: suggestionsRes } = useGetHolidaySuggestionsQuery({});
  const [createHoliday, { isLoading: creating }] = useCreateHolidayMutation();
  const [bulkCreate, { isLoading: bulkCreating }] = useBulkCreateHolidaysMutation();
  const [deleteHoliday] = useDeleteHolidayMutation();
  const [showForm, setShowForm] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    name: '', date: '', type: 'PUBLIC', isOptional: false, isHalfDay: false,
    halfDaySession: '', startTime: '', endTime: '', description: '', color: '',
    notifyEmployees: true,
  });

  const holidays = holidaysRes?.data || [];
  const suggestions = suggestionsRes?.data || [];

  const resetForm = () => {
    setForm({ name: '', date: '', type: 'PUBLIC', isOptional: false, isHalfDay: false,
      halfDaySession: '', startTime: '', endTime: '', description: '', color: '', notifyEmployees: true });
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!form.name || !form.date) return;
    try {
      await createHoliday(form).unwrap();
      toast.success(`${form.type === 'EVENT' ? 'Event' : 'Holiday'} created! ${form.notifyEmployees ? 'Emails sent to employees.' : ''}`);
      resetForm();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to create');
    }
  };

  const handleBulkAdd = async () => {
    const selected = suggestions.filter((_: any, i: number) => selectedSuggestions.has(i));
    if (selected.length === 0) return;
    try {
      const res = await bulkCreate({ holidays: selected }).unwrap();
      toast.success(`${res.data?.created || selected.length} holidays added!`);
      setSelectedSuggestions(new Set());
      setShowSuggestions(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to bulk create');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteHoliday(id).unwrap();
      toast.success('Holiday deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to delete');
    }
  };

  const toggleSuggestion = (i: number) => {
    const next = new Set(selectedSuggestions);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelectedSuggestions(next);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {/* Actions */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-2">
          <Plus size={14} /> {t('leaves.addHoliday')}
        </button>
        <button onClick={() => setShowSuggestions(!showSuggestions)} className="btn-secondary text-sm flex items-center gap-2">
          <CalendarDays size={14} /> Indian Holidays ({suggestions.length})
        </button>
        {holidays.length > 0 && (
          <button onClick={async () => {
            if (!confirm(`Delete ALL ${holidays.length} holidays/events? This cannot be undone.`)) return;
            try {
              for (const h of holidays) { await deleteHoliday(h.id).unwrap(); }
              toast.success(`Deleted ${holidays.length} holidays`);
            } catch { toast.error('Failed to delete some holidays'); }
          }} className="text-xs text-red-500 hover:text-red-700 ml-auto">
            Delete All ({holidays.length})
          </button>
        )}
      </div>

      {/* AI Suggestions Panel */}
      <AnimatePresence>
        {showSuggestions && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
            <div className="layer-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Indian Holidays — {new Date().getFullYear()}</h3>
                  <p className="text-xs text-gray-400">Select holidays to add in bulk</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedSuggestions(new Set(suggestions.map((_: any, i: number) => i)))} className="text-xs text-brand-600 hover:underline">Select All</button>
                  <button onClick={() => setSelectedSuggestions(new Set())} className="text-xs text-gray-400 hover:underline">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                {suggestions.map((s: any, i: number) => (
                  <label key={i} className={cn('flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-left',
                    selectedSuggestions.has(i) ? 'bg-brand-50 border-brand-300' : 'bg-white border-gray-200 hover:bg-gray-50')}>
                    <input type="checkbox" checked={selectedSuggestions.has(i)} onChange={() => toggleSuggestion(i)} className="mt-0.5 rounded" />
                    <div>
                      <p className="text-xs font-medium text-gray-800">{s.name}</p>
                      <p className="text-[10px] text-gray-400">{new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })} · {s.type}</p>
                    </div>
                  </label>
                ))}
              </div>
              {selectedSuggestions.size > 0 && (
                <button onClick={handleBulkAdd} disabled={bulkCreating} className="btn-primary text-sm mt-3 flex items-center gap-2">
                  {bulkCreating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Add {selectedSuggestions.size} Selected Holidays
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
            <div className="layer-card p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Create Holiday / Event</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Diwali, Team Offsite" className="input-glass w-full text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="input-glass w-full text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input-glass w-full text-sm">
                    <option value="PUBLIC">Public Holiday</option>
                    <option value="OPTIONAL">Optional Holiday</option>
                    <option value="EVENT">Company Event</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description..." className="input-glass w-full text-sm" />
                </div>
                <div className="flex gap-3 items-end">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={form.isHalfDay} onChange={e => setForm(f => ({ ...f, isHalfDay: e.target.checked }))} className="rounded" />
                    Half Day
                  </label>
                  {form.isHalfDay && (
                    <select value={form.halfDaySession} onChange={e => setForm(f => ({ ...f, halfDaySession: e.target.value }))} className="input-glass text-sm">
                      <option value="">Select session</option>
                      <option value="FIRST_HALF">First Half Off</option>
                      <option value="SECOND_HALF">Second Half Off</option>
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Time <span className="text-gray-400">(optional)</span></label>
                  <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="input-glass w-full text-sm" placeholder="e.g. 09:30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Time <span className="text-gray-400">(optional)</span></label>
                  <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="input-glass w-full text-sm" placeholder="e.g. 18:00" />
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={form.notifyEmployees} onChange={e => setForm(f => ({ ...f, notifyEmployees: e.target.checked }))} className="rounded" />
                    Email all employees
                  </label>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={handleCreate} disabled={creating || !form.name || !form.date} className="btn-primary text-sm flex items-center gap-2">
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Create
                </button>
                <button onClick={resetForm} className="btn-secondary text-sm">{t('common.cancel')}</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Holiday List */}
      <div className="layer-card overflow-hidden">
        {holidays.length === 0 ? (
          <div className="text-center py-12">
            <CalendarDays size={32} className="mx-auto text-gray-200 mb-2" />
            <p className="text-sm text-gray-500">No holidays or events yet</p>
            <p className="text-xs text-gray-400 mt-1">Create holidays or import Indian holidays using the buttons above</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Holiday / Event</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{t('common.date')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{t('common.type')}</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h: any) => {
                const isPast = new Date(h.date) < new Date();
                const typeColors: Record<string, string> = {
                  PUBLIC: 'bg-blue-50 text-blue-700', OPTIONAL: 'bg-amber-50 text-amber-700',
                  EVENT: 'bg-orange-50 text-orange-700', CUSTOM: 'bg-purple-50 text-purple-700',
                };
                return (
                  <tr key={h.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', isPast && 'opacity-50')}>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">{h.name}</p>
                      {h.description && <p className="text-xs text-gray-400 mt-0.5 max-w-xs truncate">{h.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700">{new Date(h.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' })}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', typeColors[h.type] || 'bg-gray-100 text-gray-600')}>{h.type}</span>
                      {h.isOptional && <span className="ml-1 text-[10px] text-amber-500">(Optional)</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {h.isHalfDay ? `Half Day (${h.halfDaySession === 'FIRST_HALF' ? '1st' : '2nd'} half)` : h.startTime ? `${h.startTime} — ${h.endTime}` : 'Full Day'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleDelete(h.id, h.name)} className="text-xs text-red-500 hover:text-red-700">{t('common.delete')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </motion.div>
  );
}

/* =============================================================================
   REGULARIZATION APPROVAL TAB (HR)
   ============================================================================= */

function RegularizationApprovalTab() {
  const { data: regsRes, isLoading } = useGetPendingRegularizationsQuery();
  const [handleReg, { isLoading: processing }] = useHandleRegularizationMutation();
  const [remarks, setRemarks] = useState<Record<string, string>>({});

  const regs = regsRes?.data || [];

  const handleAction = async (id: string, action: string) => {
    try {
      await handleReg({ id, action, remarks: remarks[id] || '' }).unwrap();
      toast.success(`Regularization ${action.toLowerCase()}`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || `Failed to ${action.toLowerCase()}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="layer-card overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></div>
        ) : regs.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle size={32} className="mx-auto text-emerald-200 mb-2" />
            <p className="text-sm text-gray-500">No pending regularization requests</p>
            <p className="text-xs text-gray-400 mt-1">All caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {regs.map((reg: any) => {
              const emp = reg.attendance?.employee;
              const att = reg.attendance;
              return (
                <div key={reg.id} className="p-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <Clock size={18} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-800">{emp?.firstName} {emp?.lastName}</p>
                        <span className="text-[10px] font-mono text-gray-400" data-mono>{emp?.employeeCode}</span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">
                        Date: <strong>{att?.date ? new Date(att.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</strong>
                        {' · '}Current: <strong className="text-amber-600">{att?.status?.replace('_', ' ')}</strong>
                        {att?.totalHours && <> · Hours: <strong>{Number(att.totalHours).toFixed(1)}h</strong></>}
                      </p>
                      {att?.notes && <p className="text-[10px] text-amber-600 mb-1">{att.notes}</p>}
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                        <p className="text-xs text-amber-800"><strong>Reason:</strong> {reg.reason}</p>
                        {reg.requestedCheckIn && <p className="text-[10px] text-amber-700">Requested Check-in: {new Date(reg.requestedCheckIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</p>}
                        {reg.requestedCheckOut && <p className="text-[10px] text-amber-700">Requested Check-out: {new Date(reg.requestedCheckOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <input value={remarks[reg.id] || ''} onChange={e => setRemarks(r => ({ ...r, [reg.id]: e.target.value }))}
                          placeholder="Remarks (optional)..." className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-300" />
                        <button onClick={() => handleAction(reg.id, 'APPROVED')} disabled={processing}
                          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                          <ThumbsUp size={12} /> Approve (Full Day)
                        </button>
                        <button onClick={() => handleAction(reg.id, 'REJECTED')} disabled={processing}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                          <ThumbsDown size={12} /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </motion.div>
  );
}

/* =============================================================================
   EMPLOYEE OVERVIEW TAB
   ============================================================================= */

function EmployeeOverviewTab() {
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  const { data, isLoading } = useGetAllEmployeeLeaveBalancesQuery({ year, search });
  const employees: any[] = data?.data || [];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search employee..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-glass pl-8 pr-3 py-1.5 text-xs w-52"
          />
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="input-glass text-xs py-1.5 px-3"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{employees.length} employees — click any row to view full leave details</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="layer-card p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="layer-card p-12 text-center">
          <Users size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No employees found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium text-center">Allocated</th>
                <th className="px-4 py-3 font-medium text-center">Used</th>
                <th className="px-4 py-3 font-medium text-center">Pending</th>
                <th className="px-4 py-3 font-medium text-center">Remaining</th>
                <th className="px-4 py-3 font-medium text-center">Applied</th>
                <th className="px-4 py-3 font-medium text-center">Approved</th>
                <th className="px-4 py-3 font-medium w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {employees.map((emp: any) => (
                <tr
                  key={emp.id}
                  onClick={() => setSelectedEmployee(emp)}
                  className="hover:bg-brand-50/40 transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-semibold text-brand-700 shrink-0">
                        {(emp.firstName?.[0] || '') + (emp.lastName?.[0] || '')}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                        <p className="text-gray-400 font-mono text-[11px]" data-mono>{emp.employeeCode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{emp.department}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-gray-700" data-mono>{emp.totalAllocated}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-amber-600" data-mono>{emp.totalUsed}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-blue-600" data-mono>{emp.totalPending}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-mono font-bold ${emp.totalRemaining < 2 ? 'text-red-600' : emp.totalRemaining < 5 ? 'text-amber-600' : 'text-emerald-600'}`} data-mono>
                      {emp.totalRemaining}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-gray-600" data-mono>{emp.leavesApplied}</td>
                  <td className="px-4 py-3 text-center font-mono text-emerald-600 font-medium" data-mono>{emp.leavesApproved}</td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={14} className="text-gray-300 group-hover:text-brand-500 transition-colors" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {selectedEmployee && (
          <EmployeeLeaveDetailModal
            employeeId={selectedEmployee.id}
            employeeName={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
            year={year}
            onClose={() => setSelectedEmployee(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* =============================================================================
   EMPLOYEE LEAVE DETAIL MODAL
   ============================================================================= */

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  MANAGER_APPROVED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  APPROVED_WITH_CONDITION: 'bg-teal-100 text-teal-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  DRAFT: 'bg-gray-100 text-gray-400',
};

function EmployeeLeaveDetailModal({
  employeeId,
  employeeName,
  year,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  year: number;
  onClose: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modalYear, setModalYear] = useState(year);

  const { data, isLoading, isFetching } = useGetEmployeeLeaveOverviewQuery(
    { employeeId, year: modalYear },
    { refetchOnMountOrArgChange: true }
  );

  const overview = data?.data;
  const requests: any[] = overview?.requests || [];

  const filteredRequests = statusFilter === 'ALL'
    ? requests
    : statusFilter === 'PENDING'
    ? requests.filter((r: any) => r.status === 'PENDING' || r.status === 'MANAGER_APPROVED')
    : requests.filter((r: any) => r.status === statusFilter);

  const filterTabs = [
    { key: 'ALL', label: 'All', count: requests.length },
    { key: 'PENDING', label: 'Pending', count: overview?.summary?.leavesPending ?? 0 },
    { key: 'APPROVED', label: 'Approved', count: overview?.summary?.leavesApproved ?? 0 },
    { key: 'REJECTED', label: 'Rejected', count: overview?.summary?.leavesRejected ?? 0 },
    { key: 'CANCELLED', label: 'Cancelled', count: overview?.summary?.leavesCancelled ?? 0 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden" style={{ maxHeight: 'min(90dvh, calc(100dvh - 2rem))' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700">
              {employeeName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{employeeName}</h2>
              {overview?.employee && (
                <p className="text-xs text-gray-400">
                  {overview.employee.employeeCode} · {overview.employee.department} · {overview.employee.designation}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={modalYear}
              onChange={(e) => setModalYear(Number(e.target.value))}
              className="input-glass text-xs py-1 px-2"
            >
              {[modalYear - 1, modalYear, modalYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {isFetching && <Loader2 size={14} className="animate-spin text-brand-400" />}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X size={18} className="text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin text-brand-400" />
            </div>
          ) : !overview ? (
            <div className="text-center py-16 text-sm text-gray-400">Failed to load leave data</div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 pb-0">
                {[
                  { label: 'Allocated', value: overview.summary.totalAllocated, color: 'text-gray-700', bg: 'bg-gray-50' },
                  { label: 'Used', value: overview.summary.totalUsed, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: 'Pending', value: overview.summary.totalPending, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Remaining', value: overview.summary.totalRemaining,
                    color: overview.summary.totalRemaining < 2 ? 'text-red-600' : overview.summary.totalRemaining < 5 ? 'text-amber-600' : 'text-emerald-600',
                    bg: overview.summary.totalRemaining < 2 ? 'bg-red-50' : overview.summary.totalRemaining < 5 ? 'bg-amber-50' : 'bg-emerald-50' },
                ].map((s) => (
                  <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                    <p className={`text-2xl font-bold font-mono ${s.color}`} data-mono>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label} Days</p>
                  </div>
                ))}
              </div>

              {/* Leave Type Breakdown */}
              {overview.balances.length > 0 && (
                <div className="px-5 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Leave Balance by Type</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {overview.balances.map((b: any) => (
                      <div key={b.leaveTypeId} className="bg-surface-2 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{LEAVE_ICONS[b.leaveTypeCode] || '📅'}</span>
                            <div>
                              <p className="text-xs font-semibold text-gray-800">{b.leaveTypeName}</p>
                              <p className="text-[10px] text-gray-400">{b.leaveTypeCode} · {b.isPaid ? 'Paid' : 'Unpaid'}</p>
                            </div>
                          </div>
                          <span className={`text-sm font-bold font-mono ${b.remaining < 1 ? 'text-red-600' : b.remaining < 3 ? 'text-amber-600' : 'text-emerald-600'}`} data-mono>
                            {b.remaining}
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${b.remaining < 1 ? 'bg-red-400' : b.remaining < 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(100, (b.remaining / Math.max(b.allocated + b.carriedForward, 1)) * 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between mt-1.5 text-[10px] text-gray-400">
                          <span>Used: <span className="font-medium text-gray-600">{b.used}</span></span>
                          {b.carriedForward > 0 && <span>CF: <span className="font-medium text-blue-500">{b.carriedForward}</span></span>}
                          <span>Alloc: <span className="font-medium text-gray-600">{b.allocated}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Leave Requests */}
              <div className="px-5 pt-5 pb-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <TrendingUp size={12} /> Leave Requests — {modalYear}
                  </p>
                  <span className="text-xs text-gray-400">{overview.summary.totalApprovedDays} approved days total</span>
                </div>

                {/* Status filter pills */}
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {filterTabs.map((ft) => (
                    <button
                      key={ft.key}
                      onClick={() => setStatusFilter(ft.key)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                        statusFilter === ft.key
                          ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-300'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      )}
                    >
                      {ft.label}
                      {ft.count > 0 && (
                        <span className="ml-1 font-bold">{ft.count}</span>
                      )}
                    </button>
                  ))}
                </div>

                {filteredRequests.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400 bg-gray-50 rounded-xl">
                    No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase()} leave requests for {modalYear}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredRequests.map((req: any) => (
                      <div key={req.id} className="border border-gray-100 rounded-xl p-3.5 bg-white hover:bg-gray-50/50 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-gray-800">
                                {req.leaveType?.name || 'Leave'}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatDate(req.startDate)}
                                {req.startDate !== req.endDate && ` – ${formatDate(req.endDate)}`}
                              </span>
                              <span className="text-xs font-mono font-medium text-gray-600" data-mono>
                                {req.days} {req.days === 1 ? 'day' : 'days'}
                              </span>
                              {req.isHalfDay && (
                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Half Day</span>
                              )}
                            </div>
                            {req.reason && (
                              <p className="text-[11px] text-gray-400 mt-1 italic line-clamp-1">"{req.reason}"</p>
                            )}
                            {(req.approverRemarks || req.managerRemarks) && (
                              <p className="text-[11px] text-brand-500 mt-1">
                                Remark: {req.approverRemarks || req.managerRemarks}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-500')}>
                              {req.status.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] text-gray-300">
                              {new Date(req.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* =============================================================================
   ORG WORKING DAYS SETTINGS CARD
   ============================================================================= */

const DAY_LABELS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
];

function OrgWorkingDaysCard() {
  const { data: settingsRes, isLoading } = useGetOrgLeaveSettingsQuery();
  const [updateSettings, { isLoading: saving }] = useUpdateOrgLeaveSettingsMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set(['1', '2', '3', '4', '5', '6']));
  const [dirty, setDirty] = useState(false);

  const serverDays = settingsRes?.workingDays || '1,2,3,4,5,6';
  const serverSet = new Set(serverDays.split(',').map((d: string) => d.trim()));

  // Sync from server when data loads
  useEffect(() => {
    if (settingsRes?.workingDays) {
      setSelected(new Set(settingsRes.workingDays.split(',').map((d: string) => d.trim())));
      setDirty(false);
    }
  }, [settingsRes?.workingDays]);

  const toggle = (val: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    const sorted = DAY_LABELS.map((d) => d.value).filter((v) => selected.has(v));
    if (sorted.length === 0) {
      toast.error('At least one working day must be selected');
      return;
    }
    try {
      await updateSettings({ workingDays: sorted.join(',') }).unwrap();
      toast.success('Working days updated');
      setDirty(false);
    } catch {
      toast.error('Failed to update working days');
    }
  };

  const displaySet = dirty ? selected : serverSet;

  return (
    <div className="layer-card p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Working Days</h3>
          <p className="text-xs text-gray-400 mt-0.5">Set which days count as working days for leave calculations and sandwich rules</p>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Save
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex gap-2">
          {DAY_LABELS.map((d) => <div key={d.value} className="w-12 h-10 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {DAY_LABELS.map((d) => {
            const active = displaySet.has(d.value);
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggle(d.value)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                  active
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-brand-300 hover:text-brand-600'
                }`}
              >
                {d.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center text-xs text-gray-400 gap-1.5">
            <span className="font-medium text-gray-600">{displaySet.size}</span> working day{displaySet.size !== 1 ? 's' : ''} selected
            <span className="mx-1">·</span>
            {displaySet.size === 5 && <span className="text-emerald-600 font-medium">5-day week</span>}
            {displaySet.size === 6 && <span className="text-amber-600 font-medium">6-day week</span>}
            {displaySet.size === 7 && <span className="text-red-600 font-medium">7-day week</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   TOOLTIP COMPONENT
   ============================================================================= */

function Tip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="relative inline-flex items-center ml-1 align-middle"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="w-3.5 h-3.5 rounded-full bg-gray-200 hover:bg-brand-100 text-gray-400 hover:text-brand-600 text-[9px] flex items-center justify-center cursor-help font-bold transition-colors select-none">
        ?
      </span>
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-gray-900 text-white text-[11px] rounded-xl px-3 py-2.5 z-[999] shadow-2xl leading-relaxed pointer-events-none whitespace-normal">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}

/* =============================================================================
   LEAVE TYPE CREATE/EDIT MODAL
   ============================================================================= */

const LEAVE_TYPE_DEFAULTS = {
  name: '', code: '', defaultDays: 0, maxDays: 0, minDays: 0.5,
  isPaid: true, isCarryForward: false, maxCarryForward: 0,
  isActive: true,
  applicableTo: 'ALL',
  noticeDays: 0, maxPerMonth: 0, probationMonths: 0,
  allowSameDay: false, allowWeekendAdjacent: true, requiresApproval: true,
  allowPastDates: false, maxAdvanceDays: 0,
  genderRestriction: '',
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-brand-500' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function LeaveTypeModal({ leaveType, onClose }: { leaveType: any | null; onClose: () => void }) {
  const { t } = useTranslation();
  const isEditing = !!leaveType;

  const [formData, setFormData] = useState(() => {
    if (leaveType) {
      return {
        name: leaveType.name || '',
        code: leaveType.code || '',
        defaultDays: Number(leaveType.defaultBalance) || 0,
        maxDays: Number(leaveType.maxDays) || 0,
        minDays: Number(leaveType.minDays) || 0.5,
        isPaid: leaveType.isPaid ?? true,
        isCarryForward: leaveType.carryForward ?? false,
        maxCarryForward: Number(leaveType.maxCarryForward) || 0,
        isActive: leaveType.isActive ?? true,
        applicableTo: leaveType.applicableTo || 'ALL',
        noticeDays: leaveType.noticeDays ?? 0,
        maxPerMonth: leaveType.maxPerMonth ?? 0,
        probationMonths: leaveType.probationMonths ?? 0,
        allowSameDay: leaveType.allowSameDay ?? false,
        allowWeekendAdjacent: leaveType.allowWeekendAdjacent ?? true,
        requiresApproval: leaveType.requiresApproval ?? true,
        allowPastDates: leaveType.allowPastDates ?? false,
        maxAdvanceDays: leaveType.maxAdvanceDays ?? 0,
        genderRestriction: leaveType.gender || '',
      };
    }
    return { ...LEAVE_TYPE_DEFAULTS };
  });

  const [createLeaveType, { isLoading: creating }] = useCreateLeaveTypeMutation();
  const [updateLeaveType, { isLoading: updating }] = useUpdateLeaveTypeMutation();
  const isLoading = creating || updating;

  const set = (field: string, value: any) => setFormData((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Leave type name is required'); return; }
    if (!formData.code.trim()) { toast.error('Leave type code is required'); return; }
    if (Number(formData.minDays) < 0.5) { toast.error('Minimum days must be at least 0.5'); return; }

    const payload: any = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase(),
      defaultBalance: Number(formData.defaultDays),
      maxDays: Number(formData.maxDays) || undefined,
      minDays: Number(formData.minDays),
      isPaid: formData.isPaid,
      carryForward: formData.isCarryForward,
      maxCarryForward: Number(formData.maxCarryForward) || undefined,
      isActive: formData.isActive,
      applicableTo: formData.applicableTo,
      noticeDays: Number(formData.noticeDays),
      maxPerMonth: Number(formData.maxPerMonth) || undefined,
      probationMonths: Number(formData.probationMonths),
      allowSameDay: formData.allowSameDay,
      allowWeekendAdjacent: formData.allowWeekendAdjacent,
      requiresApproval: formData.requiresApproval,
      allowPastDates: formData.allowPastDates,
      maxAdvanceDays: Number(formData.maxAdvanceDays) || undefined,
      gender: formData.genderRestriction || undefined,
    };
    try {
      if (isEditing) {
        await updateLeaveType({ id: leaveType.id, data: payload }).unwrap();
        toast.success('Leave type updated successfully');
      } else {
        await createLeaveType(payload).unwrap();
        toast.success('Leave type created successfully');
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || `Failed to ${isEditing ? 'update' : 'create'} leave type`);
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
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl flex flex-col"
        style={{ maxHeight: 'min(92dvh, calc(100dvh - 1rem))' }}
      >
        {/* Sticky Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-display font-semibold text-gray-800">
              {isEditing ? 'Edit Leave Type' : 'Create Leave Type'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure all leave settings in one place</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Form — flex column so the scrollable body + sticky footer work */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── BASIC INFO ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Basic Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Name *<Tip text="The display name employees see when applying (e.g. 'Casual Leave', 'Sick Leave')." />
                </label>
                <input type="text" value={formData.name} onChange={(e) => set('name', e.target.value)}
                  className="input-glass w-full" placeholder="e.g. Casual Leave" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Code *
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(short, e.g. CL)</span>
                  <Tip text="Short unique identifier used in reports and payslips (e.g. CL, SL, EL). Max 10 characters, auto-uppercased." />
                </label>
                <input type="text" value={formData.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  className="input-glass w-full font-mono" placeholder="CL" required maxLength={10} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Default Balance
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(days/year)</span>
                  <Tip text="Number of leave days credited to each eligible employee at the start of the year (or on joining)." />
                </label>
                <input type="number" value={formData.defaultDays} onChange={(e) => set('defaultDays', e.target.value)}
                  className="input-glass w-full" min={0} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Min Days
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(per request)</span>
                  <Tip text="Minimum leave duration per request. Use 0.5 to allow half-day applications." />
                </label>
                <input type="number" value={formData.minDays} onChange={(e) => set('minDays', e.target.value)}
                  className="input-glass w-full" min={0.5} step={0.5} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Max Days
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(0 = unlimited)</span>
                  <Tip text="Maximum leave duration per single request. Leave 0 for no upper limit." />
                </label>
                <input type="number" value={formData.maxDays} onChange={(e) => set('maxDays', e.target.value)}
                  className="input-glass w-full" min={0} />
              </div>
            </div>
          </section>

          {/* ── TOGGLES ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Leave Behaviour</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { field: 'isPaid',              label: 'Paid Leave',          hint: 'Counts toward salary (uncheck = LWP/unpaid)' },
                { field: 'isCarryForward',       label: 'Carry Forward',       hint: 'Unused balance rolls over to next year' },
                { field: 'allowSameDay',         label: 'Same-Day Apply',      hint: 'Employee can apply on the day leave starts (e.g. Sick)' },
                { field: 'allowWeekendAdjacent', label: 'Weekend Adjacent',    hint: 'Allow leave adjacent to non-working days (uncheck = sandwich rule)' },
                { field: 'requiresApproval',     label: 'Requires Approval',   hint: 'Manager/HR must approve before leave is granted' },
                { field: 'allowPastDates',       label: 'Allow Past Dates',    hint: 'Allow filing leave retroactively (e.g. sick leave filed next day)' },
                { field: 'isActive',             label: 'Active',              hint: 'Inactive types are hidden from all employees' },
              ] as { field: string; label: string; hint: string }[]).map(({ field, label, hint }) => (
                <div key={field} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700">{label}</p>
                    <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{hint}</p>
                  </div>
                  <Toggle checked={!!(formData as any)[field]} onChange={(v) => set(field, v)} />
                </div>
              ))}
            </div>
            {/* Max Carry Forward — shown when carry forward is on */}
            {formData.isCarryForward && (
              <div className="mt-2 max-w-xs">
                <label className="block text-xs font-medium text-gray-600 mb-1">Max Carry Forward Days
                  <span className="ml-1 text-[10px] text-gray-400 font-normal">(0 = unlimited)</span>
                </label>
                <input type="number" value={formData.maxCarryForward} onChange={(e) => set('maxCarryForward', e.target.value)}
                  className="input-glass w-full" min={0} />
              </div>
            )}
          </section>

          {/* ── LIMITS ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Application Limits</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Notice Days
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(0 = same-day OK)</span>
                  <Tip text="How many calendar days in advance the employee must apply. 0 means they can apply on the same day the leave starts." />
                </label>
                <input type="number" value={formData.noticeDays} onChange={(e) => set('noticeDays', e.target.value)}
                  className="input-glass w-full" min={0} placeholder="0" />
                <p className="text-[10px] text-gray-400 mt-1">
                  {Number(formData.noticeDays) === 0 ? 'Can apply same-day' : `Must apply ${formData.noticeDays}d ahead`}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Max / Month
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(0 = unlimited)</span>
                  <Tip text="Caps how many days of this leave type an employee can take within a single calendar month." />
                </label>
                <input type="number" value={formData.maxPerMonth} onChange={(e) => set('maxPerMonth', e.target.value)}
                  className="input-glass w-full" min={0} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Max Advance
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(days, 0 = unlimited)</span>
                  <Tip text="Furthest future date an employee can book. E.g. 90 means leave can only be planned up to 90 days from today." />
                </label>
                <input type="number" value={formData.maxAdvanceDays} onChange={(e) => set('maxAdvanceDays', e.target.value)}
                  className="input-glass w-full" min={0} placeholder="0 = no limit" />
                <p className="text-[10px] text-gray-400 mt-1">How far ahead employees can book</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Probation Months
                  <Tip text="Employees must complete this many months of service before they can use this leave type. Set to 0 to allow from day 1." />
                </label>
                <input type="number" value={formData.probationMonths} onChange={(e) => set('probationMonths', e.target.value)}
                  className="input-glass w-full" min={0} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Gender Restriction
                  <Tip text="Restrict this leave to a specific gender — useful for maternity/paternity leave. Leave blank to allow all genders." />
                </label>
                <select value={formData.genderRestriction} onChange={(e) => set('genderRestriction', e.target.value)}
                  className="input-glass w-full">
                  <option value="">No restriction</option>
                  <option value="MALE">Male only</option>
                  <option value="FEMALE">Female only</option>
                </select>
              </div>
            </div>
          </section>

          {/* ── WHO CAN APPLY ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Who Can Apply</h3>
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 mb-3 flex items-start gap-2">
              <Info size={13} className="text-blue-500 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-blue-700 leading-relaxed">
                Leave visibility is controlled by the employee's current employment status.
                Employees in <strong>Onboarding</strong> status cannot see or apply for any leave.
              </p>
            </div>

            <label className="block text-sm font-medium text-gray-600 mb-1">By Status
              <span className="ml-1 text-[11px] text-gray-400 font-normal">(employment status)</span>
              <Tip text="Filter by the employee's current employment status. Employees in Onboarding status never see any leaves regardless of this setting." />
            </label>
            <select value={formData.applicableTo} onChange={(e) => set('applicableTo', e.target.value)}
              className="input-glass w-full">
              <optgroup label="General">
                <option value="ALL">All Employees (except Onboarding)</option>
              </optgroup>
              <optgroup label="Active States">
                <option value="ONBOARDING">Onboarding Only</option>
                <option value="PROBATION">Probation Only</option>
                <option value="INTERN">Intern Only</option>
                <option value="ACTIVE">Active / Full-time Only</option>
              </optgroup>
              <optgroup label="Current States">
                <option value="NOTICE_PERIOD">Notice Period Only</option>
                <option value="SUSPENDED">Suspended Only</option>
              </optgroup>
              <optgroup label="Terminal States">
                <option value="INACTIVE">Inactive Only</option>
                <option value="TERMINATED">Terminated Only</option>
                <option value="ABSCONDED">Absconded Only</option>
              </optgroup>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">
              {formData.applicableTo === 'ALL' && 'Visible to all employees except those in Onboarding'}
              {formData.applicableTo === 'ONBOARDING' && 'Only employees currently in Onboarding status can see this leave'}
              {formData.applicableTo === 'PROBATION' && 'Only employees with Probation status can apply'}
              {formData.applicableTo === 'INTERN' && 'Only Intern-status employees can apply'}
              {formData.applicableTo === 'ACTIVE' && 'Only Active / Full-time employees can apply'}
              {formData.applicableTo === 'NOTICE_PERIOD' && 'Only employees serving Notice Period can apply'}
              {formData.applicableTo === 'SUSPENDED' && 'Only Suspended employees can apply'}
              {formData.applicableTo === 'INACTIVE' && 'Only Inactive employees can apply'}
              {formData.applicableTo === 'TERMINATED' && 'Only Terminated employees can apply'}
              {formData.applicableTo === 'ABSCONDED' && 'Only Absconded employees can apply'}
            </p>
          </section>

        </div>{/* end scrollable body */}

        {/* Sticky Action Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0 bg-white rounded-b-2xl">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={isLoading}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Leave Type'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* =============================================================================
   PERSONAL VIEW (existing)
   ============================================================================= */

function LeavePersonalView() {
  const { t } = useTranslation();
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [leavePage, setLeavePage] = useState(1);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>('');
  const { data: balancesRes, isLoading: balancesLoading } = useGetLeaveBalancesQuery();
  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: leavesRes, isLoading: leavesLoading } = useGetMyLeavesQuery({
    page: leavePage, limit: 10, ...(leaveStatusFilter ? { status: leaveStatusFilter } : {}),
  });
  const { data: holidaysRes } = useGetHolidaysQuery({});
  const { data: policiesRes } = useGetPoliciesQuery({ category: 'LEAVE' });
  const [acknowledgePolicy, { isLoading: acknowledging }] = useAcknowledgePolicyMutation();
  const [accepted, setAccepted] = useState(false);
  const user = useAppSelector((s) => s.auth.user);

  const balances = balancesRes?.data || [];
  const leaveTypes = typesRes?.data || [];
  const leaves = leavesRes?.data || [];
  const holidays = holidaysRes?.data || [];

  // Check if employee has accepted the leave policy
  const leavePolicy = (policiesRes?.data || []).find((p: any) => p.category === 'LEAVE' && p.isActive);
  const hasAcknowledged = leavePolicy?.acknowledgments?.length > 0; // backend filters to current employee only

  // Show policy acceptance gate if not acknowledged
  if (leavePolicy && !hasAcknowledged) {
    return (
      <div className="page-container">
        <div className="max-w-3xl mx-auto">
          <div className="layer-card overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-brand-600 to-purple-600 text-white px-6 py-5">
              <div className="flex items-center gap-3 mb-2">
                <FileText size={24} />
                <h1 className="text-xl font-display font-bold">Leave & Attendance Policy</h1>
              </div>
              <p className="text-sm text-white/80">Version {leavePolicy.version || 3} — Effective: Immediate</p>
              <p className="text-xs text-white/60 mt-1">Document Ref: AT/HR/LAP/2026-03/002</p>
            </div>

            {/* Policy Content */}
            <div className="px-6 py-5 max-h-[50vh] overflow-y-auto overflow-x-hidden bg-gray-50 border-b border-gray-200">
              <div className="text-sm text-gray-700 whitespace-pre-wrap break-words font-sans leading-relaxed">{leavePolicy.content}</div>
            </div>

            {/* Acceptance Section */}
            <div className="px-6 py-5 bg-white">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-2">Employee Acknowledgement & Declaration</h3>
                <ul className="text-xs text-amber-700 space-y-1.5">
                  <li>• I have read and fully understood this Leave, Attendance & Professional Integrity Policy</li>
                  <li>• I understand the monthly cap of 2 paid leaves and the 1st-10th mandatory attendance rule</li>
                  <li>• I understand that pattern-based violations will result in leave deductions (EL → SL → CL → PL → LWP)</li>
                  <li>• I agree to comply with all leave application procedures and professional conduct expectations</li>
                  <li>• I acknowledge that violations may lead to disciplinary action including salary deductions and termination</li>
                </ul>
              </div>

              <div className="flex items-start gap-3 mb-4">
                <button type="button" role="checkbox" aria-checked={accepted} onClick={() => setAccepted(prev => !prev)}
                  className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${accepted ? 'bg-brand-600 border-brand-600' : 'bg-white border-gray-300'}`}>
                  {accepted && <CheckCircle size={16} className="text-white" />}
                </button>
                <span className="text-sm text-gray-700 font-medium cursor-pointer select-none" onClick={() => setAccepted(prev => !prev)}>
                  I confirm that I have read, understood, and agree to comply with all provisions of this policy.
                  I understand this supersedes all previous arrangements.
                </span>
              </div>

              <button
                onClick={async () => {
                  if (!accepted) return toast.error('Please check the checkbox to accept the policy');
                  try {
                    await acknowledgePolicy(leavePolicy.id).unwrap();
                    toast.success('Leave policy accepted. You can now apply for leaves.');
                  } catch (err: any) {
                    toast.error(err?.data?.error?.message || 'Failed to submit acceptance');
                  }
                }}
                disabled={!accepted || acknowledging}
                className="w-full btn-primary flex items-center justify-center gap-2 py-3"
              >
                {acknowledging ? <Clock size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                Accept Policy & Continue to Leave Management
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Policy reminder banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2 text-xs text-blue-700">
        <AlertCircle size={14} />
        <span><strong>Policy:</strong> Max 2 paid leaves/month · 1st-10th mandatory attendance · CL needs 2-day notice · PL needs 7-day notice</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">{t('leaves.title')}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{t('leaves.subtitle')}</p>
        </div>
        {/* Only employee accounts can apply leave; system accounts (HR/Admin/SA) cannot */}
        {!['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '') ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowApplyModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            {t('leaves.applyLeave')}
          </motion.button>
        ) : (
          <div className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2 max-w-xs text-right">
            System accounts cannot apply leave
          </div>
        )}
      </div>

      {/* Leave balance cards */}
      {balancesLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="layer-card p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
              <div className="h-6 bg-gray-200 rounded w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 mb-8">
          {balances.map((bal: any, index: number) => (
            <motion.div
              key={bal.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="layer-card p-4 text-center"
            >
              <span className="text-2xl">{LEAVE_ICONS[bal.leaveType.code] || '📅'}</span>
              <p className="text-sm font-medium text-gray-700 mt-2">{bal.leaveType.name}</p>
              <div className="mt-3">
                <p className="text-2xl font-bold font-mono text-brand-600" data-mono>
                  {bal.remaining}
                </p>
                <p className="text-xs text-gray-500">
                  of {Number(bal.allocated)} available
                </p>
              </div>
              {Number(bal.used) > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Used: <span className="font-mono" data-mono>{Number(bal.used)}</span>
                </p>
              )}
              {/* Progress bar */}
              <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-brand-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min((Number(bal.used) / Number(bal.allocated)) * 100, 100)}%` }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* My leave requests */}
        <div className="lg:col-span-2 layer-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
              <CalendarDays size={18} className="text-brand-500" />
              My Leave Requests
            </h2>
            <select
              value={leaveStatusFilter}
              onChange={(e) => { setLeaveStatusFilter(e.target.value); setLeavePage(1); }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-300 bg-white"
            >
              <option value="">{t('common.all')} {t('common.status')}</option>
              <option value="PENDING">{t('leaves.pending')}</option>
              <option value="DRAFT">Draft</option>
              <option value="MANAGER_APPROVED">Manager Approved</option>
              <option value="APPROVED">{t('leaves.approved')}</option>
              <option value="REJECTED">{t('leaves.rejected')}</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          {leavesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
            </div>
          ) : leaves.length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">
                {leaveStatusFilter ? `No ${leaveStatusFilter.toLowerCase().replace(/_/g, ' ')} leave requests` : 'No leave requests yet'}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {leaves.map((leave: any) => (
                  <LeaveRequestCard key={leave.id} leave={leave} />
                ))}
              </div>
              {/* Pagination */}
              {(leavesRes?.meta?.totalPages ?? 0) > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    {leavesRes?.meta?.total || 0} total
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setLeavePage((p) => Math.max(1, p - 1))}
                      disabled={!leavesRes?.meta?.hasPrev}
                      className="px-2.5 py-1 text-xs rounded-lg bg-surface-2 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('common.previousPage')}
                    </button>
                    <span className="text-xs text-gray-500 font-mono" data-mono>{leavePage}/{leavesRes?.meta?.totalPages || 1}</span>
                    <button
                      onClick={() => setLeavePage((p) => p + 1)}
                      disabled={!leavesRes?.meta?.hasNext}
                      className="px-2.5 py-1 text-xs rounded-lg bg-surface-2 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t('common.nextPage')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Holidays */}
        <div className="layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">
            🎉 Holidays {new Date().getFullYear()}
          </h2>
          <div className="space-y-2">
            {holidays.map((holiday: any) => {
              const isPast = new Date(holiday.date) < new Date();
              return (
                <div
                  key={holiday.id}
                  className={cn(
                    'flex items-center justify-between py-2.5 px-3 rounded-lg',
                    isPast ? 'bg-gray-50 opacity-60' : 'bg-blue-50'
                  )}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-700">{holiday.name}</p>
                    <p className="text-xs text-gray-500">{formatDate(holiday.date, 'long')}</p>
                  </div>
                  {holiday.isOptional && (
                    <span className="badge badge-info text-xs">Optional</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Apply Leave Wizard */}
      {showApplyModal && (
        <LeaveApplyWizard
          leaveTypes={leaveTypes}
          balances={balances}
          onClose={() => setShowApplyModal(false)}
        />
      )}
    </div>
  );
}

function LeaveRequestCard({ leave }: { leave: any }) {
  const { t } = useTranslation();
  const [cancelLeave] = useCancelLeaveMutation();

  const handleCancel = async () => {
    if (!window.confirm(t('common.areYouSure'))) return;
    try {
      await cancelLeave(leave.id).unwrap();
      toast.success('Leave cancelled');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || t('common.failed'));
    }
  };

  const statusIcon: Record<string, React.ReactNode> = {
    DRAFT: <Clock size={16} className="text-gray-400" />,
    PENDING: <Clock size={16} className="text-amber-500" />,
    MANAGER_APPROVED: <CheckCircle size={16} className="text-blue-500" />,
    APPROVED: <CheckCircle size={16} className="text-emerald-500" />,
    APPROVED_WITH_CONDITION: <CheckCircle size={16} className="text-amber-500" />,
    REJECTED: <XCircle size={16} className="text-red-500" />,
    CANCELLED: <AlertCircle size={16} className="text-gray-400" />,
  };
  const currentStatusIcon = statusIcon[leave.status] || null;

  return (
    <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
      <div className="flex items-center gap-3">
        {currentStatusIcon}
        <div>
          <p className="text-sm font-medium text-gray-800">
            {leave.leaveType?.name || 'Leave'}
            <span className="text-gray-400 ml-2">
              {Number(leave.days)} {Number(leave.days) === 1 ? 'day' : 'days'}
            </span>
          </p>
          <p className="text-xs text-gray-500">
            {formatDate(leave.startDate)} — {formatDate(leave.endDate)}
          </p>
          {leave.reason && (
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{leave.reason}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`badge ${getStatusColor(leave.status)} text-xs`}>
          {leave.status === 'MANAGER_APPROVED' ? 'Manager Approved'
            : leave.status === 'APPROVED_WITH_CONDITION' ? 'Approved (Conditional)'
            : leave.status}
        </span>
        {(leave.status === 'PENDING' || leave.status === 'DRAFT') && (
          <button
            onClick={handleCancel}
            className="text-xs text-red-400 hover:text-red-600 transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
