import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, MapPin, Calendar, ChevronLeft, ChevronRight, User, Activity } from 'lucide-react';
import { useGetEmployeeQuery } from '../employee/employeeApi';
import { useGetEmployeeAttendanceQuery, useGetEmployeeGPSTrailQuery } from './attendanceApi';
import { useGetEmployeeShiftQuery } from '../workforce/workforceApi';
import { MapContainer, TileLayer, Marker, Circle, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn, formatDate, getInitials, getStatusColor } from '../../lib/utils';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-50', ABSENT: 'bg-red-50', HALF_DAY: 'bg-amber-50',
  HOLIDAY: 'bg-blue-50', WEEKEND: 'bg-gray-50', ON_LEAVE: 'bg-purple-50',
  WORK_FROM_HOME: 'bg-teal-50', NOT_CHECKED_IN: 'bg-gray-50',
};
const DOT_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-500', ABSENT: 'bg-red-400', HALF_DAY: 'bg-amber-400',
  HOLIDAY: 'bg-blue-400', WEEKEND: 'bg-gray-300', ON_LEAVE: 'bg-purple-400',
  WORK_FROM_HOME: 'bg-teal-400',
};
const SHIFT_TYPE_BADGE: Record<string, string> = {
  OFFICE: 'bg-blue-50 text-blue-600',
  FIELD: 'bg-green-50 text-green-600',
  HYBRID: 'bg-purple-50 text-purple-600',
};

