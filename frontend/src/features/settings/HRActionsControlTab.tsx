import { useState } from 'react';
import { Shield, Search, Loader2, Save, Info } from 'lucide-react';
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
      { key: 'canHRResetPassword', label: 'Reset Password', description: 'HR can reset this employee\'s login password' },
    ],
  },
];

const ALL_KEYS = RESTRICTION_GROUPS.flatMap(g => g.items.map(i => i.key));

const DEFAULT_VALUES: RestrictionValues = Object.fromEntries(ALL_KEYS.map(k => [k, true]));

const GROUP_COLOR_STYLES: Record<string, { header: string; dot: string }> = {
  indigo: { header: 'text-indigo-700 bg-indigo-50', dot: 'bg-indigo-400' },
  green: { header: 'text-emerald-700 bg-emerald-50', dot: 'bg-emerald-400' },
  blue: { header: 'text-blue-700 bg-blue-50', dot: 'bg-blue-400' },
  purple: { header: 'text-purple-700 bg-purple-50', dot: 'bg-purple-400' },
  orange: { header: 'text-orange-700 bg-orange-50', dot: 'bg-orange-400' },
  red: { header: 'text-red-700 bg-red-50', dot: 'bg-red-400' },
};

function EmployeeRestrictionRow({ employee }: { employee: any }) {
  const { data: restrictionRes, isLoading } = useGetHRRestrictionsQuery(employee.id);
  const [setRestrictions, { isLoading: saving }] = useSetHRRestrictionsMutation();
  const [localValues, setLocalValues] = useState<RestrictionValues | null>(null);

  const current = restrictionRes?.data ?? null;
  const values: RestrictionValues = localValues ?? (current
    ? Object.fromEntries(ALL_KEYS.map(k => [k, current[k] ?? true]))
    : DEFAULT_VALUES
  );

  const blockedCount = Object.values(values).filter(v => !v).length;

  const toggle = (key: string) => {
    setLocalValues(prev => {
      const base = prev ?? { ...values };
      return { ...base, [key]: !base[key] };
    });
  };

  const handleSave = async () => {
    try {
      await setRestrictions({ employeeId: employee.id, restrictions: values }).unwrap();
      toast.success(`Restrictions updated for ${employee.firstName} ${employee.lastName}`);
      setLocalValues(null);
    } catch {
      toast.error('Failed to save restrictions');
    }
  };

  const isDirty = localValues !== null;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* Employee header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
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
          {blockedCount > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">
              {blockedCount} blocked
            </span>
          )}
          {blockedCount === 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
              All allowed
            </span>
          )}
          {isDirty && (
            <button
              onClick={e => { e.stopPropagation(); handleSave(); }}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              Save
            </button>
          )}
          <span className="text-gray-300 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            RESTRICTION_GROUPS.map(group => {
              const colorStyle = GROUP_COLOR_STYLES[group.color];
              return (
                <div key={group.label}>
                  <div className={cn('inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2', colorStyle.header)}>
                    <div className={cn('w-1.5 h-1.5 rounded-full', colorStyle.dot)} />
                    {group.label.toUpperCase()}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {group.items.map(({ key, label, description }) => {
                      const allowed = values[key] ?? true;
                      return (
                        <button
                          key={key}
                          onClick={() => toggle(key)}
                          title={description}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all text-left',
                            allowed
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                          )}
                        >
                          <div className={cn('w-2 h-2 rounded-full flex-shrink-0', allowed ? 'bg-emerald-500' : 'bg-red-400')} />
                          <span className="truncate">{label}</span>
                          <span className="ml-auto text-[10px] font-normal opacity-70">{allowed ? 'Allow' : 'Block'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function HRActionsControlTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: res, isLoading } = useGetEmployeesQuery({ page, limit: 20, search: search || undefined });
  const employees = res?.data || [];

  return (
    <div className="layer-card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
          <Shield size={18} className="text-red-600" />
        </div>
        <div>
          <h2 className="text-lg font-display font-semibold text-gray-800">HR Action Controls</h2>
          <p className="text-xs text-gray-500">Control which actions HR can perform on individual employees across all modules</p>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl mb-5">
        <Info size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          Click an employee to expand their controls. Toggle each action to <strong>Allow</strong> or <strong>Block</strong> HR from performing it.
          Click <strong>Save</strong> after making changes. Restrictions apply to all HR accounts in the organization.
          <br />
          <span className="text-amber-600">18 actions across 6 categories: Shift &amp; Profile, Payroll, Attendance, KYC, Offboarding, Account Access.</span>
        </p>
      </div>

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

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && employees.length === 0 && (
        <div className="text-center py-12">
          <Shield size={28} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No employees found</p>
        </div>
      )}

      <div className="space-y-3">
        {employees.map((emp: any) => (
          <EmployeeRestrictionRow key={emp.id} employee={emp} />
        ))}
      </div>

      {res?.meta && res.meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400">{res.meta.total} employees</p>
          <div className="flex gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 disabled:opacity-40 hover:bg-gray-50"
            >
              Prev
            </button>
            <button
              disabled={page >= res.meta.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
