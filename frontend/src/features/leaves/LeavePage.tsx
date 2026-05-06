import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, X, Clock, CheckCircle, XCircle, AlertCircle, AlertTriangle,
  Search, FileText, ThumbsUp, ThumbsDown, Pencil, Trash2, Loader2,
  Users, ChevronRight, TrendingUp, Info, SlidersHorizontal,
} from 'lucide-react';
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
  useGetLeavePoliciesQuery,
  useUpdateLeavePolicyMutation,
  useRecalculatePolicyAllocationsMutation,
  useCreateEmployeeAdjustmentMutation,
  usePostConditionMessageMutation,
} from './leaveApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import { useGetPoliciesQuery, useAcknowledgePolicyMutation } from '../policies/policyApi';
import LeaveApplyWizard from './components/LeaveApplyWizard';
import ManagerReviewPanel from './components/ManagerReviewPanel';
import HRReviewPanel from './components/HRReviewPanel';
import toast from 'react-hot-toast';
import { useEmpPerms } from '../../hooks/useEmpPerms';
import PermDenied from '../../components/PermDenied';

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
      <div className="px-4 sm:px-6 pt-6 pb-2 flex flex-wrap gap-2">
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
  const [searchParams] = useSearchParams();
  const initialTab = (['approvals', 'types', 'holidays', 'employee-leaves', 'policy'] as const)
    .find(k => k === searchParams.get('tab')) ?? 'approvals';
  const [activeTab, setActiveTab] = useState<'approvals' | 'types' | 'holidays' | 'employee-leaves' | 'policy'>(initialTab);
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<'pending' | 'approved' | 'conditional' | 'rejected' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showLeaveTypeModal, setShowLeaveTypeModal] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<any>(null);
  const [reviewLeaveId, setReviewLeaveId] = useState<string | null>(null);
  const [liveNewCount, setLiveNewCount] = useState(0);
  const [showLegacyTypes, setShowLegacyTypes] = useState(false);

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
  const { data: approvalsRes, isLoading: approvalsLoading, isError: approvalsError, error: approvalsErrorData } = useGetPendingApprovalsQuery(
    { page, limit: 20 },
    { skip: approvalStatusFilter !== 'pending' }
  );

  // All leaves with status filter — used for approved/rejected/conditional/all tabs
  // "rejected" pill shows both REJECTED and CANCELLED; backend accepts comma-separated values
  const allLeavesStatus = approvalStatusFilter === 'approved' ? 'APPROVED'
    : approvalStatusFilter === 'conditional' ? 'APPROVED_WITH_CONDITION'
    : approvalStatusFilter === 'rejected' ? 'REJECTED,CANCELLED'
    : undefined;
  const { data: allLeavesRes, isLoading: allLeavesLoading, isError: allLeavesIsError, error: allLeavesErrorData } = useGetAllLeavesQuery(
    { page, limit: 20, status: allLeavesStatus },
    { skip: approvalStatusFilter === 'pending' }
  );

  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: holidaysRes } = useGetHolidaysQuery({});
  const { data: policiesRes } = useGetLeavePoliciesQuery(undefined, { skip: activeTab !== 'types' });
  const [handleAction] = useHandleLeaveActionMutation();
  const [deleteLeaveType] = useDeleteLeaveTypeMutation();

  // Combine data based on active filter tab
  const activeRes = approvalStatusFilter === 'pending' ? approvalsRes : allLeavesRes;
  const isLoadingApprovals = approvalStatusFilter === 'pending' ? approvalsLoading : allLeavesLoading;
  const isApprovalsError = approvalStatusFilter === 'pending' ? approvalsError : allLeavesIsError;
  const approvalsErrorMsg = approvalStatusFilter === 'pending' ? approvalsErrorData : allLeavesErrorData;
  const approvals = activeRes?.data || [];
  const leaveTypes = typesRes?.data || [];
  // Map leaveTypeId → policy rules (from the default/first policy)
  const policyRulesByType: Record<string, any[]> = (policiesRes?.data?.[0]?.rules ?? []).reduce((acc: any, r: any) => {
    if (!acc[r.leaveTypeId]) acc[r.leaveTypeId] = [];
    acc[r.leaveTypeId].push(r);
    return acc;
  }, {});
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
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
      <div role="tablist" className="flex gap-1 bg-surface-2 rounded-xl p-1 mb-6 w-full sm:w-fit overflow-x-auto">
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
        <button
          role="tab" aria-selected={activeTab === 'policy'}
          onClick={() => setActiveTab('policy')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5',
            activeTab === 'policy'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          <FileText size={14} />
          Policy Settings
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
              { key: 'conditional', label: 'Conditional', color: 'orange' },
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
                      : f.color === 'orange' ? 'bg-orange-100 text-orange-800 ring-1 ring-orange-300'
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
            <div className="relative sm:ml-auto w-full sm:w-auto">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-glass pl-8 pr-3 py-1.5 text-xs w-full sm:w-48"
              />
            </div>
          </div>

          {isApprovalsError && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 mb-4">
              <AlertTriangle size={18} className="text-red-500 shrink-0" />
              <div>
                <p className="font-medium">Failed to load leave requests</p>
                <p className="text-red-500 mt-0.5">{(approvalsErrorMsg as any)?.data?.error?.message || 'Please refresh the page or try again.'}</p>
              </div>
            </div>
          )}

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
                // Managers can only act on PENDING leaves — MANAGER_APPROVED is forwarded to HR (read-only for managers)
                const canAct = (leave.status === 'PENDING' || leave.status === 'MANAGER_APPROVED') &&
                  !(user?.role === 'MANAGER' && leave.status === 'MANAGER_APPROVED');
                // HR/Admin can open the review panel on approved/conditional leaves to revoke or take action
                const canRevoke = isHRAdmin && (leave.status === 'APPROVED' || leave.status === 'APPROVED_WITH_CONDITION');
                // Conditional leaves are clickable for HR to see full detail + employee response
                const isConditional = leave.status === 'APPROVED_WITH_CONDITION';
                // Find condition note for display in card
                const condNotePreview = leave.approvalDecisions?.find((d: any) => d.action === 'APPROVED_WITH_CONDITION' && d.conditionNote)?.conditionNote;

                return (
                  <motion.div
                    key={leave.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={isConditional && isHRAdmin ? () => setReviewLeaveId(leave.id) : undefined}
                    className={`layer-card p-5 ${isConditional && isHRAdmin ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
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
                          {/* Condition note preview for HR — shows employee response status */}
                          {isConditional && condNotePreview && (
                            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                              <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1 mb-0.5">
                                <AlertTriangle size={11} /> Condition
                              </p>
                              <p className="text-[11px] text-amber-800 line-clamp-1">{condNotePreview}</p>
                              {leave.conditionResponse ? (
                                <p className="text-[10px] text-emerald-600 mt-0.5 flex items-center gap-1">
                                  <CheckCircle size={10} /> Employee responded — click to review
                                </p>
                              ) : (
                                <p className="text-[10px] text-amber-500 mt-0.5">Awaiting employee response</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <span className={`badge ${getStatusColor(leave.status)} text-xs`}>
                          {leave.status === 'APPROVED_WITH_CONDITION' ? 'Conditional' : leave.status.replace(/_/g, ' ')}
                        </span>
                        {canRevoke && (
                          <motion.button
                            aria-label={isConditional ? 'View conditional leave details' : 'Revoke approved leave'}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => { e.stopPropagation(); setReviewLeaveId(leave.id); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              isConditional
                                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                : 'bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {isConditional ? <><FileText size={14} /> View</> : <><XCircle size={14} /> Revoke</>}
                          </motion.button>
                        )}
                        {leave.status === 'MANAGER_APPROVED' && user?.role === 'MANAGER' && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full border border-blue-200">
                            Forwarded to HR
                          </span>
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

          {/* Audience-based grouping: primary (policy-managed) vs legacy */}
          {(() => {
            const NEW_AUDIENCES = ['ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE'];
            const AUDIENCE_BADGE: Record<string, { label: string; cls: string }> = {
              ACTIVE_ONLY:  { label: 'Active only',   cls: 'bg-blue-100 text-blue-700' },
              TRAINEE_ONLY: { label: 'Trainees',      cls: 'bg-amber-100 text-amber-700' },
              ALL_ELIGIBLE: { label: 'All eligible',  cls: 'bg-purple-100 text-purple-700' },
            };

            const primaryTypes = leaveTypes.filter((lt: any) => NEW_AUDIENCES.includes(lt.applicableTo));
            const legacyTypes  = leaveTypes.filter((lt: any) => !NEW_AUDIENCES.includes(lt.applicableTo));

            const renderRow = (lt: any, idx: number, isLegacy = false) => {
              const audience = AUDIENCE_BADGE[lt.applicableTo];
              return (
                <motion.div
                  key={lt.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`layer-card px-4 py-3 flex items-center gap-3 ${isLegacy ? 'opacity-75 border-dashed' : ''}`}
                >
                  <span className="text-xl flex-shrink-0">{LEAVE_ICONS[lt.code] || '📅'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{lt.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{lt.code}</p>
                    {isLegacy && (
                      <p className="text-[10px] text-amber-600 mt-0.5">Legacy — not producing current allocations</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                    {audience && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${audience.cls}`}>{audience.label}</span>
                    )}
                    {lt.isPaid ? <span className="badge badge-success text-xs">Paid</span> : <span className="badge badge-neutral text-xs">Unpaid</span>}
                    {!lt.isActive && <span className="badge badge-neutral text-xs">Inactive</span>}
                    {lt.carryForward && <span className="badge badge-info text-xs">Carry Forward</span>}
                    {lt.requiresApproval !== false && <span className="badge badge-warning text-xs">Approval</span>}
                  </div>
                  <div className="flex items-center gap-1 ml-1 flex-shrink-0">
                    {isLegacy ? (
                      <button
                        onClick={() => handleEditLeaveType(lt)}
                        className="px-2 py-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors font-medium whitespace-nowrap"
                        title="Convert to policy-managed: update Audience to Active Only, Trainees, or All Eligible"
                      >
                        Restore →
                      </button>
                    ) : (
                      <button
                        onClick={() => setActiveTab('policy')}
                        className="px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 rounded-lg transition-colors font-medium whitespace-nowrap"
                        title="Configure allocation & behaviour in Policy Settings"
                      >
                        Configure →
                      </button>
                    )}
                    <button
                      onClick={() => handleEditLeaveType(lt)}
                      className="p-1.5 hover:bg-surface-2 rounded-lg transition-colors text-gray-400 hover:text-brand-600"
                      title="Edit audience / rename"
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
                </motion.div>
              );
            };

            return (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <p className="text-sm text-gray-500">{primaryTypes.length} policy-managed leave type{primaryTypes.length !== 1 ? 's' : ''}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-indigo-500 bg-indigo-50 px-2 py-1 rounded-lg flex items-center gap-1">
                        <Info size={11} /> Allocation rules managed in Policy Settings
                      </span>
                      <button onClick={() => setActiveTab('policy')} className="text-xs text-brand-600 hover:underline">
                        → Go to Policy Settings
                      </button>
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleCreateLeaveType}
                    className="btn-primary flex items-center gap-2 text-sm self-start sm:self-auto"
                  >
                    <Plus size={16} />
                    {t('leaves.createLeaveType')}
                  </motion.button>
                </div>

                {/* Policy-managed types */}
                {primaryTypes.length === 0 ? (
                  <div className="layer-card p-6 text-sm border border-dashed border-gray-200">
                    {legacyTypes.length > 0 ? (
                      <div className="flex items-start gap-3">
                        <span className="text-amber-500 mt-0.5">⚠️</span>
                        <div>
                          <p className="font-medium text-gray-700 mb-1">No policy-managed leave types yet</p>
                          <p className="text-gray-500 text-xs leading-relaxed">
                            {legacyTypes.length} legacy leave type{legacyTypes.length !== 1 ? 's' : ''} exist{legacyTypes.length === 1 ? 's' : ''} below but {legacyTypes.length === 1 ? 'is' : 'are'} not producing current employee allocations.{' '}
                            <button
                              onClick={() => setShowLegacyTypes(true)}
                              className="text-amber-600 hover:underline font-semibold"
                            >
                              Expand Legacy Types
                            </button>{' '}
                            and click <strong>Restore</strong> on each type to convert it to a policy-managed type, or create a new leave type above.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-center text-gray-400">No policy-managed leave types yet. Create a type and set its Audience to get started.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {primaryTypes.map((lt: any, idx: number) => renderRow(lt, idx, false))}
                  </div>
                )}

                {/* Legacy types — collapsible */}
                {legacyTypes.length > 0 && (
                  <div className="mt-4">
                    <button
                      onClick={() => setShowLegacyTypes((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 transition-colors mb-2 font-medium"
                    >
                      <ChevronRight size={13} className={cn('transition-transform', showLegacyTypes && 'rotate-90')} />
                      Legacy Types ({legacyTypes.length}) — click Restore to convert to policy-managed
                    </button>
                    <AnimatePresence>
                      {showLegacyTypes && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-2"
                        >
                          {legacyTypes.map((lt: any, idx: number) => renderRow(lt, idx, true))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </>
            );
          })()}
        </motion.div>
      )}

      {/* Holidays & Events Tab */}
      {activeTab === 'holidays' && <HolidayManagementTab />}

      {/* Employee Leaves Tab */}
      {activeTab === 'employee-leaves' && <EmployeeOverviewTab />}

      {/* Policy Settings Tab */}
      {activeTab === 'policy' && <PolicySettingsTab />}

      {/* Create/Edit Leave Type Modal */}
      <AnimatePresence>
        {showLeaveTypeModal && (
          <LeaveTypeModal
            leaveType={editingLeaveType}
            onClose={() => { setShowLeaveTypeModal(false); setEditingLeaveType(null); }}
            onLegacyConflict={() => {
              setShowLeaveTypeModal(false);
              setEditingLeaveType(null);
              setShowLegacyTypes(true);
            }}
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
    halfDaySession: '', description: '', notifyEmployees: true,
  });

  const holidays = holidaysRes?.data || [];
  const suggestions = suggestionsRes?.data || [];

  const resetForm = () => {
    setForm({ name: '', date: '', type: 'PUBLIC', isOptional: false, isHalfDay: false,
      halfDaySession: '', description: '', notifyEmployees: true });
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!form.name || !form.date) return;
    try {
      const payload = {
        ...form,
        halfDaySession: form.isHalfDay && form.halfDaySession ? form.halfDaySession : undefined,
      };
      await createHoliday(payload).unwrap();
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
                      {h.isHalfDay ? `Half Day (${h.halfDaySession === 'FIRST_HALF' ? '1st' : '2nd'} half)` : 'Full Day'}
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
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-center">Allocated</th>
                <th className="px-4 py-3 font-medium text-center">Used</th>
                <th className="px-4 py-3 font-medium text-center">Unpaid</th>
                <th className="px-4 py-3 font-medium text-center">Pending</th>
                <th className="px-4 py-3 font-medium text-center">Remaining</th>
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
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                          {/* Adjustment indicator badges */}
                          {emp.hasPreviousUsed && (
                            <span
                              title={`Previous used leaves: ${emp.totalPreviousUsed} day${emp.totalPreviousUsed !== 1 ? 's' : ''}`}
                              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 cursor-help"
                            >
                              Prev {emp.totalPreviousUsed}d
                            </span>
                          )}
                          {emp.hasManualAdjustments && (
                            <span
                              title={`Manual balance correction: ${emp.totalManualAdjustment > 0 ? '+' : ''}${emp.totalManualAdjustment} days`}
                              className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full cursor-help',
                                emp.totalManualAdjustment > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
                              )}
                            >
                              Adj {emp.totalManualAdjustment > 0 ? '+' : ''}{emp.totalManualAdjustment}d
                            </span>
                          )}
                        </div>
                        <p className="text-gray-400 font-mono text-[11px]" data-mono>{emp.employeeCode}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{emp.department}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const s = emp.status || (emp.userRole === 'INTERN' ? 'INTERN' : 'ACTIVE');
                      const map: Record<string, string> = {
                        ACTIVE: 'bg-emerald-100 text-emerald-700',
                        PROBATION: 'bg-amber-100 text-amber-700',
                        INTERN: 'bg-blue-100 text-blue-700',
                        NOTICE_PERIOD: 'bg-red-100 text-red-600',
                      };
                      return (
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', map[s] || 'bg-gray-100 text-gray-500')}>
                          {s === 'NOTICE_PERIOD' ? 'Notice' : s === 'ACTIVE' ? 'Active' : s === 'PROBATION' ? 'Probation' : s === 'INTERN' ? 'Intern' : s}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-gray-700" data-mono>
                    {emp.totalEffectiveAllocated ?? emp.totalAllocated}
                    {emp.hasManualAdjustments && (
                      <p className="text-[9px] text-gray-400 font-normal">({emp.totalPolicyAllocated} policy)</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-amber-600" data-mono>{emp.totalUsed}</td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-orange-500" data-mono>
                    {emp.totalUnpaidDays > 0 ? emp.totalUnpaidDays : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center font-mono font-medium text-blue-600" data-mono>{emp.totalPending}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-mono font-bold ${emp.totalRemaining < 2 ? 'text-red-600' : emp.totalRemaining < 5 ? 'text-amber-600' : 'text-emerald-600'}`} data-mono>
                      {emp.totalRemaining}
                    </span>
                  </td>
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
  const [activeSection, setActiveSection] = useState<'requests' | 'adjustments'>('requests');
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjForm, setAdjForm] = useState({
    leaveTypeId: '',
    days: '' as string | number,
    reason: '',
    mode: 'deduct' as 'add' | 'deduct',
  });

  const { data, isLoading, isFetching } = useGetEmployeeLeaveOverviewQuery(
    { employeeId, year: modalYear },
    { refetchOnMountOrArgChange: true }
  );
  const [createAdjustment, { isLoading: isCreating }] = useCreateEmployeeAdjustmentMutation();

  const overview = data?.data;
  const requests: any[] = overview?.requests || [];
  const adjustments: any[] = overview?.adjustments || [];

  const filteredRequests = statusFilter === 'ALL'
    ? requests
    : statusFilter === 'PENDING'
    ? requests.filter((r: any) => ['PENDING', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'].includes(r.status))
    : requests.filter((r: any) => r.status === statusFilter);

  const conditionalCount = overview?.summary?.leavesConditional ?? 0;
  const filterTabs = [
    { key: 'ALL', label: 'All', count: requests.length },
    { key: 'PENDING', label: conditionalCount > 0 ? `Pending / Conditional` : 'Pending', count: overview?.summary?.leavesPending ?? 0 },
    { key: 'APPROVED', label: 'Approved', count: overview?.summary?.leavesApproved ?? 0 },
    { key: 'REJECTED', label: 'Rejected', count: overview?.summary?.leavesRejected ?? 0 },
    { key: 'CANCELLED', label: 'Cancelled', count: overview?.summary?.leavesCancelled ?? 0 },
  ];

  const handleSubmitAdj = async () => {
    const rawDays = Number(adjForm.days);
    if (!adjForm.leaveTypeId) return toast.error('Select a leave type');
    if (!rawDays || rawDays <= 0) return toast.error('Enter a positive number of days');
    if (!adjForm.reason.trim() || adjForm.reason.trim().length < 3) return toast.error('Reason required (min 3 chars)');

    const days = adjForm.mode === 'deduct' ? -rawDays : rawDays;

    // Guard: deduction cannot push remaining below zero
    if (adjForm.mode === 'deduct') {
      const selectedBal = overview?.balances?.find((b: any) => b.leaveTypeId === adjForm.leaveTypeId);
      if (selectedBal) {
        const effectiveAlloc = (selectedBal.policyAllocated ?? selectedBal.allocated) + (selectedBal.manualAdjustment ?? 0);
        const cf = Number(selectedBal.carriedForward ?? 0);
        const used = Number(selectedBal.used ?? 0);
        const pending = Number(selectedBal.pending ?? 0);
        const newEffective = Math.max(0, effectiveAlloc + days);
        const remainingAfter = newEffective + cf - used - pending;
        if (remainingAfter < 0) {
          return toast.error(`Deducting ${rawDays}d would make remaining balance negative (${remainingAfter}d). Reduce the amount.`, { duration: 6000 });
        }
      }
    }

    try {
      await createAdjustment({
        employeeId,
        adjustmentType: 'BALANCE_CORRECTION',
        leaveTypeId: adjForm.leaveTypeId,
        year: modalYear,
        days,
        reason: adjForm.reason.trim(),
      }).unwrap();
      toast.success(adjForm.mode === 'deduct'
        ? `${rawDays} day${rawDays !== 1 ? 's' : ''} deducted from quota`
        : `${rawDays} day${rawDays !== 1 ? 's' : ''} added to quota`
      );
      setAdjForm({ leaveTypeId: '', days: '', reason: '', mode: 'deduct' });
      setShowAdjForm(false);
    } catch (e: any) {
      toast.error(e?.data?.error?.message || 'Failed to save adjustment');
    }
  };

  const adjTypeLabel = (type: string) => {
    if (type === 'PREVIOUS_USED') return { label: 'Prev. Used', color: 'bg-orange-100 text-orange-700' };
    if (type === 'MANUAL_ADJUSTMENT') return { label: 'Manual Adj.', color: 'bg-indigo-100 text-indigo-700' };
    if (type === 'INITIAL') return { label: 'Initial', color: 'bg-gray-100 text-gray-600' };
    if (type === 'PRORATA') return { label: 'Pro-rata', color: 'bg-blue-100 text-blue-700' };
    if (type === 'POLICY_CHANGE') return { label: 'Policy', color: 'bg-purple-100 text-purple-700' };
    return { label: type, color: 'bg-gray-100 text-gray-500' };
  };

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
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-gray-900">{employeeName}</h2>
                {overview?.employee?.status && (() => {
                  const s = overview.employee.status || (overview.employee.userRole === 'INTERN' ? 'INTERN' : 'ACTIVE');
                  const map: Record<string, string> = {
                    ACTIVE: 'bg-emerald-100 text-emerald-700',
                    PROBATION: 'bg-amber-100 text-amber-700',
                    INTERN: 'bg-blue-100 text-blue-700',
                    NOTICE_PERIOD: 'bg-red-100 text-red-600',
                  };
                  const label: Record<string, string> = { ACTIVE: 'Active', PROBATION: 'Probation', INTERN: 'Intern', NOTICE_PERIOD: 'Notice Period' };
                  return (
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', map[s] || 'bg-gray-100 text-gray-500')}>
                      {label[s] || s}
                    </span>
                  );
                })()}
              </div>
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

              {/* Leave Type Breakdown — full HR view */}
              {overview.balances.length > 0 && (
                <div className="px-5 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Leave Balance by Type</p>
                  <div className="space-y-2">
                    {overview.balances.map((b: any) => {
                      const policyAlloc = b.policyAllocated ?? b.allocated;
                      const manualAdj = b.manualAdjustment ?? 0;
                      const effectiveAlloc = policyAlloc + manualAdj;
                      const prevUsed = b.previousUsed ?? 0;
                      const approvedUsed = Math.max(0, Number(b.used) - prevUsed);
                      return (
                        <div key={b.leaveTypeId} className="bg-surface-2 rounded-xl p-3">
                          {/* Header row */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{LEAVE_ICONS[b.leaveTypeCode] || '📅'}</span>
                              <div>
                                <p className="text-xs font-semibold text-gray-800">{b.leaveTypeName}</p>
                                <p className="text-[10px] text-gray-400">{b.leaveTypeCode} · {b.isPaid ? 'Paid' : 'Unpaid'}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className={`text-sm font-bold font-mono ${b.remaining < 1 ? 'text-red-600' : b.remaining < 3 ? 'text-amber-600' : 'text-emerald-600'}`} data-mono>
                                {b.remaining}
                              </span>
                              <p className="text-[9px] text-gray-400">remaining</p>
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                            <div
                              className={`h-full rounded-full transition-all ${b.remaining < 1 ? 'bg-red-400' : b.remaining < 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                              style={{ width: `${Math.min(100, (b.remaining / Math.max(effectiveAlloc + b.carriedForward, 1)) * 100)}%` }}
                            />
                          </div>
                          {/* Breakdown grid */}
                          <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
                            <div className="bg-white rounded-lg py-1.5 px-1">
                              <p className="font-bold text-indigo-600 font-mono" data-mono>{policyAlloc}</p>
                              <p className="text-gray-400">Policy</p>
                            </div>
                            <div className={`rounded-lg py-1.5 px-1 ${manualAdj !== 0 ? 'bg-white' : 'bg-gray-50 opacity-50'}`}>
                              <p className={`font-bold font-mono ${manualAdj > 0 ? 'text-emerald-600' : manualAdj < 0 ? 'text-red-500' : 'text-gray-400'}`} data-mono>
                                {manualAdj > 0 ? '+' : ''}{manualAdj}
                              </p>
                              <p className="text-gray-400">Manual Adj</p>
                            </div>
                            <div className={`rounded-lg py-1.5 px-1 ${b.carriedForward > 0 ? 'bg-white' : 'bg-gray-50 opacity-50'}`}>
                              <p className="font-bold text-blue-500 font-mono" data-mono>{b.carriedForward}</p>
                              <p className="text-gray-400">Carried Fwd</p>
                            </div>
                            <div className={`rounded-lg py-1.5 px-1 ${approvedUsed > 0 ? 'bg-white' : 'bg-gray-50 opacity-50'}`}>
                              <p className="font-bold text-amber-600 font-mono" data-mono>{approvedUsed}</p>
                              <p className="text-gray-400">Approved Used</p>
                            </div>
                            <div className={`rounded-lg py-1.5 px-1 ${prevUsed > 0 ? 'bg-white' : 'bg-gray-50 opacity-50'}`}>
                              <p className="font-bold text-orange-500 font-mono" data-mono>{prevUsed}</p>
                              <p className="text-gray-400">Prev Used</p>
                            </div>
                            <div className={`rounded-lg py-1.5 px-1 ${b.pending > 0 ? 'bg-white' : 'bg-gray-50 opacity-50'}`}>
                              <p className="font-bold text-blue-600 font-mono" data-mono>{b.pending}</p>
                              <p className="text-gray-400">Pending</p>
                            </div>
                          </div>
                          {/* Formula */}
                          <p className="text-[9px] text-gray-300 mt-1.5 text-right">
                            ({policyAlloc}{manualAdj !== 0 ? (manualAdj > 0 ? `+${manualAdj}` : `${manualAdj}`) : ''} policy{b.carriedForward > 0 ? ` +${b.carriedForward} CF` : ''}) − {approvedUsed} approved − {prevUsed} prev − {b.pending} pending = <strong className="text-gray-400">{b.remaining}</strong>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section tabs: Requests | Adjustments */}
              <div className="px-5 pt-5">
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
                  {[
                    { key: 'requests', label: `Requests (${requests.length})` },
                    { key: 'adjustments', label: `Adjustments (${adjustments.length})` },
                  ].map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setActiveSection(t.key as any)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                        activeSection === t.key ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Leave Requests section */}
              {activeSection === 'requests' && (
                <div className="px-5 pb-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                      <TrendingUp size={12} /> Leave Requests — {modalYear}
                    </p>
                    <span className="text-xs text-gray-400">
                      {overview.summary.totalApprovedDays} approved days
                      {conditionalCount > 0 && <span className="ml-1 text-amber-500">· {conditionalCount} conditional</span>}
                    </span>
                  </div>
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
                        {ft.count > 0 && <span className="ml-1 font-bold">{ft.count}</span>}
                      </button>
                    ))}
                  </div>
                  {filteredRequests.length === 0 ? (
                    <div className="text-center py-8 text-sm text-gray-400 bg-gray-50 rounded-xl">
                      No {statusFilter === 'ALL' ? '' : statusFilter === 'PENDING' ? 'pending or conditional' : statusFilter.toLowerCase()} leave requests for {modalYear}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredRequests.map((req: any) => (
                        <div key={req.id} className="border border-gray-100 rounded-xl p-3.5 bg-white hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium text-gray-800 truncate max-w-[120px]">{req.leaveType?.name || 'Leave'}</span>
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                  {formatDate(req.startDate)}
                                  {req.startDate !== req.endDate && ` – ${formatDate(req.endDate)}`}
                                </span>
                                <span className="text-xs font-mono font-medium text-gray-600 whitespace-nowrap" data-mono>
                                  {req.days} {req.days === 1 ? 'day' : 'days'}
                                </span>
                                {req.isHalfDay && (
                                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded whitespace-nowrap">Half Day</span>
                                )}
                              </div>
                              {req.reason && (
                                <p className="text-[11px] text-gray-400 mt-1 italic line-clamp-1">"{req.reason}"</p>
                              )}
                              {(req.approverRemarks || req.managerRemarks) && (
                                <p className="text-[11px] text-brand-500 mt-1 line-clamp-2">
                                  Remark: {req.approverRemarks || req.managerRemarks}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0 max-w-[90px]">
                              <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full text-center leading-tight', STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-500')}>
                                {req.status.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                                {new Date(req.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Adjustments section */}
              {activeSection === 'adjustments' && (
                <div className="px-5 pb-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                      <SlidersHorizontal size={12} /> Adjustment History — {modalYear}
                    </p>
                    <button
                      onClick={() => setShowAdjForm((v) => !v)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors"
                    >
                      <Plus size={12} /> Add Adjustment
                    </button>
                  </div>

                  {/* Inline Add Adjustment form */}
                  {showAdjForm && (
                    <div className={cn('border rounded-xl p-4 mb-4 space-y-3', adjForm.mode === 'add' ? 'bg-emerald-50 border-emerald-200' : 'bg-indigo-50 border-indigo-200')}>
                      <div className="flex items-center justify-between">
                        <p className={cn('text-xs font-semibold flex items-center gap-1.5', adjForm.mode === 'add' ? 'text-emerald-700' : 'text-indigo-700')}>
                          <SlidersHorizontal size={13} /> Adjust Leave Quota
                        </p>
                        {/* Add / Deduct toggle */}
                        <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                          <button
                            onClick={() => setAdjForm((f) => ({ ...f, mode: 'add' }))}
                            className={cn('px-3 py-1 font-medium transition-colors', adjForm.mode === 'add' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
                          >+ Add</button>
                          <button
                            onClick={() => setAdjForm((f) => ({ ...f, mode: 'deduct' }))}
                            className={cn('px-3 py-1 font-medium transition-colors', adjForm.mode === 'deduct' ? 'bg-red-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50')}
                          >− Deduct</button>
                        </div>
                      </div>
                      <p className={cn('text-[10px]', adjForm.mode === 'add' ? 'text-emerald-600' : 'text-indigo-500')}>
                        {adjForm.mode === 'add' ? 'Add bonus/correction days to this employee\'s quota.' : 'Deduct days from this employee\'s quota.'} Does not create a leave request.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1 font-medium">Leave Type <span className="text-red-400">*</span></label>
                          <select
                            value={adjForm.leaveTypeId}
                            onChange={(e) => setAdjForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
                            className="input-glass text-xs w-full"
                          >
                            <option value="">— Select Leave Type —</option>
                            {(overview?.balances || []).map((b: any) => (
                              <option key={b.leaveTypeId} value={b.leaveTypeId}>{b.leaveTypeName} ({b.leaveTypeCode})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1 font-medium">
                            Days to {adjForm.mode === 'add' ? 'Add' : 'Deduct'} <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0.5"
                            value={adjForm.days}
                            onChange={(e) => setAdjForm((f) => ({ ...f, days: e.target.value }))}
                            placeholder="e.g. 1"
                            className="input-glass text-xs w-full"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-gray-600 mb-1 font-medium">Reason <span className="text-red-400">*</span></label>
                          <input
                            type="text"
                            value={adjForm.reason}
                            onChange={(e) => setAdjForm((f) => ({ ...f, reason: e.target.value }))}
                            placeholder={adjForm.mode === 'add' ? 'e.g. Bonus leave, opening balance correction' : 'e.g. Absent without approval, correction'}
                            className="input-glass text-xs w-full"
                          />
                        </div>
                      </div>
                      {/* Live preview */}
                      {(() => {
                        const rawDaysNum = Number(adjForm.days);
                        const bal = overview?.balances?.find((b: any) => b.leaveTypeId === adjForm.leaveTypeId);
                        if (!bal || !adjForm.leaveTypeId || !rawDaysNum || rawDaysNum <= 0) return null;
                        const daysNum = adjForm.mode === 'deduct' ? -rawDaysNum : rawDaysNum;
                        const effectiveAlloc = (bal.policyAllocated ?? bal.allocated) + (bal.manualAdjustment ?? 0);
                        const cf = Number(bal.carriedForward ?? 0);
                        const used = Number(bal.used ?? 0);
                        const pending = Number(bal.pending ?? 0);
                        const newEffective = Math.max(0, effectiveAlloc + daysNum);
                        const remainingAfter = newEffective + cf - used - pending;
                        const isNeg = remainingAfter < 0;
                        return (
                          <p className={cn('text-[11px] font-medium px-3 py-2 rounded-lg', isNeg ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>
                            {isNeg ? '⚠ ' : '→ '}Remaining after {adjForm.mode === 'add' ? 'addition' : 'deduction'}: <strong>{remainingAfter}d</strong>
                            {isNeg ? ' — cannot deduct this much' : ''}
                          </p>
                        );
                      })()}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setShowAdjForm(false); setAdjForm({ leaveTypeId: '', days: '', reason: '', mode: 'deduct' }); }}
                          className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSubmitAdj}
                          disabled={isCreating}
                          className={cn('flex items-center gap-1.5 px-4 py-1.5 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors',
                            adjForm.mode === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
                          )}
                        >
                          {isCreating ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          {adjForm.mode === 'add' ? 'Add Days' : 'Deduct Days'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Adjustment history table */}
                  {adjustments.length === 0 ? (
                    <div className="text-center py-8 text-sm text-gray-400 bg-gray-50 rounded-xl">
                      <SlidersHorizontal size={24} className="mx-auto text-gray-200 mb-2" />
                      No adjustments recorded for {modalYear}
                      <p className="text-xs text-gray-300 mt-1">Use "Add Adjustment" to record previous leave usage or balance corrections.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-gray-100">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-gray-50 text-gray-400 text-left">
                            <th className="px-3 py-2 font-medium">Date</th>
                            <th className="px-3 py-2 font-medium">Leave Type</th>
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 font-medium text-center">Days</th>
                            <th className="px-3 py-2 font-medium">Prev → New</th>
                            <th className="px-3 py-2 font-medium">Effective Date</th>
                            <th className="px-3 py-2 font-medium">Reason</th>
                            <th className="px-3 py-2 font-medium">By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {adjustments.map((adj: any) => {
                            const basis = adj.calculationBasis as any;
                            const isUsedAdj = basis?.adjustmentType === 'PREVIOUS_USED';
                            const isBal = basis?.adjustmentType === 'BALANCE_CORRECTION' || basis?.adjustmentType === 'BALANCE_SET';
                            const isPositive = adj.days > 0;
                            const effectiveDateStr = basis?.effectiveDate;
                            const prevVal = adj.previousDays ?? 0;
                            const newVal = isUsedAdj ? prevVal + adj.days : prevVal + adj.days;
                            return (
                              <tr key={adj.id} className="hover:bg-gray-50/60 transition-colors">
                                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                                  {new Date(adj.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                                </td>
                                <td className="px-3 py-2 font-medium text-gray-700">
                                  {adj.leaveType?.name ?? '—'}
                                  <span className="ml-1 text-gray-400 font-normal">({adj.leaveType?.code})</span>
                                </td>
                                <td className="px-3 py-2">
                                  <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap',
                                    isUsedAdj ? 'bg-orange-100 text-orange-700'
                                    : isBal ? 'bg-blue-100 text-blue-700'
                                    : adjTypeLabel(adj.allocationType).color
                                  )}>
                                    {isUsedAdj ? 'Prev. Used' : isBal ? 'Balance Adj' : adjTypeLabel(adj.allocationType).label}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={cn('font-bold font-mono', isPositive ? 'text-emerald-600' : 'text-red-500')} data-mono>
                                    {isPositive ? '+' : ''}{adj.days}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-400 font-mono whitespace-nowrap" data-mono>
                                  {adj.previousDays != null ? `${adj.previousDays} → ${Number(newVal).toFixed(1)}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                                  {effectiveDateStr
                                    ? new Date(effectiveDateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                                    : '—'}
                                </td>
                                <td className="px-3 py-2 text-gray-500 max-w-[120px]">
                                  <span className="line-clamp-1 italic">{adj.reason || '—'}</span>
                                </td>
                                <td className="px-3 py-2 text-gray-500 text-[10px] max-w-[90px]">
                                  <span className="line-clamp-1" title={adj.changedByName || adj.changedBy || 'System'}>
                                    {adj.changedByName || (adj.changedBy ? adj.changedBy.slice(0, 8) + '…' : 'System')}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
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
  applicableTo: 'ACTIVE_ONLY',
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

// Maps any legacy or unrecognized applicableTo value to one of the three valid modern audience options.
// Prevents the dropdown from silently showing a blank/wrong option when editing old leave types.
function normalizeAudience(raw: string | null | undefined): 'ACTIVE_ONLY' | 'TRAINEE_ONLY' | 'ALL_ELIGIBLE' {
  if (raw === 'ACTIVE_ONLY' || raw === 'TRAINEE_ONLY' || raw === 'ALL_ELIGIBLE') return raw;
  if (raw === 'ALL') return 'ALL_ELIGIBLE';
  if (raw === 'ACTIVE' || raw === 'CONFIRMED') return 'ACTIVE_ONLY';
  if (raw === 'PROBATION' || raw === 'INTERN') return 'TRAINEE_ONLY';
  return 'ACTIVE_ONLY'; // safe default for any other legacy value
}

function LeaveTypeModal({ leaveType, onClose, onLegacyConflict }: { leaveType: any | null; onClose: () => void; onLegacyConflict?: () => void }) {
  const { t } = useTranslation();
  const isEditing = !!leaveType;
  const { data: policiesRes } = useGetLeavePoliciesQuery();
  const modalPolicyRulesByType: Record<string, any[]> = (policiesRes?.data?.[0]?.rules ?? []).reduce((acc: any, r: any) => {
    if (!acc[r.leaveTypeId]) acc[r.leaveTypeId] = [];
    acc[r.leaveTypeId].push(r);
    return acc;
  }, {});
  const hasPolicyRules = isEditing && modalPolicyRulesByType[leaveType?.id]?.length > 0;

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
        applicableTo: normalizeAudience(leaveType.applicableTo),
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

    const payload: any = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase(),
      gender: formData.genderRestriction || undefined,
      applicableTo: formData.applicableTo,
      defaultBalance: 0,
      isPaid: formData.isPaid,
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
      const errData = err?.data?.error?.data;
      if (!isEditing && errData?.conflictType === 'LEAVE_TYPE_EXISTS_LEGACY') {
        // Backend found a legacy leave type with the same code/name.
        // Close this modal and expand the Legacy Types section so HR can click Restore.
        toast.error(
          `"${errData.existingLeaveTypeCode}" exists as a legacy leave type. Expand Legacy Types below and click Restore to convert it.`,
          { duration: 8000 },
        );
        onClose();
        onLegacyConflict?.();
      } else {
        toast.error(err?.data?.error?.message || `Failed to ${isEditing ? 'update' : 'create'} leave type`);
      }
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
            <p className="text-xs text-gray-400 mt-0.5">Configure behaviour & allocation in Policy Settings after creation</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Form — flex column so the scrollable body + sticky footer work */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700 leading-relaxed">
              Allocation rules and behaviour settings are managed in the{' '}
              <strong>Policy Settings tab</strong> after creating the leave type.
            </p>
          </div>

          {/* ── IDENTITY ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Identity</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Name *</label>
                <input type="text" value={formData.name} onChange={(e) => set('name', e.target.value)}
                  className="input-glass w-full" placeholder="e.g. Casual Leave" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Code *
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">(e.g. CL)</span>
                </label>
                <input type="text" value={formData.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  className="input-glass w-full font-mono" placeholder="CL" required maxLength={10} />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Audience
                <span className="ml-1 text-[11px] text-gray-400 font-normal">Who this leave type applies to</span>
              </label>
              <select value={formData.applicableTo} onChange={(e) => set('applicableTo', e.target.value)}
                className="input-glass w-full">
                <option value="ACTIVE_ONLY">Active Employees only</option>
                <option value="TRAINEE_ONLY">Trainees only (Probation + Intern)</option>
                <option value="ALL_ELIGIBLE">All Eligible (Active + Probation + Intern)</option>
              </select>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-600 mb-1">Gender Restriction</label>
              <select value={formData.genderRestriction} onChange={(e) => set('genderRestriction', e.target.value)}
                className="input-glass w-full">
                <option value="">No restriction (all genders)</option>
                <option value="MALE">Male only</option>
                <option value="FEMALE">Female only</option>
              </select>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700">Paid Leave</p>
                <p className="text-xs text-gray-400 mt-0.5">Disable for Leave Without Pay (LWP / Unpaid) types</p>
              </div>
              <Toggle checked={formData.isPaid} onChange={(v) => set('isPaid', v)} />
            </div>
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
  const { perms } = useEmpPerms();
  const { t } = useTranslation();
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyInitialTypeId, setApplyInitialTypeId] = useState<string | undefined>(undefined);
  const [leavePage, setLeavePage] = useState(1);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>('');
  const { data: balancesRes, isLoading: balancesLoading } = useGetLeaveBalancesQuery();
  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: leavesRes, isLoading: leavesLoading } = useGetMyLeavesQuery({
    page: leavePage, limit: 10, ...(leaveStatusFilter ? { status: leaveStatusFilter } : {}),
  });
  const { data: holidaysRes } = useGetHolidaysQuery({});
  const { data: leavePoliciesRes } = useGetLeavePoliciesQuery();
  const { data: policiesRes } = useGetPoliciesQuery({ category: 'LEAVE' });
  const [acknowledgePolicy, { isLoading: acknowledging }] = useAcknowledgePolicyMutation();
  const [accepted, setAccepted] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState<any>(null);
  const user = useAppSelector((s) => s.auth.user);
  const dispatch = useAppDispatch();

  const openApplyModal = (typeId?: string) => {
    setApplyInitialTypeId(typeId);
    setShowApplyModal(true);
  };

  // Real-time: listen for leave approval/rejection by HR/Manager
  useEffect(() => {
    const handler = (data: { action?: string; leaveType?: string; remarks?: string }) => {
      const isApproved = data.action === 'APPROVED' || data.action === 'APPROVED_WITH_CONDITION' || data.action === 'MANAGER_APPROVED';
      const leaveTypeName = data.leaveType || 'Your leave';
      if (isApproved) {
        toast.success(`${leaveTypeName} request ${data.action === 'MANAGER_APPROVED' ? 'forwarded to HR' : 'approved'}!`, { duration: 5000 });
      } else if (data.action === 'REJECTED') {
        toast.error(`${leaveTypeName} request was rejected${data.remarks ? ': ' + data.remarks : '.'}`, { duration: 6000 });
      }
      dispatch(api.util.invalidateTags(['Leave' as any]));
    };
    onSocketEvent('leave:actioned', handler);
    return () => offSocketEvent('leave:actioned', handler);
  }, [dispatch]);

  // Real-time: listen for HR leave balance adjustments
  useEffect(() => {
    const handler = (data: { leaveTypeName?: string; allocated?: number; reason?: string }) => {
      const typeName = data.leaveTypeName || 'Leave';
      const days = data.allocated !== undefined ? ` — ${data.allocated} day${data.allocated !== 1 ? 's' : ''} allocated` : '';
      toast.custom((t) => (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={cn(
            'flex items-center gap-3 bg-white border border-green-100 shadow-lg rounded-xl px-4 py-3 max-w-sm',
            t.visible ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <span className="text-2xl">🎁</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">Leave Balance Updated</p>
            <p className="text-xs text-gray-500 truncate">{typeName}{days}{data.reason ? ` — ${data.reason}` : ''}</p>
          </div>
        </motion.div>
      ), { duration: 7000, position: 'top-right' });
      dispatch(api.util.invalidateTags(['LeaveBalance' as any, 'Leave' as any]));
    };
    onSocketEvent('leave:balance-adjusted', handler);
    return () => offSocketEvent('leave:balance-adjusted', handler);
  }, [dispatch]);

  // getBalances now returns { employeeStatus, balances } — support both old array shape and new object shape for safety
  const balancesPayload = balancesRes?.data;
  const employeeStatus: string | null = balancesPayload && !Array.isArray(balancesPayload) ? (balancesPayload.employeeStatus ?? null) : null;
  const balances: any[] = Array.isArray(balancesPayload) ? balancesPayload : (balancesPayload?.balances ?? []);

  const allLeaveTypes = typesRes?.data || [];
  // Only show leave types the employee has a balance for (backend filters by employee status)
  const balanceLeaveTypeIds = new Set(balances.map((b: any) => b.leaveTypeId));
  const leaveTypes = allLeaveTypes.filter((lt: any) => balanceLeaveTypeIds.has(lt.id));
  const leaves = leavesRes?.data || [];
  const holidays = holidaysRes?.data || [];

  // Extract monthly paid limit from default policy
  const defaultLeavePolicies: any[] = leavePoliciesRes?.data ?? [];
  const defaultLeavePolicy = defaultLeavePolicies.find((p: any) => p.isDefault) ?? defaultLeavePolicies[0];
  const maxPaidPerMonthDisplay: number = defaultLeavePolicy?.maxPaidLeavesPerMonth ?? 0;

  // Unpaid leave enabled — read directly from policy.allowUnpaidLeave (system-level toggle)
  const unpaidLeaveEnabled: boolean = defaultLeavePolicy ? defaultLeavePolicy.allowUnpaidLeave !== false : true;

  // Employee-level permission gate
  if (!perms.canViewLeaveBalance) return <PermDenied action="view leave balance" />;

  // Status gate — non-eligible employees cannot access leave management
  const NON_ELIGIBLE_STATUSES = ['ONBOARDING', 'NOTICE_PERIOD', 'SUSPENDED', 'INACTIVE', 'TERMINATED', 'ABSCONDED'];
  if (!balancesLoading && employeeStatus && NON_ELIGIBLE_STATUSES.includes(employeeStatus)) {
    const statusMsg: Record<string, string> = {
      ONBOARDING: 'Complete your onboarding to access leave management.',
      NOTICE_PERIOD: 'Leave is not available during the notice period.',
      SUSPENDED: 'Leave access has been suspended. Contact HR.',
      INACTIVE: 'Your account is currently inactive. Contact HR.',
      TERMINATED: 'Leave is not available for terminated employees.',
      ABSCONDED: 'Leave access has been revoked.',
    };
    return (
      <div className="page-container">
        <div className="layer-card p-8 text-center max-w-md mx-auto">
          <CalendarDays size={40} className="mx-auto mb-3 text-gray-300" />
          <h3 className="text-base font-semibold text-gray-600 mb-1">Leave Not Available</h3>
          <p className="text-sm text-gray-400">{statusMsg[employeeStatus] || 'Leave is not available for your current employment status.'}</p>
          <p className="text-xs text-gray-300 mt-2 font-mono">{employeeStatus.replace(/_/g, ' ')}</p>
        </div>
      </div>
    );
  }

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
      {maxPaidPerMonthDisplay > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2 text-xs text-blue-700">
          <AlertCircle size={14} />
          <span><strong>Policy:</strong> Max {maxPaidPerMonthDisplay} paid leave day{maxPaidPerMonthDisplay !== 1 ? 's' : ''}/month for active employees.</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-lg md:text-2xl font-display font-bold text-gray-900">{t('leaves.title')}</h1>
          <p className="text-gray-500 text-xs md:text-sm mt-0.5">{t('leaves.subtitle')}</p>
        </div>
        {/* Only employee accounts can apply leave; system accounts (HR/Admin/SA) cannot */}
        {!['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '') ? (
          perms.canApplyLeaves ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => openApplyModal()}
              className="flex items-center gap-1.5 bg-brand-600 text-white text-xs md:text-sm font-medium px-3 py-2 md:px-4 md:py-2.5 rounded-lg md:rounded-xl hover:bg-brand-700 active:bg-brand-800 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <Plus size={14} className="md:hidden" />
              <Plus size={16} className="hidden md:block" />
              <span className="hidden xs:inline">{t('leaves.applyLeave')}</span>
              <span className="xs:hidden">Apply</span>
            </motion.button>
          ) : (
            <PermDenied action="apply for leave" inline />
          )
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 md:gap-4 mb-6 md:mb-8">
          {balances.filter((bal: any) => !bal.leaveType?.name?.toLowerCase().includes('probation')).map((bal: any, index: number) => (
            <motion.div
              key={bal.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="layer-card p-3 md:p-4 text-center"
            >
              <span className="text-xl md:text-2xl">{LEAVE_ICONS[bal.leaveType.code] || '📅'}</span>
              <p className="text-xs md:text-sm font-medium text-gray-700 mt-1 md:mt-2 leading-tight">{bal.leaveType.name}</p>
              <div className="mt-2 md:mt-3">
                <p className="text-xl md:text-2xl font-bold font-mono text-brand-600" data-mono>
                  {bal.remaining}
                </p>
                <p className="text-[10px] md:text-xs text-gray-500">
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

      {/* Unpaid Leave card — system-managed, always visible (HR toggle controls it) */}
      {!balancesLoading && (() => {
        // Check if monthly paid quota is full — show orange banner
        const quotaFull = unpaidLeaveEnabled && maxPaidPerMonthDisplay > 0 && (() => {
          const now = new Date();
          const paidThisMonth = leaves.filter((l: any) => {
            if (!['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'].includes(l.status)) return false;
            if (l.leaveType?.isPaid === false) return false;
            const start = new Date(l.startDate);
            return start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
          });
          return paidThisMonth.reduce((s: number, l: any) => s + Number(l.paidDays ?? l.days), 0) >= maxPaidPerMonthDisplay;
        })();
        // Find LWP type if one exists (for applying)
        const lwpType = allLeaveTypes.find((lt: any) => !lt.isPaid);
        return (
          <div className={`mb-6 rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${
            !unpaidLeaveEnabled
              ? 'bg-gray-50 border border-gray-200 opacity-60'
              : quotaFull
              ? 'bg-orange-50 border border-orange-200'
              : 'bg-gray-50 border border-gray-200'
          }`}>
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xl shrink-0">📋</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                  Leave Without Pay (LWP)
                  {!unpaidLeaveEnabled && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-200 rounded px-1.5 py-0.5">Disabled by HR</span>
                  )}
                </p>
                {!unpaidLeaveEnabled ? (
                  <p className="text-[11px] text-gray-400">Unpaid leave is currently disabled. Contact HR.</p>
                ) : quotaFull ? (
                  <p className="text-[11px] text-orange-600 font-medium">
                    Monthly paid leave quota full — you can apply for unpaid leave
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-400">No balance limit. System auto-splits when paid quota is exceeded.</p>
                )}
              </div>
            </div>
            {perms.canApplyLeaves && (
              <button
                onClick={() => {
                  if (!unpaidLeaveEnabled) {
                    toast.error('Unpaid leave is currently disabled by HR. Please contact HR for assistance.');
                    return;
                  }
                  openApplyModal(lwpType?.id);
                }}
                className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  !unpaidLeaveEnabled
                    ? 'text-gray-400 border border-gray-200 cursor-not-allowed'
                    : quotaFull
                    ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-300'
                    : 'text-gray-600 border border-gray-300 hover:bg-white'
                }`}
              >
                Apply
              </button>
            )}
          </div>
        );
      })()}

      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        {/* My leave requests */}
        <div className="lg:col-span-2 layer-card p-3 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm md:text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
              <CalendarDays size={16} className="text-brand-500" />
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
              <div className="space-y-3 w-full overflow-hidden">
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
        <div className="layer-card p-3 md:p-6">
          <h2 className="text-sm md:text-lg font-display font-semibold text-gray-800 mb-3 md:mb-4 flex items-center justify-between">
            <span>🎉 Holidays {new Date().getFullYear()}</span>
            {holidays.length > 0 && (
              <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2 py-1 rounded-full">
                {holidays.filter((h: any) => new Date(h.date) >= new Date()).length} upcoming
              </span>
            )}
          </h2>
          {holidays.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-4xl mb-3">📅</span>
              <p className="text-sm font-medium text-gray-600">No holidays added yet</p>
              <p className="text-xs text-gray-400 mt-1">HR will update the holiday calendar soon</p>
            </div>
          ) : (
            <div className="space-y-2">
              {holidays.map((holiday: any) => {
                const isPast = new Date(holiday.date) < new Date();
                return (
                  <div
                    key={holiday.id}
                    onClick={() => setSelectedHoliday(holiday)}
                    className={cn(
                      'flex items-center gap-2 py-2.5 px-3 rounded-lg cursor-pointer transition-all active:scale-[0.98]',
                      isPast ? 'bg-gray-50 opacity-60' : 'bg-blue-50 hover:bg-blue-100'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{holiday.name}</p>
                      <p className="text-[11px] text-gray-500 truncate">{formatDate(holiday.date, 'long')}</p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0 min-w-0 max-w-[52px]">
                      {holiday.isOptional && (
                        <span className="badge badge-info text-[9px] leading-tight">Opt.</span>
                      )}
                      {isPast ? (
                        <span className="text-[10px] text-gray-400">Past</span>
                      ) : (
                        <span className="text-[10px] text-blue-500 font-medium">
                          {Math.ceil((new Date(holiday.date).getTime() - new Date().getTime()) / 86400000)}d
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Holiday detail popup */}
      <AnimatePresence>
      {selectedHoliday && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setSelectedHoliday(null)}
        >
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-5 mx-auto"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="text-3xl mb-1">🎉</div>
                <h3 className="text-lg font-bold text-gray-900">{selectedHoliday.name}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{formatDate(selectedHoliday.date, 'long')}</p>
              </div>
              <button
                onClick={() => setSelectedHoliday(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-500">Type</span>
                <span className="font-medium text-gray-800 capitalize">{selectedHoliday.type?.replace(/_/g, ' ').toLowerCase()}</span>
              </div>
              {selectedHoliday.isOptional && (
                <div className="p-3 bg-amber-50 rounded-xl text-xs text-amber-700 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>This is an optional holiday — you may choose to work or take it off.</span>
                </div>
              )}
              {selectedHoliday.description && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">Description</span>
                  <span className="text-sm text-gray-700">{selectedHoliday.description}</span>
                </div>
              )}
              {new Date(selectedHoliday.date) < new Date() && (
                <p className="text-xs text-gray-400 italic text-center mt-2">This holiday has passed</p>
              )}
            </div>
            <button
              onClick={() => setSelectedHoliday(null)}
              className="mt-5 w-full py-3 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
            >
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      {/* Apply Leave Wizard */}
      {showApplyModal && (
        <LeaveApplyWizard
          leaveTypes={allLeaveTypes}
          balances={balances}
          initialLeaveTypeId={applyInitialTypeId}
          onClose={() => { setShowApplyModal(false); setApplyInitialTypeId(undefined); }}
        />
      )}
    </div>
  );
}

function LeaveRequestCard({ leave }: { leave: any }) {
  const { t } = useTranslation();
  const [cancelLeave] = useCancelLeaveMutation();
  const [postConditionMessage, { isLoading: submitting }] = usePostConditionMessageMutation();
  const [showConditionModal, setShowConditionModal] = useState(false);
  const [conditionReply, setConditionReply] = useState('');

  const handleCancel = async () => {
    if (!window.confirm(t('common.areYouSure'))) return;
    try {
      await cancelLeave(leave.id).unwrap();
      toast.success('Leave cancelled');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || t('common.failed'));
    }
  };

  const handleConditionReply = async () => {
    if (!conditionReply.trim() || conditionReply.trim().length < 2) {
      toast.error('Please write a response (min 2 chars)');
      return;
    }
    try {
      await postConditionMessage({ id: leave.id, message: conditionReply.trim(), senderRole: 'EMPLOYEE' }).unwrap();
      toast.success('Message sent to HR!');
      setConditionReply('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send message');
    }
  };

  const statusIcon: Record<string, React.ReactNode> = {
    DRAFT: <Clock size={14} className="text-gray-400 shrink-0" />,
    PENDING: <Clock size={14} className="text-amber-500 shrink-0" />,
    MANAGER_APPROVED: <CheckCircle size={14} className="text-blue-500 shrink-0" />,
    APPROVED: <CheckCircle size={14} className="text-emerald-500 shrink-0" />,
    APPROVED_WITH_CONDITION: <AlertTriangle size={14} className="text-amber-500 shrink-0" />,
    REJECTED: <XCircle size={14} className="text-red-500 shrink-0" />,
    CANCELLED: <AlertCircle size={14} className="text-gray-400 shrink-0" />,
  };
  const currentStatusIcon = statusIcon[leave.status] || null;

  const conditionNote = leave.approvalDecisions?.find((d: any) => d.action === 'APPROVED_WITH_CONDITION' && d.conditionNote)?.conditionNote;
  const conditionMessages: any[] = leave.conditionMessages || [];
  const hasRespondedToCondition = conditionMessages.some((m: any) => m.senderRole === 'EMPLOYEE') || !!leave.conditionResponse;
  const isConditional = leave.status === 'APPROVED_WITH_CONDITION';

  return (
    <>
      <div className="py-3 px-3 bg-surface-2 rounded-lg w-full overflow-hidden">
        {/* Top row: icon + type name + days + badge */}
        <div className="flex items-start gap-2 w-full min-w-0">
          <div className="mt-0.5 shrink-0">{currentStatusIcon}</div>
          <div className="flex-1 min-w-0">
            {/* Line 1: leave type name (full width, truncates if needed) */}
            <p className="text-xs font-semibold text-gray-800 truncate leading-snug">
              {leave.leaveType?.name || 'Leave'}
            </p>
            {/* Line 2: days + status badge on same line, both small */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[11px] text-gray-400 shrink-0">
                {Number(leave.days)} {Number(leave.days) === 1 ? 'day' : 'days'}
              </span>
              <span className={`badge ${getStatusColor(leave.status)} text-[10px] shrink-0`}>
                {leave.status === 'MANAGER_APPROVED' ? 'Mgr Approved'
                  : leave.status === 'APPROVED_WITH_CONDITION' ? 'Conditional'
                  : leave.status}
              </span>
            </div>
            {/* Line 3: date range */}
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              {formatDate(leave.startDate)} — {formatDate(leave.endDate)}
            </p>
            {/* Line 4: reason */}
            {leave.reason && (
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">{leave.reason}</p>
            )}
            {/* Condition hint */}
            {isConditional && conditionNote && (
              <p className={cn('text-[10px] mt-1 flex items-center gap-1', conditionMessages.length > 0 ? 'text-emerald-600' : 'text-amber-600')}>
                {conditionMessages.length > 0
                  ? <><CheckCircle size={10} /> Thread active — awaiting HR decision</>
                  : <><AlertTriangle size={10} /> HR set a condition — tap to respond</>}
              </p>
            )}
            {/* Actions row — below all text, no right-column clash */}
            {(isConditional && conditionNote) || (leave.status === 'PENDING' || leave.status === 'DRAFT') ? (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {isConditional && conditionNote && (
                  <button
                    onClick={() => setShowConditionModal(true)}
                    className={cn(
                      'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors',
                      conditionMessages.length > 0
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100 ring-1 ring-amber-300'
                    )}
                  >
                    {conditionMessages.length > 0 ? 'View Thread' : 'Respond'}
                  </button>
                )}
                {(leave.status === 'PENDING' || leave.status === 'DRAFT') && (
                  <button
                    onClick={handleCancel}
                    className="text-[11px] text-red-400 hover:text-red-600 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Condition bottom-sheet popup */}
      <AnimatePresence>
        {showConditionModal && isConditional && conditionNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setShowConditionModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 60 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg mx-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Conditional Approval</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{leave.leaveType?.name} · {formatDate(leave.startDate)} – {formatDate(leave.endDate)}</p>
                </div>
                <button onClick={() => setShowConditionModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Leave details */}
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="font-bold text-gray-800 font-mono" data-mono>{Number(leave.days)}</p>
                    <p className="text-gray-400 mt-0.5">Day{Number(leave.days) !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-2.5">
                    <p className="font-bold text-amber-700">Conditional</p>
                    <p className="text-amber-500 mt-0.5">Status</p>
                  </div>
                  <div className={cn('rounded-xl p-2.5', conditionMessages.length > 0 ? 'bg-emerald-50' : 'bg-orange-50')}>
                    <p className={cn('font-bold text-xs', conditionMessages.length > 0 ? 'text-emerald-700' : 'text-orange-600')}>
                      {conditionMessages.length > 0 ? `${conditionMessages.length} msg${conditionMessages.length !== 1 ? 's' : ''}` : 'Pending'}
                    </p>
                    <p className={cn('mt-0.5 text-[10px]', conditionMessages.length > 0 ? 'text-emerald-500' : 'text-orange-400')}>Thread</p>
                  </div>
                </div>

                {/* HR Condition */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                    <AlertTriangle size={13} /> HR Condition
                  </p>
                  <p className="text-sm text-amber-900 leading-relaxed">{conditionNote}</p>
                </div>

                {/* Message thread */}
                {conditionMessages.length > 0 && (
                  <div className="space-y-2 max-h-44 overflow-y-auto">
                    {conditionMessages.map((msg: any) => (
                      <div key={msg.id} className={`rounded-lg px-3 py-2 text-sm ${msg.senderRole === 'HR' ? 'bg-blue-50 border border-blue-100' : 'bg-green-50 border border-green-100 ml-4'}`}>
                        <p className={`text-[10px] font-semibold mb-0.5 ${msg.senderRole === 'HR' ? 'text-blue-600' : 'text-green-600'}`}>
                          {msg.senderRole === 'HR' ? 'HR' : 'You'} · {new Date(msg.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                        <p className={msg.senderRole === 'HR' ? 'text-blue-800' : 'text-green-800'}>{msg.message}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input — always available */}
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-gray-700">
                    {conditionMessages.length > 0 ? 'Send another message' : 'Your Response'} <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={conditionReply}
                    onChange={(e) => setConditionReply(e.target.value)}
                    className="input-glass w-full text-sm"
                    rows={3}
                    placeholder="Acknowledge or respond to HR's condition…"
                    autoFocus={conditionMessages.length === 0}
                  />
                  <p className="text-[11px] text-gray-400">Min 2 characters. HR will be notified immediately.</p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={() => setShowConditionModal(false)}
                  className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-gray-600 font-medium"
                >
                  Close
                </button>
                <button
                  onClick={handleConditionReply}
                  disabled={submitting || conditionReply.trim().length < 2}
                  className="flex-1 py-2.5 text-sm bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors font-medium"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Send Message
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* =============================================================================
   POLICY SETTINGS TAB
   ============================================================================= */

function PolicySettingsTab() {
  const { data: policiesData, isLoading, refetch } = useGetLeavePoliciesQuery();
  const [updatePolicy] = useUpdateLeavePolicyMutation();
  const [recalculate] = useRecalculatePolicyAllocationsMutation();
  const { data: leaveTypesData } = useGetLeaveTypesQuery();

  const policies: any[] = policiesData?.data ?? [];
  const allLeaveTypes: any[] = leaveTypesData?.data ?? [];
  const policy = policies.find((p: any) => p.isDefault) ?? policies[0];

  // Leave types grouped by audience
  const NEW_AUDIENCES = ['ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE'];
  const activeLeaveTypes = allLeaveTypes.filter((lt: any) =>
    lt.isPaid && (lt.applicableTo === 'ACTIVE_ONLY' || lt.applicableTo === 'ALL_ELIGIBLE')
  );
  const traineeLeaveTypes = allLeaveTypes.filter((lt: any) =>
    lt.isPaid && (lt.applicableTo === 'TRAINEE_ONLY' || lt.applicableTo === 'ALL_ELIGIBLE')
  );
  const lwpTypes = allLeaveTypes.filter((lt: any) => !lt.isPaid);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Dynamic config: keyed by leaveTypeId
  const [activeQuotas, setActiveQuotas] = useState<Record<string, number>>({});
  // Trainee quotas — total days (upfront annual allocation)
  const [traineeQuotas, setTraineeQuotas] = useState<Record<string, number>>({});
  const [durations, setDurations] = useState({ probationMonths: 3, internMonths: 3 });
  const [maxPaidPerMonth, setMaxPaidPerMonth] = useState(0);
  // Single unpaid leave toggle
  const [unpaidEnabled, setUnpaidEnabled] = useState(true);

  const deriveConfig = () => {
    if (!policy) return;
    const findRule = (typeId: string, cat: string) =>
      policy.rules?.find((r: any) => r.leaveTypeId === typeId && r.employeeCategory === cat);

    // Active quotas
    const aq: Record<string, number> = {};
    activeLeaveTypes.forEach((lt: any) => {
      aq[lt.id] = findRule(lt.id, 'ACTIVE')?.yearlyDays ?? 10;
    });
    setActiveQuotas(aq);

    // Trainee quotas — total days (upfront)
    const tq: Record<string, number> = {};
    traineeLeaveTypes.forEach((lt: any) => {
      const rule = findRule(lt.id, 'PROBATION');
      tq[lt.id] = rule?.yearlyDays ?? 5;
    });
    setTraineeQuotas(tq);

    setDurations({
      probationMonths: policy.probationDurationMonths ?? 3,
      internMonths: policy.internDurationMonths ?? 3,
    });
    setMaxPaidPerMonth(policy.maxPaidLeavesPerMonth ?? 0);

    // Unpaid leave toggle — read directly from policy.allowUnpaidLeave field
    setUnpaidEnabled(policy.allowUnpaidLeave !== false);
  };

  useEffect(() => {
    if (policy && allLeaveTypes.length) deriveConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.id, policy?.updatedAt, allLeaveTypes.length]);

  const handleSave = async () => {
    if (!policy) return;

    const rules: any[] = [];

    // Active employee rules
    Object.entries(activeQuotas).forEach(([leaveTypeId, yearlyDays]) => {
      rules.push({ leaveTypeId, employeeCategory: 'ACTIVE', yearlyDays, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: false, isAllowed: true });
    });

    // Trainee rules (UPFRONT, both PROBATION and INTERN get same total days)
    Object.entries(traineeQuotas).forEach(([leaveTypeId, yearlyDays]) => {
      rules.push({ leaveTypeId, employeeCategory: 'PROBATION', yearlyDays, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: false, isAllowed: true });
      rules.push({ leaveTypeId, employeeCategory: 'INTERN', yearlyDays, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: false, isAllowed: true });
    });

    // LWP rules — keep any existing LWP type rules in sync too
    lwpTypes.forEach((lt: any) => {
      rules.push({ leaveTypeId: lt.id, employeeCategory: 'ALL', yearlyDays: 0, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: false, isAllowed: unpaidEnabled });
    });

    setSaving(true);
    try {
      await updatePolicy({
        id: policy.id,
        data: {
          probationDurationMonths: durations.probationMonths,
          internDurationMonths: durations.internMonths,
          maxPaidLeavesPerMonth: maxPaidPerMonth,
          allowUnpaidLeave: unpaidEnabled,
          rules,
        },
      }).unwrap();
      toast.success('Policy saved');
      setEditing(false);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!policy) return;
    if (!window.confirm('This will recalculate and update leave balances for ALL employees. Continue?')) return;
    setRecalculating(true);
    try {
      const result = await recalculate({ id: policy.id }).unwrap();
      toast.success(`Recalculated: ${result.data?.success ?? 0} employees updated`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to recalculate');
    } finally {
      setRecalculating(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    deriveConfig();
  };

  const numField = (
    label: string, hint: string, value: number,
    onChange: (n: number) => void, min = 0, max = 365
  ) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type="number" min={min} max={max}
        value={value}
        disabled={!editing}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-glass w-full text-sm disabled:opacity-60"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-brand-500" size={28} />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="layer-card p-8 text-center text-gray-400">
        <FileText size={40} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm">No leave policy found. One will be created automatically when an employee applies for leave.</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800">{policy.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Set leave quotas per employee category. Changes apply to new allocations going forward.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editing ? (
            <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5 text-sm">
              <Pencil size={14} /> Edit Policy
            </button>
          ) : (
            <>
              <button onClick={cancelEdit} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Save Policy
              </button>
            </>
          )}
        </div>
      </div>

      {/* Warn if no policy-managed types exist */}
      {NEW_AUDIENCES.every((a) => !allLeaveTypes.some((lt: any) => lt.applicableTo === a)) && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl p-3 border border-amber-100">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p>
            No leave types have a new Audience value (Active only / Trainees / All eligible) yet.
            Go to <strong>Types</strong> tab → edit each type → set its Audience.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Card 1 — Active Employee (dynamic) */}
        <div className="layer-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">Active Employees</p>
              <p className="text-[11px] text-gray-400">Upfront annual allocation per leave type</p>
            </div>
          </div>
          {activeLeaveTypes.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No leave types with "Active only" or "All eligible" audience. Edit types to configure.</p>
          ) : (
            <div className="space-y-3">
              {activeLeaveTypes.map((lt: any) =>
                numField(
                  `${lt.name} (${lt.code}) — days / year`,
                  '',
                  activeQuotas[lt.id] ?? 0,
                  (n) => setActiveQuotas((q) => ({ ...q, [lt.id]: n })),
                  0, 365
                )
              )}
            </div>
          )}
          <div className="border-t border-gray-100 pt-3">
            {numField(
              'Max Paid Leaves / Month',
              '0 = unlimited. Cross-type monthly cap for paid leaves (Active employees).',
              maxPaidPerMonth,
              setMaxPaidPerMonth,
              0, 31
            )}
          </div>
        </div>

        {/* Card 2 — Trainees (Probation + Intern — upfront annual) */}
        <div className="layer-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🕐</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">Trainees</p>
              <p className="text-[11px] text-gray-400">Probation & Intern — total days for the period</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numField('Probation Duration (months)', 'Total probation period length', durations.probationMonths,
              (n) => setDurations((d) => ({ ...d, probationMonths: n })), 1, 24)}
            {numField('Internship Duration (months)', 'Total internship period length', durations.internMonths,
              (n) => setDurations((d) => ({ ...d, internMonths: n })), 1, 24)}
          </div>
          {traineeLeaveTypes.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No trainee leave types. Edit types with "Trainees" or "All eligible" audience.</p>
          ) : (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <p className="text-[11px] text-gray-500">Total days allocated for the entire probation/internship period:</p>
              {traineeLeaveTypes.map((lt: any) =>
                numField(
                  `${lt.name} (${lt.code}) — total days`,
                  '',
                  traineeQuotas[lt.id] ?? 0,
                  (n) => setTraineeQuotas((q) => ({ ...q, [lt.id]: n })),
                  0, 60
                )
              )}
            </div>
          )}
        </div>

        {/* Card 3 — Unpaid Leave */}
        <div className="layer-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">Unpaid Leave</p>
              <p className="text-[11px] text-gray-400">Leave Without Pay — available to all eligible employees</p>
            </div>
          </div>
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Allow Unpaid Leave</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {unpaidEnabled
                  ? 'Employees can apply for unpaid leave when paid balance is exhausted'
                  : 'Unpaid leave is disabled — employees cannot apply for it'}
              </p>
            </div>
            <Toggle
              checked={unpaidEnabled}
              onChange={(v) => editing && setUnpaidEnabled(v)}
            />
          </div>
          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            Unpaid leave is system-managed. When enabled, employees can apply for Leave Without Pay when their paid balance is exhausted or the monthly paid cap is exceeded.
          </p>
        </div>
      </div>

      {/* Notice Period info */}
      <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl p-3 border border-amber-100">
        <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
        <p>
          <span className="font-semibold">Notice Period, Suspended, and Onboarding employees</span> receive no leave allocation — leave management is not available to them.
          Only Active, Probation, and Intern employees can apply for leave.
        </p>
      </div>

      {/* Info footer */}
      <div className="flex items-start gap-2 text-xs text-gray-400 bg-blue-50 rounded-xl p-3 border border-blue-100">
        <Info size={14} className="text-blue-400 mt-0.5 shrink-0" />
        <p>
          Active employees and trainees receive their full leave allocation upfront at the start of the year/period.
          The <strong>Max Paid / Month</strong> cap applies across all paid leave types for Active employees.
        </p>
      </div>
    </motion.div>
  );
}
