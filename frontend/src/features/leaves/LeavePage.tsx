import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, X, Clock, CheckCircle, XCircle, AlertCircle,
  Users, Search, FileText, ThumbsUp, ThumbsDown, Pencil, Trash2, Loader2,
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
  useCreateHolidayMutation,
  useBulkCreateHolidaysMutation,
  useDeleteHolidayMutation,
  useGetHolidaySuggestionsQuery,
  usePreviewLeaveMutation,
} from './leaveApi';
import { useGetPendingRegularizationsQuery, useHandleRegularizationMutation } from '../attendance/attendanceApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import { useGetPoliciesQuery, useAcknowledgePolicyMutation } from '../policies/policyApi';
import { useAuditTasksForLeaveMutation } from '../task-integration/taskIntegrationApi';
import LeaveApplyWizard from './components/LeaveApplyWizard';
import ManagerReviewPanel from './components/ManagerReviewPanel';
import HRReviewPanel from './components/HRReviewPanel';
import toast from 'react-hot-toast';

const LEAVE_ICONS: Record<string, string> = {
  CL: '🏖️', EL: '✨', SL: '🤒', PL: '🌴', LWP: '📋',
};

export default function LeavePage() {
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');
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
          Leave Management
        </button>
        <button
          onClick={() => setView('personal')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === 'personal' ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          My Leaves
        </button>
      </div>
      {view === 'management' ? <LeaveManagementView /> : <LeavePersonalView />}
    </>
  );
}

/* =============================================================================
   MANAGEMENT VIEW
   ============================================================================= */

