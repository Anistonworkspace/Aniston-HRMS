import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Building2, MapPin, Shield, Server, Clock, Save, Loader2, Plus, Pencil, Trash2, X, Mail, CheckCircle2, AlertTriangle, Send, Cloud, Eye, EyeOff, Users, Lock, DollarSign, MessageCircle, QrCode, Wifi, WifiOff, Cpu, Zap, ExternalLink, BookOpen, Monitor, Copy, Download, RefreshCw, Search, Database, UserMinus } from 'lucide-react';
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
import { useGetOrgSettingsQuery, useUpdateOrgMutation, useGetAuditLogsQuery, useGetSystemInfoQuery, useGetEmailConfigQuery, useSaveEmailConfigMutation, useTestEmailConnectionMutation, useGetTeamsConfigQuery, useSaveTeamsConfigMutation, useTestTeamsConnectionMutation, useSyncTeamsEmployeesMutation, useGetSalaryVisibilityRulesQuery, useUpdateSalaryVisibilityRuleMutation, useGetAiConfigQuery, useSaveAiConfigMutation, useTestAiConnectionMutation, useTestAdminNotificationEmailMutation, useGetAgentSetupListQuery, useGenerateAgentCodeMutation, useRegenerateAgentCodeMutation, useBulkGenerateAgentCodesMutation } from './settingsApi';
import { useGetShiftsQuery, useCreateShiftMutation, useUpdateShiftMutation, useDeleteShiftMutation, useGetLocationsQuery, useCreateLocationMutation, useUpdateLocationMutation, useDeleteLocationMutation } from '../workforce/workforceApi';
import { useGetEmployeesQuery, useChangeEmployeeRoleMutation } from '../employee/employeeApi';
import { useInitializeWhatsAppMutation, useGetWhatsAppStatusQuery, useGetWhatsAppQrQuery, useRefreshWhatsAppQrMutation, useLogoutWhatsAppMutation, useSendWhatsAppMessageMutation, useGetWhatsAppContactsQuery, useGetWhatsAppMessagesQuery } from '../whatsapp/whatsappApi';
import { cn, getInitials, getUploadUrl } from '../../lib/utils';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../app/store';
import AiAssistantFab from '../ai-assistant/AiAssistantPanel';
import { useGetKnowledgeBaseQuery, useAddKnowledgeDocMutation, useDeleteKnowledgeDocMutation } from '../ai-assistant/aiAssistantApi';
import { useGetTaskConfigQuery, useUpsertTaskConfigMutation, useTestTaskConnectionMutation } from '../task-integration/taskIntegrationApi';

import AttendancePolicyTab from './AttendancePolicyTab';
import SalaryComponentsTab from './SalaryComponentsTab';
import DatabaseBackupTab from './DatabaseBackupTab';
import DeletionRequestsTab from './DeletionRequestsTab';

type Tab = 'organization' | 'locations' | 'shifts' | 'attendance-policy' | 'salary-components' | 'email' | 'whatsapp' | 'roles' | 'salary-privacy' | 'api-integration' | 'ai-config' | 'agent-setup' | 'audit' | 'system' | 'database-backup' | 'deletion-requests';

export default function SettingsPage() {
  const { t } = useTranslation();
  const user = useAppSelector(s => s.auth.user);
  const isAdminOrSuper = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Tabs visible to HR (non-admin) users
  const HR_VISIBLE_TABS: Tab[] = ['organization', 'locations', 'shifts', 'attendance-policy', 'whatsapp'];
  // Tabs visible only to Super Admin
  const SUPER_ADMIN_ONLY_TABS: Tab[] = ['deletion-requests'];

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = sessionStorage.getItem('settings_active_tab') as Tab | null;
    if (saved && (isAdminOrSuper || HR_VISIBLE_TABS.includes(saved))) {
      if (SUPER_ADMIN_ONLY_TABS.includes(saved) && !isSuperAdmin) return 'organization';
      return saved;
    }
    return 'organization';
  });

  useEffect(() => {
    sessionStorage.setItem('settings_active_tab', activeTab);
  }, [activeTab]);

  // Reset to organization tab if current tab is not accessible
  useEffect(() => {
    if (!isAdminOrSuper && !HR_VISIBLE_TABS.includes(activeTab)) {
      setActiveTab('organization');
    }
    if (SUPER_ADMIN_ONLY_TABS.includes(activeTab) && !isSuperAdmin) {
      setActiveTab('organization');
    }
  }, [isAdminOrSuper, isSuperAdmin, activeTab]);

  const allTabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'organization', label: t('settings.organization'), icon: Building2 },
    { key: 'locations', label: t('settings.officeLocations'), icon: MapPin },
    { key: 'shifts', label: t('settings.shiftsRosters'), icon: Clock },
    { key: 'attendance-policy', label: t('settings.attendancePolicy'), icon: Shield },
    { key: 'salary-components', label: t('settings.salaryComponents'), icon: DollarSign },
    { key: 'email', label: t('settings.emailConfig'), icon: Mail },
    { key: 'whatsapp', label: t('settings.whatsapp'), icon: MessageCircle },
    { key: 'roles', label: t('settings.userRoles'), icon: Users },
    { key: 'salary-privacy', label: t('settings.salaryPrivacy'), icon: Lock },
    { key: 'api-integration', label: t('settings.apiIntegration'), icon: ExternalLink },
    { key: 'ai-config', label: t('settings.aiApiConfig'), icon: Cpu },
    { key: 'agent-setup', label: t('settings.agentSetup'), icon: Monitor },
    { key: 'audit', label: t('settings.auditLogs'), icon: Shield },
    { key: 'system', label: t('settings.system'), icon: Server },
    { key: 'database-backup', label: 'Database Backup', icon: Database },
    // Super Admin only
    ...(isSuperAdmin ? [{ key: 'deletion-requests' as Tab, label: 'Deletion Requests', icon: UserMinus }] : []),
  ];

  const tabs = isAdminOrSuper
    ? allTabs
    : allTabs.filter(tab => HR_VISIBLE_TABS.includes(tab.key));

  return (
    <>
      <div className="page-container">
        <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">{t('settings.title')}</h1>

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
            {activeTab === 'attendance-policy' && <AttendancePolicyTab />}
            {activeTab === 'salary-components' && <SalaryComponentsTab />}
            {activeTab === 'email' && <EmailConfig />}
            {activeTab === 'whatsapp' && <WhatsAppConfig />}
            {activeTab === 'roles' && <UserRolesTab />}
            {activeTab === 'salary-privacy' && <SalaryPrivacyTab />}
            {activeTab === 'api-integration' && <ExternalApiIntegrationTab />}
            {activeTab === 'ai-config' && <ApiIntegrationsTab />}
            {activeTab === 'agent-setup' && <AgentSetupTab />}
            {activeTab === 'audit' && <AuditLogs />}
            {activeTab === 'system' && <SystemInfo />}
            {activeTab === 'database-backup' && <DatabaseBackupTab />}
            {activeTab === 'deletion-requests' && isSuperAdmin && <DeletionRequestsTab />}
          </div>
        </div>
      </div>
      <AiAssistantFab context="admin" label="Admin Assistant" />
    </>
  );
}

