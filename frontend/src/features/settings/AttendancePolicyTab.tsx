import { useState, useEffect } from 'react';
import { Clock, Shield, Zap, Calendar, Save, Loader2, Sun } from 'lucide-react';
import { useGetAttendancePolicyQuery, useUpdateAttendancePolicyMutation } from '../attendance/attendanceApi';
import toast from 'react-hot-toast';

export default function AttendancePolicyTab() {
  const { data: res, isLoading } = useGetAttendancePolicyQuery();
  const [update, { isLoading: saving }] = useUpdateAttendancePolicyMutation();
  const [form, setForm] = useState<any>({});

  useEffect(() => { if (res?.data) setForm(res.data); }, [res]);

  const set = (key: string, value: any) => setForm((p: any) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    try {
      await update(form).unwrap();
      toast.success('Attendance policy updated');
    } catch (e: any) { toast.error(e?.data?.error?.message || 'Failed to save'); }
  };

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary-color)' }} /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-display font-bold text-gray-900">Attendance Policy</h2>
        <p className="text-sm text-gray-500 mt-1">Configure rules for late penalties, overtime, half-day cutoffs, and comp-off</p>
      </div>

      {/* Late Penalty Rules */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <Clock size={18} className="text-amber-500" /> Late Arrival Rules
        </h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grace Period (minutes)</label>
            <input type="number" value={form.lateGraceMinutes || 15} onChange={e => set('lateGraceMinutes', +e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <p className="text-xs text-gray-400 mt-1">Check-in within this window counts as on-time</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Half-Day After (minutes late)</label>
            <input type="number" value={form.lateHalfDayAfterMins || 120} onChange={e => set('lateHalfDayAfterMins', +e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            <p className="text-xs text-gray-400 mt-1">Auto-mark half-day if late beyond this</p>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between bg-gray-50 rounded-xl p-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Late Penalty (LOP Deduction)</p>
              <p className="text-xs text-gray-400">Every N late arrivals = 1 day Loss of Pay</p>
            </div>
            <button type="button" onClick={() => set('latePenaltyEnabled', !(form.latePenaltyEnabled || false))}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              style={{ background: form.latePenaltyEnabled ? 'var(--primary-color)' : '#e5e7eb' }}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.latePenaltyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {form.latePenaltyEnabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lates per LOP Day</label>
              <input type="number" value={form.latePenaltyPerCount || 3} onChange={e => set('latePenaltyPerCount', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <p className="text-xs text-gray-400 mt-1">e.g., 3 = every 3 lates = 1 LOP day in payroll</p>
            </div>
          )}
        </div>
      </div>

      {/* Working Hours */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <Shield size={18} className="text-blue-500" /> Working Hours
        </h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Day Minimum (hours)</label>
            <input type="number" step="0.5" value={form.fullDayMinHours || 8} onChange={e => set('fullDayMinHours', +e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Half Day Minimum (hours)</label>
            <input type="number" step="0.5" value={form.halfDayMinHours || 4} onChange={e => set('halfDayMinHours', +e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Week Off Days</label>
            <div className="flex gap-1.5 mt-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                <button key={i} type="button"
                  onClick={() => {
                    const days = new Set(form.weekOffDays || [0]);
                    days.has(i) ? days.delete(i) : days.add(i);
                    set('weekOffDays', Array.from(days));
                  }}
                  className="w-9 h-9 rounded-lg text-xs font-semibold transition-colors"
                  style={(form.weekOffDays || [0]).includes(i) ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : { background: '#f3f4f6', color: '#6b7280' }}>{day}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Overtime Rules */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <Zap size={18} className="text-orange-500" /> Overtime Rules
        </h3>
        <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 mb-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Enable Overtime Tracking</p>
            <p className="text-xs text-gray-400">Track and manage overtime hours worked beyond shift</p>
          </div>
          <button type="button" onClick={() => set('otEnabled', !(form.otEnabled || false))}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: form.otEnabled ? 'var(--primary-color)' : '#e5e7eb' }}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.otEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {form.otEnabled && (
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Extra Minutes for OT</label>
              <input type="number" value={form.otThresholdMinutes || 30} onChange={e => set('otThresholdMinutes', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OT Rate Multiplier</label>
              <input type="number" step="0.1" value={form.otRateMultiplier || 1.5} onChange={e => set('otRateMultiplier', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <p className="text-xs text-gray-400 mt-1">1.5x = 150% of hourly rate</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max OT Hours/Day</label>
              <input type="number" step="0.5" value={form.otMaxHoursPerDay || 4} onChange={e => set('otMaxHoursPerDay', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
          </div>
        )}
      </div>

      {/* Comp-Off Rules */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-green-500" /> Compensatory Off Rules
        </h3>
        <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 mb-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Enable Comp-Off</p>
            <p className="text-xs text-gray-400">Grant compensatory leave for working on holidays/weekoffs</p>
          </div>
          <button type="button" onClick={() => set('compOffEnabled', !(form.compOffEnabled || false))}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: form.compOffEnabled ? 'var(--primary-color)' : '#e5e7eb' }}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.compOffEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {form.compOffEnabled && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min OT Hours for Comp-Off</label>
              <input type="number" step="0.5" value={form.compOffMinOTHours || 4} onChange={e => set('compOffMinOTHours', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Comp-Off Expiry (days)</label>
              <input type="number" value={form.compOffExpiryDays || 30} onChange={e => set('compOffExpiryDays', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <p className="text-xs text-gray-400 mt-1">Unused comp-off expires after these many days</p>
            </div>
          </div>
        )}
      </div>

      {/* Sunday Working Rules */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2 mb-1">
          <Sun size={18} className="text-yellow-500" /> Sunday Working Rules
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Enable Sunday work for selected employees. When an employee marked as "Sunday worker" clocks in on Sunday,
          the system sends an email to the HR/admin and applies a pay multiplier in payroll.
        </p>
        <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 mb-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Allow Sunday Working</p>
            <p className="text-xs text-gray-400">Enable org-level Sunday attendance. Must also be enabled per employee in their profile.</p>
          </div>
          <button type="button" onClick={() => set('sundayWorkEnabled', !(form.sundayWorkEnabled || false))}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
            style={{ background: form.sundayWorkEnabled ? 'var(--primary-color)' : '#e5e7eb' }}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.sundayWorkEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {form.sundayWorkEnabled && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sunday Pay Multiplier</label>
              <input type="number" step="0.1" min={1} max={5} value={form.sundayPayMultiplier ?? 2.0} onChange={e => set('sundayPayMultiplier', +e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <p className="text-xs text-gray-400 mt-1">
                2.0 = double pay · 1.5 = time and a half · Applied to daily rate in payroll for Sunday records flagged as Sunday work.
              </p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-700">
              <p className="font-semibold mb-1">How Sunday pay works:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Enable Sunday working here (org level)</li>
                <li>Enable it on specific employees in Employee Profile → Employment tab</li>
                <li>When they clock in on Sunday, attendance is flagged</li>
                <li>An email is sent to the configured HR/admin email</li>
                <li>Payroll applies the multiplier to their daily rate for that Sunday</li>
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="disabled:bg-gray-300 px-8 py-3 rounded-xl font-semibold flex items-center gap-2 transition-colors" style={{ background: saving ? undefined : 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          Save Policy
        </button>
      </div>
    </div>
  );
}
