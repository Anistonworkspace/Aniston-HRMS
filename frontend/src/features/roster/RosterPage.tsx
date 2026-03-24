import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, MapPin, Users, Plus, Trash2, Search, Pencil, X, Save, Loader2 } from 'lucide-react';
import {
  useGetShiftsQuery, useCreateShiftMutation, useUpdateShiftMutation, useDeleteShiftMutation,
  useGetLocationsQuery, useCreateLocationMutation, useUpdateLocationMutation, useDeleteLocationMutation,
  useAssignShiftMutation,
} from '../workforce/workforceApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import LocationPickerMap from '../../components/map/LocationPickerMap';
import LocationSearch from '../../components/map/LocationSearch';
import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

type Tab = 'shifts' | 'locations' | 'assignments';

export default function RosterPage() {
  const [tab, setTab] = useState<Tab>('shifts');

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Roster Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage shifts, locations, and employee assignments</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: 'shifts' as Tab, label: 'Shifts', icon: Clock },
          { key: 'locations' as Tab, label: 'Office Locations', icon: MapPin },
          { key: 'assignments' as Tab, label: 'Assign Employees', icon: Users },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            }`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'shifts' && <ShiftsPanel />}
      {tab === 'locations' && <LocationsPanel />}
      {tab === 'assignments' && <AssignmentsPanel />}
    </div>
  );
}

/* ===== SHIFTS PANEL ===== */
function ShiftsPanel() {
  const { data: res } = useGetShiftsQuery();
  const shifts = res?.data || [];
  const [createShift, { isLoading: creating }] = useCreateShiftMutation();
  const [updateShift] = useUpdateShiftMutation();
  const [deleteShift] = useDeleteShiftMutation();
  const [show, setShow] = useState(false);
  const [editShift, setEditShift] = useState<any>(null);
  const emptyForm = { name: '', code: '', shiftType: 'OFFICE' as string, startTime: '09:00', endTime: '18:00', graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, trackingIntervalMinutes: undefined as number | undefined, isDefault: false };
  const [form, setForm] = useState(emptyForm);

  // Auto-generate code from name + type
  const autoGenerateCode = (name: string, shiftType: string) => {
    const base = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 15);
    const suffix = shiftType === 'OFFICE' ? 'OFC' : shiftType === 'HYBRID' ? 'HYB' : 'FLD';
    return base ? `${base}-${suffix}` : '';
  };

  const handleShiftTypeChange = (shiftType: string) => {
    setForm(prev => ({
      ...prev,
      shiftType,
      code: autoGenerateCode(prev.name, shiftType),
      trackingIntervalMinutes: shiftType === 'FIELD' ? 60 : undefined,
    }));
  };

  const handleNameChange = (name: string) => {
    setForm(prev => ({
      ...prev,
      name,
      code: autoGenerateCode(name, prev.shiftType),
    }));
  };

  const preparePayload = () => {
    const { name, code, shiftType, startTime, endTime, graceMinutes, halfDayHours, fullDayHours, trackingIntervalMinutes, isDefault } = form;
    const payload: any = { name, code, shiftType, startTime, endTime, graceMinutes, halfDayHours, fullDayHours, isDefault };
    if (shiftType === 'FIELD' && trackingIntervalMinutes) payload.trackingIntervalMinutes = trackingIntervalMinutes;
    return payload;
  };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('Name and code required'); return; }
    try {
      await createShift(preparePayload()).unwrap();
      toast.success('Shift created');
      setShow(false);
      setForm(emptyForm);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleEdit = (s: any) => {
    setEditShift(s);
    setForm({
      name: s.name, code: s.code, shiftType: s.shiftType || 'OFFICE', startTime: s.startTime, endTime: s.endTime,
      graceMinutes: s.graceMinutes, halfDayHours: Number(s.halfDayHours || 4), fullDayHours: Number(s.fullDayHours),
      trackingIntervalMinutes: s.trackingIntervalMinutes || undefined, isDefault: s.isDefault,
    });
  };

  const handleUpdate = async () => {
    if (!editShift) return;
    try {
      await updateShift({ id: editShift.id, data: preparePayload() }).unwrap();
      toast.success('Shift updated');
      setEditShift(null);
      setForm(emptyForm);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const isEditing = !!editShift;
  const showForm = show || isEditing;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!showForm && (
          <button onClick={() => { setShow(true); setEditShift(null); setForm(emptyForm); }}
            className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Create Shift</button>
        )}
      </div>

      {showForm && (
        <div className="layer-card p-5 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-700">{isEditing ? 'Edit Shift' : 'Create Shift'}</h3>
            <button onClick={() => { setShow(false); setEditShift(null); setForm(emptyForm); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          {/* Shift Type Selector */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Shift Type</label>
            <div className="flex gap-2">
              {[
                { key: 'OFFICE', label: 'Office', color: 'blue' },
                { key: 'HYBRID', label: 'Hybrid', color: 'purple' },
                { key: 'FIELD', label: 'Field', color: 'green' },
              ].map(t => (
                <button key={t.key} type="button" onClick={() => handleShiftTypeChange(t.key)}
                  className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                    form.shiftType === t.key
                      ? `bg-${t.color}-50 text-${t.color}-700 border-${t.color}-200`
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  )}
                  style={form.shiftType === t.key ? {
                    backgroundColor: t.color === 'blue' ? '#eff6ff' : t.color === 'purple' ? '#faf5ff' : '#f0fdf4',
                    color: t.color === 'blue' ? '#1d4ed8' : t.color === 'purple' ? '#7e22ce' : '#15803d',
                    borderColor: t.color === 'blue' ? '#bfdbfe' : t.color === 'purple' ? '#e9d5ff' : '#bbf7d0',
                  } : {}}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Shift Name *</label>
              <input value={form.name} onChange={e => handleNameChange(e.target.value)} className="input-glass w-full text-sm" placeholder="Morning Shift" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Code <span className="text-gray-300 font-normal">(auto-generated)</span></label>
              <input value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} className="input-glass w-full text-sm text-gray-500" placeholder="Auto from name + type" /></div>
          </div>
          <div className={cn('grid gap-3', form.shiftType === 'FIELD' ? 'grid-cols-6' : 'grid-cols-5')}>
            <div><label className="block text-xs text-gray-500 mb-1">Start Time</label>
              <input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">End Time</label>
              <input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Grace (min)</label>
              <input type="number" value={form.graceMinutes} onChange={e => setForm({...form, graceMinutes: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Half Day (hrs)</label>
              <input type="number" value={form.halfDayHours} onChange={e => setForm({...form, halfDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Full Day (hrs)</label>
              <input type="number" value={form.fullDayHours} onChange={e => setForm({...form, fullDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
            {form.shiftType === 'FIELD' && (
              <div><label className="block text-xs text-gray-500 mb-1">GPS Interval</label>
                <select value={form.trackingIntervalMinutes || 60} onChange={e => setForm({...form, trackingIntervalMinutes: Number(e.target.value)})}
                  className="input-glass w-full text-sm">
                  <option value={15}>Every 15 min</option>
                  <option value={30}>Every 30 min</option>
                  <option value={60}>Every 1 hr</option>
                  <option value={120}>Every 2 hrs</option>
                  <option value={240}>Every 4 hrs</option>
                </select>
              </div>
            )}
          </div>

          {/* Hybrid info note */}
          {form.shiftType === 'HYBRID' && (
            <div className="bg-purple-50 rounded-lg p-3 text-xs text-purple-700 space-y-1">
              <p className="font-semibold">Hybrid Shift Tracking</p>
              <p>Office days: Geofence-based check-in/out + location tracking</p>
              <p>WFH days: Browser activity tracking (Page Visibility API), periodic "still working?" prompts, session duration</p>
            </div>
          )}

          {form.shiftType === 'FIELD' && (
            <div className="bg-green-50 rounded-lg p-3 text-xs text-green-700">
              <p className="font-semibold">Field Shift</p>
              <p>Live GPS tracking at the selected interval. Employee locations are recorded automatically.</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm({...form, isDefault: e.target.checked})} className="rounded" />
            Set as default shift
          </label>
          <div className="flex gap-2">
            <button onClick={isEditing ? handleUpdate : handleCreate} disabled={creating}
              className="btn-primary text-sm flex items-center gap-1.5">
              {isEditing ? <><Save size={14} /> Update</> : creating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setShow(false); setEditShift(null); setForm(emptyForm); }} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shifts.map((s: any) => (
          <div key={s.id} className="layer-card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-800">{s.name}</h3>
                  <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500" data-mono>{s.code}</span>
                  {s.shiftType && s.shiftType !== 'OFFICE' && (
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded',
                      s.shiftType === 'HYBRID' ? 'bg-purple-50 text-purple-600' : 'bg-green-50 text-green-600'
                    )}>{s.shiftType}</span>
                  )}
                  {s.isDefault && <span className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">Default</span>}
                </div>
                <p className="text-sm text-gray-500 mt-1">{s.startTime} — {s.endTime}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => handleEdit(s)} className="text-gray-400 hover:text-brand-600 p-1"><Pencil size={14} /></button>
                <button onClick={async () => { if (confirm('Deactivate?')) { await deleteShift(s.id).unwrap(); toast.success('Done'); } }}
                  className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
              <span>Grace: {s.graceMinutes}min</span>
              <span>Full day: {Number(s.fullDayHours)}hrs</span>
              {s.trackingIntervalMinutes && <span>GPS: every {s.trackingIntervalMinutes}min</span>}
              <span>{s._count?.assignments || 0} assigned</span>
            </div>
          </div>
        ))}
        {shifts.length === 0 && <p className="text-sm text-gray-400 col-span-3 text-center py-8">No shifts created yet</p>}
      </div>
    </div>
  );
}

/* ===== LOCATIONS PANEL ===== */
function LocationsPanel() {
  const { data: res } = useGetLocationsQuery();
  const locations = res?.data || [];
  const [createLocation, { isLoading: creating }] = useCreateLocationMutation();
  const [updateLocation] = useUpdateLocationMutation();
  const [deleteLocation] = useDeleteLocationMutation();
  const [show, setShow] = useState(false);
  const [editLoc, setEditLoc] = useState<any>(null);
  const emptyForm = { name: '', address: '', city: '', latitude: '', longitude: '', radiusMeters: 200, strictMode: false };
  const [form, setForm] = useState(emptyForm);

  const mapCoords = form.latitude && form.longitude
    ? { lat: Number(form.latitude), lng: Number(form.longitude) }
    : null;

  const handleMapChange = (coords: { lat: number; lng: number }) => {
    setForm({ ...form, latitude: coords.lat.toFixed(6), longitude: coords.lng.toFixed(6) });
  };

  const handleSearchSelect = (result: { name: string; address: string; city: string; state: string; lat: number; lng: number }) => {
    setForm({
      ...form,
      name: form.name || result.name,
      address: result.address,
      city: result.city,
      latitude: result.lat.toFixed(6),
      longitude: result.lng.toFixed(6),
    });
  };

  const handleCreate = async () => {
    if (!form.name || !form.city || !form.latitude || !form.longitude) { toast.error('Fill required fields'); return; }
    try {
      await createLocation({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) }).unwrap();
      toast.success('Location created');
      setShow(false);
      setForm(emptyForm);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const handleEdit = (l: any) => {
    const c = l.geofence?.coordinates as any;
    setEditLoc(l);
    setForm({
      name: l.name || '',
      address: l.address || '',
      city: l.city || '',
      latitude: c?.lat ? String(c.lat) : '',
      longitude: c?.lng ? String(c.lng) : '',
      radiusMeters: l.geofence?.radiusMeters || 200,
      strictMode: l.geofence?.strictMode || false,
    });
  };

  const handleUpdate = async () => {
    if (!editLoc) return;
    try {
      await updateLocation({ id: editLoc.id, data: { ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) } }).unwrap();
      toast.success('Location updated');
      setEditLoc(null);
      setForm(emptyForm);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const isEditing = !!editLoc;
  const showForm = show || isEditing;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!showForm && (
          <button onClick={() => { setShow(true); setEditLoc(null); setForm(emptyForm); }}
            className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Add Location</button>
        )}
      </div>

      {showForm && (
        <div className="layer-card p-5 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-gray-700">{isEditing ? 'Edit Location' : 'Add Location'}</h3>
            <button onClick={() => { setShow(false); setEditLoc(null); setForm(emptyForm); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>

          {/* Location Search */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Search location (auto-fills fields below)</label>
            <LocationSearch onSelect={handleSearchSelect} />
          </div>

          {/* Interactive Map */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Click map or drag marker to set coordinates</label>
            <LocationPickerMap
              value={mapCoords}
              onChange={handleMapChange}
              radius={form.radiusMeters}
              height={280}
            />
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-glass w-full text-sm" placeholder="Office name" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">City *</label>
              <input value={form.city} onChange={e => setForm({...form, city: e.target.value})} className="input-glass w-full text-sm" placeholder="New Delhi" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Radius (m)</label>
              <input type="number" value={form.radiusMeters} onChange={e => setForm({...form, radiusMeters: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Address</label>
            <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="input-glass w-full text-sm" placeholder="Full address" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Latitude *</label>
              <input type="number" step="any" value={form.latitude} onChange={e => setForm({...form, latitude: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Longitude *</label>
              <input type="number" step="any" value={form.longitude} onChange={e => setForm({...form, longitude: e.target.value})} className="input-glass w-full text-sm" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.strictMode} onChange={e => setForm({...form, strictMode: e.target.checked})} className="rounded" />
            Strict mode (block check-in outside geofence)
          </label>
          <div className="flex gap-2">
            <button onClick={isEditing ? handleUpdate : handleCreate} disabled={creating}
              className="btn-primary text-sm flex items-center gap-1.5">
              {isEditing ? <><Save size={14} /> Update</> : creating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setShow(false); setEditLoc(null); setForm(emptyForm); }} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* All locations map */}
      {locations.length > 0 && !showForm && (
        <div className="layer-card overflow-hidden" style={{ height: 300 }}>
          <MapContainer center={[(locations[0]?.geofence?.coordinates as any)?.lat || 28.6, (locations[0]?.geofence?.coordinates as any)?.lng || 77.2]} zoom={11} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
            {locations.map((l: any) => {
              const c = l.geofence?.coordinates as any;
              if (!c?.lat) return null;
              return <span key={l.id}><Marker position={[c.lat, c.lng]} /><Circle center={[c.lat, c.lng]} radius={l.geofence?.radiusMeters || 200} pathOptions={{ color: '#4f46e5', fillOpacity: 0.15 }} /></span>;
            })}
          </MapContainer>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {locations.map((l: any) => (
          <div key={l.id} className="layer-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin size={18} className="text-brand-500" />
              <div>
                <p className="text-sm font-medium text-gray-800">{l.name}</p>
                <p className="text-xs text-gray-400">{l.address || l.city} · {l.geofence?.radiusMeters || 0}m{l.geofence?.strictMode ? ' · Strict' : ''}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => handleEdit(l)} className="text-gray-400 hover:text-brand-600 p-1"><Pencil size={14} /></button>
              <button onClick={async () => { if (confirm('Delete?')) { await deleteLocation(l.id).unwrap(); toast.success('Deleted'); } }}
                className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== ASSIGNMENTS PANEL ===== */
const SHIFT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  OFFICE: { label: 'Office', color: 'text-blue-600' },
  HYBRID: { label: 'Hybrid', color: 'text-purple-600' },
  FIELD: { label: 'Field', color: 'text-green-600' },
};

function AssignmentsPanel() {
  const { data: empRes } = useGetEmployeesQuery({ limit: 100 });
  const { data: shiftRes } = useGetShiftsQuery();
  const { data: locRes } = useGetLocationsQuery();
  const [assignShift, { isLoading }] = useAssignShiftMutation();
  const [search, setSearch] = useState('');
  const employees = empRes?.data || [];
  const shifts = shiftRes?.data || [];
  const locations = locRes?.data || [];
  const [assignments, setAssignments] = useState<Record<string, { shiftId: string; locationId: string }>>({});

  const filtered = employees.filter((e: any) => {
    if (!search) return true;
    return `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase());
  });

  const getSelectedShift = (empId: string) => {
    const shiftId = assignments[empId]?.shiftId;
    return shifts.find((s: any) => s.id === shiftId);
  };

  const handleAssign = async (empId: string) => {
    const { shiftId, locationId } = assignments[empId] || {};
    if (!shiftId) return;
    const selectedShift = shifts.find((s: any) => s.id === shiftId);

    // Validate: OFFICE shifts require a location
    if (selectedShift?.shiftType === 'OFFICE' && !locationId) {
      toast.error('Please select an office location for this employee');
      return;
    }

    try {
      await assignShift({
        employeeId: empId, shiftId,
        locationId: (selectedShift?.shiftType === 'OFFICE' && locationId) ? locationId : undefined,
        startDate: new Date().toISOString().split('T')[0],
      }).unwrap();
      toast.success('Shift assigned successfully');
      setAssignments(prev => ({ ...prev, [empId]: { shiftId: '', locationId: '' } }));
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..."
          className="input-glass w-full pl-10 text-sm" />
      </div>

      <div className="layer-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Employee</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Work Mode</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Assign Shift</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Office Location / Info</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp: any) => {
              const sel = getSelectedShift(emp.id);
              const selType = sel?.shiftType || '';
              const needsLocation = selType === 'OFFICE';
              const hasLocation = !!assignments[emp.id]?.locationId;
              const canAssign = assignments[emp.id]?.shiftId && (!needsLocation || hasLocation);

              return (
                <tr key={emp.id} className="border-b border-gray-50 hover:bg-surface-2">
                  <td className="p-3">
                    <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                    <p className="text-xs text-gray-400">{emp.employeeCode}</p>
                  </td>
                  <td className="p-3"><span className="badge badge-info text-xs">{emp.workMode}</span></td>
                  <td className="p-3">
                    <select value={assignments[emp.id]?.shiftId || ''} onChange={e => setAssignments(prev => ({...prev, [emp.id]: { shiftId: e.target.value, locationId: '' }}))}
                      className="input-glass text-xs py-1.5 w-52">
                      <option value="">Select shift...</option>
                      {shifts.map((s: any) => {
                        const tl = SHIFT_TYPE_LABELS[s.shiftType] || SHIFT_TYPE_LABELS.OFFICE;
                        return <option key={s.id} value={s.id}>[{tl.label}] {s.name} ({s.startTime}-{s.endTime})</option>;
                      })}
                    </select>
                  </td>
                  <td className="p-3">
                    {/* OFFICE → required location dropdown */}
                    {selType === 'OFFICE' && (
                      <div>
                        <select value={assignments[emp.id]?.locationId || ''} onChange={e => setAssignments(prev => ({...prev, [emp.id]: { ...prev[emp.id], locationId: e.target.value }}))}
                          className={cn('input-glass text-xs py-1.5 w-44', !hasLocation && 'border-red-300')}>
                          <option value="">Select office *</option>
                          {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name} ({l.city})</option>)}
                        </select>
                        {!hasLocation && <p className="text-[10px] text-red-400 mt-0.5">Required for office shift</p>}
                      </div>
                    )}
                    {/* HYBRID → info text */}
                    {selType === 'HYBRID' && (
                      <span className="text-[10px] text-purple-500 bg-purple-50 px-2 py-1 rounded">WFH + Office · No fixed location</span>
                    )}
                    {/* FIELD → info text */}
                    {selType === 'FIELD' && (
                      <span className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded">Live GPS tracking · {sel?.trackingIntervalMinutes || 60}min interval</span>
                    )}
                    {/* No shift selected */}
                    {!selType && assignments[emp.id]?.shiftId === '' && (
                      <span className="text-[10px] text-gray-300">Select a shift first</span>
                    )}
                  </td>
                  <td className="p-3">
                    {assignments[emp.id]?.shiftId && (
                      <button onClick={() => handleAssign(emp.id)} disabled={isLoading || !canAssign}
                        className={cn('text-xs py-1.5 px-4 rounded-lg font-medium transition-colors',
                          canAssign ? 'btn-primary' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        )}>
                        {isLoading ? 'Assigning...' : 'Assign'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