function OrgSettings() {
  const { t } = useTranslation();
  const { data: res } = useGetOrgSettingsQuery();
  const [updateOrg, { isLoading }] = useUpdateOrgMutation();
  const [testAdminEmail, { isLoading: isTestingAdminEmail }] = useTestAdminNotificationEmailMutation();
  const org = res?.data;
  const [form, setForm] = useState({ name: '', timezone: '', currency: '', fiscalYear: '', adminNotificationEmail: '' });

  useEffect(() => {
    if (org) setForm({ name: org.name, timezone: org.timezone, currency: org.currency, fiscalYear: org.fiscalYear, adminNotificationEmail: org.adminNotificationEmail || '' });
  }, [org]);

  const handleSave = async () => {
    try {
      await updateOrg(form).unwrap();
      toast.success(t('settings.saved'));
    } catch { toast.error(t('settings.failedToSave')); }
  };

  return (
    <div className="layer-card p-6">
      <h2 className="text-lg font-display font-semibold text-gray-800 mb-6">{t('settings.orgSettings')}</h2>
      <div className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.companyName')}</label>
          <input value={form.name || org?.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-glass w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.timezone')}</label>
            <select value={form.timezone || org?.timezone || ''} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="input-glass w-full">
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.currency')}</label>
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
          <label className="block text-sm font-medium text-gray-600 mb-1">{t('settings.fiscalYear')}</label>
          <select value={form.fiscalYear || org?.fiscalYear || ''} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
            className="input-glass w-full">
            <option value="APRIL_MARCH">{t('settings.aprilMarch')}</option>
            <option value="JANUARY_DECEMBER">{t('settings.januaryDecember')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            {t('settings.adminEmail')}
          </label>
          <div className="flex gap-2">
            <input value={form.adminNotificationEmail} onChange={(e) => setForm({ ...form, adminNotificationEmail: e.target.value })}
              type="email" placeholder="admin@company.com" className="input-glass flex-1" />
            <button
              onClick={async () => {
                // Warn if the email has been changed but not saved yet
                if (form.adminNotificationEmail !== (org?.adminNotificationEmail || '')) {
                  toast('Save your settings first, then test the email.', { icon: '⚠️' });
                  return;
                }
                try {
                  const result = await testAdminEmail().unwrap();
                  if (result?.data?.success) {
                    toast.success(result.data.message || 'Test email sent!');
                  } else {
                    toast.error(result?.data?.message || 'Failed to send test email');
                  }
                } catch {
                  toast.error('Failed to send test email — check SMTP configuration');
                }
              }}
              disabled={isTestingAdminEmail || !form.adminNotificationEmail}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 whitespace-nowrap"
            >
              {isTestingAdminEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Test
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Used for: system alerts, backup notifications, payroll errors, Sunday attendance approvals, candidate selection notices, and HR activity reports.
          </p>
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
          {t('profile.saveChanges')}
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

const EMPTY_LOC_FORM = { name: '', address: '', city: '', state: '', latitude: '', longitude: '', radiusMeters: 200, strictMode: false };

function LocationFormMap({ lat, lng, radius, onSelect }: { lat: string; lng: string; radius: number; onSelect: (lat: number, lng: number) => void }) {
  const defaultCenter: [number, number] = [lat ? Number(lat) : 28.6139, lng ? Number(lng) : 77.2090];
  return (
    <MapContainer center={defaultCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
      <MapClickHandler onLocationSelect={onSelect} />
      {lat && lng && (
        <>
          <Marker position={[Number(lat), Number(lng)]} />
          <Circle center={[Number(lat), Number(lng)]} radius={radius} pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.15 }} />
        </>
      )}
    </MapContainer>
  );
}

function LocationForm({ form, setForm, onSubmit, onCancel, isLoading, submitLabel }: {
  form: typeof EMPTY_LOC_FORM; setForm: (f: typeof EMPTY_LOC_FORM) => void;
  onSubmit: () => void; onCancel: () => void; isLoading: boolean; submitLabel: string;
}) {
  return (
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Address *</label>
          <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="input-glass w-full text-sm" placeholder="123, Business Park, Sector 62" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">State</label>
          <input value={form.state} onChange={e => setForm({...form, state: e.target.value})} className="input-glass w-full text-sm" placeholder="Delhi" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Click map to pin location (or type coordinates below)</label>
        <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: 260 }}>
          <LocationFormMap lat={form.latitude} lng={form.longitude} radius={form.radiusMeters}
            onSelect={(lat, lng) => setForm({...form, latitude: String(lat.toFixed(6)), longitude: String(lng.toFixed(6))})} />
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
          <label className="block text-xs text-gray-500 mb-1">Geofence Radius (m)</label>
          <input type="number" value={form.radiusMeters} onChange={e => setForm({...form, radiusMeters: Number(e.target.value)})} className="input-glass w-full text-sm" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={form.strictMode} onChange={e => setForm({...form, strictMode: e.target.checked})} className="rounded border-gray-300" />
        Strict mode — block clock-in if outside geofence radius
      </label>
      <div className="flex gap-2">
        <button onClick={onSubmit} disabled={isLoading} className="btn-primary text-sm">{isLoading ? 'Saving...' : submitLabel}</button>
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  );
}

function LocationSettings() {
  const { data: res } = useGetLocationsQuery();
  const locations = res?.data || [];
  const [createLocation, { isLoading: creating }] = useCreateLocationMutation();
  const [updateLocation, { isLoading: updating }] = useUpdateLocationMutation();
  const [deleteLocation] = useDeleteLocationMutation();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ ...EMPTY_LOC_FORM });
  const [editForm, setEditForm] = useState({ ...EMPTY_LOC_FORM });
  const [showMapModal, setShowMapModal] = useState(false);

  const handleCreate = async () => {
    if (!createForm.name || !createForm.address || !createForm.city || !createForm.latitude || !createForm.longitude) {
      toast.error('Name, address, city, latitude and longitude are required'); return;
    }
    try {
      await createLocation({ ...createForm, latitude: Number(createForm.latitude), longitude: Number(createForm.longitude) }).unwrap();
      toast.success('Location created');
      setShowCreateForm(false);
      setCreateForm({ ...EMPTY_LOC_FORM });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to create location'); }
  };

  const startEdit = (loc: any) => {
    const coords = loc.geofence?.coordinates as any;
    setEditForm({
      name: loc.name || '',
      address: loc.address || '',
      city: loc.city || '',
      state: loc.state || '',
      latitude: coords?.lat ? String(coords.lat) : '',
      longitude: coords?.lng ? String(coords.lng) : '',
      radiusMeters: loc.geofence?.radiusMeters || 200,
      strictMode: loc.geofence?.strictMode || false,
    });
    setEditingId(loc.id);
    setShowCreateForm(false);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!editForm.name || !editForm.address || !editForm.city || !editForm.latitude || !editForm.longitude) {
      toast.error('Name, address, city, latitude and longitude are required'); return;
    }
    try {
      await updateLocation({ id: editingId, data: { ...editForm, latitude: Number(editForm.latitude), longitude: Number(editForm.longitude) } }).unwrap();
      toast.success('Location updated');
      setEditingId(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to update location'); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete location "${name}"? This cannot be undone.`)) return;
    try {
      await deleteLocation(id).unwrap();
      toast.success('Location deleted');
      if (editingId === id) setEditingId(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to delete'); }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-semibold text-gray-800">Office Locations & Geofence</h2>
        <button onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); }} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add Location
        </button>
      </div>

      {showCreateForm && (
        <LocationForm form={createForm} setForm={setCreateForm} onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)} isLoading={creating} submitLabel="Create Location" />
      )}

      {/* Overview map with expand button */}
      {locations.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-gray-400">All office locations ({locations.length})</p>
            <button onClick={() => setShowMapModal(true)} className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
              <ExternalLink size={11} /> Expand Map
            </button>
          </div>
          <div className="rounded-xl overflow-hidden border border-gray-200 cursor-pointer" style={{ height: 200 }} onClick={() => setShowMapModal(true)}>
            <MapContainer
              center={[(locations[0]?.geofence?.coordinates as any)?.lat || 28.6139, (locations[0]?.geofence?.coordinates as any)?.lng || 77.2090]}
              zoom={11} style={{ height: '100%', width: '100%' }} zoomControl={false} dragging={false} scrollWheelZoom={false}
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
        </div>
      )}

      {/* Full-screen map modal */}
      {showMapModal && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl overflow-hidden w-full max-w-4xl" style={{ height: '80vh' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2"><MapPin size={16} className="text-brand-500" /> Office Locations</h3>
              <button onClick={() => setShowMapModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div style={{ height: 'calc(80vh - 57px)' }}>
              <MapContainer
                center={[(locations[0]?.geofence?.coordinates as any)?.lat || 28.6139, (locations[0]?.geofence?.coordinates as any)?.lng || 77.2090]}
                zoom={12} style={{ height: '100%', width: '100%' }}
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
          </div>
        </div>
      )}

      {locations.length === 0 && !showCreateForm ? (
        <p className="text-sm text-gray-400 text-center py-8">No locations configured. Add your first office location.</p>
      ) : (
        <div className="space-y-3">
          {locations.map((loc: any) => (
            <div key={loc.id}>
              <div className={cn('flex items-center justify-between p-4 bg-surface-2 rounded-lg', editingId === loc.id && 'ring-2 ring-brand-300')}>
                <div className="flex items-center gap-3">
                  <MapPin size={18} className="text-brand-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{loc.name}</p>
                    <p className="text-xs text-gray-400">{loc.address}{loc.city ? ` · ${loc.city}` : ''}{loc.state ? `, ${loc.state}` : ''}</p>
                    {loc.geofence && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Geofence: {loc.geofence.radiusMeters}m radius
                        {loc.geofence.strictMode ? ' · Strict' : ' · Relaxed'}
                        {` · ${(loc.geofence.coordinates as any)?.lat?.toFixed(4) ?? '—'}, ${(loc.geofence.coordinates as any)?.lng?.toFixed(4) ?? '—'}`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => editingId === loc.id ? setEditingId(null) : startEdit(loc)}
                    className={cn('p-1.5 rounded-lg transition-colors', editingId === loc.id ? 'bg-brand-100 text-brand-600' : 'text-gray-400 hover:text-brand-600 hover:bg-brand-50')}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(loc.id, loc.name)} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {/* Inline edit form */}
              {editingId === loc.id && (
                <div className="mt-2 pl-2 border-l-2 border-brand-300">
                  <LocationForm form={editForm} setForm={setEditForm} onSubmit={handleUpdate}
                    onCancel={() => setEditingId(null)} isLoading={updating} submitLabel="Save Changes" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_SHIFT_FORM = { name: '', code: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, isDefault: false };

function ShiftSettings() {
  const { data: res } = useGetShiftsQuery();
  const shifts = res?.data || [];
  const [createShift, { isLoading: creating }] = useCreateShiftMutation();
  const [updateShift, { isLoading: updating }] = useUpdateShiftMutation();
  const [deleteShift] = useDeleteShiftMutation();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ ...EMPTY_SHIFT_FORM });
  const [editForm, setEditForm] = useState({ ...EMPTY_SHIFT_FORM });

  const handleCreate = async () => {
    if (!createForm.name || !createForm.code) { toast.error('Shift name and code are required'); return; }
    try {
      await createShift(createForm).unwrap();
      toast.success('Shift created');
      setShowCreateForm(false);
      setCreateForm({ ...EMPTY_SHIFT_FORM });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to create shift'); }
  };

  const startEdit = (shift: any) => {
    setEditForm({
      name: shift.name || '',
      code: shift.code || '',
      startTime: shift.startTime || '09:00',
      endTime: shift.endTime || '18:00',
      graceMinutes: shift.graceMinutes ?? 15,
      halfDayHours: Number(shift.halfDayHours) || 4,
      fullDayHours: Number(shift.fullDayHours) || 8,
      isDefault: shift.isDefault || false,
    });
    setEditingId(shift.id);
    setShowCreateForm(false);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!editForm.name || !editForm.code) { toast.error('Shift name and code are required'); return; }
    try {
      await updateShift({ id: editingId, data: editForm }).unwrap();
      toast.success('Shift updated');
      setEditingId(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to update shift'); }
  };

  const handleDelete = async (id: string, name: string, assignedCount: number) => {
    const msg = assignedCount > 0
      ? `Deactivate shift "${name}"? It has ${assignedCount} assigned employee(s). Their assignments will be kept but the shift will be marked inactive.`
      : `Deactivate shift "${name}"?`;
    if (!confirm(msg)) return;
    try {
      await deleteShift(id).unwrap();
      toast.success('Shift deactivated');
      if (editingId === id) setEditingId(null);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const renderShiftFormFields = (form: typeof EMPTY_SHIFT_FORM, set: (f: typeof EMPTY_SHIFT_FORM) => void, onSubmit: () => void, onCancel: () => void, isLoading: boolean, label: string) => (
    <div className="bg-surface-2 rounded-xl p-4 mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Shift Name *</label>
          <input value={form.name} onChange={e => set({...form, name: e.target.value})} className="input-glass w-full text-sm" placeholder="Morning Shift" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Code *</label>
          <input value={form.code} onChange={e => set({...form, code: e.target.value.toUpperCase()})} className="input-glass w-full text-sm" placeholder="MORNING" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Start Time</label>
          <input type="time" value={form.startTime} onChange={e => set({...form, startTime: e.target.value})} className="input-glass w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">End Time</label>
          <input type="time" value={form.endTime} onChange={e => set({...form, endTime: e.target.value})} className="input-glass w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Grace (min)</label>
          <input type="number" min={0} value={form.graceMinutes} onChange={e => set({...form, graceMinutes: Number(e.target.value)})} className="input-glass w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Full Day (hrs)</label>
          <input type="number" step="0.5" min={1} value={form.fullDayHours} onChange={e => set({...form, fullDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Half Day (hrs)</label>
        <input type="number" step="0.5" min={0.5} value={form.halfDayHours} onChange={e => set({...form, halfDayHours: Number(e.target.value)})} className="input-glass w-40 text-sm" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={form.isDefault} onChange={e => set({...form, isDefault: e.target.checked})} className="rounded border-gray-300" />
        Set as default shift (auto-assigned to new employees)
      </label>
      <div className="flex gap-2">
        <button onClick={onSubmit} disabled={isLoading} className="btn-primary text-sm">{isLoading ? 'Saving...' : label}</button>
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="layer-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-semibold text-gray-800">Shifts & Rosters</h2>
        <button onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); }} className="btn-primary text-sm flex items-center gap-1.5">
          <Plus size={14} /> Add Shift
        </button>
      </div>

      {showCreateForm && renderShiftFormFields(createForm, setCreateForm, handleCreate, () => setShowCreateForm(false), creating, 'Create Shift')}

      {shifts.length === 0 && !showCreateForm ? (
        <p className="text-sm text-gray-400 text-center py-8">No shifts configured. Create your first shift.</p>
      ) : (
        <div className="space-y-3">
          {shifts.map((shift: any) => (
            <div key={shift.id}>
              <div className={cn('flex items-center justify-between p-4 bg-surface-2 rounded-lg', editingId === shift.id && 'ring-2 ring-brand-300')}>
                <div className="flex items-center gap-3">
                  <Clock size={18} className="text-brand-500 flex-shrink-0" />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-800">{shift.name}</p>
                      <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{shift.code}</span>
                      {shift.isDefault && <span className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded font-medium">Default</span>}
                      {!shift.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactive</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {shift.startTime} — {shift.endTime} · Grace: {shift.graceMinutes}min · Full day: {Number(shift.fullDayHours)}hrs · Half day: {Number(shift.halfDayHours)}hrs
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{shift._count?.assignments || 0} assigned</span>
                  <button onClick={() => editingId === shift.id ? setEditingId(null) : startEdit(shift)}
                    className={cn('p-1.5 rounded-lg transition-colors', editingId === shift.id ? 'bg-brand-100 text-brand-600' : 'text-gray-400 hover:text-brand-600 hover:bg-brand-50')}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(shift.id, shift.name, shift._count?.assignments || 0)} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {editingId === shift.id && (
                <div className="mt-2 pl-2 border-l-2 border-brand-300">
                  {renderShiftFormFields(editForm, setEditForm, handleUpdate, () => setEditingId(null), updating, 'Save Changes')}
                </div>
              )}
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
  const [form, setForm] = useState({
    host: '', port: 587, user: '', pass: '', fromAddress: '', fromName: '', emailDomain: '', payrollEmail: '',
  });
  const [showPass, setShowPass] = useState(false);
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
        payrollEmail: config.payrollEmail || '',
      });
    }
  }, [config]);

  const handleSave = async () => {
    if (!form.host || !form.user) { toast.error('SMTP host and username are required'); return; }
    try {
      const payload: any = { ...form, authMethod: 'smtp' };
      if (!payload.pass && config?.hasPassword) {
        delete payload.pass;
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
      <p className="text-sm text-gray-400 mb-6">Configure SMTP email for sending invitation links, notifications, and password resets.</p>

      {/* Status indicator */}
      {config && (
        <div className={cn('flex items-center gap-2 p-3 rounded-lg mb-6 text-sm',
          config.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
        )}>
          {config.configured ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {config.configured
            ? 'Email configured via SMTP. Emails will be sent.'
            : 'Email not configured. Invitations will be logged to console only.'}
        </div>
      )}

      <div className="space-y-4 max-w-lg">
        {/* SMTP Fields */}
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
            <label className="block text-sm font-medium text-gray-600 mb-1">Username (Email) *</label>
            <input value={form.user} onChange={e => setForm({...form, user: e.target.value})}
              className="input-glass w-full text-sm" placeholder="hr@anistonav.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Password {config?.hasPassword && <span className="text-xs text-emerald-600 font-medium">✓ saved</span>}
            </label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={form.pass} onChange={e => setForm({...form, pass: e.target.value})}
                className="input-glass w-full text-sm pr-10" placeholder={config?.hasPassword ? '(leave blank to keep saved password)' : 'Email password or App Password'} />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {config?.hasPassword && !form.pass && (
              <p className="text-xs text-gray-400 mt-1">Password already saved. Enter a new password only if you want to change it.</p>
            )}
          </div>
        </div>

        {/* From fields */}
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Send As (From Email) *</label>
          <input value={form.fromAddress} onChange={e => setForm({...form, fromAddress: e.target.value})}
            className="input-glass w-full text-sm" placeholder="hr@anistonav.com" />
          <p className="text-xs text-gray-400 mt-1">The email address that appears in the "From" field. Can be a shared mailbox if "Send As" permission is granted to the SMTP login user.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">From Name</label>
            <input value={form.fromName} onChange={e => setForm({...form, fromName: e.target.value})}
              className="input-glass w-full text-sm" placeholder="Aniston HRMS" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Email Domain</label>
            <input value={form.emailDomain} onChange={e => setForm({...form, emailDomain: e.target.value})}
              className="input-glass w-full text-sm" placeholder="@anistonav.com" />
          </div>
        </div>

        {/* Payroll Email Recipients */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
            <DollarSign size={14} className="text-brand-500" /> Payroll Email Recipients
          </h3>
          <p className="text-xs text-gray-400 mb-3">When HR sends payroll reports, the password-protected Excel will be emailed to these addresses.</p>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Accounts / Finance Email</label>
            <input value={form.payrollEmail || ''} onChange={e => setForm({...form, payrollEmail: e.target.value})}
              className="input-glass w-full text-sm" placeholder="accounts@anistonav.com" />
            <p className="text-xs text-gray-400 mt-1">Payroll Excel reports will be sent to this email when HR clicks "Send to Accounts" after processing.</p>
          </div>
        </div>

        {/* Info box */}
        <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Microsoft 365 SMTP Setup</p>
          <p>1. Go to <strong>admin.microsoft.com</strong> → Users → Active users → hr@anistonav.com</p>
          <p>2. Click <strong>Mail</strong> tab → <strong>Manage email apps</strong></p>
          <p>3. Enable <strong>Authenticated SMTP</strong> → Save</p>
          <p>4. Use the mailbox password (or App Password if MFA is on) as the password above</p>
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface-2 rounded-lg p-3">
              <div className="h-3 bg-gray-100 rounded w-14 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-20" />
            </div>
          ))}
        </div>
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
          No employees found. Invite employees from the Manage Employees page first.
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

// =================== Salary Privacy Tab ===================
function SalaryPrivacyTab() {
  const { data: res, isLoading } = useGetSalaryVisibilityRulesQuery();
  const [updateRule] = useUpdateSalaryVisibilityRuleMutation();
  const rules = res?.data || [];

  const handleToggle = async (employeeId: string, field: 'visibleToHR' | 'visibleToManager', current: boolean) => {
    try {
      const rule = rules.find((r: any) => r.employee.id === employeeId);
      await updateRule({
        employeeId,
        visibleToHR: field === 'visibleToHR' ? !current : (rule?.visibleToHR ?? true),
        visibleToManager: field === 'visibleToManager' ? !current : (rule?.visibleToManager ?? false),
      }).unwrap();
      toast.success('Visibility updated');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center gap-3 mb-2">
        <Lock size={20} className="text-brand-600" />
        <h2 className="text-lg font-display font-semibold text-gray-800">Salary Privacy</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">Control which employees' salaries are visible to HR and Managers</p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
        <p className="text-xs text-amber-700">Only Super Admin can modify salary visibility. HR will see masked values for hidden employees.</p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-brand-600 mx-auto" /></div>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No employees found</p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left py-3 px-4 font-medium text-gray-500">Employee</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500 hidden md:table-cell">Department</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Visible to HR</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">Visible to Manager</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule: any) => (
                <tr key={rule.employee.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-3 px-4">
                    <p className="font-medium text-gray-800">{rule.employee.firstName} {rule.employee.lastName}</p>
                    <p className="text-xs font-mono text-gray-400" data-mono>{rule.employee.employeeCode}</p>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell text-gray-500">{rule.employee.department?.name || '—'}</td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleToggle(rule.employee.id, 'visibleToHR', rule.visibleToHR)}
                      className={cn('w-10 h-5 rounded-full transition-colors relative',
                        rule.visibleToHR ? 'bg-emerald-500' : 'bg-gray-300')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        rule.visibleToHR ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleToggle(rule.employee.id, 'visibleToManager', rule.visibleToManager)}
                      className={cn('w-10 h-5 rounded-full transition-colors relative',
                        rule.visibleToManager ? 'bg-emerald-500' : 'bg-gray-300')}>
                      <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        rule.visibleToManager ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =================== WhatsApp Configuration ===================
function WhatsAppConfig() {
  const { data: statusRes, refetch: refetchStatus } = useGetWhatsAppStatusQuery(undefined, { pollingInterval: 10000 });
  const { data: qrRes, refetch: refetchQr } = useGetWhatsAppQrQuery(undefined, { pollingInterval: 10000 });
  const [initializeWA, { isLoading: initializing }] = useInitializeWhatsAppMutation();
  const [refreshQrMutation, { isLoading: refreshingQr }] = useRefreshWhatsAppQrMutation();
  const [logoutWA, { isLoading: disconnecting }] = useLogoutWhatsAppMutation();
  const [sendMessage] = useSendWhatsAppMessageMutation();
  const [testPhone, setTestPhone] = useState('');
  const [testMsg, setTestMsg] = useState('Hello from Aniston HRMS!');
  const [connecting, setConnecting] = useState(false);
  const [linking, setLinking] = useState(false); // QR scanned, waiting for full connection
  const [liveQr, setLiveQr] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false); // instant connected state via socket
  const [livePhone, setLivePhone] = useState<string | null>(null);
  const [waError, setWaError] = useState<string | null>(null);

  const status = statusRes?.data;
  const isConnected = liveConnected || status?.isConnected || false;
  const serverInitializing = status?.isInitializing || false;
  const qrCode = liveQr || qrRes?.data?.qrCode;

  // Sync connecting state with server's isInitializing
  useEffect(() => {
    if (serverInitializing && !connecting) setConnecting(true);
    if (isConnected) { setConnecting(false); setLinking(false); }
  }, [serverInitializing, isConnected]);

  // Listen for real-time socket events for instant QR + connection updates
  useEffect(() => {
    const handleQr = (data: any) => {
      setLiveQr(data.qrCode);
      setConnecting(false);
      setLinking(false);
    };
    const handleAuthenticated = () => {
      // QR was scanned — immediately hide QR and show linking spinner
      setLiveQr(null);
      setLinking(true);
      setConnecting(false);
    };
    const handleReady = (data: any) => {
      setLiveQr(null);
      setLinking(false);
      setConnecting(false);
      setLiveConnected(true);
      setLivePhone(data.phoneNumber || null);
      toast.success(`WhatsApp connected${data.phoneNumber ? ` (+${data.phoneNumber})` : ''}!`);
      refetchStatus();
    };
    const handleAuthFailure = (data: any) => {
      setLiveQr(null);
      setLinking(false);
      setConnecting(false);
      setWaError(data?.message || 'Authentication failed. Please try again.');
      toast.error('WhatsApp authentication failed');
      refetchStatus();
    };
    const handleDisconnected = () => {
      setLiveQr(null);
      setLinking(false);
      setConnecting(false);
      setLiveConnected(false);
      setLivePhone(null);
      refetchStatus();
    };

    onSocketEvent('whatsapp:qr', handleQr);
    onSocketEvent('whatsapp:authenticated', handleAuthenticated);
    onSocketEvent('whatsapp:ready', handleReady);
    onSocketEvent('whatsapp:auth_failure', handleAuthFailure);
    onSocketEvent('whatsapp:disconnected', handleDisconnected);

    return () => {
      offSocketEvent('whatsapp:qr', handleQr);
      offSocketEvent('whatsapp:authenticated', handleAuthenticated);
      offSocketEvent('whatsapp:ready', handleReady);
      offSocketEvent('whatsapp:auth_failure', handleAuthFailure);
      offSocketEvent('whatsapp:disconnected', handleDisconnected);
    };
  }, [refetchStatus]);

  const handleInitialize = async () => {
    try {
      setConnecting(true);
      setLiveQr(null);
      setWaError(null);
      await initializeWA().unwrap();
      toast.success('WhatsApp initializing... QR code will appear shortly');
    } catch (err: any) {
      setConnecting(false);
      const errorMsg = err?.data?.error?.message || 'Failed to initialize WhatsApp';
      setWaError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const handleDisconnect = async () => {
    try {
      await logoutWA().unwrap();
      toast.success('WhatsApp disconnected');
      refetchStatus();
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to disconnect');
    }
  };

  const handleTestMessage = async () => {
    if (!testPhone || !testMsg) return toast.error('Enter phone number and message');
    try {
      await sendMessage({ to: testPhone, message: testMsg }).unwrap();
      toast.success('Test message sent!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to send message');
    }
  };

  return (
    <div className="layer-card p-6">
      <div className="flex items-center gap-3 mb-2">
        <MessageCircle size={20} className="text-emerald-500" />
        <h2 className="text-lg font-display font-semibold text-gray-800">WhatsApp Integration</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">Connect WhatsApp Web to send messages to candidates and employees</p>

      <div className={cn('rounded-xl px-4 py-3 mb-6 flex items-center gap-3',
        isConnected ? 'bg-emerald-50 border border-emerald-200'
        : linking ? 'bg-blue-50 border border-blue-200'
        : (connecting || qrCode) ? 'bg-amber-50 border border-amber-200'
        : 'bg-gray-50 border border-gray-200')}>
        {isConnected ? (
          <>
            <Wifi size={18} className="text-emerald-600" />
            <div>
              <p className="text-sm font-medium text-emerald-700">Connected</p>
              {(livePhone || status?.phoneNumber) && <p className="text-xs text-emerald-500">Phone: +{livePhone || status?.phoneNumber}</p>}
            </div>
          </>
        ) : linking ? (
          <>
            <Loader2 size={18} className="text-blue-600 animate-spin" />
            <div>
              <p className="text-sm font-medium text-blue-700">Linking device...</p>
              <p className="text-xs text-blue-500">QR scanned successfully! Connecting to WhatsApp...</p>
            </div>
          </>
        ) : connecting && !qrCode ? (
          <>
            <Loader2 size={18} className="text-amber-600 animate-spin" />
            <p className="text-sm font-medium text-amber-600">Generating QR code...</p>
          </>
        ) : qrCode ? (
          <>
            <QrCode size={18} className="text-amber-600" />
            <p className="text-sm font-medium text-amber-600">Waiting for scan...</p>
          </>
        ) : (
          <>
            <WifiOff size={18} className="text-gray-400" />
            <p className="text-sm font-medium text-gray-500">Not Connected</p>
          </>
        )}
      </div>

      {isConnected && <WhatsAppStats />}

      {waError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm font-medium text-red-700">Connection Error</p>
          <p className="text-xs text-red-600 mt-1">{waError}</p>
          <button onClick={() => setWaError(null)} className="text-xs text-red-500 underline mt-2">Dismiss</button>
        </div>
      )}

      {!isConnected ? (
        <div className="space-y-6">
          {linking ? (
            <div className="text-center py-12">
              <Loader2 size={48} className="mx-auto text-blue-500 animate-spin mb-4" />
              <p className="text-sm font-medium text-gray-700">Linking your WhatsApp device...</p>
              <p className="text-xs text-gray-400 mt-1">QR code scanned! Please wait while we establish the connection.</p>
            </div>
          ) : qrCode ? (
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">Scan this QR code with WhatsApp on your phone</p>
              <div className="inline-block p-4 bg-white rounded-2xl shadow-lg border border-gray-100">
                <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
              </div>
              <p className="text-xs text-gray-400 mt-3">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  onClick={async () => {
                    try {
                      setLiveQr(null);
                      setConnecting(true);
                      await refreshQrMutation().unwrap();
                      toast.success('Refreshing QR code...');
                    } catch (err: any) {
                      setConnecting(false);
                      toast.error(err?.data?.error?.message || 'Failed to refresh QR');
                    }
                  }}
                  disabled={refreshingQr}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  {refreshingQr && <Loader2 size={12} className="animate-spin" />}
                  Refresh QR
                </button>
                <span className="text-xs text-gray-400">QR updates automatically via real-time connection</span>
              </div>
            </div>
          ) : connecting ? (
            <div className="text-center py-12">
              <Loader2 size={48} className="mx-auto text-indigo-400 animate-spin mb-4" />
              <p className="text-sm font-medium text-gray-700">Initializing WhatsApp...</p>
              <p className="text-xs text-gray-400 mt-1">QR code will appear automatically in a few seconds</p>
            </div>
          ) : (
            <div className="text-center py-8">
              <MessageCircle size={48} className="mx-auto text-gray-200 mb-4" />
              <p className="text-sm text-gray-500 mb-4">Click below to generate a QR code for WhatsApp Web connection</p>
              <button onClick={handleInitialize} disabled={initializing}
                className="btn-primary flex items-center gap-2 mx-auto">
                {initializing && <Loader2 size={16} className="animate-spin" />}
                <MessageCircle size={16} /> Connect WhatsApp
              </button>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <h4 className="text-sm font-medium text-blue-700 mb-2">How it works</h4>
            <ol className="text-xs text-blue-600 space-y-1 list-decimal list-inside">
              <li>Click "Connect WhatsApp" to generate a QR code</li>
              <li>Open WhatsApp on your phone → Settings → Linked Devices</li>
              <li>Scan the QR code displayed here</li>
              <li>Connection is detected automatically — no refresh needed</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="layer-card p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Send Test Message</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone Number (with country code)</label>
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="919876543210" className="input-glass w-full text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Message</label>
                <textarea value={testMsg} onChange={e => setTestMsg(e.target.value)}
                  className="input-glass w-full text-sm h-20 resize-none" />
              </div>
              <button onClick={handleTestMessage} className="btn-primary text-xs flex items-center gap-2">
                <Send size={14} /> Send Test
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-red-50 rounded-xl border border-red-200">
            <div>
              <p className="text-sm font-medium text-red-700">Disconnect WhatsApp</p>
              <p className="text-xs text-red-500">This will end the current WhatsApp Web session</p>
            </div>
            <button onClick={handleDisconnect} disabled={disconnecting}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
              {disconnecting && <Loader2 size={14} className="animate-spin" />}
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WhatsAppStats() {
  const { data: contactsRes, isLoading: loadingContacts } = useGetWhatsAppContactsQuery();
  const { data: messagesRes, isLoading: loadingMessages } = useGetWhatsAppMessagesQuery({ page: 1, limit: 1 });

  const totalContacts = (contactsRes?.data || []).length;
  // Messages total from the meta — represents all-time messages stored in DB
  const totalMessages = messagesRes?.meta?.total || messagesRes?.data?.meta?.total || 0;

  return (
    <div className="grid grid-cols-2 gap-4 mb-6">
      <div className="layer-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
          <Send size={18} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Messages</p>
          <p className="text-lg font-semibold text-gray-800" data-mono>
            {loadingMessages ? '...' : totalMessages}
          </p>
        </div>
      </div>
      <div className="layer-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Users size={18} className="text-blue-600" />
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Contacts</p>
          <p className="text-lg font-semibold text-gray-800" data-mono>
            {loadingContacts ? '...' : totalContacts}
          </p>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_DEFAULTS: Record<string, { modelName: string; placeholder: string }> = {
  DEEPSEEK: { modelName: 'deepseek-chat', placeholder: 'sk-...' },
  OPENAI: { modelName: 'gpt-4o', placeholder: 'sk-...' },
  ANTHROPIC: { modelName: 'claude-sonnet-4-20250514', placeholder: 'sk-ant-...' },
  GEMINI: { modelName: 'gemini-2.0-flash', placeholder: 'AIza...' },
  CUSTOM: { modelName: '', placeholder: 'API key' },
};

function ExternalApiIntegrationTab() {
  const { data: taskConfigRes } = useGetTaskConfigQuery();
  const [upsertTaskConfig, { isLoading: savingTask }] = useUpsertTaskConfigMutation();
  const [testTaskConnection, { isLoading: testingTask }] = useTestTaskConnectionMutation();

  const [integrations, setIntegrations] = useState<{ name: string; baseUrl: string; apiKey: string; description: string; enabled: boolean }[]>([
    { name: 'Task Manager', baseUrl: '', apiKey: '', description: 'Connect your task management tool (Jira, ClickUp, Asana, etc.) to sync employee tasks with performance reviews.', enabled: false },
    { name: 'Naukri / Job Board', baseUrl: '', apiKey: '', description: 'Connect job board APIs to auto-post job openings and receive applications.', enabled: false },
    { name: 'Slack / Teams Webhook', baseUrl: '', apiKey: '', description: 'Send HRMS notifications to your team chat channels via webhook URL.', enabled: false },
  ]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Pre-fill Task Manager config from backend
  useEffect(() => {
    if (taskConfigRes?.data) {
      const cfg = taskConfigRes.data;
      setIntegrations(prev => {
        const updated = [...prev];
        updated[0] = {
          ...updated[0],
          baseUrl: cfg.baseUrl || '',
          apiKey: '', // Never pre-fill encrypted key — show placeholder
          enabled: cfg.isActive || false,
        };
        return updated;
      });
    }
  }, [taskConfigRes]);

  const handleSaveIntegration = async (index: number) => {
    const intg = integrations[index];
    if (index === 0) {
      // Task Manager — persist to backend
      if (!intg.baseUrl) {
        toast.error('Please enter a Base URL');
        return;
      }
      try {
        await upsertTaskConfig({
          provider: 'CUSTOM',
          // Only send apiKey when user typed a new one — blank = keep existing encrypted key
          apiKey: intg.apiKey || '',
          baseUrl: intg.baseUrl,
        }).unwrap();
        toast.success('Task Manager configuration saved');
        setEditingIndex(null);
      } catch (err: any) {
        toast.error(err.data?.error?.message || 'Failed to save configuration');
      }
    } else {
      toast.success(`${intg.name} configuration saved`);
      setEditingIndex(null);
    }
  };

  const handleTestIntegration = async (index: number) => {
    const intg = integrations[index];
    if (index === 0) {
      // Task Manager — use backend test endpoint
      try {
        const res = await testTaskConnection().unwrap();
        toast.success(`Task Manager connection successful! (${res.data?.responseTimeMs}ms)`);
      } catch (err: any) {
        toast.error(err.data?.error?.message || 'Connection test failed');
      }
      return;
    }
    if (!intg.baseUrl) {
      toast.error('Please enter a Base URL first');
      return;
    }
    try {
      const res = await fetch(intg.baseUrl, {
        method: 'GET',
        headers: intg.apiKey ? { 'Authorization': `Bearer ${intg.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        toast.success(`${intg.name} connection successful!`);
      } else {
        toast.error(`${intg.name} returned status ${res.status}`);
      }
    } catch {
      toast.error(`Cannot reach ${intg.name} — check URL and network`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="layer-card p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <ExternalLink size={20} className="text-brand-600" /> External API Integrations
        </h3>
        <p className="text-sm text-gray-500 mb-5">Connect third-party services to extend HRMS functionality. API keys are optional — leave blank if the service doesn't require authentication.</p>

        <div className="space-y-4">
          {integrations.map((intg, i) => (
            <div key={intg.name} className={cn('border rounded-xl p-4 transition-all', intg.enabled ? 'border-brand-200 bg-brand-50/30' : 'border-gray-200')}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', intg.enabled ? 'bg-brand-100' : 'bg-gray-100')}>
                    <ExternalLink size={18} className={intg.enabled ? 'text-brand-600' : 'text-gray-400'} />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800">{intg.name}</h4>
                    <p className="text-xs text-gray-400">{intg.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(i === 0 ? taskConfigRes?.data?.isActive : intg.baseUrl) && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Connected</span>
                  )}
                  <button onClick={() => setEditingIndex(editingIndex === i ? null : i)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                    {editingIndex === i ? 'Close' : 'Configure'}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {editingIndex === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="pt-3 mt-3 border-t border-gray-100 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
                        <input value={intg.baseUrl}
                          onChange={e => { const n = [...integrations]; n[i].baseUrl = e.target.value; setIntegrations(n); }}
                          placeholder="https://api.example.com" className="input-glass w-full text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">API Key (optional)</label>
                        <input type="password" value={intg.apiKey}
                          onChange={e => { const n = [...integrations]; n[i].apiKey = e.target.value; setIntegrations(n); }}
                          placeholder="Leave blank if not required" className="input-glass w-full text-sm" />
                        <p className="text-[10px] text-gray-400 mt-1">
                          {i === 0 && taskConfigRes?.data ? 'Key is encrypted on server. Enter a new key to update, or leave blank to keep existing.' : 'Leave empty if the service doesn\'t require authentication'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleSaveIntegration(i)} disabled={i === 0 && savingTask} className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                          {i === 0 && savingTask ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                        </button>
                        <button onClick={() => handleTestIntegration(i)} disabled={i === 0 && testingTask} className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                          {i === 0 && testingTask ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Test Connection
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links to other integrations */}
      <div className="layer-card p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Other Integrations</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <Mail size={18} className="text-blue-500" />
            <div>
              <p className="text-xs font-medium text-gray-700">Email (SMTP)</p>
              <p className="text-[10px] text-gray-400">Configure in Email tab</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <MessageCircle size={18} className="text-green-500" />
            <div>
              <p className="text-xs font-medium text-gray-700">WhatsApp</p>
              <p className="text-[10px] text-gray-400">Configure in WhatsApp tab</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <Cloud size={18} className="text-blue-600" />
            <div>
              <p className="text-xs font-medium text-gray-700">Microsoft Teams SSO</p>
              <p className="text-[10px] text-gray-400">Configure in Teams tab</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
            <Cpu size={18} className="text-purple-500" />
            <div>
              <p className="text-xs font-medium text-gray-700">AI API (DeepSeek/OpenAI)</p>
              <p className="text-[10px] text-gray-400">Configure in AI API Config tab</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiIntegrationsTab() {
  const { data: res, isLoading } = useGetAiConfigQuery();
  const [saveConfig, { isLoading: saving }] = useSaveAiConfigMutation();
  const [testConnection, { isLoading: testing }] = useTestAiConnectionMutation();

  const config = res?.data;

  const [provider, setProvider] = useState('DEEPSEEK');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('deepseek-chat');
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    if (config) {
      setProvider(config.provider || 'DEEPSEEK');
      setModelName(config.modelName || 'deepseek-chat');
      setBaseUrl(config.baseUrl || '');
      setApiKey('');
    }
  }, [config]);

  const handleProviderChange = (p: string) => {
    if (p === provider) return; // Don't reset if clicking same provider
    setProvider(p);
    setTestResult(null);

    // If switching back to the saved provider, restore saved values
    if (config && p === config.provider) {
      setModelName(config.modelName || PROVIDER_DEFAULTS[p]?.modelName || '');
      setBaseUrl(config.baseUrl || '');
      setApiKey(''); // Keep empty — saved key is still in backend
    } else {
      // New provider — show defaults, user must enter a new key
      const defaults = PROVIDER_DEFAULTS[p];
      if (defaults) setModelName(defaults.modelName);
      setBaseUrl('');
      setApiKey('');
    }
  };

  const handleSave = async () => {
    const isSameProvider = provider === config?.provider;
    // Require API key: first-time setup, decrypt error, or switching to a different provider without a key
    if (!apiKey && (!config?.hasApiKey || config?.decryptError || !isSameProvider)) {
      toast.error(isSameProvider ? 'Please enter an API key' : 'Please enter an API key for the new provider');
      return;
    }
    try {
      const body: any = { provider, modelName };
      if (apiKey) body.apiKey = apiKey.trim(); // Trim whitespace from pasted keys
      if (provider === 'CUSTOM' && baseUrl) body.baseUrl = baseUrl;
      await saveConfig(body).unwrap();
      toast.success(apiKey ? 'AI configuration saved with new API key' : 'AI configuration updated');
      setApiKey('');
      setTestResult(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to save AI configuration');
    }
  };

  const handleTest = async () => {
    try {
      // Send current form values so we test what the user sees, not just what's in DB
      const result = await testConnection({ provider, modelName, baseUrl: provider === 'CUSTOM' ? baseUrl : undefined, apiKey: apiKey || undefined }).unwrap();
      setTestResult(result.data);
      if (result.data?.success) {
        toast.success(`Connection successful! (${result.data.latencyMs}ms)`);
      } else {
        toast.error(result.data?.message || 'Connection test failed');
      }
    } catch {
      toast.error('Connection test failed');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-brand-600" size={32} /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Warning banner — show when no API key is configured */}
      {config && !config.hasApiKey && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={20} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-700">AI provider needs an API key</p>
            <p className="text-xs text-blue-600">Select your AI provider below and enter an API key to enable resume scoring, interview questions, and AI assistant.</p>
          </div>
        </div>
      )}

      {/* AI Provider Configuration */}
      <div className="layer-card p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Cpu size={20} className="text-brand-600" /> AI Provider
        </h3>
        <p className="text-sm text-gray-500 mb-5">Configure which AI model powers resume scoring, interview questions, and the AI assistant.</p>

        <div className="space-y-4">
          {/* Provider Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
            <div className="grid grid-cols-5 gap-2">
              {Object.keys(PROVIDER_DEFAULTS).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  className={cn(
                    'px-3 py-2.5 rounded-lg text-xs font-medium border transition-all',
                    provider === p
                      ? 'bg-brand-50 border-brand-300 text-brand-700 ring-2 ring-brand-200'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  )}
                >
                  {p === 'DEEPSEEK' ? 'DeepSeek' : p === 'OPENAI' ? 'OpenAI' : p === 'ANTHROPIC' ? 'Anthropic' : p === 'GEMINI' ? 'Gemini' : 'Custom'}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={config?.hasApiKey ? (config.apiKeyMasked || '••••••••') : 'Enter your API key here'}
                className="input-glass w-full text-sm pr-10"
              />
              <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
            {config?.hasApiKey && provider === config.provider && !apiKey && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <CheckCircle2 size={12} className="text-green-500" />
                <p className="text-xs text-green-600 font-medium">API key is saved and encrypted. Leave blank to keep it, or enter a new key to replace.</p>
              </div>
            )}
            {config?.decryptError && provider === config.provider && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertTriangle size={12} className="text-red-500" />
                <p className="text-xs text-red-600 font-medium">Saved key could not be read. Please re-enter your API key.</p>
              </div>
            )}
            {provider !== config?.provider && !apiKey && (
              <p className="text-xs text-amber-500 mt-1">You are switching providers. Enter a new API key for this provider.</p>
            )}
            {!config?.hasApiKey && !config?.decryptError && provider === config?.provider && (
              <p className="text-xs text-gray-400 mt-1">Your key is encrypted with AES-256-GCM before storage.</p>
            )}
          </div>

          {/* Base URL (only for CUSTOM) */}
          {provider === 'CUSTOM' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
              <input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://your-api-endpoint.com"
                className="input-glass w-full text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Must be OpenAI-compatible. The endpoint /v1/chat/completions will be called.</p>
            </div>
          )}

          {/* Model Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
            <input
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder="Model identifier"
              className="input-glass w-full text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button onClick={handleSave} disabled={saving || !modelName}
              className="btn-primary flex items-center gap-2 text-sm">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Configuration
            </button>
            <button onClick={handleTest} disabled={testing || (!apiKey && (!config?.hasApiKey || provider !== config?.provider))}
              className="btn-secondary flex items-center gap-2 text-sm"
              title={!config?.hasApiKey && !apiKey ? 'Save an API key first to test the connection' : 'Test the AI provider connection'}>
              {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              Test Connection
            </button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={cn(
              'rounded-xl px-4 py-3 border',
              testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
            )}>
              <div className="flex items-center gap-2 mb-1">
                {testResult.success ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-red-600" />}
                <span className={cn('text-sm font-medium', testResult.success ? 'text-green-700' : 'text-red-700')}>
                  {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                </span>
              </div>
              {testResult.success ? (
                <div className="text-xs text-green-600 space-y-0.5">
                  <p>Provider: {testResult.provider} | Model: {testResult.model}</p>
                  <p>Latency: {testResult.latencyMs}ms</p>
                  <p className="text-gray-500 italic mt-1">"{testResult.response}"</p>
                </div>
              ) : (
                <p className="text-xs text-red-600">{testResult.message}</p>
              )}
            </div>
          )}

          {/* Last updated info */}
          {config?.updatedAt && (
            <p className="text-xs text-gray-400">
              Last updated: {new Date(config.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
      </div>

      {/* Knowledge Base */}
      <KnowledgeBaseSection />

      {/* Default DeepSeek info */}
      <div className="layer-card p-5 bg-blue-50/50 border border-blue-100">
        <div className="flex items-start gap-3">
          <Zap size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Getting Started with AI</p>
            <p className="text-xs text-blue-600 mt-1">DeepSeek is the recommended default provider with affordable pricing. Sign up at <span className="font-mono">platform.deepseek.com</span> to get an API key. You can also use OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint. Select your provider above, enter the API key, save, and test the connection.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeBaseSection() {
  const { data: res, isLoading } = useGetKnowledgeBaseQuery();
  const [addDoc, { isLoading: adding }] = useAddKnowledgeDocMutation();
  const [deleteDoc] = useDeleteKnowledgeDocMutation();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const docs = res?.data || [];

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required');
      return;
    }
    try {
      await addDoc({ title: title.trim(), content: content.trim() }).unwrap();
      toast.success('Knowledge document added');
      setTitle('');
      setContent('');
    } catch {
      toast.error('Failed to add knowledge document');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(id).unwrap();
      toast.success('Knowledge document deleted');
    } catch {
      toast.error('Failed to delete knowledge document');
    }
  };

  return (
    <div className="layer-card p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
        <BookOpen size={20} className="text-brand-600" /> Knowledge Base
      </h3>
      <p className="text-sm text-gray-500 mb-5">Upload documents to train the AI assistant on company policies.</p>

      {/* Add Document Form */}
      <div className="space-y-3 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g., Leave Policy, Work from Home Guidelines"
            className="input-glass w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Paste the full document content here..."
            rows={5}
            className="input-glass w-full text-sm resize-y"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !title.trim() || !content.trim()}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Add Document
        </button>
      </div>

      {/* Document List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-brand-600" size={24} />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No knowledge documents added yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc: any) => (
            <div key={doc.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{doc.title}</p>
                <p className="text-xs text-gray-400">
                  Added {new Date(doc.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </p>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="ml-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                title="Delete document"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== AGENT SETUP TAB ===== */
const AGENT_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes — agent considered disconnected after this

function AgentSetupTab() {
  const { data: res, isLoading } = useGetAgentSetupListQuery();
  const [generateCode, { isLoading: generating }] = useGenerateAgentCodeMutation();
  const [regenerateCode, { isLoading: regenerating }] = useRegenerateAgentCodeMutation();
  const [bulkGenerate, { isLoading: bulkGenerating }] = useBulkGenerateAgentCodesMutation();
  const [search, setSearch] = useState('');
  const [liveStatuses, setLiveStatuses] = useState<Record<string, { isActive: boolean; lastHeartbeat: string }>>({});

  const employees: any[] = res?.data || [];

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
  const downloadUrl = `${apiUrl.replace('/api', '')}/uploads/agent/aniston-agent-setup.exe`;

  // Real-time socket updates
  useEffect(() => {
    const handler = (data: any) => {
      if (data?.employeeId) {
        setLiveStatuses(prev => ({
          ...prev,
          [data.employeeId]: { isActive: true, lastHeartbeat: data.timestamp || new Date().toISOString() },
        }));
      }
    };
    onSocketEvent('agent:heartbeat', handler);
    return () => { offSocketEvent('agent:heartbeat', handler); };
  }, []);

  // Auto-fade: mark as disconnected if no heartbeat in 2 min
  useEffect(() => {
    const interval = setInterval(() => {
      const twoMinAgo = Date.now() - AGENT_HEARTBEAT_TIMEOUT_MS;
      setLiveStatuses(prev => {
        const next = { ...prev };
        for (const [id, status] of Object.entries(next)) {
          if (status.isActive && new Date(status.lastHeartbeat).getTime() < twoMinAgo) {
            next[id] = { ...status, isActive: false };
          }
        }
        return next;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatus = (emp: any) => {
    const live = liveStatuses[emp.id];
    if (live) return live;
    return emp.agentStatus || { isActive: false, lastHeartbeat: null };
  };

  const filtered = employees.filter((e: any) => {
    if (!search) return true;
    return `${e.firstName} ${e.lastName} ${e.employeeCode} ${e.email || ''}`.toLowerCase().includes(search.toLowerCase());
  });

  const connectedCount = employees.filter(e => getStatus(e).isActive).length;
  const withCodeCount = employees.filter(e => !!e.agentPairingCode).length;

  const handleGenerate = async (employeeId: string) => {
    try {
      const result = await generateCode({ employeeId }).unwrap();
      const code = result?.data?.code;
      if (code) {
        navigator.clipboard.writeText(code)
          .then(() => toast.success(`Code generated: ${code} (copied to clipboard)`))
          .catch(() => toast.success(`Code generated: ${code} — copy it manually`));
      }
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleRegenerate = async (employeeId: string) => {
    if (!confirm('This will invalidate the old code. The agent on this employee\'s machine will need to be reconfigured. Continue?')) return;
    try {
      const result = await regenerateCode({ employeeId }).unwrap();
      const code = result?.data?.code;
      if (code) {
        navigator.clipboard.writeText(code)
          .then(() => toast.success(`New code: ${code} (copied to clipboard)`))
          .catch(() => toast.success(`New code: ${code} — copy it manually`));
      }
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleBulkGenerate = async () => {
    if (!confirm(`Generate codes for all ${employees.length - withCodeCount} employees without a code?`)) return;
    try {
      const result = await bulkGenerate().unwrap();
      toast.success(`Generated ${result?.data?.generated || 0} codes`);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
      .then(() => toast.success('Code copied to clipboard'))
      .catch(() => toast.error('Failed to copy — please copy manually'));
  };

  const relativeTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-brand-600" size={32} /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="layer-card p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Monitor size={20} className="text-brand-600" /> Agent Setup</h3>
            <p className="text-sm text-gray-500 mt-0.5">Generate permanent pairing codes and deploy the desktop agent to employee machines.</p>
          </div>
          <a href={downloadUrl} download className="btn-primary text-sm flex items-center gap-1.5">
            <Download size={14} /> Download Agent (.exe)
          </a>
        </div>
      </div>

      {/* Summary + Search + Bulk */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..."
              className="input-glass w-full pl-10 text-sm" />
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> {connectedCount} connected</span>
            <span>{withCodeCount} with code</span>
            <span>{employees.length} total</span>
          </div>
        </div>
        {employees.length - withCodeCount > 0 && (
          <button onClick={handleBulkGenerate} disabled={bulkGenerating}
            className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap">
            {bulkGenerating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Generate All Codes ({employees.length - withCodeCount})
          </button>
        )}
      </div>

      {/* Employee Table */}
      <div className="layer-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Employee</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Department</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Agent Code</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Status</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Last Seen</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp: any) => {
              const status = getStatus(emp);
              return (
                <tr key={emp.id} className="border-b border-gray-50 hover:bg-surface-2">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                        {emp.avatar ? <img src={getUploadUrl(emp.avatar)} alt="" className="w-full h-full rounded-full object-cover" /> : getInitials(`${emp.firstName} ${emp.lastName}`)}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{emp.firstName} {emp.lastName}</p>
                        <p className="text-[11px] text-gray-400">{emp.employeeCode} · {emp.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-500">{emp.department || '—'}</td>
                  <td className="p-3">
                    {emp.agentPairingCode ? (
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700 select-all" data-mono>{emp.agentPairingCode}</code>
                        <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium">Permanent</span>
                        <button onClick={() => copyCode(emp.agentPairingCode)} className="text-gray-400 hover:text-brand-600 p-0.5" title="Copy code">
                          <Copy size={12} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">No code</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-2 h-2 rounded-full', status.isActive ? 'bg-green-500 animate-pulse' : emp.agentPairedAt ? 'bg-red-400' : 'bg-gray-300')} />
                      <span className={cn('text-xs font-medium', status.isActive ? 'text-green-600' : emp.agentPairedAt ? 'text-red-500' : 'text-gray-400')}>
                        {status.isActive ? 'Connected' : emp.agentPairedAt ? 'Disconnected' : 'Not paired'}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-400">{relativeTime(status.lastHeartbeat)}</td>
                  <td className="p-3">
                    <div className="flex gap-1.5">
                      {!emp.agentPairingCode ? (
                        <button onClick={() => handleGenerate(emp.id)} disabled={generating}
                          className="btn-primary text-[11px] py-1 px-2.5 flex items-center gap-1">
                          {generating ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Generate Code
                        </button>
                      ) : (
                        <button onClick={() => handleRegenerate(emp.id)} disabled={regenerating}
                          className="text-[11px] py-1 px-2.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center gap-1"
                          title="Generate new code (invalidates old)">
                          <RefreshCw size={10} /> Regenerate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-400">No employees found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Setup instructions */}
      <div className="layer-card p-4 bg-blue-50/50 border border-blue-100">
        <p className="text-sm text-blue-800 font-medium mb-1">How to set up an agent:</p>
        <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside">
          <li>Click "Generate Code" for the employee to get a permanent pairing code.</li>
          <li>Download and install the agent (.exe) on the employee's computer.</li>
          <li>Open the agent and paste the pairing code when prompted.</li>
          <li>Once connected, the status will turn green and activity tracking begins automatically.</li>
        </ol>
      </div>
    </div>
  );
}