export default function EmployeeAttendanceDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: empRes } = useGetEmployeeQuery(employeeId || '');
  const employee = empRes?.data;

  const { data: shiftRes } = useGetEmployeeShiftQuery(employeeId || '');
  const shiftAssignment = shiftRes?.data;
  const shift = shiftAssignment?.shift;
  const shiftType = shift?.shiftType || 'OFFICE';

  const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString().split('T')[0];
  const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).toISOString().split('T')[0];
  const { data: attRes } = useGetEmployeeAttendanceQuery({ employeeId: employeeId || '', startDate, endDate });
  const records = attRes?.data?.records || attRes?.data?.data || [];
  const summary = attRes?.data?.summary;

  // GPS trail for FIELD employees
  const { data: gpsRes } = useGetEmployeeGPSTrailQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: shiftType !== 'FIELD' }
  );
  const gpsTrail = gpsRes?.data || [];

  // Find selected date record
  const selectedRecord = useMemo(() => {
    return records.find((r: any) => new Date(r.date).toISOString().split('T')[0] === selectedDate);
  }, [records, selectedDate]);

  // Build calendar
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const recordMap = new Map<string, any>();
    records.forEach((r: any) => {
      recordMap.set(new Date(r.date).toISOString().split('T')[0], r);
    });
    const todayStr = new Date().toISOString().split('T')[0];
    const days: any[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ date: 0, status: '' });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const record = recordMap.get(dateStr);
      let status = '';
      if (record) status = record.status;
      else if (dayOfWeek === 0 || dayOfWeek === 6) status = 'WEEKEND';
      else if (new Date(dateStr) < new Date(todayStr)) status = 'ABSENT';
      days.push({ date: d, dateStr, status, record, isToday: dateStr === todayStr, isSelected: dateStr === selectedDate });
    }
    return days;
  }, [currentMonth, records, selectedDate]);

  if (!employee) {
    return <div className="page-container flex items-center justify-center min-h-[60vh]">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  const monthName = currentMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const checkInLoc = selectedRecord?.checkInLocation as any;
  const geofence = shiftAssignment?.location?.geofence;
  const geofenceCoords = geofence?.coordinates as any;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/attendance')} className="p-2 rounded-lg hover:bg-surface-2"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-lg">
            {getInitials(employee.firstName, employee.lastName)}
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-gray-900">{employee.firstName} {employee.lastName}</h1>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="font-mono text-xs" data-mono>{employee.employeeCode}</span>
              {employee.department?.name && <span>· {employee.department.name}</span>}
              {shift && (
                <span className={cn('badge text-[10px] ml-1', SHIFT_TYPE_BADGE[shiftType] || SHIFT_TYPE_BADGE.OFFICE)}>
                  {shiftType} — {shift.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Selected Date Detail */}
        <div className="lg:col-span-1 space-y-4">
          {/* Date status */}
          <div className="layer-card p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{formatDate(selectedDate, 'long')}</h3>
            {selectedRecord ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Status</span>
                  <span className={cn('badge text-xs', getStatusColor(selectedRecord.status))}>{selectedRecord.status?.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Check In</span>
                  <span className="text-sm font-mono text-gray-700" data-mono>
                    {selectedRecord.checkIn ? new Date(selectedRecord.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Check Out</span>
                  <span className="text-sm font-mono text-gray-700" data-mono>
                    {selectedRecord.checkOut ? new Date(selectedRecord.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Total Hours</span>
                  <span className="text-sm font-mono font-bold text-gray-800" data-mono>
                    {selectedRecord.totalHours ? `${Number(selectedRecord.totalHours).toFixed(1)}h` : '--'}
                  </span>
                </div>
                {(selectedRecord.activeMinutes > 0 || selectedRecord.activityPulses > 0) && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Active Time</span>
                    <span className="text-sm font-mono text-brand-600 font-bold" data-mono>
                      {Math.floor((selectedRecord.activeMinutes || 0) / 60)}h {(selectedRecord.activeMinutes || 0) % 60}m
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Work Mode</span>
                  <span className="text-xs text-gray-600">{selectedRecord.workMode || 'OFFICE'}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">No record for this date</p>
            )}
          </div>

          {/* Check-in location map (for OFFICE/HYBRID) */}
          {checkInLoc?.lat && (
            <div className="layer-card overflow-hidden">
              <div className="px-4 pt-3 pb-1"><p className="text-xs font-semibold text-gray-600">Check-in Location</p></div>
              <div style={{ height: 200 }}>
                <MapContainer center={[checkInLoc.lat, checkInLoc.lng]} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                  <Marker position={[checkInLoc.lat, checkInLoc.lng]} />
                  {geofenceCoords?.lat && (
                    <Circle center={[geofenceCoords.lat, geofenceCoords.lng]} radius={geofence?.radiusMeters || 200}
                      pathOptions={{ color: '#4f46e5', fillOpacity: 0.1 }} />
                  )}
                </MapContainer>
              </div>
            </div>
          )}

          {/* Monthly summary */}
          {summary && (
            <div className="layer-card p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Summary</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { l: 'Present', v: summary.present, c: 'text-emerald-600' },
                  { l: 'Absent', v: summary.absent, c: 'text-red-500' },
                  { l: 'Half Day', v: summary.halfDay, c: 'text-amber-500' },
                  { l: 'On Leave', v: summary.onLeave, c: 'text-purple-500' },
                  { l: 'Avg Hours', v: `${summary.averageHours || 0}h`, c: 'text-blue-600' },
                  { l: 'WFH', v: summary.workFromHome, c: 'text-teal-500' },
                ].map(s => (
                  <div key={s.l} className="text-center py-2 bg-surface-2 rounded-lg">
                    <p className={cn('text-lg font-bold font-mono', s.c)} data-mono>{s.v}</p>
                    <p className="text-[10px] text-gray-400">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Calendar + Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Calendar */}
          <div className="layer-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
                <Calendar size={18} className="text-brand-500" /> {monthName}
              </h2>
              <div className="flex gap-2">
                <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                  className="p-2 rounded-lg hover:bg-surface-2"><ChevronLeft size={16} /></button>
                <button onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date().toISOString().split('T')[0]); }}
                  className="text-sm text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-50 font-medium">Today</button>
                <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                  className="p-2 rounded-lg hover:bg-surface-2"><ChevronRight size={16} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day: any, idx: number) => (
                <button key={idx} disabled={day.date === 0}
                  onClick={() => day.dateStr && setSelectedDate(day.dateStr)}
                  className={cn(
                    'aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all relative',
                    day.date === 0 && 'invisible',
                    day.isSelected && 'ring-2 ring-brand-500 ring-offset-1',
                    day.isToday && !day.isSelected && 'ring-1 ring-brand-300',
                    STATUS_COLORS[day.status] || (day.date > 0 ? 'bg-white hover:bg-gray-50' : ''),
                  )}>
                  <span className={cn('font-medium text-xs', day.isToday ? 'text-brand-600' : 'text-gray-700', day.status === 'WEEKEND' && 'text-gray-400')}>
                    {day.date > 0 ? day.date : ''}
                  </span>
                  {day.status && day.date > 0 && <div className={cn('w-1.5 h-1.5 rounded-full mt-0.5', DOT_COLORS[day.status])} />}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-gray-100">
              {[
                { l: 'Present', c: 'bg-emerald-500' }, { l: 'Absent', c: 'bg-red-400' },
                { l: 'Half Day', c: 'bg-amber-400' }, { l: 'Leave', c: 'bg-purple-400' },
                { l: 'WFH', c: 'bg-teal-400' }, { l: 'Weekend', c: 'bg-gray-300' },
              ].map(i => (
                <div key={i.l} className="flex items-center gap-1.5">
                  <div className={cn('w-2 h-2 rounded-full', i.c)} />
                  <span className="text-[10px] text-gray-500">{i.l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* GPS Trail for FIELD employees */}
          {shiftType === 'FIELD' && gpsTrail.length > 0 && (
            <div className="layer-card overflow-hidden">
              <div className="px-5 pt-4 pb-2">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Activity size={14} className="text-green-500" /> GPS Trail — {formatDate(selectedDate, 'long')}
                </h3>
                <p className="text-xs text-gray-400">{gpsTrail.length} points recorded</p>
              </div>
              <div style={{ height: 300 }}>
                <MapContainer center={[gpsTrail[0]?.latitude || 28.6, gpsTrail[0]?.longitude || 77.2]} zoom={13}
                  style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
                  <Polyline positions={gpsTrail.map((p: any) => [p.latitude, p.longitude])}
                    pathOptions={{ color: '#10b981', weight: 3 }} />
                  <Marker position={[gpsTrail[0]?.latitude, gpsTrail[0]?.longitude]} />
                  {gpsTrail.length > 1 && (
                    <Marker position={[gpsTrail[gpsTrail.length - 1]?.latitude, gpsTrail[gpsTrail.length - 1]?.longitude]} />
                  )}
                </MapContainer>
              </div>
            </div>
          )}

          {/* Hybrid tracking stats */}
          {shiftType === 'HYBRID' && (
            <div className="layer-card p-5">
              <h3 className="text-sm font-semibold text-purple-700 mb-3">Hybrid Tracking — {monthName}</h3>
              <div className="grid grid-cols-3 gap-3 mb-3">
                {(() => {
                  const officeDays = records.filter((r: any) => r.workMode === 'OFFICE' && r.status === 'PRESENT').length;
                  const wfhDays = records.filter((r: any) => ['HYBRID', 'REMOTE', 'WORK_FROM_HOME'].includes(r.workMode) && r.status === 'PRESENT').length;
                  const totalActive = records.reduce((sum: number, r: any) => sum + (r.activeMinutes || 0), 0);
                  return [
                    { l: 'Office Days', v: officeDays, c: 'text-blue-600', bg: 'bg-blue-50' },
                    { l: 'WFH Days', v: wfhDays, c: 'text-teal-600', bg: 'bg-teal-50' },
                    { l: 'Avg Active/Day', v: `${Math.round(totalActive / Math.max(officeDays + wfhDays, 1))}m`, c: 'text-purple-600', bg: 'bg-purple-50' },
                  ].map(s => (
                    <div key={s.l} className={cn('text-center py-3 rounded-lg', s.bg)}>
                      <p className={cn('text-lg font-bold font-mono', s.c)} data-mono>{s.v}</p>
                      <p className="text-[10px] text-gray-500">{s.l}</p>
                    </div>
                  ));
                })()}
              </div>
              <div className="text-[10px] text-gray-400 space-y-0.5">
                <p>Office days: Geofence check-in/out + location verified</p>
                <p>WFH days: Browser activity tracked via Page Visibility API + periodic check-ins</p>
                <p>Active time measures how long the HRMS tab was active in the browser</p>
              </div>
            </div>
          )}

          {/* Daily records table */}
          <div className="layer-card overflow-hidden">
            <div className="px-5 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-gray-700">Daily Records</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Date</th>
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Check In</th>
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Check Out</th>
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Hours</th>
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Status</th>
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Active</th>
                  <th className="text-left text-xs text-gray-500 px-5 py-2">Mode</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 31).map((r: any, i: number) => (
                  <tr key={i} onClick={() => setSelectedDate(new Date(r.date).toISOString().split('T')[0])}
                    className={cn('border-b border-gray-50 hover:bg-surface-2 cursor-pointer',
                      new Date(r.date).toISOString().split('T')[0] === selectedDate && 'bg-brand-50')}>
                    <td className="px-5 py-2 text-xs text-gray-600">{formatDate(r.date)}</td>
                    <td className="px-5 py-2 text-xs font-mono text-gray-600" data-mono>
                      {r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                    </td>
                    <td className="px-5 py-2 text-xs font-mono text-gray-600" data-mono>
                      {r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--'}
                    </td>
                    <td className="px-5 py-2 text-xs font-mono text-gray-600" data-mono>
                      {r.totalHours ? `${Number(r.totalHours).toFixed(1)}h` : '--'}
                    </td>
                    <td className="px-5 py-2"><span className={cn('badge text-[10px]', getStatusColor(r.status))}>{r.status?.replace(/_/g, ' ')}</span></td>
                    <td className="px-5 py-2 text-xs font-mono text-gray-500" data-mono>
                      {r.activeMinutes ? `${Math.floor(r.activeMinutes / 60)}h${r.activeMinutes % 60}m` : '--'}
                    </td>
                    <td className="px-5 py-2 text-xs text-gray-400">{r.workMode || 'OFFICE'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
