import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, X, Clock, CheckCircle, XCircle, AlertCircle,
  Users, Search, FileText, ThumbsUp, ThumbsDown, Pencil, Trash2,
} from 'lucide-react';
import {
  useGetLeaveBalancesQuery,
  useGetLeaveTypesQuery,
  useGetMyLeavesQuery,
  useApplyLeaveMutation,
  useCancelLeaveMutation,
  useGetHolidaysQuery,
  useGetPendingApprovalsQuery,
  useHandleLeaveActionMutation,
  useCreateLeaveTypeMutation,
  useUpdateLeaveTypeMutation,
  useDeleteLeaveTypeMutation,
} from './leaveApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';

const LEAVE_ICONS: Record<string, string> = {
  CL: '🏖️', EL: '✨', SL: '🤒', ML: '🤱', PL: '👶', LWP: '📋', SAB: '🧘',
};

export default function LeavePage() {
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');

  return isManagement ? <LeaveManagementView /> : <LeavePersonalView />;
}

/* =============================================================================
   MANAGEMENT VIEW
   ============================================================================= */

function LeaveManagementView() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'types'>('approvals');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showLeaveTypeModal, setShowLeaveTypeModal] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<any>(null);

  const { data: approvalsRes, isLoading: approvalsLoading } = useGetPendingApprovalsQuery({ page, limit: 20 });
  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: holidaysRes } = useGetHolidaysQuery({});
  const [handleAction] = useHandleLeaveActionMutation();
  const [deleteLeaveType] = useDeleteLeaveTypeMutation();

  const approvals = approvalsRes?.data || [];
  const leaveTypes = typesRes?.data || [];
  const holidays = holidaysRes?.data || [];

  // Filter approvals by search
  const filteredApprovals = searchQuery.trim()
    ? approvals.filter((a: any) => {
        const name = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`.toLowerCase();
        return name.includes(searchQuery.toLowerCase());
      })
    : approvals;

  const handleApprove = async (id: string) => {
    try {
      await handleAction({ id, action: 'APPROVE' }).unwrap();
      toast.success('Leave approved');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to approve');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await handleAction({ id, action: 'REJECT' }).unwrap();
      toast.success('Leave rejected');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to reject');
    }
  };

  const handleDeleteLeaveType = async (id: string, name: string) => {
    if (!confirm(`Delete leave type "${name}"? This cannot be undone.`)) return;
    try {
      await deleteLeaveType(id).unwrap();
      toast.success('Leave type deleted');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to delete leave type');
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
  const pendingCount = approvals.length;

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Leave Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Review and manage employee leave requests</p>
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
      <div className="flex gap-1 bg-surface-2 rounded-xl p-1 mb-6 w-fit">
        <button
          onClick={() => setActiveTab('approvals')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'approvals'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Pending Approvals
          {pendingCount > 0 && (
            <span className="ml-2 bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('types')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'types'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Leave Types
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'approvals' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Search */}
          <div className="mb-4">
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by employee name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-glass w-full pl-9 text-sm"
              />
            </div>
          </div>

          {/* Approval cards */}
          {approvalsLoading ? (
            <div className="text-center py-12">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-400 mt-2">Loading pending approvals...</p>
            </div>
          ) : filteredApprovals.length === 0 ? (
            <div className="layer-card p-12 text-center">
              <CheckCircle size={40} className="mx-auto text-emerald-200 mb-3" />
              <p className="text-sm text-gray-400">No pending leave requests</p>
              <p className="text-xs text-gray-300 mt-1">All caught up!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map((leave: any, idx: number) => (
                <motion.div
                  key={leave.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className="layer-card p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="badge badge-info text-xs">
                            {leave.leaveType?.name || 'Leave'}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatDate(leave.startDate)} - {formatDate(leave.endDate)}
                          </span>
                          <span className="text-xs font-mono text-gray-500" data-mono>
                            {Number(leave.days)} {Number(leave.days) === 1 ? 'day' : 'days'}
                          </span>
                          {leave.isHalfDay && (
                            <span className="badge badge-warning text-xs">Half Day</span>
                          )}
                        </div>
                        {leave.reason && (
                          <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{leave.reason}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`badge ${getStatusColor(leave.status)} text-xs`}>
                        {leave.status}
                      </span>
                      {leave.status === 'PENDING' && (
                        <>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleApprove(leave.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors"
                          >
                            <ThumbsUp size={14} />
                            Approve
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleReject(leave.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                          >
                            <ThumbsDown size={14} />
                            Reject
                          </motion.button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {activeTab === 'types' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{leaveTypes.length} leave types configured</p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCreateLeaveType}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              Create Leave Type
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
                      {lt.defaultDays ?? 0}
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
                  {lt.isCarryForward && <span className="badge badge-info text-xs">Carry Forward</span>}
                  {lt.requiresApproval !== false && <span className="badge badge-warning text-xs">Needs Approval</span>}
                  {lt.allowSameDay && <span className="badge badge-neutral text-xs">Same-day OK</span>}
                  {lt.genderRestriction && <span className="badge badge-neutral text-xs">{lt.genderRestriction} only</span>}
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
                    {lt.isCarryForward && lt.maxCarryForward != null && (
                      <span>Carry max: <span className="text-gray-600 font-medium">{lt.maxCarryForward}d</span></span>
                    )}
                    {lt.probationMonths != null && lt.probationMonths > 0 && (
                      <span>Probation: <span className="text-gray-600 font-medium">{lt.probationMonths}mo</span></span>
                    )}
                    <span>Same-day: <span className="text-gray-600 font-medium">{lt.allowSameDay ? 'Yes' : 'No'}</span></span>
                    <span>Wknd adj: <span className="text-gray-600 font-medium">{lt.allowWeekendAdjacent ? 'Yes' : 'No'}</span></span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Create/Edit Leave Type Modal */}
      <AnimatePresence>
        {showLeaveTypeModal && (
          <LeaveTypeModal
            leaveType={editingLeaveType}
            onClose={() => { setShowLeaveTypeModal(false); setEditingLeaveType(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* =============================================================================
   LEAVE TYPE CREATE/EDIT MODAL
   ============================================================================= */

const LEAVE_TYPE_DEFAULTS = {
  name: '', code: '', defaultDays: 0, maxDays: 0, minDays: 1,
  isPaid: true, isCarryForward: false, maxCarryForward: 0,
  applicableTo: 'ALL', noticeDays: 0, maxPerMonth: 0, probationMonths: 0,
  allowSameDay: false, allowWeekendAdjacent: true, requiresApproval: true,
  genderRestriction: '',
};

function LeaveTypeModal({ leaveType, onClose }: { leaveType: any | null; onClose: () => void }) {
  const isEditing = !!leaveType;
  const [formData, setFormData] = useState(() => {
    if (leaveType) {
      return {
        name: leaveType.name || '',
        code: leaveType.code || '',
        defaultDays: leaveType.defaultDays ?? 0,
        maxDays: leaveType.maxDays ?? 0,
        minDays: leaveType.minDays ?? 1,
        isPaid: leaveType.isPaid ?? true,
        isCarryForward: leaveType.isCarryForward ?? false,
        maxCarryForward: leaveType.maxCarryForward ?? 0,
        applicableTo: leaveType.applicableTo || 'ALL',
        noticeDays: leaveType.noticeDays ?? 0,
        maxPerMonth: leaveType.maxPerMonth ?? 0,
        probationMonths: leaveType.probationMonths ?? 0,
        allowSameDay: leaveType.allowSameDay ?? false,
        allowWeekendAdjacent: leaveType.allowWeekendAdjacent ?? true,
        requiresApproval: leaveType.requiresApproval ?? true,
        genderRestriction: leaveType.genderRestriction || '',
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
    const payload = {
      ...formData,
      defaultDays: Number(formData.defaultDays),
      maxDays: Number(formData.maxDays),
      minDays: Number(formData.minDays),
      maxCarryForward: Number(formData.maxCarryForward),
      noticeDays: Number(formData.noticeDays),
      maxPerMonth: Number(formData.maxPerMonth),
      probationMonths: Number(formData.probationMonths),
      genderRestriction: formData.genderRestriction || null,
    };
    try {
      if (isEditing) {
        await updateLeaveType({ id: leaveType.id, data: payload }).unwrap();
        toast.success('Leave type updated');
      } else {
        await createLeaveType(payload).unwrap();
        toast.success('Leave type created');
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
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">
            {isEditing ? 'Edit Leave Type' : 'Create Leave Type'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Row 1: Name, Code */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => set('name', e.target.value)}
                className="input-glass w-full"
                placeholder="e.g. Casual Leave"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Code</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                className="input-glass w-full"
                placeholder="e.g. CL"
                required
                maxLength={10}
              />
            </div>
          </div>

          {/* Row 2: Default Balance, Max Days, Min Days */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Default Balance</label>
              <input
                type="number"
                value={formData.defaultDays}
                onChange={(e) => set('defaultDays', e.target.value)}
                className="input-glass w-full"
                min={0}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Max Days</label>
              <input
                type="number"
                value={formData.maxDays}
                onChange={(e) => set('maxDays', e.target.value)}
                className="input-glass w-full"
                min={0}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Min Days</label>
              <input
                type="number"
                value={formData.minDays}
                onChange={(e) => set('minDays', e.target.value)}
                className="input-glass w-full"
                min={0}
              />
            </div>
          </div>

          {/* Row 3: Is Paid, Carry Forward, Max Carry Forward */}
          <div className="grid grid-cols-3 gap-3 items-end">
            <div className="flex items-center gap-3 py-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isPaid}
                  onChange={(e) => set('isPaid', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-brand-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
              </label>
              <span className="text-sm text-gray-700">Is Paid</span>
            </div>
            <div className="flex items-center gap-3 py-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isCarryForward}
                  onChange={(e) => set('isCarryForward', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-brand-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
              </label>
              <span className="text-sm text-gray-700">Carry Forward</span>
            </div>
            {formData.isCarryForward && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Max Carry Forward</label>
                <input
                  type="number"
                  value={formData.maxCarryForward}
                  onChange={(e) => set('maxCarryForward', e.target.value)}
                  className="input-glass w-full"
                  min={0}
                />
              </div>
            )}
          </div>

          {/* Row 4: Applicable To, Notice Days */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Applicable To</label>
              <select
                value={formData.applicableTo}
                onChange={(e) => set('applicableTo', e.target.value)}
                className="input-glass w-full"
              >
                <option value="ALL">All Employees</option>
                <option value="PROBATION">Probation Only</option>
                <option value="CONFIRMED">Confirmed Only</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Notice Days</label>
              <input
                type="number"
                value={formData.noticeDays}
                onChange={(e) => set('noticeDays', e.target.value)}
                className="input-glass w-full"
                min={0}
              />
            </div>
          </div>

          {/* Row 5: Max Per Month, Probation Months */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Max Per Month</label>
              <input
                type="number"
                value={formData.maxPerMonth}
                onChange={(e) => set('maxPerMonth', e.target.value)}
                className="input-glass w-full"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Probation Months</label>
              <input
                type="number"
                value={formData.probationMonths}
                onChange={(e) => set('probationMonths', e.target.value)}
                className="input-glass w-full"
                min={0}
              />
            </div>
          </div>

          {/* Row 6: Allow Same Day, Allow Weekend Adjacent, Requires Approval */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-3 py-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.allowSameDay}
                  onChange={(e) => set('allowSameDay', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-brand-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
              </label>
              <span className="text-sm text-gray-700">Same Day</span>
            </div>
            <div className="flex items-center gap-3 py-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.allowWeekendAdjacent}
                  onChange={(e) => set('allowWeekendAdjacent', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-brand-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
              </label>
              <span className="text-sm text-gray-700">Wknd Adjacent</span>
            </div>
            <div className="flex items-center gap-3 py-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.requiresApproval}
                  onChange={(e) => set('requiresApproval', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-brand-500 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
              </label>
              <span className="text-sm text-gray-700">Approval</span>
            </div>
          </div>

          {/* Row 7: Gender Restriction */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Gender Restriction</label>
              <select
                value={formData.genderRestriction}
                onChange={(e) => set('genderRestriction', e.target.value)}
                className="input-glass w-full"
              >
                <option value="">No restriction</option>
                <option value="MALE">Male only</option>
                <option value="FEMALE">Female only</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
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
              {isEditing ? 'Update' : 'Create'}
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
  const [showApplyModal, setShowApplyModal] = useState(false);
  const { data: balancesRes } = useGetLeaveBalancesQuery();
  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: leavesRes } = useGetMyLeavesQuery({ page: 1, limit: 20 });
  const { data: holidaysRes } = useGetHolidaysQuery({});

  const balances = balancesRes?.data || [];
  const leaveTypes = typesRes?.data || [];
  const leaves = leavesRes?.data || [];
  const holidays = holidaysRes?.data || [];

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Leave Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track your leaves and apply for new ones</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowApplyModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          Apply Leave
        </motion.button>
      </div>

      {/* Leave balance cards */}
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
              <p className="text-xs text-gray-400">
                of {Number(bal.allocated)} available
              </p>
            </div>
            {Number(bal.used) > 0 && (
              <p className="text-xs text-gray-400 mt-1">
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

      <div className="grid lg:grid-cols-3 gap-6">
        {/* My leave requests */}
        <div className="lg:col-span-2 layer-card p-6">
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <CalendarDays size={18} className="text-brand-500" />
            My Leave Requests
          </h2>
          {leaves.length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">No leave requests yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {leaves.map((leave: any) => (
                <LeaveRequestCard key={leave.id} leave={leave} />
              ))}
            </div>
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
                    <p className="text-xs text-gray-400">{formatDate(holiday.date, 'long')}</p>
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

      {/* Apply Leave Modal */}
      <AnimatePresence>
        {showApplyModal && (
          <ApplyLeaveModal
            leaveTypes={leaveTypes}
            onClose={() => setShowApplyModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function LeaveRequestCard({ leave }: { leave: any }) {
  const [cancelLeave] = useCancelLeaveMutation();

  const handleCancel = async () => {
    try {
      await cancelLeave(leave.id).unwrap();
      toast.success('Leave cancelled');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to cancel');
    }
  };

  const statusIcon = {
    PENDING: <Clock size={16} className="text-amber-500" />,
    APPROVED: <CheckCircle size={16} className="text-emerald-500" />,
    REJECTED: <XCircle size={16} className="text-red-500" />,
    CANCELLED: <AlertCircle size={16} className="text-gray-400" />,
  }[leave.status] || null;

  return (
    <div className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
      <div className="flex items-center gap-3">
        {statusIcon}
        <div>
          <p className="text-sm font-medium text-gray-800">
            {leave.leaveType?.name || 'Leave'}
            <span className="text-gray-400 ml-2">
              {Number(leave.days)} {Number(leave.days) === 1 ? 'day' : 'days'}
            </span>
          </p>
          <p className="text-xs text-gray-400">
            {formatDate(leave.startDate)} — {formatDate(leave.endDate)}
          </p>
          {leave.reason && (
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{leave.reason}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`badge ${getStatusColor(leave.status)} text-xs`}>{leave.status}</span>
        {leave.status === 'PENDING' && (
          <button
            onClick={handleCancel}
            className="text-xs text-red-400 hover:text-red-600 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function ApplyLeaveModal({ leaveTypes, onClose }: { leaveTypes: any[]; onClose: () => void }) {
  const [formData, setFormData] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    isHalfDay: false,
    reason: '',
  });
  const [applyLeave, { isLoading }] = useApplyLeaveMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.startDate && formData.endDate && formData.endDate < formData.startDate) {
      toast.error('End date must be on or after the start date');
      return;
    }
    try {
      await applyLeave(formData).unwrap();
      toast.success('Leave request submitted!');
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to apply leave');
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
        className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-display font-semibold text-gray-800">Apply Leave</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Leave Type</label>
            <select
              value={formData.leaveTypeId}
              onChange={(e) => setFormData({ ...formData, leaveTypeId: e.target.value })}
              className="input-glass w-full"
              required
            >
              <option value="">Select leave type</option>
              {leaveTypes.map((lt: any) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name} ({lt.code})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="input-glass w-full"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="input-glass w-full"
                min={formData.startDate}
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="halfDay"
              checked={formData.isHalfDay}
              onChange={(e) => setFormData({ ...formData, isHalfDay: e.target.checked })}
              className="rounded border-gray-300"
            />
            <label htmlFor="halfDay" className="text-sm text-gray-600">Half day</label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Reason</label>
            <textarea
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              className="input-glass w-full h-20 resize-none"
              placeholder="Enter reason for leave"
              required
              minLength={5}
            />
          </div>

          <div className="flex gap-3 pt-2">
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
              Submit
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
