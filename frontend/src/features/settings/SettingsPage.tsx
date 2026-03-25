import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Building2, MapPin, Shield, Server, Clock, Save, Loader2, Plus, Pencil, Trash2, X, Mail, CheckCircle2, AlertTriangle, Send, Cloud, Eye, EyeOff, Users } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});
import { useGetOrgSettingsQuery, useUpdateOrgMutation, useGetLocationsQuery as useGetSettingsLocationsQuery, useGetAuditLogsQuery, useGetSystemInfoQuery, useGetEmailConfigQuery, useSaveEmailConfigMutation, useTestEmailConnectionMutation, useGetTeamsConfigQuery, useSaveTeamsConfigMutation, useTestTeamsConnectionMutation, useSyncTeamsEmployeesMutation } from './settingsApi';
import { useGetShiftsQuery, useCreateShiftMutation, useUpdateShiftMutation, useDeleteShiftMutation, useGetLocationsQuery, useCreateLocationMutation, useDeleteLocationMutation } from '../workforce/workforceApi';
import { useGetEmployeesQuery, useChangeEmployeeRoleMutation } from '../employee/employeeApi';
import { cn, getInitials } from '../../lib/utils';
import toast from 'react-hot-toast';

type Tab = 'organization' | 'locations' | 'shifts' | 'email' | 'teams' | 'roles' | 'audit' | 'system';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('organization');

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'organization', label: 'Organization', icon: Building2 },
    { key: 'locations', label: 'Office Locations', icon: MapPin },
    { key: 'shifts', label: 'Shifts & Rosters', icon: Clock },
    { key: 'email', label: 'Email Configuration', icon: Mail },
    { key: 'teams', label: 'Microsoft Teams', icon: Cloud },
    { key: 'roles', label: 'User Roles', icon: Users },
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
          {activeTab === 'shifts' && <ShiftSettings />}
          {activeTab === 'email' && <EmailConfig />}
          {activeTab === 'teams' && <TeamsConfig />}
          {activeTab === 'roles' && <UserRolesTab />}
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

  useEffect(() => {
    if (org) setForm({ name: org.name, timezone: org.timezone, currency: org.currency, fiscalYear: org.fiscalYear });
  }, [org]);

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

function MapClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function LocationSettings() {
  const { data: res } = useGetLocationsQuery();
  const locations = res?.data || [];
  const [createLocation, { isLoading: creating }] = useCreateLocationMutation();
  const [deleteLocation] = useDeleteLocationMutation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '', state: '', latitude: '', longitude: '', radiusMeters: 200, strictMode: false });

  const handleCreate = async () => {
    if (!form.name || !form.address || !form.city || !form.latitude || !form.longitude) {
      toast.error('Fill all required fields'); return;
    }
    try {
      await createLocation({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) }).unwrap();
      toast.success('Location created');
      setShowForm(false);
      setForm({ name: '', address: '', city: '', state: '', latitude: '', longitude: '', radiusMeters: 200, strictMode: false });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try { await deleteLocation(id).unwrap(); toast.success('Deleted'); } catch { toast.error('Failed'); }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-semibold text-gray-800">Office Locations & Geofence</h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add Location
        </button>
      </div>

      {showForm && (
        <div className="bg-surface-2 rounded-xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-glass w-full text-sm" placeholder="Main Office" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">City *</label>
              <input value={form.city} onChange={e => setForm({...form, city: e.target.value})} className="input-glass w-full text-sm" placeholder="New Delhi" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Address *</label>
            <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="input-glass w-full text-sm" placeholder="123, Business Park, Sector 62" />
          </div>
          {/* Interactive Map */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Click map to set location (or enter coordinates below)</label>
            <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 250 }}>
              <MapContainer
                center={[form.latitude ? Number(form.latitude) : 28.6139, form.longitude ? Number(form.longitude) : 77.2090]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                <MapClickHandler onLocationSelect={(lat, lng) => setForm({...form, latitude: String(lat.toFixed(6)), longitude: String(lng.toFixed(6))})} />
                {form.latitude && form.longitude && (
                  <>
                    <Marker position={[Number(form.latitude), Number(form.longitude)]} />
                    <Circle center={[Number(form.latitude), Number(form.longitude)]} radius={form.radiusMeters} pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.15 }} />
                  </>
                )}
              </MapContainer>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Latitude *</label>
              <input type="number" step="any" value={form.latitude} onChange={e => setForm({...form, latitude: e.target.value})} className="input-glass w-full text-sm" placeholder="28.6139" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Longitude *</label>
              <input type="number" step="any" value={form.longitude} onChange={e => setForm({...form, longitude: e.target.value})} className="input-glass w-full text-sm" placeholder="77.2090" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Radius (meters)</label>
              <input type="number" value={form.radiusMeters} onChange={e => setForm({...form, radiusMeters: Number(e.target.value)})} className="input-glass w-full text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={form.strictMode} onChange={e => setForm({...form, strictMode: e.target.checked})} className="rounded border-gray-300" />
              Strict mode (block clock-in outside geofence)
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm">{creating ? 'Creating...' : 'Create Location'}</button>
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Map showing all existing geofences */}
      {locations.length > 0 && (
        <div className="rounded-xl overflow-hidden border border-gray-200 mb-4" style={{ height: 220 }}>
          <MapContainer
            center={[
              (locations[0]?.geofence?.coordinates as any)?.lat || 28.6139,
              (locations[0]?.geofence?.coordinates as any)?.lng || 77.2090,
            ]}
            zoom={11}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
            {locations.map((loc: any) => {
              const coords = loc.geofence?.coordinates as any;
              if (!coords?.lat || !coords?.lng) return null;
              return (
                <span key={loc.id}>
                  <Marker position={[coords.lat, coords.lng]} />
                  <Circle center={[coords.lat, coords.lng]} radius={loc.geofence?.radiusMeters || 200}
                    pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.15 }} />
                </span>
              );
            })}
          </MapContainer>
        </div>
      )}

      {locations.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400 text-center py-8">No locations configured. Add your first office location.</p>
      ) : (
        <div className="space-y-3">
          {locations.map((loc: any) => (
            <div key={loc.id} className="flex items-center justify-between p-4 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-3">
                <MapPin size={18} className="text-brand-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{loc.name}</p>
                  <p className="text-xs text-gray-400">{loc.address} · {loc.city}</p>
                  {loc.geofence && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Geofence: {loc.geofence.radiusMeters}m radius
                      {loc.geofence.strictMode ? ' · Strict' : ''}
                      {` · ${(loc.geofence.coordinates as any)?.lat?.toFixed(4)}, ${(loc.geofence.coordinates as any)?.lng?.toFixed(4)}`}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => handleDelete(loc.id, loc.name)} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftSettings() {
  const { data: res } = useGetShiftsQuery();
  const shifts = res?.data || [];
  const [createShift, { isLoading: creating }] = useCreateShiftMutation();
  const [deleteShift] = useDeleteShiftMutation();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, isDefault: false });

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('Name and code are required'); return; }
    try {
      await createShift(form).unwrap();
      toast.success('Shift created');
      setShowForm(false);
      setForm({ name: '', code: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, isDefault: false });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deactivate shift "${name}"?`)) return;
    try { await deleteShift(id).unwrap(); toast.success('Shift deactivated'); } catch { toast.error('Failed'); }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-semibold text-gray-800">Shifts & Rosters</h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add Shift
        </button>
      </div>

      {showForm && (
        <div className="bg-surface-2 rounded-xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Shift Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-glass w-full text-sm" placeholder="Morning Shift" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Code *</label>
              <input value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} className="input-glass w-full text-sm" placeholder="MORNING" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Start Time</label>
              <input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">End Time</label>
              <input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Grace (min)</label>
              <input type="number" value={form.graceMinutes} onChange={e => setForm({...form, graceMinutes: Number(e.target.value)})} className="input-glass w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Full Day (hrs)</label>
              <input type="number" value={form.fullDayHours} onChange={e => setForm({...form, fullDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm({...form, isDefault: e.target.checked})} className="rounded border-gray-300" />
            Set as default shift
          </label>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm">{creating ? 'Creating...' : 'Create Shift'}</button>
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {shifts.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400 text-center py-8">No shifts configured. Create your first shift.</p>
      ) : (
        <div className="space-y-3">
          {shifts.map((shift: any) => (
            <div key={shift.id} className="flex items-center justify-between p-4 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-3">
                <Clock size={18} className="text-brand-500" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-800">{shift.name}</p>
                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500" data-mono>{shift.code}</span>
                    {shift.isDefault && <span className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">Default</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {shift.startTime} — {shift.endTime} · Grace: {shift.graceMinutes}min · Full day: {Number(shift.fullDayHours)}hrs
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{shift._count?.assignments || 0} assigned</span>
                <button onClick={() => handleDelete(shift.id, shift.name)} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmailConfig() {
  const { data: res, refetch } = useGetEmailConfigQuery();
  const [saveConfig, { isLoading: saving }] = useSaveEmailConfigMutation();
  const [testConnection, { isLoading: testing }] = useTestEmailConnectionMutation();
  const config = res?.data;
  const [form, setForm] = useState({ host: '', port: 587, user: '', pass: '', fromAddress: '', fromName: '', emailDomain: '' });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (config) {
      setForm({
        host: config.host || '',
        port: config.port || 587,
        user: config.user || '',
        pass: '',
        fromAddress: config.fromAddress || '',
        fromName: config.fromName || '',
        emailDomain: config.emailDomain || '',
      });
    }
  }, [config]);

  const handleSave = async () => {
    if (!form.host || !form.user) { toast.error('SMTP host and username required'); return; }
    try {
      const payload = { ...form };
      if (!payload.pass && config?.hasPassword) {
        delete (payload as any).pass; // Don't overwrite existing password if not changed
      }
      await saveConfig(payload).unwrap();
      toast.success('Email configuration saved');
      refetch();
      setTestResult(null);
    } catch { toast.error('Failed to save'); }
  };

  const handleTest = async () => {
    try {
      const result = await testConnection().unwrap();
      setTestResult(result.data);
      if (result.data?.success) toast.success('Connection successful!');
      else toast.error(result.data?.message || 'Connection failed');
    } catch { setTestResult({ success: false, message: 'Test failed — check your settings' }); }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-2">Email Configuration</h2>
      <p className="text-sm text-gray-400 mb-6">Configure SMTP settings for sending invitation emails, notifications, and password resets.</p>

      {/* Status indicator */}
      {config && (
        <div className={cn('flex items-center gap-2 p-3 rounded-lg mb-6 text-sm',
          config.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        )}>
          {config.configured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {config.configured
            ? 'Email is configured. Invitation emails will be sent via SMTP.'
            : 'Email not configured. Invitations will be logged to console only.'}
        </div>
      )}

      <div className="space-y-4 max-w-lg">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-600 mb-1">SMTP Host *</label>
            <input value={form.host} onChange={e => setForm({...form, host: e.target.value})}
              className="input-glass w-full text-sm" placeholder="smtp.office365.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Port</label>
            <input type="number" value={form.port} onChange={e => setForm({...form, port: Number(e.target.value)})}
              className="input-glass w-full text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Username *</label>
            <input value={form.user} onChange={e => setForm({...form, user: e.target.value})}
              className="input-glass w-full text-sm" placeholder="noreply@company.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Password {config?.hasPassword && <span className="text-xs text-gray-400">(saved, leave blank to keep)</span>}
            </label>
            <input type="password" value={form.pass} onChange={e => setForm({...form, pass: e.target.value})}
              className="input-glass w-full text-sm" placeholder={config?.hasPassword ? '••••••••' : 'SMTP password'} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">From Address</label>
            <input value={form.fromAddress} onChange={e => setForm({...form, fromAddress: e.target.value})}
              className="input-glass w-full text-sm" placeholder="noreply@company.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">From Name</label>
            <input value={form.fromName} onChange={e => setForm({...form, fromName: e.target.value})}
              className="input-glass w-full text-sm" placeholder="Aniston HRMS" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Email Domain (for Teams/Work emails)</label>
          <input value={form.emailDomain} onChange={e => setForm({...form, emailDomain: e.target.value})}
            className="input-glass w-full text-sm max-w-xs" placeholder="@aniston.in" />
          <p className="text-xs text-gray-400 mt-1">Used to auto-suggest work email when hiring new employees (e.g., firstname.lastname@aniston.in)</p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn('flex items-center gap-2 p-3 rounded-lg text-sm',
            testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          )}>
            {testResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {testResult.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Configuration
          </button>
          <button onClick={handleTest} disabled={testing || !config?.configured} className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50">
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Test Connection
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamsConfig() {
  const { data: res, refetch } = useGetTeamsConfigQuery();
  const [saveConfig, { isLoading: saving }] = useSaveTeamsConfigMutation();
  const [testConnection, { isLoading: testing }] = useTestTeamsConnectionMutation();
  const [syncEmployees, { isLoading: syncing }] = useSyncTeamsEmployeesMutation();
  const [syncResult, setSyncResult] = useState<any>(null);
  const config = res?.data;
  const [form, setForm] = useState({ tenantId: '', clientId: '', clientSecret: '', redirectUri: '', ssoEnabled: false });
  const [isEditing, setIsEditing] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const isViewMode = config?.configured && !isEditing && !editingField;

  useEffect(() => {
    if (config) {
      setForm({
        tenantId: config.tenantId || '',
        clientId: config.clientId || '',
        clientSecret: '',
        redirectUri: config.redirectUri || '',
        ssoEnabled: config.ssoEnabled || false,
      });
    }
  }, [config]);

  const handleSave = async () => {
    if (!form.tenantId || !form.clientId) { toast.error('Tenant ID and Client ID are required'); return; }
    if (!form.clientSecret && !config?.hasClientSecret) { toast.error('Client Secret is required'); return; }
    try {
      const payload: any = { tenantId: form.tenantId, clientId: form.clientId, ssoEnabled: form.ssoEnabled, redirectUri: form.redirectUri };
      if (form.clientSecret) payload.clientSecret = form.clientSecret;
      await saveConfig(payload).unwrap();
      toast.success('Microsoft Teams configuration saved');
      refetch();
      setIsEditing(false);
      setForm(f => ({ ...f, clientSecret: '' }));
    } catch { toast.error('Failed to save'); }
  };

  const handleFieldSave = async (field: string) => {
    try {
      const payload: any = { tenantId: form.tenantId, clientId: form.clientId, ssoEnabled: form.ssoEnabled, redirectUri: form.redirectUri };
      if (field === 'clientSecret' && fieldDraft) {
        payload.clientSecret = fieldDraft;
      } else if (field === 'ssoEnabled') {
        payload.ssoEnabled = !form.ssoEnabled;
      } else {
        (payload as any)[field] = fieldDraft;
        setForm(f => ({ ...f, [field]: fieldDraft }));
      }
      await saveConfig(payload).unwrap();
      toast.success('Updated successfully');
      refetch();
      setEditingField(null);
      setFieldDraft('');
    } catch { toast.error('Failed to save'); }
  };

  const startFieldEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setFieldDraft(currentValue);
  };

  const cancelFieldEdit = () => {
    setEditingField(null);
    setFieldDraft('');
  };

  const handleTest = async () => {
    try {
      const result = await testConnection().unwrap();
      if (result.data?.success) toast.success('Connection established!');
      else toast.error(result.data?.message || 'Connection failed');
      refetch();
    } catch { toast.error('Test failed — check your Azure AD settings'); }
  };

  const startEditAll = () => {
    setIsEditing(true);
    setEditingField(null);
    if (config) {
      setForm({
        tenantId: config.tenantId || '',
        clientId: config.clientId || '',
        clientSecret: '',
        redirectUri: config.redirectUri || '',
        ssoEnabled: config.ssoEnabled || false,
      });
    }
  };

  const cancelEditAll = () => {
    setIsEditing(false);
    if (config) {
      setForm({
        tenantId: config.tenantId || '',
        clientId: config.clientId || '',
        clientSecret: '',
        redirectUri: config.redirectUri || '',
        ssoEnabled: config.ssoEnabled || false,
      });
    }
  };

  // ---- Status Banner ----
  const renderStatus = () => {
    if (!config) return null;
    if (config.connectionVerified) {
      const verifiedDate = config.connectionVerifiedAt ? new Date(config.connectionVerifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm bg-emerald-50 text-emerald-700">
          <CheckCircle2 size={16} />
          <span>Connection Established{verifiedDate ? ` — verified ${verifiedDate}` : ''}</span>
        </div>
      );
    }
    if (config.configured) {
      return (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm bg-amber-50 text-amber-700">
          <AlertTriangle size={16} />
          Configuration saved. Click Test Connection to verify.
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm bg-amber-50 text-amber-700">
        <AlertTriangle size={16} />
        Microsoft Teams is not configured. Enter your Azure AD credentials below.
      </div>
    );
  };

  // ---- View Mode Field Row ----
  const renderViewRow = (label: string, field: string, value: string, isMasked?: boolean) => {
    const isFieldEditing = editingField === field;
    return (
      <div key={field} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
          {isFieldEditing ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={field === 'clientSecret' && !showSecret ? 'password' : 'text'}
                  value={fieldDraft}
                  onChange={e => setFieldDraft(e.target.value)}
                  className="input-glass w-full text-sm pr-8"
                  placeholder={isMasked && config?.hasClientSecret ? 'Leave blank to keep existing' : `Enter ${label.toLowerCase()}`}
                  autoFocus
                />
                {field === 'clientSecret' && (
                  <button type="button" onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
              <button onClick={() => handleFieldSave(field)} disabled={saving}
                className="text-emerald-600 hover:text-emerald-700 p-1.5 rounded-lg hover:bg-emerald-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              </button>
              <button onClick={cancelFieldEdit}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium text-gray-800 font-mono truncate" data-mono>
              {isMasked ? (value ? '••••••••••••••••' : '—') : (value || '—')}
            </p>
          )}
        </div>
        {!isFieldEditing && (
          <button onClick={() => startFieldEdit(field, isMasked ? '' : value)}
            className="ml-3 text-gray-400 hover:text-brand-600 p-1.5 rounded-lg hover:bg-brand-50 flex-shrink-0">
            <Pencil size={14} />
          </button>
        )}
      </div>
    );
  };

  // ---- VIEW MODE ----
  if (isViewMode) {
    return (
      <div className="layer-card p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-display font-semibold text-gray-800">Microsoft Teams Integration</h2>
        </div>
        <p className="text-sm text-gray-400 mb-6">Connect your Azure AD / Microsoft 365 tenant to enable SSO login and Teams data sync.</p>

        {renderStatus()}

        <div className="max-w-lg">
          <div className="bg-surface-2 rounded-xl p-4">
            {renderViewRow('Tenant ID', 'tenantId', config.tenantId)}
            {renderViewRow('Client ID (Application ID)', 'clientId', config.clientId)}
            {renderViewRow('Client Secret', 'clientSecret', config.hasClientSecret ? 'configured' : '', true)}
            {renderViewRow('Redirect URI', 'redirectUri', config.redirectUri)}

            {/* SSO toggle row */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Microsoft SSO</p>
                <p className={cn('text-sm font-medium', config.ssoEnabled ? 'text-emerald-600' : 'text-gray-500')}>
                  {config.ssoEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <button onClick={() => handleFieldSave('ssoEnabled')} disabled={saving}
                className="ml-3 text-gray-400 hover:text-brand-600 p-1.5 rounded-lg hover:bg-brand-50 flex-shrink-0">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4">
            <button onClick={handleTest} disabled={testing} className="btn-primary flex items-center gap-2 text-sm">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Test Connection
            </button>
            <button onClick={async () => {
              try {
                const res = await syncEmployees().unwrap();
                setSyncResult(res.data);
                toast.success(res.message || `Imported ${res.data?.imported || 0} employees`);
              } catch (err: any) { toast.error(err?.data?.error?.message || 'Sync failed'); }
            }} disabled={syncing || !config?.connectionVerified}
              className="flex items-center gap-2 text-sm px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Sync Employees from Teams
            </button>
            <button onClick={startEditAll} className="btn-secondary flex items-center gap-2 text-sm">
              <Pencil size={14} />
              Edit All
            </button>
          </div>
          {syncResult && (
            <div className="mt-3 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">
              Sync complete: <strong>{syncResult.imported}</strong> imported, <strong>{syncResult.skipped}</strong> skipped
              {syncResult.errors?.length > 0 && (
                <p className="text-xs text-amber-600 mt-1">{syncResult.errors.length} errors occurred</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- EDIT MODE (full form) ----
  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-2">Microsoft Teams Integration</h2>
      <p className="text-sm text-gray-400 mb-6">Connect your Azure AD / Microsoft 365 tenant to enable SSO login and Teams data sync.</p>

      {renderStatus()}

      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Tenant ID *</label>
          <input value={form.tenantId} onChange={e => setForm({...form, tenantId: e.target.value})}
            className="input-glass w-full text-sm" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <p className="text-xs text-gray-400 mt-1">Azure AD Directory (tenant) ID from your app registration</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Client ID (Application ID) *</label>
          <input value={form.clientId} onChange={e => setForm({...form, clientId: e.target.value})}
            className="input-glass w-full text-sm" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          <p className="text-xs text-gray-400 mt-1">Application (client) ID from Azure AD app registration</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            Client Secret {config?.hasClientSecret && <span className="text-xs text-gray-400">(saved securely, leave blank to keep)</span>}
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={form.clientSecret}
              onChange={e => setForm({...form, clientSecret: e.target.value})}
              className="input-glass w-full text-sm pr-10"
              placeholder={config?.hasClientSecret ? '••••••••••••••••' : 'Enter client secret from Azure AD'} />
            <button type="button" onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Client secret value from Certificates & secrets section</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Redirect URI</label>
          <input value={form.redirectUri} onChange={e => setForm({...form, redirectUri: e.target.value})}
            className="input-glass w-full text-sm" placeholder="http://localhost:4000/api/auth/microsoft/callback" />
          <p className="text-xs text-gray-400 mt-1">Add this URI to your Azure AD app's redirect URIs</p>
        </div>

        {/* SSO Toggle */}
        <div className="pt-2 border-t border-gray-100">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={form.ssoEnabled}
                onChange={e => setForm({...form, ssoEnabled: e.target.checked})}
                className="sr-only"
              />
              <div className={cn('w-10 h-6 rounded-full transition-colors', form.ssoEnabled ? 'bg-brand-500' : 'bg-gray-300')} />
              <div className={cn('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', form.ssoEnabled && 'translate-x-4')} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Enable Microsoft SSO for Login</p>
              <p className="text-xs text-gray-400">Allow employees to sign in with their Microsoft account</p>
            </div>
          </label>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Configuration
          </button>
          {config?.configured && (
            <button onClick={cancelEditAll} className="btn-secondary flex items-center gap-2 text-sm">
              <X size={14} />
              Cancel
            </button>
          )}
        </div>
      </div>
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

// ==================
// USER ROLES TAB
// ==================

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'ADMIN', label: 'Admin', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'HR', label: 'HR', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'MANAGER', label: 'Manager', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'EMPLOYEE', label: 'Employee', color: 'bg-gray-50 text-gray-600 border-gray-200' },
];

function UserRolesTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: res, isLoading } = useGetEmployeesQuery({ page, limit: 50, search: search || undefined });
  const [changeRole] = useChangeEmployeeRoleMutation();

  const employees = res?.data || [];
  const meta = res?.meta;

  const handleRoleChange = async (employeeId: string, newRole: string, currentRole: string) => {
    if (newRole === currentRole) return;
    try {
      await changeRole({ employeeId, role: newRole }).unwrap();
      toast.success(`Role changed to ${ROLE_OPTIONS.find(r => r.value === newRole)?.label || newRole}`);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to change role');
    }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-2">User Roles Management</h2>
      <p className="text-sm text-gray-400 mb-6">Assign roles to employees to control their access level in the portal.</p>

      {/* Role Legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {ROLE_OPTIONS.map(r => (
          <div key={r.value} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${r.color}`}>
            <span className="w-2 h-2 rounded-full bg-current" />
            {r.label}
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <Settings size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search employees..." className="input-glass w-full pl-9 text-sm" />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></div>
      ) : employees.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No employees found. Sync employees from Microsoft Teams first.
        </div>
      ) : (
        <>
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Employee</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 hidden md:table-cell">Department</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Current Role</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500">Change Role</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp: any) => {
                  const role = emp.user?.role || 'EMPLOYEE';
                  const roleConfig = ROLE_OPTIONS.find(r => r.value === role) || ROLE_OPTIONS[4];
                  return (
                    <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm">
                            {getInitials(emp.firstName, emp.lastName)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                            <p className="text-xs text-gray-400">{emp.employeeCode} · {emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-sm text-gray-600">{emp.department?.name || '—'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${roleConfig.color}`}>
                          {roleConfig.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={role}
                          onChange={e => handleRoleChange(emp.id, e.target.value, role)}
                          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white hover:border-brand-300 focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition-all cursor-pointer"
                        >
                          {ROLE_OPTIONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-gray-400">Page {meta.page} of {meta.totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Prev</button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 text-xs border rounded-lg disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
