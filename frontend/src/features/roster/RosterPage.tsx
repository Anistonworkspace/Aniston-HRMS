import { useState } from 'react';
import { Clock, MapPin, Users, Plus, Trash2, Search, Pencil, X, Save, Loader2, Shield, Zap, Calendar, Sun, Home, Maximize2, Minimize2, Send, Repeat, Navigation, Map as MapIcon } from 'lucide-react';
import HomeLocationRequestsTab from './HomeLocationRequestsTab';
import ShiftChangeRequestsTab from './ShiftChangeRequestsTab';
import {
  useGetShiftsQuery, useCreateShiftMutation, useUpdateShiftMutation, useDeleteShiftMutation,
  useGetLocationsQuery, useCreateLocationMutation, useUpdateLocationMutation, useDeleteLocationMutation,
  useAssignShiftMutation, useAutoAssignDefaultMutation, useGetAllAssignmentsQuery,
  useCreateShiftChangeRequestMutation,
} from '../workforce/workforceApi';
import { useGetEmployeesQuery } from '../employee/employeeApi';
import { useGetOrgLeaveSettingsQuery } from '../leaves/leaveApi';
import { useAppSelector } from '../../app/store';
import LocationPickerMap from '../../components/map/LocationPickerMap';
import LocationSearch from '../../components/map/LocationSearch';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

// Auto-fit map to show all markers
function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  if (coords.length > 0) {
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }
  return null;
}

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

type Tab = 'shifts' | 'locations' | 'assignments' | 'home-locations' | 'shift-requests';
type ShiftFilter = string | null;

