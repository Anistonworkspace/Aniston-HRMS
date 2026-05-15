import { useState, useEffect } from 'react';
import { Shield, Save, Loader2, XCircle } from 'lucide-react';
import { useGetExitAccessConfigQuery, useSaveExitAccessConfigMutation, useRevokeExitAccessMutation } from './exitApi';
import toast from 'react-hot-toast';

interface Props {
  employeeId: string;
  exitStatus: string;
}

const ACCESS_TOGGLES = [
  { key: 'canViewDashboard', label: 'View Dashboard', description: 'Access the main dashboard' },
  { key: 'canViewPayslips', label: 'View Payslips', description: 'View salary slips and payroll details' },
  { key: 'canDownloadPayslips', label: 'Download Payslips', description: 'Download salary slip PDFs' },
  { key: 'canViewAttendance', label: 'View Attendance', description: 'View own attendance records' },
  { key: 'canMarkAttendance', label: 'Mark Attendance', description: 'Clock in/out for attendance' },
  { key: 'canApplyLeave', label: 'Apply for Leave', description: 'Submit new leave requests' },
  { key: 'canViewLeaveBalance', label: 'View Leave Balance', description: 'View remaining leave balance' },
  { key: 'canViewDocuments', label: 'View Documents', description: 'View uploaded documents' },
  { key: 'canDownloadDocuments', label: 'Download Documents', description: 'Download document files' },
  { key: 'canViewHelpdesk', label: 'View Helpdesk', description: 'View support tickets' },
  { key: 'canCreateTicket', label: 'Create Ticket', description: 'Submit new support tickets' },
  { key: 'canViewAnnouncements', label: 'View Announcements', description: 'Read company announcements' },
  { key: 'canViewProfile', label: 'View Profile', description: 'Access own profile page' },
];

export default function ExitAccessConfig({ employeeId, exitStatus }: Props) {
  const { data: configRes, isLoading } = useGetExitAccessConfigQuery(employeeId);
  const [saveConfig, { isLoading: saving }] = useSaveExitAccessConfigMutation();
  const [revokeAccess, { isLoading: revoking }] = useRevokeExitAccessMutation();

  const [config, setConfig] = useState<Record<string, any>>({});
  const [expiryDate, setExpiryDate] = useState('');

  useEffect(() => {
    if (configRes?.data) {
      const c = configRes.data;
      const newConfig: Record<string, any> = {};
      ACCESS_TOGGLES.forEach(t => { newConfig[t.key] = c[t.key] ?? false; });
      setConfig(newConfig);
      if (c.accessExpiresAt) {
        setExpiryDate(new Date(c.accessExpiresAt).toISOString().split('T')[0]);
      }
    } else {
      // Default config
      const defaults: Record<string, boolean> = {};
      ACCESS_TOGGLES.forEach(t => {
        defaults[t.key] = ['canViewPayslips', 'canDownloadPayslips', 'canViewDocuments', 'canDownloadDocuments', 'canViewProfile'].includes(t.key);
      });
      setConfig(defaults);
    }
  }, [configRes]);

  const handleToggle = (key: string) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    try {
      await saveConfig({
        employeeId,
        body: {
          ...config,
          accessExpiresAt: expiryDate ? new Date(expiryDate).toISOString() : null,
        },
      }).unwrap();
      toast.success('Exit access configuration saved');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save');
    }
  };

  const handleRevoke = async () => {
    if (!confirm('Revoke all access? The employee will no longer be able to log in.')) return;
    try {
      await revokeAccess(employeeId).unwrap();
      toast.success('Access revoked — employee deactivated');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to revoke');
    }
  };

  // Only show for approved/completed exits
  if (!['APPROVED', 'NO_DUES_PENDING', 'COMPLETED'].includes(exitStatus)) return null;

  if (isLoading) {
    return (
      <div className="layer-card p-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Loading access config...
        </div>
      </div>
    );
  }

  return (
    <div className="layer-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={20} style={{ color: 'var(--primary-color)' }} />
          <h2 className="text-lg font-display font-semibold text-gray-800">Exit Access Control</h2>
        </div>
        {configRes?.data?.isActive && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Active
          </span>
        )}
      </div>

      <p className="text-xs text-gray-400 mb-4">
        Configure which features the exiting employee can access. By default, only payslip and document access is enabled.
      </p>

      {/* Access Toggles */}
      <div className="space-y-2 mb-6">
        {ACCESS_TOGGLES.map(toggle => (
          <label key={toggle.key} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
            <div>
              <p className="text-sm font-medium text-gray-800">{toggle.label}</p>
              <p className="text-xs text-gray-400">{toggle.description}</p>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={config[toggle.key] || false}
                onChange={() => handleToggle(toggle.key)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" style={{ ...(config[toggle.key] ? { background: 'var(--primary-color)' } : {}) }} />
            </div>
          </label>
        ))}
      </div>

      {/* Access Expiry */}
      <div className="mb-6">
        <label className="text-xs text-gray-500 mb-1 block">Access Expires On (optional)</label>
        <input
          type="date"
          value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)}
          className="input-glass text-sm w-full"
          min={new Date().toISOString().split('T')[0]}
        />
        <p className="text-[10px] text-gray-400 mt-1">Leave empty for no expiration (until manually revoked)</p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Access Config
        </button>
        {configRes?.data?.isActive && (
          <button onClick={handleRevoke} disabled={revoking} className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-600 border border-red-200 hover:bg-red-50 text-sm transition-colors">
            {revoking ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}
