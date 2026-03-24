import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Building2, MapPin, Shield, Server, Clock, Save, Loader2, Plus, Pencil, Trash2, X, Mail, CheckCircle2, AlertTriangle, Send } from 'lucide-react';
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
import { useGetOrgSettingsQuery, useUpdateOrgMutation, useGetLocationsQuery as useGetSettingsLocationsQuery, useGetAuditLogsQuery, useGetSystemInfoQuery, useGetEmailConfigQuery, useSaveEmailConfigMutation, useTestEmailConnectionMutation } from './settingsApi';
import { useGetShiftsQuery, useCreateShiftMutation, useUpdateShiftMutation, useDeleteShiftMutation, useGetLocationsQuery, useCreateLocationMutation, useDeleteLocationMutation } from '../workforce/workforceApi';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

type Tab = 'organization' | 'locations' | 'shifts' | 'email' | 'audit' | 'system';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('organization');

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'organization', label: 'Organization', icon: Building2 },
    { key: 'locations', label: 'Office Locations', icon: MapPin },
    { key: 'shifts', label: 'Shifts & Rosters', icon: Clock },
    { key: 'email', label: 'Email Configuration', icon: Mail },
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
  const [form, setForm] = useState({ host: '', port: 587, user: '', pass: '', fromAddress: '', fromName: '' });
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
