import { useState } from 'react';
import { Zap, Plus, Check, X, Clock, Loader2 } from 'lucide-react';
import { useGetAllOvertimeRequestsQuery, useGetMyOvertimeRequestsQuery, useSubmitOvertimeRequestMutation, useHandleOvertimeRequestMutation } from '../attendanceApi';
import { useAppSelector } from '../../../app/store';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export default function OvertimeTab() {
  const user = useAppSelector(s => s.auth.user);
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(user?.role || '');
  const { data: allRes, isLoading: loadingAll } = useGetAllOvertimeRequestsQuery(undefined, { skip: !isAdmin });
  const { data: myRes, isLoading: loadingMy } = useGetMyOvertimeRequestsQuery();
  const [submit, { isLoading: submitting }] = useSubmitOvertimeRequestMutation();
  const [handle, { isLoading: handling }] = useHandleOvertimeRequestMutation();

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('2');
  const [reason, setReason] = useState('');

  const requests = isAdmin ? (allRes?.data || []) : (myRes?.data || []);
  const isLoading = isAdmin ? loadingAll : loadingMy;

  const handleSubmit = async () => {
    if (!date || !hours || !reason) { toast.error('All fields required'); return; }
    try {
      await submit({ date, plannedHours: +hours, reason }).unwrap();
      toast.success('Overtime request submitted');
      setShowForm(false); setDate(''); setHours('2'); setReason('');
    } catch (e: any) { toast.error(e?.data?.error?.message || 'Failed to submit'); }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      await handle({ id, action }).unwrap();
      toast.success(`Request ${action}d`);
    } catch (e: any) { toast.error(e?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-semibold text-gray-800 flex items-center gap-2">
          <Zap size={16} className="text-orange-500" /> Overtime Requests
        </h3>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-medium">
          <Plus size={14} /> Request OT
        </button>
      </div>

      {/* Submit Form */}
      {showForm && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Planned Hours *</label>
              <input type="number" step="0.5" min="0.5" max="8" value={hours} onChange={e => setHours(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={handleSubmit} disabled={submitting}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white py-2 rounded-lg text-sm font-medium">
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g., Project deadline, client deliverable"
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm" />
          </div>
        </div>
      )}

      {/* Requests List */}
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : requests.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400">No overtime requests</div>
      ) : (
        <div className="space-y-2">
          {requests.map((req: any) => (
            <div key={req.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                  <Clock size={14} className="text-orange-500" />
                </div>
                <div>
                  {req.employee && <p className="text-xs font-medium text-gray-800">{req.employee.firstName} {req.employee.lastName} <span className="text-gray-400">({req.employee.employeeCode})</span></p>}
                  <p className="text-[11px] text-gray-500">
                    {new Date(req.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {Number(req.plannedHours)}h planned
                    {req.actualHours && ` · ${Number(req.actualHours)}h actual`}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{req.reason}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-500'}`}>
                  {req.status}
                </span>
                {isAdmin && req.status === 'PENDING' && (
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => handleAction(req.id, 'approve')} disabled={handling}
                      className="p-1.5 bg-emerald-50 hover:bg-emerald-100 rounded-lg" title="Approve">
                      <Check size={14} className="text-emerald-600" />
                    </button>
                    <button onClick={() => handleAction(req.id, 'reject')} disabled={handling}
                      className="p-1.5 bg-red-50 hover:bg-red-100 rounded-lg" title="Reject">
                      <X size={14} className="text-red-500" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
