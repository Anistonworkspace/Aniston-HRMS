import { useState } from 'react';
import { CalendarDays, Edit2, Save, X, Plus, Trash2, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  useGetLeaveTypesQuery,
  useCreateLeaveTypeMutation,
  useUpdateLeaveTypeMutation,
  useDeleteLeaveTypeMutation,
} from '../leaves/leaveApi';
import toast from 'react-hot-toast';

const EMPTY_FORM = {
  name: '',
  code: '',
  defaultBalance: 12,
  carryForward: false,
  maxCarryForward: '',
  isPaid: true,
  minDays: 0.5,
  maxDays: '',
  noticeDays: 0,
  allowSameDay: false,
  maxPerMonth: '',
  applicableTo: 'ALL' as string,
  requiresApproval: true,
  isActive: true,
};

type FormState = typeof EMPTY_FORM;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
      style={{ background: checked ? 'var(--primary-color)' : '#d1d5db' }}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export default function LeaveSettingsTab() {
  const { data: res, isLoading } = useGetLeaveTypesQuery();
  const [createLeaveType, { isLoading: creating }] = useCreateLeaveTypeMutation();
  const [updateLeaveType, { isLoading: updating }] = useUpdateLeaveTypeMutation();
  const [deleteLeaveType] = useDeleteLeaveTypeMutation();

  const leaveTypes: any[] = res?.data || [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const set = (key: keyof FormState, value: any) => setForm(p => ({ ...p, [key]: value }));

  const startEdit = (lt: any) => {
    setShowCreate(false);
    setEditingId(lt.id);
    setForm({
      name: lt.name || '',
      code: lt.code || '',
      defaultBalance: lt.defaultBalance ?? 12,
      carryForward: lt.carryForward ?? false,
      maxCarryForward: lt.maxCarryForward ?? '',
      isPaid: lt.isPaid ?? true,
      minDays: lt.minDays ?? 0.5,
      maxDays: lt.maxDays ?? '',
      noticeDays: lt.noticeDays ?? 0,
      allowSameDay: lt.allowSameDay ?? false,
      maxPerMonth: lt.maxPerMonth ?? '',
      applicableTo: lt.applicableTo ?? 'ALL',
      requiresApproval: lt.requiresApproval ?? true,
      isActive: lt.isActive ?? true,
    });
  };

  const cancelEdit = () => { setEditingId(null); setShowCreate(false); setForm({ ...EMPTY_FORM }); };

  const buildPayload = () => ({
    name: form.name,
    code: form.code.toUpperCase(),
    defaultBalance: Number(form.defaultBalance),
    carryForward: form.carryForward,
    maxCarryForward: form.maxCarryForward !== '' ? Number(form.maxCarryForward) : undefined,
    isPaid: form.isPaid,
    minDays: Number(form.minDays),
    maxDays: form.maxDays !== '' ? Number(form.maxDays) : undefined,
    noticeDays: Number(form.noticeDays),
    allowSameDay: form.allowSameDay,
    maxPerMonth: form.maxPerMonth !== '' ? Number(form.maxPerMonth) : undefined,
    applicableTo: form.applicableTo,
    requiresApproval: form.requiresApproval,
    isActive: form.isActive,
  });

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error('Name and Code are required');
      return;
    }
    try {
      if (editingId) {
        await updateLeaveType({ id: editingId, data: buildPayload() }).unwrap();
        toast.success('Leave type updated');
      } else {
        await createLeaveType(buildPayload()).unwrap();
        toast.success('Leave type created');
      }
      cancelEdit();
    } catch (e: any) {
      toast.error(e?.data?.error?.message || 'Failed to save leave type');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLeaveType(id).unwrap();
      toast.success('Leave type deleted');
      setDeleteConfirmId(null);
    } catch (e: any) {
      toast.error(e?.data?.error?.message || 'Failed to delete leave type');
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--primary-color)' }} /></div>;
  }

  const APPLICABILITY_LABELS: Record<string, string> = {
    ALL: 'All Employees',
    PROBATION: 'Probation Employees',
    CONFIRMED: 'Confirmed / Active Only',
    ACTIVE: 'Active Employees',
    INTERN: 'Interns Only',
    NOTICE_PERIOD: 'On Notice Period',
    ONBOARDING: 'Onboarding Only',
    SUSPENDED: 'Suspended Employees',
    INACTIVE: 'Inactive Employees',
    TERMINATED: 'Terminated Employees',
    ABSCONDED: 'Absconded Employees',
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-gray-900">Leave Settings</h2>
          <p className="text-sm text-gray-500 mt-1">Manage leave types, notice periods, carry-forward rules, and application policies</p>
        </div>
        {!showCreate && !editingId && (
          <button onClick={() => { setEditingId(null); setShowCreate(true); setForm({ ...EMPTY_FORM }); }} className="btn-primary text-sm flex items-center gap-2">
            <Plus size={16} /> New Leave Type
          </button>
        )}
      </div>

      {/* Create / Edit Form */}
      {(showCreate || editingId) && (
        <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-5" style={{ borderColor: 'var(--ui-border-color)' }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <CalendarDays size={16} style={{ color: 'var(--primary-color)' }} />
              {editingId ? 'Edit Leave Type' : 'Create Leave Type'}
            </h3>
            <button onClick={cancelEdit} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Sick Leave"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Code * <span className="text-gray-400 font-normal">(short, e.g. SL)</span></label>
              <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="SL"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Default Balance (days/year)</label>
              <input type="number" min={0} step={0.5} value={form.defaultBalance} onChange={e => set('defaultBalance', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notice Days Required</label>
              <input type="number" min={0} value={form.noticeDays} onChange={e => set('noticeDays', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <p className="text-[11px] text-gray-400 mt-1">0 = can apply same day or day-of. 2 = must apply 2 days before.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Min Days per Application</label>
              <input type="number" min={0.5} step={0.5} value={form.minDays} onChange={e => set('minDays', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Days per Application <span className="text-gray-400 font-normal">(leave blank = unlimited)</span></label>
              <input type="number" min={0.5} step={0.5} value={form.maxDays} onChange={e => set('maxDays', e.target.value)} placeholder="—"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Applications per Month <span className="text-gray-400 font-normal">(blank = unlimited)</span></label>
              <input type="number" min={1} value={form.maxPerMonth} onChange={e => set('maxPerMonth', e.target.value)} placeholder="—"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Applicable To</label>
              <select value={form.applicableTo} onChange={e => set('applicableTo', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
                <option value="ALL">All Employees</option>
                <optgroup label="Active States">
                  <option value="ONBOARDING">Onboarding</option>
                  <option value="PROBATION">Probation Only</option>
                  <option value="CONFIRMED">Confirmed / Active</option>
                  <option value="INTERN">Interns Only</option>
                </optgroup>
                <optgroup label="Transition States">
                  <option value="NOTICE_PERIOD">On Notice Period</option>
                  <option value="SUSPENDED">Suspended</option>
                </optgroup>
                <optgroup label="Terminal States">
                  <option value="INACTIVE">Inactive</option>
                  <option value="TERMINATED">Terminated</option>
                  <option value="ABSCONDED">Absconded</option>
                </optgroup>
              </select>
            </div>
          </div>

          {/* Toggles */}
          <div className="grid sm:grid-cols-2 gap-3 pt-2">
            {([
              { key: 'isPaid', label: 'Paid Leave', desc: 'Counts toward payroll salary (uncheck for LWP)' },
              { key: 'allowSameDay', label: 'Allow Same-Day Application', desc: 'Employee can apply on the day itself (e.g. Sick Leave)' },
              { key: 'carryForward', label: 'Carry Forward', desc: 'Unused balance rolls over to next year' },
              { key: 'requiresApproval', label: 'Requires Approval', desc: 'Manager/HR must approve before leave is granted' },
              { key: 'isActive', label: 'Active', desc: 'Inactive types are hidden from employees' },
            ] as { key: keyof FormState; label: string; desc: string }[]).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">{label}</p>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
                <Toggle checked={!!form[key]} onChange={v => set(key, v)} />
              </div>
            ))}

            {form.carryForward && (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Max Carry Forward Days</label>
                <input type="number" min={0} step={0.5} value={form.maxCarryForward} onChange={e => set('maxCarryForward', e.target.value)} placeholder="—"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={creating || updating} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
              {(creating || updating) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editingId ? 'Save Changes' : 'Create Leave Type'}
            </button>
            <button onClick={cancelEdit} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Leave Types List */}
      <div className="space-y-3">
        {leaveTypes.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">No leave types configured yet.</div>
        )}
        {leaveTypes.map((lt: any) => (
          <div key={lt.id} className={`bg-white border border-gray-200 rounded-2xl p-5 transition-colors ${!lt.isActive ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 text-sm">{lt.name}</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>{lt.code}</span>
                  {lt.isPaid ? (
                    <span className="text-[11px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Paid</span>
                  ) : (
                    <span className="text-[11px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">Unpaid (LWP)</span>
                  )}
                  {!lt.isActive && <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span><span className="font-medium text-gray-700">{lt.defaultBalance}</span> days/year</span>
                  <span>Notice: <span className="font-medium text-gray-700">{lt.noticeDays === 0 ? 'None (same-day OK)' : `${lt.noticeDays} day(s)`}</span></span>
                  <span>Same-day: <span className={`font-medium ${lt.allowSameDay ? 'text-emerald-600' : 'text-red-500'}`}>{lt.allowSameDay ? 'Allowed' : 'Not allowed'}</span></span>
                  {lt.maxDays && <span>Max: <span className="font-medium text-gray-700">{lt.maxDays} days</span></span>}
                  {lt.carryForward && <span>Carry forward: <span className="font-medium text-gray-700">{lt.maxCarryForward ? `up to ${lt.maxCarryForward} days` : 'unlimited'}</span></span>}
                  <span>Applies to: <span className="font-medium text-gray-700">{APPLICABILITY_LABELS[lt.applicableTo] || lt.applicableTo}</span></span>
                  <span>Approval: <span className="font-medium text-gray-700">{lt.requiresApproval ? 'Required' : 'Auto-approved'}</span></span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => startEdit(lt)}
                  disabled={!!editingId || showCreate}
                  className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30"
                  title="Edit"
                >
                  <Edit2 size={15} />
                </button>
                {deleteConfirmId === lt.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-red-600 font-medium">Delete?</span>
                    <button onClick={() => handleDelete(lt.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg hover:bg-red-700">Yes</button>
                    <button onClick={() => setDeleteConfirmId(null)} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-200">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(lt.id)}
                    disabled={!!editingId || showCreate}
                    className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors disabled:opacity-30"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Policy guide */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <h4 className="text-sm font-semibold text-amber-800 mb-2">Leave Policy Guide</h4>
        <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
          <li><strong>Sick Leave (SL) / Emergency Leave (EL)</strong> — Set <em>Notice Days = 0</em> and enable <em>Allow Same-Day</em> so employees can apply on the day of illness.</li>
          <li><strong>Casual Leave (CL) / Privileged Leave (PL)</strong> — Set <em>Notice Days = 2</em> and disable <em>Allow Same-Day</em> to enforce advance planning.</li>
          <li><strong>Leave Without Pay (LWP)</strong> — Disable <em>Paid Leave</em>. This deducts from payroll salary automatically.</li>
          <li>Changes apply immediately to all new leave applications. Existing approved leaves are unaffected.</li>
        </ul>
      </div>
    </div>
  );
}
