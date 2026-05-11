import { useState } from 'react';
import { Shield, Search, Loader2, Save, Info, X, ChevronRight } from 'lucide-react';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { useGetHRRestrictionsQuery, useSetHRRestrictionsMutation } from '../workforce/workforceApi';
import { cn, getInitials, getUploadUrl } from '../../lib/utils';
import toast from 'react-hot-toast';

type RestrictionValues = Record<string, boolean>;

interface RestrictionGroup {
  label: string;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'indigo';
  items: { key: string; label: string; description: string }[];
}

const RESTRICTION_GROUPS: RestrictionGroup[] = [
  {
    label: 'Shift & Profile',
    color: 'indigo',
    items: [
      { key: 'canHRChangeShift', label: 'Change Shift', description: 'HR can request shift changes for this employee' },
      { key: 'canHRMarkAttendance', label: 'Mark Attendance', description: 'HR can manually mark attendance for this employee' },
      { key: 'canHREditProfile', label: 'Edit Profile', description: 'HR can update personal/professional details of this employee' },
      { key: 'canHRManageLeave', label: 'Manage Leave', description: 'HR can approve, reject, or cancel leave requests for this employee' },
      { key: 'canHRManageDocuments', label: 'Manage Documents', description: 'HR can upload or delete documents for this employee' },
      { key: 'canHRChangeRole', label: 'Change Role', description: 'HR can change the role/designation of this employee' },
    ],
  },
  {
    label: 'Payroll & Salary',
    color: 'green',
    items: [
      { key: 'canHRRunPayroll', label: 'Run Payroll', description: 'HR can create and process payroll runs' },
      { key: 'canHREditSalary', label: 'Edit Salary', description: 'HR can update salary structure for this employee' },
      { key: 'canHRViewPayroll', label: 'View Payroll', description: 'HR can view payroll records and salary history for this employee' },
      { key: 'canHRAddPayrollAdjustment', label: 'Payroll Adjustments', description: 'HR can add bonus/deduction adjustments for this employee' },
    ],
  },
  {
    label: 'Attendance (Extended)',
    color: 'blue',
    items: [
      { key: 'canHRExportAttendance', label: 'Export Attendance', description: 'HR can export attendance data for this employee' },
      { key: 'canHRResolveRegularization', label: 'Resolve Regularization', description: 'HR can approve or reject regularization requests for this employee' },
      { key: 'canHRSetHybridSchedule', label: 'Set Hybrid Schedule', description: 'HR can configure WFH/office days for this employee' },
    ],
  },
  {
    label: 'KYC & Documents',
    color: 'purple',
    items: [
      { key: 'canHRManageKYC', label: 'Manage KYC', description: 'HR can verify, reject, or revoke KYC for this employee' },
    ],
  },
  {
    label: 'Offboarding',
    color: 'orange',
    items: [
      { key: 'canHRManageExit', label: 'Manage Exit', description: 'HR can set last working day, IT checklist, F&F settlement for this employee' },
    ],
  },
  {
    label: 'Account Access',
    color: 'red',
    items: [
      { key: 'canHRResetPassword', label: 'Reset Password', description: "HR can reset this employee's login password" },
    ],
  },
];

const ALL_KEYS = RESTRICTION_GROUPS.flatMap(g => g.items.map(i => i.key));
const DEFAULT_VALUES: RestrictionValues = Object.fromEntries(ALL_KEYS.map(k => [k, true]));

const GROUP_COLOR_STYLES: Record<string, { header: string; dot: string }> = {
  indigo: { header: 'text-indigo-700 bg-indigo-50 border-indigo-100', dot: 'bg-indigo-400' },
  green:  { header: 'text-emerald-700 bg-emerald-50 border-emerald-100', dot: 'bg-emerald-400' },
  blue:   { header: 'text-blue-700 bg-blue-50 border-blue-100', dot: 'bg-blue-400' },
  purple: { header: 'text-purple-700 bg-purple-50 border-purple-100', dot: 'bg-purple-400' },
  orange: { header: 'text-orange-700 bg-orange-50 border-orange-100', dot: 'bg-orange-400' },
  red:    { header: 'text-red-700 bg-red-50 border-red-100', dot: 'bg-red-400' },
};

// ─── Modal ───────────────────────────────────────────────────────────────────

