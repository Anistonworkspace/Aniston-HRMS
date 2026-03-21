import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Building2, MapPin, Shield, Server, Clock, Save, Loader2 } from 'lucide-react';
import { api } from '../../app/api';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getOrgSettings: builder.query<any, void>({ query: () => '/settings/organization' }),
    updateOrg: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/organization', method: 'PATCH', body }),
    }),
    getLocations: builder.query<any, void>({ query: () => '/settings/locations' }),
    createLocation: builder.mutation<any, any>({
      query: (body) => ({ url: '/settings/locations', method: 'POST', body }),
    }),
    getAuditLogs: builder.query<any, { page?: number; entity?: string }>({
      query: (params) => ({ url: '/settings/audit-logs', params }),
    }),
    getSystemInfo: builder.query<any, void>({ query: () => '/settings/system' }),
  }),
});

const { useGetOrgSettingsQuery, useUpdateOrgMutation, useGetLocationsQuery, useGetAuditLogsQuery, useGetSystemInfoQuery } = settingsApi;

type Tab = 'organization' | 'locations' | 'audit' | 'system';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('organization');

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'organization', label: 'Organization', icon: Building2 },
    { key: 'locations', label: 'Office Locations', icon: MapPin },
    { key: 'audit', label: 'Audit Logs', icon: Shield },
    { key: 'system', label: 'System', icon: Server },
  ];

  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">Settings</h1>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <div className="w-56 flex-shrink-0 hidden md:block">
          <div className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left',
                  activeTab === tab.key ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                )}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'organization' && <OrgSettings />}
          {activeTab === 'locations' && <LocationSettings />}
          {activeTab === 'audit' && <AuditLogs />}
          {activeTab === 'system' && <SystemInfo />}
        </div>
      </div>
    </div>
  );
}

function OrgSettings() {
  const { data: res } = useGetOrgSettingsQuery();
  const [updateOrg, { isLoading }] = useUpdateOrgMutation();
  const org = res?.data;
  const [form, setForm] = useState({ name: '', timezone: '', currency: '', fiscalYear: '' });

  useState(() => {
    if (org) setForm({ name: org.name, timezone: org.timezone, currency: org.currency, fiscalYear: org.fiscalYear });
  });

  const handleSave = async () => {
    try {
      await updateOrg(form).unwrap();
      toast.success('Organization settings saved');
    } catch { toast.error('Failed to save'); }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-6">Organization Settings</h2>
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Company Name</label>
          <input value={form.name || org?.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-glass w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Timezone</label>
            <select value={form.timezone || org?.timezone || ''} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="input-glass w-full">
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Currency</label>
            <select value={form.currency || org?.currency || ''} onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="input-glass w-full">
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Fiscal Year</label>
          <select value={form.fiscalYear || org?.fiscalYear || ''} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
            className="input-glass w-full">
            <option value="APRIL_MARCH">April - March</option>
            <option value="JANUARY_DECEMBER">January - December</option>
          </select>
        </div>

        {org && (
          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Employees: <strong>{org._count?.employees || 0}</strong> ·
              Departments: <strong>{org._count?.departments || 0}</strong> ·
              Designations: <strong>{org._count?.designations || 0}</strong>
            </p>
          </div>
        )}

        <button onClick={handleSave} disabled={isLoading}
          className="btn-primary flex items-center gap-2">
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

function LocationSettings() {
  const { data: res } = useGetLocationsQuery();
  const locations = res?.data || [];

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">Office Locations</h2>
      {locations.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No locations configured</p>
      ) : (
        <div className="space-y-3">
          {locations.map((loc: any) => (
            <div key={loc.id} className="flex items-center justify-between p-4 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-3">
                <MapPin size={18} className="text-brand-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{loc.name}</p>
                  <p className="text-xs text-gray-400">{loc.address} · {loc.city}, {loc.country}</p>
                </div>
              </div>
              <span className="text-xs text-gray-400 font-mono" data-mono>{loc._count?.employees || 0} employees</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AuditLogs() {
  const { data: res } = useGetAuditLogsQuery({ page: 1 });
  const logs = res?.data || [];

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">Audit Logs</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No audit logs yet</p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
          {logs.map((log: any) => (
            <div key={log.id} className="flex items-start gap-3 py-2.5 px-3 hover:bg-surface-2 rounded-lg text-sm">
              <div className="w-2 h-2 rounded-full bg-brand-400 mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-gray-700">
                  <span className="font-medium">{log.user?.email}</span> {log.action.toLowerCase()} {log.entity}
                </p>
                <p className="text-xs text-gray-400 font-mono mt-0.5" data-mono>
                  {new Date(log.createdAt).toLocaleString('en-IN')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemInfo() {
  const { data: res } = useGetSystemInfoQuery();
  const sys = res?.data;

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-4">System Information</h2>
      {sys ? (
        <div className="grid grid-cols-2 gap-4">
          <InfoBox label="Version" value={sys.version} />
          <InfoBox label="Node.js" value={sys.nodeVersion} />
          <InfoBox label="Uptime" value={`${Math.floor(sys.uptime / 3600)}h ${Math.floor((sys.uptime % 3600) / 60)}m`} />
          <InfoBox label="Platform" value={sys.platform} />
          <InfoBox label="Memory (RSS)" value={`${Math.round(sys.memoryUsage.rss / 1024 / 1024)} MB`} />
          <InfoBox label="Heap Used" value={`${Math.round(sys.memoryUsage.heapUsed / 1024 / 1024)} MB`} />
        </div>
      ) : (
        <p className="text-sm text-gray-400">Loading...</p>
      )}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-mono font-medium text-gray-800 mt-0.5" data-mono>{value}</p>
    </div>
  );
}