export default function RosterPage() {
  const [tab, setTab] = useState<Tab>('shifts');
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>(null);
  const { user } = useAppSelector((s) => s.auth);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const isHrOrAdmin = isAdmin || user?.role === 'HR';

  const goToAssignments = (shiftId?: string) => {
    setShiftFilter(shiftId || null);
    setTab('assignments');
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Roster Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage shifts, locations, and employee assignments</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          { key: 'shifts' as Tab, label: 'Shifts', icon: Clock },
          { key: 'locations' as Tab, label: 'Office Locations', icon: MapPin },
          { key: 'assignments' as Tab, label: 'Assign Employees', icon: Users },
          ...(isHrOrAdmin ? [
            { key: 'home-locations' as Tab, label: 'Home Locations', icon: Home },
          ] : []),
          ...(isHrOrAdmin ? [
            { key: 'shift-requests' as Tab, label: 'Shift Requests', icon: Repeat },
          ] : []),
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); if (t.key !== 'assignments') setShiftFilter(null); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? '' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
            }`}
            style={tab === t.key ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'shifts' && <ShiftsPanel onViewAssigned={goToAssignments} />}
      {tab === 'locations' && <LocationsPanel isHrOrAdmin={isHrOrAdmin} />}
      {tab === 'assignments' && <AssignmentsPanel shiftFilter={shiftFilter} onClearFilter={() => setShiftFilter(null)} />}
      {tab === 'home-locations' && isHrOrAdmin && <HomeLocationRequestsTab />}
      {tab === 'shift-requests' && isHrOrAdmin && <ShiftChangeRequestsTab />}
    </div>
  );
}

/* ===== SHIFT TYPE LABELS ===== */
const SHIFT_DISPLAY: Record<string, { label: string; description: string; badgeClass: string; bgColor: string; textColor: string; borderColor: string }> = {
  OFFICE: { label: 'General Shift', description: 'Geofence-based attendance. Employees can only mark in/out within assigned office locations. HR is notified if marking outside geofence.', badgeClass: 'bg-blue-50 text-blue-600', bgColor: '#eff6ff', textColor: '#1d4ed8', borderColor: '#bfdbfe' },
  FIELD: { label: 'Live Tracking', description: 'GPS-based live location tracking. Ideal for field sales employees. Locations are recorded at regular intervals.', badgeClass: 'bg-green-50 text-green-600', bgColor: '#f0fdf4', textColor: '#15803d', borderColor: '#bbf7d0' },
  HYBRID: { label: 'Hybrid (WFH)', description: 'Dual-location shift. Employees must clock in from either their approved home geofence or their assigned office geofence. GPS is required. Assigned via home location approval.', badgeClass: 'bg-purple-50 text-purple-600', bgColor: '#faf5ff', textColor: '#7c3aed', borderColor: '#ddd6fe' },
};

function getShiftDisplay(shiftType: string, shiftName?: string) {
  if (SHIFT_DISPLAY[shiftType]) return SHIFT_DISPLAY[shiftType];
  return { label: shiftName || shiftType, description: 'Custom shift with configured attendance policy.', badgeClass: 'bg-purple-50 text-purple-600', bgColor: '#faf5ff', textColor: '#7c3aed', borderColor: '#ddd6fe' };
}

/* ===== SHIFTS PANEL ===== */
function ShiftsPanel({ onViewAssigned }: { onViewAssigned: (shiftId: string) => void }) {
  const { data: res } = useGetShiftsQuery();
  const { data: orgSettingsRes } = useGetOrgLeaveSettingsQuery();
  const { data: assignmentsRes } = useGetAllAssignmentsQuery();
  const orgWorkingDays: string | undefined = orgSettingsRes?.data?.workingDays;
  const shifts = res?.data || [];
  const allAssignments: any[] = assignmentsRes?.data || [];
  const [createShift, { isLoading: creating }] = useCreateShiftMutation();
  const [updateShift, { isLoading: updating }] = useUpdateShiftMutation();
  const [deleteShift] = useDeleteShiftMutation();
  const [show, setShow] = useState(false);
  const [editShift, setEditShift] = useState<any>(null);
  const emptyForm = {
    name: '', code: '', shiftType: 'OFFICE' as string, startTime: '09:00', endTime: '18:00',
    halfDayHours: 4, fullDayHours: 8, trackingIntervalMinutes: undefined as number | undefined, isDefault: true,
    lateGraceMinutes: 15, lateHalfDayAfterMins: 120, latePenaltyEnabled: false, latePenaltyPerCount: 3,
    weekOffDays: [0] as number[], otEnabled: false, otThresholdMinutes: 30, otRateMultiplier: 1.5, otMaxHoursPerDay: 4,
    compOffEnabled: false, compOffMinOTHours: 4, compOffExpiryDays: 30, sundayWorkEnabled: false, sundayPayMultiplier: 2.0,
    allowWfh: false, wfhDays: [] as number[],
    isWfhShift: false,
  };
  const [form, setForm] = useState(emptyForm);

  const autoGenerateCode = (name: string, shiftType: string) => {
    const base = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 20);
    const suffix = shiftType === 'OFFICE' ? 'GEN' : shiftType === 'FIELD' ? 'LT' : shiftType === 'HYBRID' ? 'HYB' : 'SH';
    return base ? `${base}-${suffix}` : '';
  };

  const handleShiftTypeChange = (shiftType: string) => {
    setForm(prev => ({
      ...prev,
      shiftType,
      code: autoGenerateCode(prev.name, shiftType),
      trackingIntervalMinutes: shiftType === 'FIELD' ? 60 : undefined,
      isDefault: shiftType === 'OFFICE',
      // HYBRID shift always uses dual-geofence — never treat as pure WFH
      allowWfh: shiftType === 'HYBRID' ? true : prev.allowWfh,
      isWfhShift: false,
    }));
  };

  const handleNameChange = (name: string) => {
    setForm(prev => ({ ...prev, name, code: autoGenerateCode(name, prev.shiftType) }));
  };

  const preparePayload = () => {
    const { name, code, shiftType, startTime, endTime, halfDayHours, fullDayHours, trackingIntervalMinutes, isDefault,
      lateGraceMinutes, lateHalfDayAfterMins, latePenaltyEnabled, latePenaltyPerCount, weekOffDays,
      otEnabled, otThresholdMinutes, otRateMultiplier, otMaxHoursPerDay,
      compOffEnabled, compOffMinOTHours, compOffExpiryDays, sundayWorkEnabled, sundayPayMultiplier,
      allowWfh, wfhDays, isWfhShift } = form;
    // graceMinutes is an alias for lateGraceMinutes — send both so the backend can accept either
    const payload: any = { name, code, shiftType, startTime, endTime, graceMinutes: lateGraceMinutes, halfDayHours, fullDayHours, isDefault,
      lateGraceMinutes, lateHalfDayAfterMins, latePenaltyEnabled, latePenaltyPerCount, weekOffDays,
      otEnabled, otThresholdMinutes, otRateMultiplier, otMaxHoursPerDay,
      compOffEnabled, compOffMinOTHours, compOffExpiryDays, sundayWorkEnabled, sundayPayMultiplier,
      allowWfh, wfhDays: allowWfh ? wfhDays : [], isWfhShift };
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
      halfDayHours: Number(s.halfDayHours || 4), fullDayHours: Number(s.fullDayHours),
      trackingIntervalMinutes: s.trackingIntervalMinutes || undefined, isDefault: s.isDefault,
      lateGraceMinutes: s.lateGraceMinutes ?? 15,
      lateHalfDayAfterMins: s.lateHalfDayAfterMins ?? 120,
      latePenaltyEnabled: s.latePenaltyEnabled ?? false,
      latePenaltyPerCount: s.latePenaltyPerCount ?? 3,
      weekOffDays: s.weekOffDays ?? [0],
      otEnabled: s.otEnabled ?? false,
      otThresholdMinutes: s.otThresholdMinutes ?? 30,
      otRateMultiplier: Number(s.otRateMultiplier ?? 1.5),
      otMaxHoursPerDay: Number(s.otMaxHoursPerDay ?? 4),
      compOffEnabled: s.compOffEnabled ?? false,
      compOffMinOTHours: Number(s.compOffMinOTHours ?? 4),
      compOffExpiryDays: s.compOffExpiryDays ?? 30,
      sundayWorkEnabled: s.sundayWorkEnabled ?? false,
      sundayPayMultiplier: Number(s.sundayPayMultiplier ?? 2.0),
      allowWfh: s.allowWfh ?? false,
      wfhDays: s.wfhDays ?? [],
      isWfhShift: s.isWfhShift ?? false,
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

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const handleDelete = async (s: any) => {
    if (!confirm(`Delete shift "${s.name}"? ${s._count?.assignments > 0 ? `It has ${s._count.assignments} active assignment(s) and will be deactivated.` : ''}`)) return;
    try {
      await deleteShift(s.id).unwrap();
      toast.success('Shift deleted');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to delete'); }
  };

  const isEditing = !!editShift;
  const showForm = show || isEditing;

  return (
    <div className="space-y-4">
      {/* Working Days — configured in Leave Settings */}
      <div className="layer-card p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">Working Days</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {orgWorkingDays
              ? `${orgWorkingDays.split(',').length}-day week`
              : 'Not configured'}
            {' · '}
            <span className="text-indigo-500">Configure in Leave Management → Types</span>
          </p>
        </div>
      </div>

      {/* Default shifts info banner */}
      <div className="layer-card p-4 bg-blue-50/50 border border-blue-100">
        <p className="text-sm text-blue-800 font-semibold mb-1">Default Shifts (always maintained)</p>
        <ul className="text-xs text-blue-700 space-y-0.5 list-disc list-inside">
          <li><strong>General Shift</strong> — Geofence-based attendance. Employees mark in/out within assigned office locations. HR notified on out-of-geofence marking.</li>
          <li><strong>Live Tracking</strong> — GPS tracking for field sales employees. Location recorded at configurable intervals.</li>
        </ul>
        <p className="text-xs text-blue-500 mt-1.5">Additional shifts (e.g. Night Shift) can be created below with their own attendance policies.</p>
      </div>

      <div className="flex justify-end">
        {!showForm && (
          <button onClick={() => {
            setShow(true); setEditShift(null);
            setForm({ ...emptyForm, shiftType: 'OFFICE', name: '', code: '', isDefault: false });
          }}
            className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Create Shift</button>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto">
          <div className="flex items-start justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-6 mx-auto">
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-gray-700">{isEditing ? 'Edit Shift' : 'Create Shift'}</h3>
                  <button onClick={() => { setShow(false); setEditShift(null); setForm(emptyForm); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                </div>
                {/* Shift Type Selector */}
                {!isEditing && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1.5">Shift Type</label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: 'OFFICE', label: 'General Shift' },
                        { key: 'FIELD', label: 'Live Tracking' },
                        { key: 'HYBRID', label: 'Hybrid (WFH)' },
                      ].map(t => (
                        <button key={t.key} type="button" onClick={() => handleShiftTypeChange(t.key)}
                          className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                            form.shiftType === t.key ? '' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                          )}
                          style={form.shiftType === t.key ? {
                            backgroundColor: SHIFT_DISPLAY[t.key].bgColor,
                            color: SHIFT_DISPLAY[t.key].textColor,
                            borderColor: SHIFT_DISPLAY[t.key].borderColor,
                          } : {}}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Show current shift type when editing (read-only) */}
                {isEditing && editShift?.shiftType && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Shift Type:</span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', SHIFT_DISPLAY[editShift.shiftType]?.badgeClass)}>
                      {SHIFT_DISPLAY[editShift.shiftType]?.label || editShift.shiftType}
                    </span>
                    <span className="text-xs text-gray-400">(cannot be changed after creation)</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs text-gray-500 mb-1">Shift Name *</label>
                    <input value={form.name} onChange={e => handleNameChange(e.target.value)} className="input-glass w-full text-sm" placeholder={form.shiftType === 'OFFICE' ? 'General' : 'Live Tracking'} /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">Code <span className="text-gray-300 font-normal">(auto)</span></label>
                    <input value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} className="input-glass w-full text-sm text-gray-500" /></div>
                </div>
                <div className={cn('grid gap-3', form.shiftType === 'FIELD' ? 'grid-cols-6' : 'grid-cols-5')}>
                  <div><label className="block text-xs text-gray-500 mb-1">Start Time</label>
                    <input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="input-glass w-full text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">End Time</label>
                    <input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="input-glass w-full text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">Grace (min)</label>
                    <input type="number" value={form.lateGraceMinutes} onChange={e => setForm({...form, lateGraceMinutes: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">Half Day (hrs)</label>
                    <input type="number" value={form.halfDayHours} onChange={e => setForm({...form, halfDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">Full Day (hrs)</label>
                    <input type="number" value={form.fullDayHours} onChange={e => setForm({...form, fullDayHours: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                  {form.shiftType === 'FIELD' && (
                    <div><label className="block text-xs text-gray-500 mb-1">GPS Interval</label>
                      <select value={form.trackingIntervalMinutes || 60} onChange={e => setForm({...form, trackingIntervalMinutes: Number(e.target.value)})}
                        className="input-glass w-full text-sm">
                        <option value={1}>Every 1 min</option>
                        <option value={5}>Every 5 min</option>
                        <option value={15}>Every 15 min</option>
                        <option value={30}>Every 30 min</option>
                        <option value={60}>Every 1 hr</option>
                        <option value={120}>Every 2 hrs</option>
                        <option value={240}>Every 4 hrs</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Shift type info */}
                {form.shiftType === 'OFFICE' && (
                  <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                    <p className="font-semibold">General Shift — Geofence Attendance</p>
                    <p>Employees must mark attendance within assigned office geofence. If marking outside, an email alert is sent to HR.</p>
                    <p>This shift is automatically assigned to all employees by default. Different locations can be assigned per employee.</p>
                  </div>
                )}

                {form.shiftType === 'FIELD' && (
                  <div className="bg-green-50 rounded-lg p-3 text-xs text-green-700 space-y-1">
                    <p className="font-semibold">Live Tracking — GPS Field Tracking</p>
                    <p>Live GPS tracking at the selected interval. Employee locations are recorded automatically for field visits.</p>
                  </div>
                )}

                {/* Attendance Policy — always visible */}
                <div className="border-t border-gray-100 pt-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3"><Shield size={15} style={{ color: 'var(--primary-color)' }} /> Attendance Policy</p>
                  <div className="space-y-4">
                    {/* Late Arrival */}
                    <div className="bg-amber-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-3"><Clock size={13} /> Late Arrival Rules</p>
                      <div className="grid grid-cols-1 gap-3">
                        <div><label className="block text-xs text-gray-500 mb-1">Half-Day After (min late)</label>
                          <input type="number" value={form.lateHalfDayAfterMins} onChange={e => setForm({...form, lateHalfDayAfterMins: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                      </div>
                      <div className="flex items-center justify-between bg-white rounded-lg p-3 mt-3">
                        <div><p className="text-xs font-medium text-gray-700">Late Penalty (LOP)</p>
                          <p className="text-[10px] text-gray-400">Every N lates = 1 Loss of Pay day</p></div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={form.latePenaltyEnabled} onChange={e => setForm({...form, latePenaltyEnabled: e.target.checked})} className="sr-only peer" />
                          <div className="w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"
                            style={{ background: form.latePenaltyEnabled ? 'var(--primary-color)' : 'var(--ui-border-color, #d1d5db)' }} />
                        </label>
                      </div>
                      {form.latePenaltyEnabled && (
                        <div className="mt-2"><label className="block text-xs text-gray-500 mb-1">Lates per LOP Day</label>
                          <input type="number" value={form.latePenaltyPerCount} onChange={e => setForm({...form, latePenaltyPerCount: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                      )}
                    </div>

                    {/* Week Off */}
                    <div className="bg-blue-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5 mb-3"><Shield size={13} /> Week Off Days</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAY_LABELS.map((day, i) => (
                          <button key={i} type="button"
                            onClick={() => {
                              const days = new Set(form.weekOffDays);
                              days.has(i) ? days.delete(i) : days.add(i);
                              setForm({...form, weekOffDays: Array.from(days)});
                            }}
                            className={`w-9 h-9 rounded-lg text-xs font-semibold transition-colors ${
                              form.weekOffDays.includes(i) ? '' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
                            }`}
                            style={form.weekOffDays.includes(i) ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
                          >{day}</button>
                        ))}
                      </div>
                    </div>

                    {/* Overtime */}
                    <div className="bg-orange-50 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5"><Zap size={13} /> Overtime Rules</p>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={form.otEnabled} onChange={e => setForm({...form, otEnabled: e.target.checked})} className="sr-only peer" />
                          <div className="w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"
                            style={{ background: form.otEnabled ? 'var(--primary-color)' : 'var(--ui-border-color, #d1d5db)' }} />
                        </label>
                      </div>
                      {form.otEnabled && (
                        <div className="grid grid-cols-3 gap-3">
                          <div><label className="block text-xs text-gray-500 mb-1">Min Extra Min</label>
                            <input type="number" value={form.otThresholdMinutes} onChange={e => setForm({...form, otThresholdMinutes: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                          <div><label className="block text-xs text-gray-500 mb-1">Rate Multiplier</label>
                            <input type="number" step="0.1" value={form.otRateMultiplier} onChange={e => setForm({...form, otRateMultiplier: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                          <div><label className="block text-xs text-gray-500 mb-1">Max OT Hrs/Day</label>
                            <input type="number" step="0.5" value={form.otMaxHoursPerDay} onChange={e => setForm({...form, otMaxHoursPerDay: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                        </div>
                      )}
                    </div>

                    {/* Comp-Off */}
                    <div className="bg-green-50 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-green-700 flex items-center gap-1.5"><Calendar size={13} /> Comp-Off Rules</p>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={form.compOffEnabled} onChange={e => setForm({...form, compOffEnabled: e.target.checked})} className="sr-only peer" />
                          <div className="w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"
                            style={{ background: form.compOffEnabled ? 'var(--primary-color)' : 'var(--ui-border-color, #d1d5db)' }} />
                        </label>
                      </div>
                      {form.compOffEnabled && (
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className="block text-xs text-gray-500 mb-1">Min OT Hrs for Comp-Off</label>
                            <input type="number" step="0.5" value={form.compOffMinOTHours} onChange={e => setForm({...form, compOffMinOTHours: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                          <div><label className="block text-xs text-gray-500 mb-1">Expiry (days)</label>
                            <input type="number" value={form.compOffExpiryDays} onChange={e => setForm({...form, compOffExpiryDays: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                        </div>
                      )}
                    </div>

                    {/* Sunday Working */}
                    <div className="bg-yellow-50 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-yellow-700 flex items-center gap-1.5"><Sun size={13} /> Sunday Working</p>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={form.sundayWorkEnabled} onChange={e => setForm({...form, sundayWorkEnabled: e.target.checked})} className="sr-only peer" />
                          <div className="w-9 h-5 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all"
                            style={{ background: form.sundayWorkEnabled ? 'var(--primary-color)' : 'var(--ui-border-color, #d1d5db)' }} />
                        </label>
                      </div>
                      {form.sundayWorkEnabled && (
                        <div><label className="block text-xs text-gray-500 mb-1">Pay Multiplier (e.g. 2.0 = double)</label>
                          <input type="number" step="0.1" min={1} max={5} value={form.sundayPayMultiplier} onChange={e => setForm({...form, sundayPayMultiplier: Number(e.target.value)})} className="input-glass w-full text-sm" /></div>
                      )}
                    </div>

                    {/* Hybrid shift info — shown only for HYBRID type */}
                    {(form.shiftType === 'HYBRID' || (isEditing && editShift?.shiftType === 'HYBRID')) && (
                      <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <Home className="h-4 w-4 text-purple-600" />
                          <p className="text-sm font-semibold text-purple-700">Hybrid / WFH Shift</p>
                        </div>
                        <p className="text-xs text-purple-700 bg-purple-100 rounded-lg px-3 py-2">
                          Employees assigned to this shift must clock in from <strong>either their approved home location or their assigned office location</strong>. Both geofences are enforced. GPS is required.
                        </p>
                        {isEditing && (() => {
                          const homeGeofencedCount = allAssignments.filter((a: any) =>
                            a.shiftId === editShift?.id && a.employee?.approvedHomeGeofenceId
                          ).length;
                          return homeGeofencedCount > 0 ? (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <Shield className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                              <p className="text-xs text-amber-700">
                                <strong>{homeGeofencedCount} employee{homeGeofencedCount > 1 ? 's have' : ' has'} an approved home geofence</strong> on this shift.
                                Changing the shift type to OFFICE or FIELD will disable their WFH clock-in capability.
                                Notify affected employees before making this change.
                              </p>
                            </div>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button onClick={isEditing ? handleUpdate : handleCreate} disabled={creating || updating}
                    className="btn-primary text-sm flex items-center gap-1.5">
                    {isEditing
                      ? updating ? <><Loader2 size={14} className="animate-spin" /> Updating...</> : <><Save size={14} /> Update</>
                      : creating ? <><Loader2 size={14} className="animate-spin" /> Creating...</> : 'Create'}
                  </button>
                  <button onClick={() => { setShow(false); setEditShift(null); setForm(emptyForm); }} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {shifts.map((s: any) => {
          const display = getShiftDisplay(s.shiftType, s.name);
          return (
            <div key={s.id} className="layer-card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-800">{s.name}</h3>
                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500" data-mono>{s.code}</span>
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', display.badgeClass)}>{display.label}</span>
                    {s.isDefault && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>Default</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{s.startTime} — {s.endTime}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleEdit(s)} className="text-gray-400 p-1" style={{ color: undefined }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-color)')} onMouseLeave={e => (e.currentTarget.style.color = '')}><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(s)} className="text-gray-300 hover:text-red-500 p-1" title="Delete shift"><Trash2 size={14} /></button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-3">{display.description}</p>

              {/* Timing row */}
              <div className="flex gap-3 text-xs text-gray-500 flex-wrap mb-3">
                <span className="flex items-center gap-1"><Clock size={10} /> {s.startTime} — {s.endTime}</span>
                <span>Grace: <strong>{s.lateGraceMinutes ?? s.graceMinutes ?? 15}min</strong></span>
                <span>Full day: <strong>{Number(s.fullDayHours)}h</strong></span>
                <span>Half day: <strong>{Number(s.halfDayHours)}h</strong></span>
                {s.trackingIntervalMinutes && <span>GPS: every <strong>{s.trackingIntervalMinutes >= 60 ? `${s.trackingIntervalMinutes / 60}h` : `${s.trackingIntervalMinutes}min`}</strong></span>}
                <button onClick={() => onViewAssigned(s.id)}
                  className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors cursor-pointer"
                  style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                  {s._count?.assignments || 0} assigned
                </button>
              </div>

              {/* Attendance policy summary */}
              <div className="border-t border-gray-100 pt-2 space-y-1.5">
                {/* Week off */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-400 w-20 shrink-0">Week off:</span>
                  <div className="flex gap-1">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                      <span key={i}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={(s.weekOffDays as number[] || [0]).includes(i)
                          ? { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }
                          : { background: '#f9fafb', color: '#d1d5db' }}
                      >{d}</span>
                    ))}
                  </div>
                </div>

                {/* Late rules */}
                <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
                  <span className="w-20 shrink-0 text-gray-400">Late rules:</span>
                  <span>Grace <strong>{s.lateGraceMinutes ?? 15}min</strong></span>
                  <span>· Half-day after <strong>{s.lateHalfDayAfterMins ?? 120}min</strong> late</span>
                  {s.latePenaltyEnabled && <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded">LOP: every {s.latePenaltyPerCount ?? 3} lates</span>}
                </div>

                {/* OT / Comp-off / Sunday / WFH */}
                <div className="flex gap-1.5 flex-wrap">
                  {s.otEnabled
                    ? <span className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded-full">OT ×{Number(s.otRateMultiplier||1.5)} after {s.otThresholdMinutes}min</span>
                    : <span className="text-[10px] bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded-full">OT off</span>}
                  {s.compOffEnabled
                    ? <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full">Comp-off ≥{Number(s.compOffMinOTHours)}h OT</span>
                    : <span className="text-[10px] bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded-full">Comp-off off</span>}
                  {s.sundayWorkEnabled
                    ? <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded-full">Sun pay ×{Number(s.sundayPayMultiplier||2)}</span>
                    : <span className="text-[10px] bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded-full">Sun working off</span>}
                  {s.allowWfh
                    ? <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                        <Home size={9} />
                        {(s.wfhDays as number[] || []).length > 0
                          ? `WFH: ${(s.wfhDays as number[]).map((d: number) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}`
                          : 'WFH enabled'}
                      </span>
                    : <span className="text-[10px] bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded-full">WFH off</span>}
                  {s.isWfhShift && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      <Home className="h-3 w-3" /> WFH Shift
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {shifts.length === 0 && <p className="text-sm text-gray-400 col-span-2 text-center py-8">No shifts yet. Click "Create Shift" to add your first shift.</p>}
      </div>
    </div>
  );
}

/* ===== LOCATIONS PANEL ===== */
function LocationsPanel({ isHrOrAdmin }: { isHrOrAdmin: boolean }) {
  const [locTab, setLocTab] = useState<'offices' | 'home-requests'>('offices');
  const { data: res } = useGetLocationsQuery();
  const locations = res?.data || [];
  const [createLocation, { isLoading: creating }] = useCreateLocationMutation();
  const [updateLocation] = useUpdateLocationMutation();
  const [deleteLocation] = useDeleteLocationMutation();
  const [show, setShow] = useState(false);
  const [editLoc, setEditLoc] = useState<any>(null);
  const [mapFullscreen, setMapFullscreen] = useState(false);
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
      {/* Sub-tab bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <button
            onClick={() => setLocTab('offices')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              locTab === 'offices' ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            style={locTab === 'offices' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
          >
            <MapPin size={14} /> Office Locations
          </button>
          {isHrOrAdmin && (
            <button
              onClick={() => setLocTab('home-requests')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                locTab === 'home-requests' ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
              style={locTab === 'home-requests' ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
            >
              <Home size={14} /> Home Location Requests
            </button>
          )}
        </div>
        {locTab === 'offices' && !showForm && (
          <button onClick={() => { setShow(true); setEditLoc(null); setForm(emptyForm); }}
            className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Add Location</button>
        )}
      </div>

      {/* Home location requests sub-tab */}
      {locTab === 'home-requests' && isHrOrAdmin && <HomeLocationRequestsTab />}

      {/* Office locations content */}
      {locTab === 'offices' && <div className="space-y-4">

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto">
          <div className="flex items-start justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-6 mx-auto">
              <div className="p-5 space-y-3">
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
            </div>
          </div>
        </div>
      )}

      {/* All locations map */}
      {locations.length > 0 && !showForm && (
        <>
          <div className="layer-card overflow-hidden relative" style={{ height: 300 }}>
            <MapContainer
              center={[(locations[0]?.geofence?.coordinates as any)?.lat || 28.6, (locations[0]?.geofence?.coordinates as any)?.lng || 77.2]}
              zoom={11}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
              <FitBounds coords={locations.filter((l: any) => l.geofence?.coordinates?.lat).map((l: any) => [l.geofence.coordinates.lat, l.geofence.coordinates.lng] as [number, number])} />
              {locations.map((l: any) => {
                const c = l.geofence?.coordinates as any;
                if (!c?.lat) return null;
                return <><Marker key={`m-${l.id}`} position={[c.lat, c.lng]} /><Circle key={`c-${l.id}`} center={[c.lat, c.lng]} radius={l.geofence?.radiusMeters || 200} pathOptions={{ color: '#4f46e5', fillOpacity: 0.15 }} /></>;
              })}
            </MapContainer>
            {/* Fullscreen toggle button */}
            <button
              onClick={() => setMapFullscreen(true)}
              className="absolute top-3 right-3 z-[500] bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-1.5 shadow-md hover:bg-white transition-colors"
              title="View fullscreen"
            >
              <Maximize2 size={16} className="text-gray-600" />
            </button>
          </div>

          {/* Fullscreen map modal */}
          {mapFullscreen && (
            <div className="fixed inset-0 z-[80] flex flex-col bg-black">
              {/* Header bar */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-white/95 backdrop-blur-sm border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <MapPin size={16} style={{ color: 'var(--primary-color)' }} />
                  <span className="text-sm font-semibold text-gray-800">Office Locations — {locations.length} site{locations.length !== 1 ? 's' : ''}</span>
                </div>
                <button
                  onClick={() => setMapFullscreen(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
                >
                  <Minimize2 size={14} />
                  Exit Fullscreen
                </button>
              </div>
              {/* Full-window map */}
              <div className="flex-1 relative">
                <MapContainer
                  center={[(locations[0]?.geofence?.coordinates as any)?.lat || 28.6, (locations[0]?.geofence?.coordinates as any)?.lng || 77.2]}
                  zoom={12}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                  <FitBounds coords={locations.filter((l: any) => l.geofence?.coordinates?.lat).map((l: any) => [l.geofence.coordinates.lat, l.geofence.coordinates.lng] as [number, number])} />
                  {locations.map((l: any) => {
                    const c = l.geofence?.coordinates as any;
                    if (!c?.lat) return null;
                    return (
                      <>
                        <Marker key={`m-${l.id}`} position={[c.lat, c.lng]} />
                        <Circle
                          key={`c-${l.id}`}
                          center={[c.lat, c.lng]}
                          radius={l.geofence?.radiusMeters || 200}
                          pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.12, weight: 2 }}
                        />
                      </>
                    );
                  })}
                </MapContainer>
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {locations.map((l: any) => (
          <div key={l.id} className="layer-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapPin size={18} style={{ color: 'var(--primary-color)' }} />
              <div>
                <p className="text-sm font-medium text-gray-800">{l.name}</p>
                <p className="text-xs text-gray-400">{l.address || l.city} · {l.geofence?.radiusMeters || 0}m{l.geofence?.strictMode ? ' · Strict' : ''}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => handleEdit(l)} className="text-gray-400 p-1" onMouseEnter={e => (e.currentTarget.style.color = 'var(--primary-color)')} onMouseLeave={e => (e.currentTarget.style.color = '')}><Pencil size={14} /></button>
              <button onClick={async () => {
                if (confirm('Delete?')) {
                  try { await deleteLocation(l.id).unwrap(); toast.success('Deleted'); }
                  catch (err: any) { toast.error(err?.data?.error?.message || 'Failed to delete location'); }
                }
              }} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      </div>}
    </div>
  );
}

/* ===== ASSIGNMENTS PANEL ===== */
const SHIFT_TYPE_LABELS: Record<string, { label: string; color: string; bg?: string }> = {
  OFFICE: { label: 'General', color: 'text-blue-600', bg: 'bg-blue-50' },
  FIELD: { label: 'Live Tracking', color: 'text-green-600', bg: 'bg-green-50' },
  HYBRID: { label: 'Hybrid (WFH)', color: 'text-purple-600', bg: 'bg-purple-100' },
};
function getShiftTypeLabel(shiftType: string, shiftName?: string) {
  return SHIFT_TYPE_LABELS[shiftType] || { label: shiftName || shiftType, color: 'text-purple-600' };
}

function AssignmentsPanel({ shiftFilter, onClearFilter }: { shiftFilter: ShiftFilter; onClearFilter: () => void }) {
  const user = useAppSelector(s => s.auth.user);
  const isHR = user?.role === 'HR';
  const { data: empRes } = useGetEmployeesQuery({ limit: 100 });
  const { data: shiftRes } = useGetShiftsQuery();
  const { data: locRes } = useGetLocationsQuery();
  const { data: assignRes } = useGetAllAssignmentsQuery();
  const [assignShift, { isLoading }] = useAssignShiftMutation();
  const [autoAssign, { isLoading: autoAssigning }] = useAutoAssignDefaultMutation();
  const [createShiftChangeRequest, { isLoading: requesting }] = useCreateShiftChangeRequestMutation();
  const [search, setSearch] = useState('');
  // HR shift change request modal state
  const [requestModal, setRequestModal] = useState<{ empId: string; empName: string } | null>(null);
  const [requestShiftId, setRequestShiftId] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const employees = empRes?.data || [];
  const shifts = shiftRes?.data || [];
  const locations = locRes?.data || [];
  const existingAssignments = assignRes?.data || [];

  const handleHRRequest = async () => {
    if (!requestModal || !requestShiftId) { toast.error('Please select a shift'); return; }
    try {
      await createShiftChangeRequest({ employeeId: requestModal.empId, toShiftId: requestShiftId, reason: requestReason || undefined }).unwrap();
      toast.success(`Shift change request submitted for ${requestModal.empName}. Awaiting Super Admin approval.`);
      setRequestModal(null);
      setRequestShiftId('');
      setRequestReason('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit request');
    }
  };

  // Build a map of employeeId → current assignment from DB
  const assignmentMap = new Map<string, any>();
  existingAssignments.forEach((a: any) => {
    // Only keep the latest assignment per employee
    if (!assignmentMap.has(a.employeeId)) {
      assignmentMap.set(a.employeeId, a);
    }
  });

  // Track editing state and pending selections
  const [pending, setPending] = useState<Record<string, { shiftId: string; locationId: string }>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  const filtered = employees.filter((e: any) => {
    const matchesSearch = !search || `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (!shiftFilter) return true;
    const assignment = assignmentMap.get(e.id);
    return assignment?.shiftId === shiftFilter;
  });

  const activeShiftFilterName = shiftFilter ? shifts.find((s: any) => s.id === shiftFilter)?.name : null;

  const handleAssign = async (empId: string) => {
    const { shiftId, locationId } = pending[empId] || {};
    if (!shiftId) return;
    const selectedShift = shifts.find((s: any) => s.id === shiftId);

    if (selectedShift?.shiftType === 'OFFICE' && !locationId) {
      toast.error('Please select an office location for General shift');
      return;
    }

    try {
      await assignShift({
        employeeId: empId, shiftId,
        // For OFFICE: pass locationId. For HYBRID: pass if selected (office is optional). FIELD: no locationId.
        locationId: locationId || undefined,
        startDate: new Date().toISOString().split('T')[0],
      }).unwrap();
      toast.success('Shift assigned successfully');
      setPending(prev => { const n = { ...prev }; delete n[empId]; return n; });
      setEditing(prev => ({ ...prev, [empId]: false }));
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  const startEdit = (empId: string) => {
    const a = assignmentMap.get(empId);
    if (a) {
      setPending(prev => ({ ...prev, [empId]: { shiftId: a.shiftId, locationId: a.locationId || '' } }));
    }
    setEditing(prev => ({ ...prev, [empId]: true }));
  };

  const cancelEdit = (empId: string) => {
    setPending(prev => { const n = { ...prev }; delete n[empId]; return n; });
    setEditing(prev => ({ ...prev, [empId]: false }));
  };

  const handleAutoAssign = async () => {
    try {
      const res = await autoAssign().unwrap();
      toast.success(res?.data?.message || 'Auto-assigned General shift');
    } catch (err: any) { toast.error(err?.data?.error?.message || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative max-w-sm flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..."
              className="input-glass w-full pl-10 text-sm" />
          </div>
          {activeShiftFilterName && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: 'var(--primary-highlighted-color)', border: '1px solid var(--primary-color)', color: 'var(--primary-color)' }}>
              <Users size={12} /> Filtered: {activeShiftFilterName}
              <button onClick={onClearFilter} className="ml-1" style={{ color: 'var(--primary-color)' }}><X size={12} /></button>
            </div>
          )}
        </div>
        <button onClick={handleAutoAssign} disabled={autoAssigning}
          className="btn-primary text-sm flex items-center gap-1.5 whitespace-nowrap">
          {autoAssigning ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
          Auto-Assign General Shift
        </button>
      </div>

      <div className="layer-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Employee</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Work Mode</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Shift</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Location / Info</th>
              <th className="text-left p-3 text-xs text-gray-500 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp: any) => {
              const dbAssignment = assignmentMap.get(emp.id);
              const hasDbAssignment = !!dbAssignment;
              const isEditMode = editing[emp.id];
              const showSaved = hasDbAssignment && !isEditMode;
              const showEditing = isEditMode || !hasDbAssignment;
              const p = pending[emp.id] || { shiftId: '', locationId: '' };
              const sel = shifts.find((s: any) => s.id === p.shiftId);
              const selType = sel?.shiftType || '';
              const needsLocation = selType === 'OFFICE';
              const hasLocation = !!p.locationId;
              // HYBRID: office location is optional (home geofence comes from home location request approval)
              const canAssign = p.shiftId && (!needsLocation || hasLocation);

              return (
                <tr key={emp.id} className={cn('border-b border-gray-50', showSaved ? 'bg-emerald-50/30' : 'hover:bg-surface-2')}>
                  <td className="p-3">
                    <p className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                    <p className="text-xs text-gray-400">{emp.employeeCode}</p>
                  </td>
                  <td className="p-3"><span className="badge badge-info text-xs">{emp.workMode}</span></td>

                  {/* SAVED STATE — read-only display from DB */}
                  {showSaved && (
                    <>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          {(() => { const tl = getShiftTypeLabel(dbAssignment.shift?.shiftType, dbAssignment.shift?.name); return (
                            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded',
                              dbAssignment.shift?.shiftType === 'OFFICE' ? 'bg-blue-50' : dbAssignment.shift?.shiftType === 'FIELD' ? 'bg-green-50' : 'bg-purple-50', tl.color
                            )}>{tl.label}</span>
                          ); })()}
                          <span className="text-xs text-gray-700 font-medium">{dbAssignment.shift?.name}</span>
                          <span className="text-[10px] text-gray-400">({dbAssignment.shift?.startTime}–{dbAssignment.shift?.endTime})</span>
                        </div>
                      </td>
                      <td className="p-3">
                        {dbAssignment.shift?.shiftType === 'FIELD' ? (
                          <span className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded">Live GPS Tracking</span>
                        ) : dbAssignment.shift?.shiftType === 'HYBRID' ? (
                          <div className="space-y-1">
                            {dbAssignment.location?.name ? (
                              <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                                <MapPin size={9} /> Office: {dbAssignment.location.name} · {dbAssignment.location.geofence?.radiusMeters || 0}m
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded w-fit">No office location</span>
                            )}
                            {emp.approvedHomeGeofenceId ? (
                              <span className="text-[10px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                                <Home size={9} /> Home: geofence approved
                              </span>
                            ) : (
                              <span className="text-[10px] text-red-400 bg-red-50 px-2 py-0.5 rounded w-fit">No home location</span>
                            )}
                          </div>
                        ) : dbAssignment.location?.name ? (
                          <span className="text-xs text-gray-600 flex items-center gap-1">
                            <MapPin size={10} style={{ color: 'var(--primary-color)' }} />
                            {dbAssignment.location.name}
                            {dbAssignment.location.geofence?.radiusMeters && (
                              <span className="text-[10px] text-gray-400">· {dbAssignment.location.geofence.radiusMeters}m</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] text-red-400">No location assigned</span>
                        )}
                      </td>
                      <td className="p-3">
                        {isHR ? (
                          <button onClick={() => { setRequestModal({ empId: emp.id, empName: `${emp.firstName} ${emp.lastName}` }); setRequestShiftId(''); setRequestReason(''); }}
                            className="text-xs py-1.5 px-4 rounded-lg font-medium bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 flex items-center gap-1">
                            <Send size={12} /> Request
                          </button>
                        ) : (
                          <button onClick={() => startEdit(emp.id)}
                            className="text-xs py-1.5 px-4 rounded-lg font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                            <Pencil size={12} /> Change
                          </button>
                        )}
                      </td>
                    </>
                  )}

                  {/* EDITING/NEW STATE — dropdowns (only for SUPER_ADMIN/ADMIN, not HR) */}
                  {showEditing && !isHR && (
                    <>
                      <td className="p-3">
                        <select value={p.shiftId} onChange={e => setPending(prev => ({...prev, [emp.id]: { ...prev[emp.id], shiftId: e.target.value }}))}
                          className="input-glass text-xs py-1.5 w-52">
                          <option value="">Select shift...</option>
                          {shifts.map((s: any) => {
                            const tl = getShiftTypeLabel(s.shiftType, s.name);
                            return <option key={s.id} value={s.id}>[{tl.label}] {s.name} ({s.startTime}-{s.endTime})</option>;
                          })}
                        </select>
                      </td>
                      <td className="p-3">
                        {selType === 'OFFICE' && (
                          <div>
                            <select value={p.locationId} onChange={e => setPending(prev => ({...prev, [emp.id]: { ...prev[emp.id], locationId: e.target.value }}))}
                              className={cn('input-glass text-xs py-1.5 w-44', !hasLocation && 'border-red-300')}>
                              <option value="">Select office *</option>
                              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name} ({l.city || 'N/A'})</option>)}
                            </select>
                            {!hasLocation && <p className="text-[10px] text-red-400 mt-0.5">Location required for geofencing</p>}
                          </div>
                        )}
                        {selType === 'HYBRID' && (
                          <div className="space-y-1.5">
                            <div>
                              <select value={p.locationId} onChange={e => setPending(prev => ({...prev, [emp.id]: { ...prev[emp.id], locationId: e.target.value }}))}
                                className="input-glass text-xs py-1.5 w-44">
                                <option value="">Office location (optional)</option>
                                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name} ({l.city || 'N/A'})</option>)}
                              </select>
                              <p className="text-[10px] text-gray-400 mt-0.5">Office geofence for clock-in</p>
                            </div>
                            {emp.approvedHomeGeofenceId ? (
                              <span className="text-[10px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded flex items-center gap-1 w-fit">
                                <Home size={9} /> Home geofence: approved
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded w-fit">
                                Home geofence: pending request
                              </span>
                            )}
                          </div>
                        )}
                        {selType === 'FIELD' && <span className="text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded">Live GPS Tracking · {(sel?.trackingIntervalMinutes || 60) >= 60 ? `${(sel?.trackingIntervalMinutes || 60) / 60}h` : `${sel?.trackingIntervalMinutes || 60}min`} interval</span>}
                        {!selType && <span className="text-[10px] text-gray-300">Select a shift first</span>}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1.5">
                          {p.shiftId && (
                            <button onClick={() => handleAssign(emp.id)} disabled={isLoading || !canAssign}
                              className={cn('text-xs py-1.5 px-3 rounded-lg font-medium transition-colors',
                                canAssign ? 'btn-primary' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              )}>
                              {isLoading ? '...' : hasDbAssignment ? 'Save' : 'Assign'}
                            </button>
                          )}
                          {hasDbAssignment && (
                            <button onClick={() => cancelEdit(emp.id)}
                              className="text-xs py-1.5 px-3 rounded-lg font-medium bg-white border border-gray-200 text-gray-500 hover:bg-gray-50">
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* HR Shift Change Request Modal */}
      {requestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Request Shift Change</h3>
              <button onClick={() => setRequestModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Submitting a shift change request for <span className="font-semibold text-gray-700">{requestModal.empName}</span>.
              This will be sent to Super Admin for approval.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Target Shift *</label>
                <select value={requestShiftId} onChange={e => setRequestShiftId(e.target.value)} className="input-glass w-full text-sm">
                  <option value="">Select shift...</option>
                  {shifts.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
                <textarea value={requestReason} onChange={e => setRequestReason(e.target.value)} rows={2}
                  placeholder="Why is this shift change needed?" className="input-glass w-full text-sm resize-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRequestModal(null)} className="btn-secondary flex-1 text-sm">Cancel</button>
              <button onClick={handleHRRequest} disabled={requesting || !requestShiftId}
                className="flex-1 text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                {requesting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
