import { useState, useEffect } from 'react';
import { Shield, Save, Loader2, RotateCcw } from 'lucide-react';
import { useGetOverrideQuery, useUpsertOverrideMutation, useDeleteOverrideMutation } from './permissionsApi';
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

// null = inherit, true = allow, false = deny
type TriState = boolean | null;
type OverrideState = Record<PermissionKey, TriState>;

interface Props {
  employeeId: string;
}

function defaultOverrides(): OverrideState {
  const state: Record<string, TriState> = {};
  PERMISSION_FIELDS.forEach(f => { state[f.key] = null; });
  return state as OverrideState;
}

export default function PermissionOverridePanel({ employeeId }: Props) {
  const { data: overrideRes, isLoading } = useGetOverrideQuery(employeeId);
  const [upsertOverride, { isLoading: saving }] = useUpsertOverrideMutation();
  const [deleteOverride, { isLoading: resetting }] = useDeleteOverrideMutation();

  const [overrides, setOverrides] = useState<OverrideState>(defaultOverrides());

  useEffect(() => {
    if (overrideRes?.data) {
      const data = overrideRes.data;
      const state: Record<string, TriState> = {};
      PERMISSION_FIELDS.forEach(f => {
        const val = data[f.key];
        state[f.key] = val === true ? true : val === false ? false : null;
      });
      setOverrides(state as OverrideState);
    } else {
      setOverrides(defaultOverrides());
    }
  }, [overrideRes]);

  const handleChange = (key: PermissionKey, value: TriState) => {
    setOverrides(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      await upsertOverride({ employeeId, body: overrides }).unwrap();
      toast.success('Permission overrides saved');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save overrides');
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all overrides? This employee will inherit permissions from their role preset.')) return;
    try {
      await deleteOverride(employeeId).unwrap();
      setOverrides(defaultOverrides());
      toast.success('Overrides cleared — using role defaults');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to reset overrides');
    }
  };

  if (isLoading) {
    return (
      <div className="layer-card p-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading permission overrides...
        </div>
      </div>
    );
  }

  return (
    <div className="layer-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Shield size={20} style={{ color: 'var(--primary-color)' }} />
          <h2 className="text-lg font-display font-semibold text-gray-800">Permission Overrides</h2>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-5 ml-7">
        Override role defaults for this employee. Gray = inherit from role preset.
      </p>

      {/* Override Rows */}
      <div className="space-y-2 mb-6">
        {PERMISSION_FIELDS.map(field => {
          const value = overrides[field.key];

          return (
            <div
              key={field.key}
              className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50/50 transition-colors"
            >
              <div className="pr-4">
                <p className="text-sm font-medium text-gray-800 leading-tight">{field.label}</p>
                <p className="text-[11px] text-gray-400 leading-tight">{field.description}</p>
              </div>

              {/* 3-state selector */}
              <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleChange(field.key, null)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    value === null
                      ? 'bg-gray-200 text-gray-700'
                      : 'bg-white text-gray-400 hover:bg-gray-50'
                  )}
                >
                  Inherit
                </button>
                <button
                  type="button"
                  onClick={() => handleChange(field.key, true)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200',
                    value === true
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-white text-gray-400 hover:bg-gray-50'
                  )}
                >
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => handleChange(field.key, false)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200',
                    value === false
                      ? 'bg-red-100 text-red-700'
                      : 'bg-white text-gray-400 hover:bg-gray-50'
                  )}
                >
                  Deny
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Overrides
        </button>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-gray-600 border border-gray-200 hover:bg-gray-50 text-sm transition-colors"
        >
          {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Reset to Role Defaults
        </button>
      </div>
    </div>
  );
}
