import { useState } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { RootState } from '../../../app/store';
import { Role } from '@aniston/shared';
import {
  useGetCompOffBalanceQuery,
  useGetCompOffCreditsQuery,
  useGetOrgCompOffCreditsQuery,
  useGrantCompOffMutation,
} from '../attendanceApi';
import { Gift, Clock, CheckCircle, AlertTriangle, Plus, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-700' :
    status === 'USED'      ? 'bg-gray-100 text-gray-600' :
    status === 'EXPIRED'   ? 'bg-red-100 text-red-600' :
    'bg-gray-100 text-gray-500';
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return format(new Date(d), 'dd MMM yyyy'); } catch { return d; }
}

export function CompOffTab() {
  const user = useSelector((s: RootState) => s.auth.user);
  const isHR = user?.role && [Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER].includes(user.role as Role);

  const { data: balanceData } = useGetCompOffBalanceQuery();
  const { data: creditsData, isLoading: creditsLoading } = useGetCompOffCreditsQuery();
  const { data: orgData, isLoading: orgLoading } = useGetOrgCompOffCreditsQuery({}, { skip: !isHR });
  const [grantCompOff] = useGrantCompOffMutation();

  const [showGrant, setShowGrant] = useState(false);
  const [grantForm, setGrantForm] = useState({
    employeeId: '', earnedDate: '', hoursWorked: '8', notes: '', expiryMonths: '3',
  });
  const [granting, setGranting] = useState(false);

  const balance = balanceData?.data?.balance ?? 0;
  const myCredits: any[] = creditsData?.data ?? [];
  const orgCredits: any[] = orgData?.data ?? [];

  async function handleGrant() {
    if (!grantForm.employeeId || !grantForm.earnedDate) {
      toast.error('Employee ID and earned date are required');
      return;
    }
    setGranting(true);
    try {
      await grantCompOff({
        employeeId: grantForm.employeeId,
        earnedDate: grantForm.earnedDate,
        hoursWorked: Number(grantForm.hoursWorked),
        notes: grantForm.notes || undefined,
        expiryMonths: Number(grantForm.expiryMonths),
      }).unwrap();
      toast.success('Comp-off credit granted successfully');
      setShowGrant(false);
      setGrantForm({ employeeId: '', earnedDate: '', hoursWorked: '8', notes: '', expiryMonths: '3' });
    } catch (e: any) {
      toast.error(e?.data?.error?.message ?? 'Failed to grant comp-off');
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Balance stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="layer-card p-5 flex items-center gap-4 border border-emerald-200 bg-emerald-50/40">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
            <Gift size={22} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Available Balance</p>
            <p className="text-3xl font-bold font-mono text-emerald-700" data-mono>{balance}</p>
            <p className="text-xs text-gray-400">comp-off days</p>
          </div>
        </div>
        <div className="layer-card p-5 flex items-center gap-4 border border-blue-200 bg-blue-50/40">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <CheckCircle size={22} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Total Earned</p>
            <p className="text-3xl font-bold font-mono text-blue-700" data-mono>{myCredits.length}</p>
            <p className="text-xs text-gray-400">all-time credits</p>
          </div>
        </div>
        <div className="layer-card p-5 flex items-center gap-4 border border-amber-200 bg-amber-50/40">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Clock size={22} className="text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Used / Expired</p>
            <p className="text-3xl font-bold font-mono text-amber-700" data-mono>
              {myCredits.filter(c => c.status !== 'AVAILABLE').length}
            </p>
            <p className="text-xs text-gray-400">credits consumed</p>
          </div>
        </div>
      </div>

      {/* My Credits */}
      <div className="layer-card p-4 md:p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Gift size={16} style={{ color: 'var(--primary-color)' }} /> My Comp-Off Credits
        </h3>
        {creditsLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary-color)' }} /></div>
        ) : myCredits.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No comp-off credits yet. Work on a weekly off-day to earn one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left py-2 font-medium">Earned Date</th>
                  <th className="text-left py-2 font-medium">Hours</th>
                  <th className="text-left py-2 font-medium">Expires</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {myCredits.map((c: any) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="py-2 font-mono text-xs" data-mono>{fmtDate(c.earnedDate)}</td>
                    <td className="py-2 font-mono text-xs" data-mono>{c.hoursWorked}h</td>
                    <td className="py-2 font-mono text-xs" data-mono>
                      {fmtDate(c.expiryDate)}
                      {c.status === 'AVAILABLE' && new Date(c.expiryDate) < new Date(Date.now() + 7 * 864e5) && (
                        <span className="ml-1 text-amber-500 inline-flex items-center gap-0.5">
                          <AlertTriangle size={11} /> Soon
                        </span>
                      )}
                    </td>
                    <td className="py-2"><StatusBadge status={c.status} /></td>
                    <td className="py-2 text-gray-400 text-xs">{c.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HR view */}
      {isHR && (
        <div className="layer-card p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Gift size={16} className="text-purple-500" /> All Employee Comp-Off Credits
            </h3>
            <button onClick={() => setShowGrant(true)} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
              <Plus size={14} /> Grant Credit
            </button>
          </div>
          {orgLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary-color)' }} /></div>
          ) : orgCredits.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No comp-off credits in the org yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left py-2 font-medium">Employee</th>
                    <th className="text-left py-2 font-medium">Earned</th>
                    <th className="text-left py-2 font-medium">Hours</th>
                    <th className="text-left py-2 font-medium">Expires</th>
                    <th className="text-left py-2 font-medium">Status</th>
                    <th className="text-left py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {orgCredits.map((c: any) => (
                    <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="py-2">
                        <span className="font-medium text-gray-800">{c.employee?.firstName} {c.employee?.lastName}</span>
                        <span className="text-gray-400 text-xs ml-1">({c.employee?.employeeCode})</span>
                      </td>
                      <td className="py-2 font-mono text-xs" data-mono>{fmtDate(c.earnedDate)}</td>
                      <td className="py-2 font-mono text-xs" data-mono>{c.hoursWorked}h</td>
                      <td className="py-2 font-mono text-xs" data-mono>{fmtDate(c.expiryDate)}</td>
                      <td className="py-2"><StatusBadge status={c.status} /></td>
                      <td className="py-2 text-gray-400 text-xs">{c.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Grant Modal */}
      <AnimatePresence>
        {showGrant && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowGrant(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="bg-white rounded-2xl shadow-glass-lg w-full max-w-md"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
                <h3 className="text-base font-display font-semibold text-gray-900 flex items-center gap-2">
                  <Gift size={18} className="text-emerald-500" /> Grant Comp-Off Credit
                </h3>
                <button onClick={() => setShowGrant(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Employee ID *</label>
                  <input
                    className="input-glass w-full text-sm font-mono"
                    placeholder="Employee UUID from their profile"
                    value={grantForm.employeeId}
                    onChange={e => setGrantForm(f => ({ ...f, employeeId: e.target.value }))}
                  />
                  <p className="text-xs text-gray-400 mt-1">Paste the employee's UUID</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Earned Date *</label>
                  <input
                    type="date"
                    className="input-glass w-full text-sm"
                    value={grantForm.earnedDate}
                    onChange={e => setGrantForm(f => ({ ...f, earnedDate: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Hours Worked</label>
                    <input
                      type="number" min="1" max="24" step="0.5"
                      className="input-glass w-full text-sm"
                      value={grantForm.hoursWorked}
                      onChange={e => setGrantForm(f => ({ ...f, hoursWorked: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Expires After (months)</label>
                    <input
                      type="number" min="1" max="12"
                      className="input-glass w-full text-sm"
                      value={grantForm.expiryMonths}
                      onChange={e => setGrantForm(f => ({ ...f, expiryMonths: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Notes (optional)</label>
                  <textarea
                    rows={2}
                    className="input-glass w-full text-sm resize-none"
                    placeholder="e.g. Worked on Sunday for project deployment"
                    value={grantForm.notes}
                    onChange={e => setGrantForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="px-6 pb-5 flex gap-3">
                <button onClick={() => setShowGrant(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                <button onClick={handleGrant} disabled={granting} className="btn-primary flex-1 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {granting ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
                  {granting ? 'Granting…' : 'Grant Comp-Off'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