function LeaveManagementView() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'types' | 'holidays' | 'regularizations'>('approvals');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showLeaveTypeModal, setShowLeaveTypeModal] = useState(false);
  const [editingLeaveType, setEditingLeaveType] = useState<any>(null);
  const [reviewLeaveId, setReviewLeaveId] = useState<string | null>(null);

  const user = useAppSelector((state) => state.auth.user);
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
      <div role="tablist" className="flex gap-1 bg-surface-2 rounded-xl p-1 mb-6 w-fit">
        <button
          role="tab" aria-selected={activeTab === 'approvals'}
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
          role="tab" aria-selected={activeTab === 'types'}
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
          Holidays & Events
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
          Regularizations
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
                            onClick={() => handleApprove(leave.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors"
                          >
                            <ThumbsUp size={14} />
                            Approve
                          </motion.button>
                          <motion.button
                            aria-label="Reject leave"
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
   HOLIDAY MANAGEMENT TAB
   ============================================================================= */

function HolidayManagementTab() {
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
          <Plus size={14} /> Create Holiday / Event
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
                <button onClick={resetForm} className="btn-secondary text-sm">Cancel</button>
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
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
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
                      <button onClick={() => handleDelete(h.id, h.name)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
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

      {/* Review Panel */}
      {reviewLeaveId && (
        user?.role === 'MANAGER'
          ? <ManagerReviewPanel leaveId={reviewLeaveId} onClose={() => setReviewLeaveId(null)} />
          : <HRReviewPanel leaveId={reviewLeaveId} onClose={() => setReviewLeaveId(null)} />
      )}
    </motion.div>
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
        defaultDays: Number(leaveType.defaultBalance) || 0,
        maxDays: Number(leaveType.maxDays) || 0,
        minDays: Number(leaveType.minDays) || 1,
        isPaid: leaveType.isPaid ?? true,
        isCarryForward: leaveType.carryForward ?? false,
        maxCarryForward: Number(leaveType.maxCarryForward) || 0,
        applicableTo: leaveType.applicableTo || 'ALL',
        noticeDays: leaveType.noticeDays ?? 0,
        maxPerMonth: leaveType.maxPerMonth ?? 0,
        probationMonths: leaveType.probationMonths ?? 0,
        allowSameDay: leaveType.allowSameDay ?? false,
        allowWeekendAdjacent: leaveType.allowWeekendAdjacent ?? true,
        requiresApproval: leaveType.requiresApproval ?? true,
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
    const payload: any = {
      name: formData.name,
      code: formData.code,
      defaultBalance: Number(formData.defaultDays),
      maxDays: Number(formData.maxDays) || undefined,
      minDays: Number(formData.minDays),
      isPaid: formData.isPaid,
      carryForward: formData.isCarryForward,
      maxCarryForward: Number(formData.maxCarryForward) || undefined,
      applicableTo: formData.applicableTo,
      noticeDays: Number(formData.noticeDays),
      maxPerMonth: Number(formData.maxPerMonth) || undefined,
      probationMonths: Number(formData.probationMonths),
      allowSameDay: formData.allowSameDay,
      allowWeekendAdjacent: formData.allowWeekendAdjacent,
      requiresApproval: formData.requiresApproval,
      gender: formData.genderRestriction || undefined,
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
          <button aria-label="Close" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
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
  const { data: balancesRes, isLoading: balancesLoading } = useGetLeaveBalancesQuery();
  const { data: typesRes } = useGetLeaveTypesQuery();
  const { data: leavesRes, isLoading: leavesLoading } = useGetMyLeavesQuery({ page: 1, limit: 20 });
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
          <h2 className="text-lg font-display font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <CalendarDays size={18} className="text-brand-500" />
            My Leave Requests
          </h2>
          {leavesLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
            </div>
          ) : leaves.length === 0 ? (
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
  const [cancelLeave] = useCancelLeaveMutation();

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this leave request?')) return;
    try {
      await cancelLeave(leave.id).unwrap();
      toast.success('Leave cancelled');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to cancel');
    }
  };

  const statusIcon: Record<string, React.ReactNode> = {
    PENDING: <Clock size={16} className="text-amber-500" />,
    MANAGER_APPROVED: <CheckCircle size={16} className="text-blue-500" />,
    APPROVED: <CheckCircle size={16} className="text-emerald-500" />,
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
          {leave.status === 'MANAGER_APPROVED' ? 'Manager Approved' : leave.status}
        </span>
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
type LeaveMode = 'single' | 'multiple' | 'half';

function ApplyLeaveModal({ leaveTypes, balances, onClose }: { leaveTypes: any[]; balances: any[]; onClose: () => void }) {
  const [leaveMode, setLeaveMode] = useState<LeaveMode | null>(null);
  const [formData, setFormData] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    halfDaySession: '' as '' | 'FIRST_HALF' | 'SECOND_HALF',
    reason: '',
  });
  const [applyLeave, { isLoading }] = useApplyLeaveMutation();
  const [previewLeave] = usePreviewLeaveMutation();
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [previewTimer, setPreviewTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [auditTasks, { isLoading: taskAuditLoading }] = useAuditTasksForLeaveMutation();
  const [taskAudit, setTaskAudit] = useState<any>(null);

  const isHalfDay = leaveMode === 'half';
  const effectiveEndDate = leaveMode === 'single' || leaveMode === 'half'
    ? formData.startDate
    : formData.endDate;

  const selectedBalance = balances.find((b: any) => b.leaveType?.id === formData.leaveTypeId);

  // Fetch preview from backend
  const fetchPreview = async () => {
    if (!formData.leaveTypeId || !formData.startDate || (leaveMode === 'multiple' && !formData.endDate)) {
      setPreview(null);
      return;
    }
    const endD = leaveMode === 'single' || leaveMode === 'half' ? formData.startDate : formData.endDate;
    setPreviewLoading(true);
    try {
      const result = await previewLeave({
        leaveTypeId: formData.leaveTypeId,
        startDate: formData.startDate,
        endDate: endD,
        isHalfDay,
        halfDaySession: isHalfDay && formData.halfDaySession ? formData.halfDaySession : undefined,
      }).unwrap();
      setPreview(result.data);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const triggerPreview = () => {
    if (previewTimer) clearTimeout(previewTimer);
    setPreviewTimer(setTimeout(fetchPreview, 400));
  };

  const previewKey = `${formData.leaveTypeId}-${formData.startDate}-${effectiveEndDate}-${leaveMode}-${formData.halfDaySession}`;
  const [lastPreviewKey, setLastPreviewKey] = useState('');
  if (previewKey !== lastPreviewKey && formData.leaveTypeId && formData.startDate && (leaveMode !== 'multiple' || formData.endDate)) {
    setLastPreviewKey(previewKey);
    triggerPreview();
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!leaveMode) return toast.error('Please select a leave mode');
    if (leaveMode === 'half' && !formData.halfDaySession) return toast.error('Please select First Half or Second Half');
    if (leaveMode === 'multiple' && formData.endDate && formData.endDate < formData.startDate) {
      return toast.error('End date must be on or after the start date');
    }
    try {
      await applyLeave({
        leaveTypeId: formData.leaveTypeId,
        startDate: formData.startDate,
        endDate: effectiveEndDate,
        isHalfDay,
        halfDaySession: isHalfDay ? formData.halfDaySession : undefined,
        reason: formData.reason,
      }).unwrap();
      setSubmitted(true);
    } catch (err: any) {
      const errorData = err?.data?.error;
      if (errorData?.code === 'VALIDATION_ERROR' && errorData?.details) {
        const fields = Object.entries(errorData.details as Record<string, string[]>);
        fields.forEach(([field, messages]) => {
          toast.error(`${field}: ${(messages as string[]).join(', ')}`);
        });
      } else {
        toast.error(errorData?.message || 'Failed to apply leave');
      }
    }
  };

  // Success screen
  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-glass-lg w-full max-w-sm p-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
            className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <CheckCircle size={32} className="text-emerald-600" />
          </motion.div>
          <h3 className="text-lg font-display font-bold text-gray-900 mb-1">Leave Request Submitted</h3>
          <p className="text-sm text-gray-500 mb-1">
            {preview?.days || ''} {(preview?.days || 0) === 1 ? 'day' : 'days'} of {preview?.leaveTypeName || 'leave'}
          </p>
          <p className="text-xs text-gray-400 mb-6">Your request is pending approval</p>
          <button onClick={onClose} className="btn-primary w-full py-3">
            Done
          </button>
        </motion.div>
      </motion.div>
    );
  }

  const modeConfig = [
    { key: 'single' as LeaveMode, icon: '1', label: 'Single Day', desc: 'One full day off' },
    { key: 'multiple' as LeaveMode, icon: '\uD83D\uDCC5', label: 'Multiple Days', desc: 'Date range' },
    { key: 'half' as LeaveMode, icon: '\u00BD', label: 'Half Day', desc: 'Morning or afternoon' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        role="dialog"
        aria-modal="true"
        aria-label="Apply for leave"
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-glass-lg w-full sm:max-w-md max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-display font-semibold text-gray-800">Apply Leave</h2>
          <button aria-label="Close" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Step 1: Leave Mode Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">How long?</label>
            <div className="grid grid-cols-3 gap-2">
              {modeConfig.map((mode) => (
                <motion.button
                  key={mode.key}
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    setLeaveMode(mode.key);
                    if (mode.key !== 'multiple') setFormData(f => ({ ...f, endDate: '' }));
                    if (mode.key !== 'half') setFormData(f => ({ ...f, halfDaySession: '' }));
                    setPreview(null);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-center',
                    leaveMode === mode.key
                      ? 'border-brand-500 bg-brand-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <span className="text-xl leading-none">{mode.icon}</span>
                  <span className={cn('text-xs font-semibold', leaveMode === mode.key ? 'text-brand-700' : 'text-gray-700')}>
                    {mode.label}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-tight">{mode.desc}</span>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Step 2: Leave Type */}
          {leaveMode && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Leave Type</label>
              <select
                value={formData.leaveTypeId}
                onChange={(e) => setFormData({ ...formData, leaveTypeId: e.target.value })}
                className="input-glass w-full text-sm py-3"
                required
              >
                <option value="">Select leave type</option>
                {leaveTypes.map((lt: any) => {
                  const bal = balances.find((b: any) => b.leaveType?.id === lt.id);
                  return (
                    <option key={lt.id} value={lt.id}>
                      {lt.name} ({lt.code}) — {bal ? bal.remaining : '?'} days left
                    </option>
                  );
                })}
              </select>
              {selectedBalance && (
                <div className="flex items-center gap-3 mt-2 px-1">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-brand-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min((Number(selectedBalance.used) / Math.max(Number(selectedBalance.allocated), 1)) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-500 font-mono shrink-0" data-mono>
                    {selectedBalance.remaining}/{Number(selectedBalance.allocated)}
                  </span>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 3: Date Fields (dynamic by mode) */}
          {leaveMode && formData.leaveTypeId && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              {(leaveMode === 'single' || leaveMode === 'half') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="input-glass w-full text-sm py-3"
                    required
                  />
                </div>
              )}

              {leaveMode === 'multiple' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Start Date</label>
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFormData(f => ({ ...f, startDate: v, endDate: (!f.endDate || f.endDate < v) ? v : f.endDate }));
                      }}
                      className="input-glass w-full text-sm py-3"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">End Date</label>
                    <input
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      className="input-glass w-full text-sm py-3"
                      min={formData.startDate}
                      required
                    />
                  </div>
                </div>
              )}

              {leaveMode === 'half' && (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Session</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'FIRST_HALF' as const, label: 'First Half', desc: 'Morning off' },
                      { value: 'SECOND_HALF' as const, label: 'Second Half', desc: 'Afternoon off' },
                    ].map((session) => (
                      <motion.button
                        key={session.value}
                        type="button"
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setFormData(f => ({ ...f, halfDaySession: session.value }))}
                        className={cn(
                          'py-3 px-3 rounded-xl border-2 text-center transition-all',
                          formData.halfDaySession === session.value
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-gray-200 hover:border-gray-300'
                        )}
                      >
                        <p className={cn('text-sm font-semibold', formData.halfDaySession === session.value ? 'text-brand-700' : 'text-gray-700')}>
                          {session.label}
                        </p>
                        <p className="text-[10px] text-gray-400">{session.desc}</p>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Real-time Preview Panel */}
          {preview && !previewLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-brand-50 to-indigo-50 rounded-xl p-4 border border-brand-100"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-brand-700 uppercase tracking-wide">Leave Summary</span>
                <span className="text-lg font-bold font-mono text-brand-600" data-mono>
                  {preview.days} {preview.days === 1 ? 'day' : 'days'}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Current balance</span>
                  <span className="font-mono text-gray-700" data-mono>{preview.balance.available} days</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">After this request</span>
                  <span className={cn('font-mono font-semibold', preview.balance.remainingAfter < 0 ? 'text-red-600' : 'text-emerald-600')} data-mono>
                    {preview.balance.remainingAfter} days
                  </span>
                </div>
              </div>
              {preview.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {preview.warnings.map((w: string, i: number) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      <AlertCircle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-amber-700">{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {previewLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 size={16} className="animate-spin text-brand-500" />
              <span className="text-xs text-gray-400 ml-2">Calculating...</span>
            </div>
          )}

          {/* Reason */}
          {leaveMode && formData.leaveTypeId && formData.startDate && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Reason</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="input-glass w-full h-20 resize-none text-sm"
                placeholder="Why do you need this leave?"
                required
                minLength={5}
              />
            </motion.div>
          )}

          {/* Task Impact Assessment */}
          {formData.startDate && formData.leaveTypeId && (
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700">Task Impact Assessment</h4>
                <button
                  type="button"
                  onClick={async () => {
                    const leaveType = leaveTypes.find((lt: any) => lt.id === formData.leaveTypeId);
                    try {
                      const result = await auditTasks({
                        startDate: formData.startDate,
                        endDate: formData.endDate || formData.startDate,
                        leaveType: leaveType?.code || 'CL',
                      }).unwrap();
                      setTaskAudit(result.data);
                    } catch {
                      setTaskAudit(null);
                    }
                  }}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  {taskAuditLoading ? 'Checking...' : 'Check Tasks'}
                </button>
              </div>
              {taskAudit && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <p className="text-lg font-bold font-mono text-gray-900" data-mono>{taskAudit.totalOpenTasks}</p>
                      <p className="text-[10px] text-gray-500">Open Tasks</p>
                    </div>
                    <div className={`rounded-lg p-2 ${taskAudit.dueWithinLeave > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                      <p className="text-lg font-bold font-mono text-gray-900" data-mono>{taskAudit.dueWithinLeave}</p>
                      <p className="text-[10px] text-gray-500">Due in Leave</p>
                    </div>
                    <div className={`rounded-lg p-2 ${taskAudit.criticalTasks > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                      <p className="text-lg font-bold font-mono text-gray-900" data-mono>{taskAudit.criticalTasks}</p>
                      <p className="text-[10px] text-gray-500">Critical</p>
                    </div>
                  </div>
                  {taskAudit.riskLevel !== 'LOW' && (
                    <div className={`text-xs px-3 py-2 rounded-lg ${
                      taskAudit.riskLevel === 'CRITICAL' ? 'bg-red-50 text-red-700 border border-red-200' :
                      taskAudit.riskLevel === 'HIGH' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                      'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      <strong>Risk: {taskAudit.riskLevel}</strong> — {taskAudit.riskExplanation}
                    </div>
                  )}
                  {taskAudit.integrationStatus === 'NOT_CONFIGURED' && (
                    <p className="text-xs text-gray-400 italic">Task manager not configured. Contact admin to enable task impact assessment.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Submit Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white rounded-b-2xl shrink-0">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3">
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleSubmit}
              disabled={isLoading || !leaveMode || !formData.leaveTypeId || !formData.startDate || !formData.reason || (leaveMode === 'multiple' && !formData.endDate) || (leaveMode === 'half' && !formData.halfDaySession)}
              className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <CalendarDays size={16} />
              )}
              Submit Request
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
