import { useState } from 'react';
import { Clock, Plus, ChevronDown, ChevronUp, Loader2, Home, Building2, MapPin, X } from 'lucide-react';
import { useGetShiftsQuery } from '../../workforce/workforceApi';
import { useCreateShiftChangeRequestMutation, useGetMyShiftChangeRequestsQuery } from '../../workforce/workforceApi';
import { cn } from '../../../lib/utils';
import toast from 'react-hot-toast';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

const SHIFT_ICON: Record<string, React.ElementType> = {
  OFFICE: Building2,
  FIELD: MapPin,
  HYBRID: Home,
};

export default function ShiftChangeRequestPanel() {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [toShiftId, setToShiftId] = useState('');
  const [reason, setReason] = useState('');

  const { data: shiftsRes } = useGetShiftsQuery();
  const { data: requestsRes, refetch } = useGetMyShiftChangeRequestsQuery();
  const [createRequest, { isLoading: creating }] = useCreateShiftChangeRequestMutation();

  const shifts: any[] = shiftsRes?.data || [];
  const requests: any[] = requestsRes?.data || [];
  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  const handleSubmit = async () => {
    if (!toShiftId) { toast.error('Please select a shift'); return; }
    try {
      await createRequest({ toShiftId, reason: reason.trim() || undefined }).unwrap();
      toast.success('Shift change request submitted successfully');
      setToShiftId('');
      setReason('');
      setShowForm(false);
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit request');
    }
  };

  return (
    <div className="layer-card overflow-hidden">
      {/* Header — collapsible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Clock size={16} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Shift Change Requests</p>
            <p className="text-xs text-gray-400">Request a shift change or WFH mode</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
              {pendingCount} pending
            </span>
          )}
          {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4">
          {/* New request button */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors mb-4"
            >
              <Plus size={15} />
              Request Shift Change
            </button>
          )}

          {/* Request form */}
          {showForm && (
            <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-700">New Shift Change Request</p>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Select target shift</label>
                  <div className="grid grid-cols-1 gap-2">
                    {shifts.map((shift: any) => {
                      const Icon = SHIFT_ICON[shift.shiftType] || Clock;
                      return (
                        <button
                          key={shift.id}
                          onClick={() => setToShiftId(shift.id)}
                          className={cn(
                            'flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left',
                            toShiftId === shift.id
                              ? 'border-brand-500 bg-brand-50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          )}
                        >
                          <div className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                            shift.shiftType === 'OFFICE' ? 'bg-blue-100' :
                            shift.shiftType === 'FIELD' ? 'bg-green-100' : 'bg-purple-100'
                          )}>
                            <Icon size={15} className={
                              shift.shiftType === 'OFFICE' ? 'text-blue-600' :
                              shift.shiftType === 'FIELD' ? 'text-green-600' : 'text-purple-600'
                            } />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800">{shift.name}</p>
                            <p className="text-[10px] text-gray-400">{shift.startTime}–{shift.endTime}</p>
                          </div>
                          {shift.isWfhShift && (
                            <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">WFH</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="e.g. Need to work from home this month due to..."
                    rows={2}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-brand-300 resize-none"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowForm(false)}
                    className="flex-1 text-xs px-4 py-2 border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={creating || !toShiftId}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                  >
                    {creating ? <Loader2 size={12} className="animate-spin" /> : null}
                    Submit Request
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Past requests */}
          {requests.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No shift change requests yet</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 mb-2">Your requests</p>
              {requests.map((req: any) => (
                <div key={req.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700">{req.toShift?.name}</p>
                    <p className="text-[10px] text-gray-400">{new Date(req.createdAt).toLocaleDateString('en-IN')}</p>
                    {req.reason && <p className="text-[10px] text-gray-500 truncate mt-0.5">{req.reason}</p>}
                  </div>
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', STATUS_STYLE[req.status])}>
                    {req.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