function EmployeeRestrictionsModal({
  employee,
  onClose,
}: {
  employee: any;
  onClose: () => void;
}) {
  const { data: restrictionRes, isLoading } = useGetHRRestrictionsQuery(employee.id);
  const [setRestrictions, { isLoading: saving }] = useSetHRRestrictionsMutation();
  const [localValues, setLocalValues] = useState<RestrictionValues | null>(null);

  const current = restrictionRes?.data ?? null;
  const values: RestrictionValues = localValues ?? (current
    ? Object.fromEntries(ALL_KEYS.map(k => [k, current[k] ?? true]))
    : DEFAULT_VALUES
  );

  const blockedCount = Object.values(values).filter(v => !v).length;
  const isDirty = localValues !== null;

  const toggle = (key: string) => {
    setLocalValues(prev => ({ ...(prev ?? { ...values }), [key]: !(prev ?? values)[key] }));
  };

  const handleSave = async () => {
    try {
      await setRestrictions({ employeeId: employee.id, restrictions: values }).unwrap();
      toast.success(`Restrictions updated for ${employee.firstName} ${employee.lastName}`);
      setLocalValues(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save restrictions');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-bold flex-shrink-0 overflow-hidden">
            {employee.avatar
              ? <img src={getUploadUrl(employee.avatar)} alt="" className="w-full h-full object-cover" />
              : getInitials(`${employee.firstName} ${employee.lastName}`)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">{employee.firstName} {employee.lastName}</p>
            <p className="text-xs text-gray-400">{employee.employeeCode} · {employee.user?.role || 'EMPLOYEE'}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {blockedCount > 0 ? (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">
                {blockedCount} blocked
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                All allowed
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            RESTRICTION_GROUPS.map(group => {
              const colorStyle = GROUP_COLOR_STYLES[group.color];
              return (
                <div key={group.label}>
                  <div className={cn(
                    'inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border mb-2.5',
                    colorStyle.header
                  )}>
                    <div className={cn('w-1.5 h-1.5 rounded-full', colorStyle.dot)} />
                    {group.label.toUpperCase()}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {group.items.map(({ key, label, description }) => {
                      const allowed = values[key] ?? true;
                      return (
                        <button
                          key={key}
                          onClick={() => toggle(key)}
                          title={description}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all text-left',
                            allowed
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                          )}
                        >
                          <div className={cn(
                            'w-2 h-2 rounded-full flex-shrink-0 transition-colors',
                            allowed ? 'bg-emerald-500' : 'bg-red-400'
                          )} />
                          <span className="flex-1 truncate">{label}</span>
                          <span className={cn(
                            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0',
                            allowed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                          )}>
                            {allowed ? 'Allow' : 'Block'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400">
            {isDirty ? (
              <span className="text-amber-600 font-medium">Unsaved changes</span>
            ) : (
              'Click toggles to allow or block HR actions'
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 px-4 py-2 text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function HRActionsControlTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  const { data: res, isLoading } = useGetEmployeesQuery({ page, limit: 20, search: search || undefined });
  const employees = res?.data || [];

  return (
    <div className="layer-card p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
          <Shield size={18} className="text-red-600" />
        </div>
        <div>
          <h2 className="text-lg font-display font-semibold text-gray-800">HR Action Controls</h2>
          <p className="text-xs text-gray-500">Control which actions HR can perform on individual employees across all modules</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl mb-5">
        <Info size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          Click any employee to open their control panel. Toggle each action to <strong>Allow</strong> or <strong>Block</strong> HR.
          These restrictions apply to <strong>all HR accounts</strong> in the organization.
          <br /><span className="text-amber-600 font-medium">18 actions across 6 categories: Shift &amp; Profile · Payroll · Attendance · KYC · Offboarding · Account Access</span>
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search employees..."
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:ring-1 focus:ring-brand-300 focus:border-brand-400"
        />
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && employees.length === 0 && (
        <div className="text-center py-12">
          <Shield size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No employees found</p>
        </div>
      )}

      {/* Employee list */}
      <div className="space-y-2">
        {employees.map((emp: any) => (
          <EmployeeRow key={emp.id} employee={emp} onSelect={() => setSelectedEmployee(emp)} />
        ))}
      </div>

      {/* Pagination */}
      {res?.meta && res.meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400">{res.meta.total} employees</p>
          <div className="flex gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 disabled:opacity-40 hover:bg-gray-50">
              Prev
            </button>
            <button disabled={page >= res.meta.totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 disabled:opacity-40 hover:bg-gray-50">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {selectedEmployee && (
        <EmployeeRestrictionsModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
        />
      )}
    </div>
  );
}

// ─── Row (summary only) ───────────────────────────────────────────────────────

function EmployeeRow({ employee, onSelect }: { employee: any; onSelect: () => void }) {
  const { data: restrictionRes } = useGetHRRestrictionsQuery(employee.id);
  const current = restrictionRes?.data;

  const blockedCount = current
    ? ALL_KEYS.filter(k => current[k] === false).length
    : 0;

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:border-brand-200 hover:bg-brand-50/30 transition-all text-left group"
    >
      <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0 overflow-hidden">
        {employee.avatar
          ? <img src={getUploadUrl(employee.avatar)} alt="" className="w-full h-full object-cover" />
          : getInitials(`${employee.firstName} ${employee.lastName}`)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{employee.firstName} {employee.lastName}</p>
        <p className="text-xs text-gray-400">{employee.employeeCode} · {employee.user?.role || 'EMPLOYEE'}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {blockedCount > 0 ? (
          <span className="text-[10px] font-bold px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">
            {blockedCount} blocked
          </span>
        ) : (
          <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
            All allowed
          </span>
        )}
        <ChevronRight size={14} className="text-gray-300 group-hover:text-brand-400 transition-colors" />
      </div>
    </button>
  );
}
