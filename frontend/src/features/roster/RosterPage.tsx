import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, MapPin, Users, Plus, Trash2, Search, ChevronRight } from 'lucide-react';
import {
  useGetShiftsQuery, useCreateShiftMutation, useDeleteShiftMutation,
  useGetLocationsQuery, useCreateLocationMutation, useDeleteLocationMutation,
  useAssignShiftMutation,
} from '../workforce/workforceApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import toast from 'react-hot-toast';

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

function ShiftsPanel() {
  const { data: res } = useGetShiftsQuery();
  const shifts = res?.data || [];
  const [createShift, { isLoading: creating }] = useCreateShiftMutation();
  const [deleteShift] = useDeleteShiftMutation();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15, fullDayHours: 8, isDefault: false });

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('Name and code required'); return; }
    try {
      await createShift(form).unwrap();
      toast.success('Shift created');
      setShow(false);
      setForm({ name: '', code: '', startTime: '09:00', endTime: '18:00', graceMinutes: 15, fullDayHours: 8, isDefault: false });
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShow(!show)} className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Create Shift</button>
      </div>

      {show && (
        <div className="layer-card p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Shift Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-glass w-full text-sm" placeholder="Morning Shift" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Code *</label>
              <input value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} className="input-glass w-full text-sm" placeholder="MORNING" /></div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Start Time</label>
              <input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">End Time</label>
              <input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Grace (min)</label>
              <input type="number" value={form.graceMinutes} onChange={e => setForm({...form, graceMinutes: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Full Day (hrs)</label>
              <input type="number" value={form.fullDayHours} onChange={e => setForm({...form, fullDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm({...form, isDefault: e.target.checked})} className="rounded" />
            Set as default shift
          </label>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm">{creating ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setShow(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shifts.map((s: any) => (
          <div key={s.id} className="layer-card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-800">{s.name}</h3>
                  <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500" data-mono>{s.code}</span>
                  {s.isDefault && <span className="text-xs bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded">Default</span>}
                </div>
                <p className="text-sm text-gray-500 mt-1">{s.startTime} — {s.endTime}</p>
              </div>
              <button onClick={async () => { if (confirm('Deactivate?')) { await deleteShift(s.id).unwrap(); toast.success('Done'); } }}
                className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
            </div>
            <div className="flex gap-3 text-xs text-gray-400">
              <span>Grace: {s.graceMinutes}min</span>
              <span>Full day: {Number(s.fullDayHours)}hrs</span>
              <span>{s._count?.assignments || 0} assigned</span>
            </div>
          </div>
        ))}
        {shifts.length === 0 && <p className="text-sm text-gray-400 col-span-3 text-center py-8">No shifts created yet</p>}
      </div>
    </div>
  );
}

function LocationsPanel() {
  const { data: res } = useGetLocationsQuery();
  const locations = res?.data || [];
  const [createLocation, { isLoading: creating }] = useCreateLocationMutation();
  const [deleteLocation] = useDeleteLocationMutation();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '', latitude: '', longitude: '', radiusMeters: 200, strictMode: false });

  const handleCreate = async () => {
    if (!form.name || !form.city || !form.latitude || !form.longitude) { toast.error('Fill required fields'); return; }
    try {
      await createLocation({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) }).unwrap();
      toast.success('Location created');
      setShow(false);
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShow(!show)} className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Add Location</button>
      </div>

      {show && (
        <div className="layer-card p-5 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">City *</label>
              <input value={form.city} onChange={e => setForm({...form, city: e.target.value})} className="input-glass w-full text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Radius (m)</label>
              <input type="number" value={form.radiusMeters} onChange={e => setForm({...form, radiusMeters: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Address</label>
            <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="input-glass w-full text-sm" /></div>
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
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm">{creating ? 'Creating...' : 'Create'}</button>
            <button onClick={() => setShow(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Map */}
      {locations.length > 0 && (
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
            <button onClick={async () => { if (confirm('Delete?')) { await deleteLocation(l.id).unwrap(); toast.success('Deleted'); } }}
              className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssignmentsPanel() {
  const { data: empRes } = useGetEmployeesQuery({ limit: 100 });
  const { data: shiftRes } = useGetShiftsQuery();
  const [assignShift, { isLoading }] = useAssignShiftMutation();
  const [search, setSearch] = useState('');
  const employees = empRes?.data || [];
  const shifts = shiftRes?.data || [];
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const filtered = employees.filter((e: any) => {
    if (!search) return true;
    return `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase());
  });

  const handleAssign = async (empId: string) => {
    const shiftId = assignments[empId];
    if (!shiftId) return;
    try {
      await assignShift({ employeeId: empId, shiftId, startDate: new Date().toISOString().split('T')[0] }).unwrap();
      toast.success('Shift assigned');
      setAssignments(prev => ({ ...prev, [empId]: '' }));
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
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp: any) => (
              <tr key={emp.id} className="border-b border-gray-50 hover:bg-surface-2">
                <td className="p-3">
                  <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-gray-400">{emp.employeeCode}</p>
                </td>
                <td className="p-3"><span className="badge badge-info text-xs">{emp.workMode}</span></td>
                <td className="p-3">
                  <select value={assignments[emp.id] || ''} onChange={e => setAssignments(prev => ({...prev, [emp.id]: e.target.value}))}
                    className="input-glass text-xs py-1.5 w-48">
                    <option value="">Select shift...</option>
                    {shifts.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}
                  </select>
                </td>
                <td className="p-3">
                  {assignments[emp.id] && (
                    <button onClick={() => handleAssign(emp.id)} disabled={isLoading}
                      className="btn-primary text-xs py-1 px-3">Assign</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
