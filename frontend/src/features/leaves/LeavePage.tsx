import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, Plus, X, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import {
  useGetLeaveBalancesQuery,
  useGetLeaveTypesQuery,
  useGetMyLeavesQuery,
  useApplyLeaveMutation,
  useCancelLeaveMutation,
  useGetHolidaysQuery,
} from './leaveApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import toast from 'react-hot-toast';

const LEAVE_ICONS: Record<string, string> = {
  CL: '🏖️', EL: '✨', SL: '🤒', ML: '🤱', PL: '👶', LWP: '📋', SAB: '🧘',
};

export default function LeavePage() {
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
