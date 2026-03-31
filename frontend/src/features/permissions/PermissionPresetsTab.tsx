import { useState, useEffect } from 'react';
import { Shield, Save, Loader2, RotateCcw } from 'lucide-react';
import { useGetPresetsQuery, useUpsertPresetMutation } from './permissionsApi';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';

const PERMISSION_FIELDS = [
  { key: 'canMarkAttendance', label: 'Mark Attendance', description: 'Clock in/out' },
  { key: 'canViewAttendanceHistory', label: 'View Attendance', description: 'View own attendance history' },
  { key: 'canApplyLeaves', label: 'Apply Leaves', description: 'Submit leave requests' },
  { key: 'canViewLeaveBalance', label: 'View Leave Balance', description: 'See remaining leave days' },
  { key: 'canViewPayslips', label: 'View Payslips', description: 'Access salary slips' },
  { key: 'canDownloadPayslips', label: 'Download Payslips', description: 'Download salary slip PDFs' },
  { key: 'canViewDocuments', label: 'View Documents', description: 'Access My Documents page' },
  { key: 'canDownloadDocuments', label: 'Download Documents', description: 'Download document files' },
  { key: 'canViewDashboardStats', label: 'View Dashboard', description: 'See dashboard statistics' },
  { key: 'canViewAnnouncements', label: 'View Announcements', description: 'Read company announcements' },
  { key: 'canViewPolicies', label: 'View Policies', description: 'Read company policies' },
  { key: 'canRaiseHelpdeskTickets', label: 'Raise Tickets', description: 'Create helpdesk tickets' },
  { key: 'canViewOrgChart', label: 'View Org Chart', description: 'See organization hierarchy' },
  { key: 'canViewPerformance', label: 'View Performance', description: 'Access performance reviews' },
  { key: 'canViewEditProfile', label: 'View/Edit Profile', description: 'Access own profile page' },
] as const;

type PermissionKey = typeof PERMISSION_FIELDS[number]['key'];
type PermState = Record<PermissionKey, boolean>;

const ROLES = ['EMPLOYEE', 'MANAGER', 'INTERN'] as const;

const ROLE_COLORS: Record<string, { bg: string; border: string; badge: string }> = {
  EMPLOYEE: { bg: 'bg-blue-50/50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  MANAGER: { bg: 'bg-purple-50/50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
  INTERN: { bg: 'bg-amber-50/50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
};

function allAllowed(): PermState {
  const state: Record<string, boolean> = {};
  PERMISSION_FIELDS.forEach(f => { state[f.key] = true; });
  return state as PermState;
}

function parsePreset(preset: any): PermState {
  const state: Record<string, boolean> = {};
  PERMISSION_FIELDS.forEach(f => {
    state[f.key] = preset?.[f.key] ?? true;
  });
  return state as PermState;
}

export default function PermissionPresetsTab() {
  const { data: presetsRes, isLoading } = useGetPresetsQuery();
  const [upsertPreset] = useUpsertPresetMutation();

  const [roleStates, setRoleStates] = useState<Record<string, PermState>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);

  useEffect(() => {
    if (presetsRes?.data) {
      const presets = presetsRes.data;
      const states: Record<string, PermState> = {};
      ROLES.forEach(role => {
        const existing = Array.isArray(presets)
          ? presets.find((p: any) => p.role === role)
          : presets[role];
        states[role] = existing ? parsePreset(existing) : allAllowed();
      });
      setRoleStates(states);
    } else {
      const states: Record<string, PermState> = {};
      ROLES.forEach(role => { states[role] = allAllowed(); });
      setRoleStates(states);
    }
  }, [presetsRes]);

  const handleToggle = (role: string, key: PermissionKey) => {
    setRoleStates(prev => ({
      ...prev,
      [role]: { ...prev[role], [key]: !prev[role][key] },
    }));
  };

  const handleReset = (role: string) => {
    setRoleStates(prev => ({ ...prev, [role]: allAllowed() }));
  };

  const handleSave = async (role: string) => {
    setSavingRole(role);
    try {
      await upsertPreset({ role, ...roleStates[role] }).unwrap();
      toast.success(`${role} permission preset saved`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save preset');
    } finally {
      setSavingRole(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-gray-400 mr-2" />
        <span className="text-sm text-gray-400">Loading permission presets...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <Shield size={22} className="text-brand-600" />
        <h2 className="text-xl font-display font-bold text-gray-900">Employee Permission Control</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6 ml-[34px]">
        Set default feature access per role. Employees inherit these unless overridden individually.
      </p>

      {/* Role Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {ROLES.map(role => {
          const colors = ROLE_COLORS[role];
          const state = roleStates[role];
          if (!state) return null;

          return (
            <div key={role} className={cn('layer-card p-5 border', colors.border, colors.bg)}>
              {/* Role Header */}
              <div className="flex items-center justify-between mb-4">
                <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', colors.badge)}>
                  {role}
                </span>
                <button
                  onClick={() => handleReset(role)}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
                >
                  <RotateCcw size={12} />
                  Reset to All Allowed
                </button>
              </div>

              {/* Permission Toggles */}
              <div className="space-y-1.5 mb-5">
                {PERMISSION_FIELDS.map(field => (
                  <label
                    key={field.key}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 hover:bg-white/60 cursor-pointer transition-colors"
                  >
                    <div className="pr-3">
                      <p className="text-sm font-medium text-gray-800 leading-tight">{field.label}</p>
                      <p className="text-[11px] text-gray-400 leading-tight">{field.description}</p>
                    </div>
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={state[field.key]}
                        onChange={() => handleToggle(role, field.key)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-brand-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                    </div>
                  </label>
                ))}
              </div>

              {/* Save Button */}
              <button
                onClick={() => handleSave(role)}
                disabled={savingRole === role}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm"
              >
                {savingRole === role ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save Preset
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
