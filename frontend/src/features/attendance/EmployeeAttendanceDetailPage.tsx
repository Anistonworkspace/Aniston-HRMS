import { useState, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUploadUrl } from '../../lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Clock, MapPin, Calendar, ChevronLeft, ChevronRight, Activity,
  Flag, LogIn, LogOut, Coffee, Play, Shield, FileText, AlertTriangle,
  Download, PenSquare, ClipboardList, User, Briefcase, Building, Maximize2, X, Navigation,
} from 'lucide-react';
import { useGetEmployeeQuery } from '../employee/employeeApi';
import {
  useGetEmployeeAttendanceQuery, useGetEmployeeGPSTrailQuery,
  useGetEmployeeActivityLogsQuery, useGetEmployeeScreenshotsQuery,
  useGetAttendanceLogsQuery, useGetEmployeeAttendanceDetailQuery,
  useGetAttendancePolicyQuery,
} from './attendanceApi';
import { useGetEmployeeShiftQuery } from '../workforce/workforceApi';
import { cn, formatDate, getInitials, getStatusColor } from '../../lib/utils';

// Lazy load map component
const MapSection = lazy(() => import('./components/MapSection'));
const GpsTrailModal = lazy(() => import('./components/GpsTrailModal'));

// ==========================================
// Constants
// ==========================================
const STATUS_BG: Record<string, string> = {
  PRESENT: 'bg-emerald-50', ABSENT: 'bg-red-50', HALF_DAY: 'bg-amber-50',
  HOLIDAY: 'bg-blue-50', WEEKEND: 'bg-gray-50', ON_LEAVE: 'bg-purple-50',
  WORK_FROM_HOME: 'bg-teal-50', NOT_CHECKED_IN: 'bg-gray-50',
};

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'P', ABSENT: 'A', HALF_DAY: 'HD', HOLIDAY: 'H',
  WEEKEND: 'WO', ON_LEAVE: 'L', WORK_FROM_HOME: 'WFH',
};

const DOT_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-500', ABSENT: 'bg-red-400', HALF_DAY: 'bg-amber-400',
  HOLIDAY: 'bg-blue-400', WEEKEND: 'bg-gray-300', ON_LEAVE: 'bg-purple-400',
  WORK_FROM_HOME: 'bg-teal-400',
};

const TIMELINE_COLORS: Record<string, { bg: string; icon: string; border: string }> = {
  CLOCK_IN: { bg: 'bg-emerald-50', icon: 'text-emerald-500', border: 'border-emerald-200' },
  RE_CLOCK_IN: { bg: 'bg-amber-50', icon: 'text-amber-500', border: 'border-amber-200' },
  CLOCK_OUT: { bg: 'bg-red-50', icon: 'text-red-500', border: 'border-red-200' },
  BREAK_START: { bg: 'bg-amber-50', icon: 'text-amber-500', border: 'border-amber-200' },
  BREAK_END: { bg: 'bg-blue-50', icon: 'text-blue-500', border: 'border-blue-200' },
};

const ANOMALY_COLORS: Record<string, string> = {
  LATE_ARRIVAL: 'bg-amber-50 text-amber-700',
  EARLY_EXIT: 'bg-orange-50 text-orange-700',
  MISSING_PUNCH: 'bg-red-50 text-red-700',
  INSUFFICIENT_HOURS: 'bg-rose-50 text-rose-700',
  OUTSIDE_GEOFENCE: 'bg-red-50 text-red-700',
  GPS_SPOOF: 'bg-red-50 text-red-700',
};

const SHIFT_BADGE: Record<string, string> = {
  OFFICE: 'bg-blue-50 text-blue-600 border-blue-200',
  FIELD: 'bg-green-50 text-green-600 border-green-200',
  HYBRID: 'bg-purple-50 text-purple-600 border-purple-200',
};

// ==========================================
// Component
// ==========================================
export default function EmployeeAttendanceDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [gpsTrailModal, setGpsTrailModal] = useState<{ date: string } | null>(null);

  // Data fetching
  const { data: empRes } = useGetEmployeeQuery(employeeId || '');
  const employee = empRes?.data;
  const { data: policyRes } = useGetAttendancePolicyQuery();
  const weekOffDays: number[] = (policyRes?.data?.weekOffDays as number[]) || [0];

  const { data: shiftRes } = useGetEmployeeShiftQuery(employeeId || '');
  const shiftAssignment = shiftRes?.data;
  const shift = shiftAssignment?.shift;
  const shiftType = shift?.shiftType || 'OFFICE';

  const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString().split('T')[0];
  const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).toISOString().split('T')[0];
  const { data: attRes } = useGetEmployeeAttendanceQuery({ employeeId: employeeId || '', startDate, endDate });
  const records = attRes?.data?.records || attRes?.data?.data || [];
  const holidays = attRes?.data?.holidays || [];
  const summary = attRes?.data?.summary;

  // Enriched detail for selected date
  const { data: detailRes } = useGetEmployeeAttendanceDetailQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: !employeeId }
  );
  const detail = detailRes?.data;

  // GPS trail for FIELD
  const { data: gpsRes } = useGetEmployeeGPSTrailQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: shiftType !== 'FIELD' }
  );
  const gpsTrail: any[] = gpsRes?.data?.data?.points || [];
  const gpsVisits: any[] = gpsRes?.data?.data?.visits || [];

  // Attendance logs
  const { data: logsRes } = useGetAttendanceLogsQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: !employeeId }
  );
  const attendanceLogs = logsRes?.data?.logs || [];

  // Desktop activity
  const { data: activityRes } = useGetEmployeeActivityLogsQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: !employeeId }
  );
  const activityData = activityRes?.data;

  const { data: screenshotRes } = useGetEmployeeScreenshotsQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: !employeeId }
  );
  const screenshots = screenshotRes?.data || [];

  // Selected record
  const selectedRecord = useMemo(() => {
    return records.find((r: any) => new Date(r.date).toISOString().split('T')[0] === selectedDate);
  }, [records, selectedDate]);

  // Calendar
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const recordMap = new Map<string, any>();
    records.forEach((r: any) => { recordMap.set(new Date(r.date).toISOString().split('T')[0], r); });
    const holidayDates = new Set(
      holidays.map((h: any) => new Date(h.date).toISOString().split('T')[0])
    );
    const todayStr = new Date().toISOString().split('T')[0];
    const days: any[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ date: 0, status: '' });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const record = recordMap.get(dateStr);
      let status = '';
      if (record) status = record.status;
      else if (holidayDates.has(dateStr)) status = 'HOLIDAY';
      else if (weekOffDays.includes(dayOfWeek)) status = 'WEEKEND';
      else if (new Date(dateStr) < new Date(todayStr)) status = 'ABSENT';
      const hasAnomaly = record?.geofenceViolation || (record?.clockInCount || 0) > 1;
      const isMissingPunch = record?.checkIn && !record?.checkOut && record?.status === 'PRESENT';
      days.push({ date: d, dateStr, status, record, isToday: dateStr === todayStr, isSelected: dateStr === selectedDate, hasAnomaly, isMissingPunch });
    }
    return days;
  }, [currentMonth, records, holidays, selectedDate, weekOffDays]);

  // Helpers
  const formatTime = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  const formatTimeFull = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  if (!employee) {
    return (
      <div className="page-container">
        {/* Header skeleton */}
        <div className="layer-card p-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 bg-gray-100 rounded-lg animate-pulse" />
            <div className="w-11 h-11 rounded-xl bg-gray-100 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="w-40 h-5 bg-gray-100 rounded animate-pulse" />
              <div className="flex gap-2"><div className="w-16 h-3 bg-gray-50 rounded animate-pulse" /><div className="w-20 h-3 bg-gray-50 rounded animate-pulse" /></div>
            </div>
          </div>
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-3">
            <div className="layer-card p-4 space-y-3">
              <div className="w-32 h-4 bg-gray-100 rounded animate-pulse" />
              <div className="grid grid-cols-2 gap-2">{[1,2].map(i => <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />)}</div>
              <div className="grid grid-cols-3 gap-1.5">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />)}</div>
            </div>
            <div className="layer-card p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-6 bg-gray-50 rounded animate-pulse" />)}</div>
          </div>
          <div className="lg:col-span-2 space-y-4">
            <div className="layer-card p-4">
              <div className="w-32 h-4 bg-gray-100 rounded animate-pulse mb-3" />
              <div className="grid grid-cols-7 gap-1">{Array.from({length:35}).map((_,i) => <div key={i} className="aspect-square bg-gray-50 rounded-lg animate-pulse" />)}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const monthName = currentMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const checkInLoc = selectedRecord?.checkInLocation as any;
  const geofence = shiftAssignment?.location?.geofence;
  const geofenceCoords = geofence?.coordinates as any;

  // Break duration
  const breakDuration = selectedRecord?.breaks?.reduce((sum: number, b: any) => sum + (b.durationMinutes || 0), 0) || 0;
  const totalHours = Number(selectedRecord?.totalHours || 0);
  const activeHours = Math.max(0, totalHours - breakDuration / 60);

  // Late/early calculations
  const lateBy = (() => {
    if (!selectedRecord?.checkIn || !shift) return 0;
    const [h, m] = shift.startTime.split(':').map(Number);
    const shiftStart = new Date(selectedRecord.checkIn);
    shiftStart.setHours(h, m, 0, 0);
    const diff = Math.round((new Date(selectedRecord.checkIn).getTime() - shiftStart.getTime()) / 60000);
    return Math.max(0, diff);
  })();

  const earlyExitBy = (() => {
    if (!selectedRecord?.checkOut || !shift) return 0;
    const [h, m] = shift.endTime.split(':').map(Number);
    const shiftEnd = new Date(selectedRecord.checkOut);
    shiftEnd.setHours(h, m, 0, 0);
    const diff = Math.round((shiftEnd.getTime() - new Date(selectedRecord.checkOut).getTime()) / 60000);
    return Math.max(0, diff);
  })();

  const overtime = totalHours > Number(shift?.fullDayHours || 8) ? totalHours - Number(shift?.fullDayHours || 8) : 0;

  return (
    <div className="page-container">
      {/* ========== ENHANCED HEADER ========== */}
      <div className="layer-card p-4 mb-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/attendance')} className="p-2 rounded-lg hover:bg-surface-2 flex-shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div className="w-11 h-11 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-base flex-shrink-0">
            {getInitials(employee.firstName, employee.lastName)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-display font-bold text-gray-900">{employee.firstName} {employee.lastName}</h1>
              <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded" data-mono>{employee.employeeCode}</span>
              {shift && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', SHIFT_BADGE[shiftType] || SHIFT_BADGE.OFFICE)}>
                  {shift.name} ({shift.startTime}–{shift.endTime})
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
              {employee.department?.name && <span className="flex items-center gap-1"><Building size={10} /> {employee.department.name}</span>}
              {employee.designation?.name && <span className="flex items-center gap-1"><Briefcase size={10} /> {employee.designation.name}</span>}
              {employee.manager && <span className="flex items-center gap-1"><User size={10} /> {employee.manager.firstName} {employee.manager.lastName}</span>}
              <span className="flex items-center gap-1"><MapPin size={10} /> {employee.workMode?.replace(/_/g, ' ') || 'Office'}</span>
            </div>
          </div>
          {/* Header actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => navigate(`/attendance?regularize=${employeeId}&date=${selectedDate}`)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
              <PenSquare size={11} /> Regularize
            </button>
            <button
              onClick={async () => {
                try {
                  const token = localStorage.getItem('accessToken');
                  const apiUrl = import.meta.env.VITE_API_URL || '/api';
                  const res = await fetch(
                    `${apiUrl}/attendance/export?employeeId=${employeeId}&month=${currentMonth.getMonth() + 1}&year=${currentMonth.getFullYear()}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                  );
                  if (!res.ok) throw new Error('Export failed');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `attendance-${employeeId}-${currentMonth.getMonth() + 1}-${currentMonth.getFullYear()}.xlsx`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { /* toast handled below */ }
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
              <Download size={11} /> Export
            </button>
            <button
              onClick={() => navigate(`/attendance/employee/${employeeId}`)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
              <ClipboardList size={11} /> Audit
            </button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ========== LEFT COLUMN ========== */}
        <div className="lg:col-span-1 space-y-3">
          {/* Daily Summary (enriched) */}
          <div className="layer-card p-4">
            <h3 className="text-xs font-semibold text-gray-700 mb-2.5">{formatDate(selectedDate, 'long')}</h3>
            {selectedRecord ? (
              <div className="space-y-2">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">Status</span>
                  <span className={cn('badge text-[10px]', getStatusColor(selectedRecord.status))}>{selectedRecord.status?.replace(/_/g, ' ')}</span>
                </div>
                {/* Check-in / Check-out */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-emerald-50 rounded-lg p-2 text-center">
                    <p className="text-[9px] text-emerald-600 font-medium">Check In</p>
                    <p className="text-sm font-mono font-bold text-emerald-700" data-mono>{formatTime(selectedRecord.checkIn)}</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2 text-center">
                    <p className="text-[9px] text-red-500 font-medium">Check Out</p>
                    <p className="text-sm font-mono font-bold text-red-600" data-mono>{formatTime(selectedRecord.checkOut)}</p>
                  </div>
                </div>
                {/* Hours grid */}
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-surface-2 rounded-lg p-1.5 text-center">
                    <p className="text-[9px] text-gray-400">Total</p>
                    <p className="text-xs font-mono font-bold text-gray-700" data-mono>{totalHours ? `${totalHours.toFixed(1)}h` : '--'}</p>
                  </div>
                  <div className="bg-surface-2 rounded-lg p-1.5 text-center">
                    <p className="text-[9px] text-gray-400">Active</p>
                    <p className="text-xs font-mono font-bold text-blue-600" data-mono>{totalHours ? `${activeHours.toFixed(1)}h` : '--'}</p>
                  </div>
                  <div className="bg-surface-2 rounded-lg p-1.5 text-center">
                    <p className="text-[9px] text-gray-400">Break</p>
                    <p className="text-xs font-mono font-bold text-amber-600" data-mono>{breakDuration > 0 ? `${breakDuration}m` : '--'}</p>
                  </div>
                </div>
                {/* Late / Early / Overtime */}
                <div className="flex gap-2">
                  {lateBy > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-200 font-medium">
                      Late by {lateBy}m
                    </span>
                  )}
                  {earlyExitBy > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded-full border border-orange-200 font-medium">
                      Early exit {earlyExitBy}m
                    </span>
                  )}
                  {overtime > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-200 font-medium">
                      OT {overtime.toFixed(1)}h
                    </span>
                  )}
                </div>
                {/* Source + Mode */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Source: <span className="text-gray-600">{selectedRecord.source || 'MANUAL_APP'}</span></span>
                  <span className="text-gray-400">Mode: <span className="text-gray-600">{selectedRecord.workMode || 'OFFICE'}</span></span>
                </div>
                {/* Anomalies */}
                {selectedRecord.geofenceViolation && (
                  <div className="p-2 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-[10px] font-medium text-red-600 flex items-center gap-1"><Flag size={10} /> Outside geofence area</p>
                  </div>
                )}
                {selectedRecord.clockInCount > 1 && (
                  <div className="p-2 bg-amber-50 rounded-lg border border-amber-100">
                    <p className="text-[10px] font-medium text-amber-600">Re-clocked in {selectedRecord.clockInCount - 1} time(s)</p>
                  </div>
                )}
                {/* Detail anomalies from API */}
                {detail?.anomalies?.length > 0 && (
                  <div className="space-y-1">
                    {detail.anomalies.map((a: any) => (
                      <div key={a.id} className={cn('p-1.5 rounded-lg text-[10px] font-medium', ANOMALY_COLORS[a.type] || 'bg-gray-50 text-gray-600')}>
                        <AlertTriangle size={9} className="inline mr-1" />{a.description}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">No record for this date</p>
            )}
          </div>

          {/* Attendance Timeline (enriched) */}
          {attendanceLogs.length > 0 && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                <Clock size={12} className="text-brand-500" /> Attendance Timeline
              </h3>
              <div className="space-y-0">
                {attendanceLogs.map((log: any, idx: number) => {
                  const colors = TIMELINE_COLORS[log.action] || { bg: 'bg-gray-50', icon: 'text-gray-400', border: 'border-gray-200' };
                  const icons: Record<string, any> = {
                    CLOCK_IN: <LogIn size={11} className={colors.icon} />,
                    RE_CLOCK_IN: <LogIn size={11} className={colors.icon} />,
                    CLOCK_OUT: <LogOut size={11} className={colors.icon} />,
                    BREAK_START: <Coffee size={11} className={colors.icon} />,
                    BREAK_END: <Play size={11} className={colors.icon} />,
                  };
                  const labels: Record<string, string> = {
                    CLOCK_IN: 'Checked In', RE_CLOCK_IN: 'Re-Checked In',
                    CLOCK_OUT: 'Checked Out', BREAK_START: 'Break Started', BREAK_END: 'Break Ended',
                  };
                  const isViolation = log.geofenceStatus === 'OUTSIDE';
                  return (
                    <div key={log.id || idx} className="flex items-start gap-2.5 py-1.5 relative">
                      {idx < attendanceLogs.length - 1 && <div className="absolute left-[10px] top-7 bottom-0 w-px bg-gray-200" />}
                      <div className={cn('w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 z-10 border', colors.bg, colors.border)}>
                        {icons[log.action] || <Clock size={11} className="text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={cn('text-[11px] font-medium', isViolation ? 'text-red-600' : 'text-gray-700')}>
                            {labels[log.action] || log.action}
                          </p>
                          <span className="text-[9px] font-mono text-gray-400" data-mono>{formatTimeFull(log.timestamp)}</span>
                        </div>
                        {isViolation && (
                          <p className="text-[9px] text-red-500 flex items-center gap-0.5 mt-0.5">
                            <Flag size={8} /> Outside geofence ({log.distanceMeters}m away)
                          </p>
                        )}
                        {log.notes && <p className="text-[9px] text-gray-400 mt-0.5 truncate">{log.notes}</p>}
                        {log.shiftName && <p className="text-[9px] text-blue-400 mt-0.5">Shift: {log.shiftName}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shift & Policy Block */}
          {shift && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                <Shield size={12} className="text-brand-500" /> Shift & Policy
              </h3>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-400">Assigned Shift</span><span className="text-gray-700 font-medium">{shift.name}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Shift Window</span><span className="text-gray-700 font-mono" data-mono>{shift.startTime} – {shift.endTime}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Grace Period</span><span className="text-gray-700">{shift.graceMinutes || 15} min</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Expected Hours</span><span className="text-gray-700">{Number(shift.fullDayHours || 8)}h full / {Number(shift.halfDayHours || 4)}h half</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Shift Type</span><span className="text-gray-700">{shiftType}</span></div>
                {shiftAssignment?.location && (
                  <div className="flex justify-between"><span className="text-gray-400">Office Location</span><span className="text-gray-700">{shiftAssignment.location.name}</span></div>
                )}
              </div>
            </div>
          )}

          {/* Leave/Payroll Impact */}
          {detail?.leaveRequests?.length > 0 && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                <FileText size={12} className="text-purple-500" /> Leave Impact
              </h3>
              {detail.leaveRequests.map((lr: any) => (
                <div key={lr.id} className="bg-purple-50 rounded-lg p-2.5 mb-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="font-medium text-purple-700">{lr.leaveType?.name}</span>
                    <span className={cn('badge text-[9px]', getStatusColor(lr.status))}>{lr.status}</span>
                  </div>
                  <p className="text-purple-500 text-[10px] mt-0.5">
                    {formatDate(lr.startDate)} – {formatDate(lr.endDate)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Monthly Summary */}
          {summary && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5">Monthly Summary</h3>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { l: 'Present', v: summary.present, c: 'text-emerald-600' },
                  { l: 'Absent', v: summary.absent, c: 'text-red-500' },
                  { l: 'Half Day', v: summary.halfDay, c: 'text-amber-500' },
                  { l: 'On Leave', v: summary.onLeave, c: 'text-purple-500' },
                  { l: 'Avg Hours', v: `${summary.averageHours || 0}h`, c: 'text-blue-600' },
                  { l: 'WFH', v: summary.workFromHome, c: 'text-teal-500' },
                ].map(s => (
                  <div key={s.l} className="text-center py-1.5 bg-surface-2 rounded-lg">
                    <p className={cn('text-sm font-bold font-mono', s.c)} data-mono>{s.v}</p>
                    <p className="text-[9px] text-gray-400">{s.l}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ========== RIGHT COLUMN (2 cols) ========== */}
        <div className="lg:col-span-2 space-y-4">
          {/* Compact Calendar */}
          <div className="layer-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-display font-semibold text-gray-800 flex items-center gap-1.5">
                <Calendar size={12} className="text-brand-500" /> {monthName}
              </h2>
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="p-1 rounded-md hover:bg-surface-2">
                  <ChevronLeft size={12} />
                </button>
                <button onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date().toISOString().split('T')[0]); }} className="text-[9px] text-brand-600 px-2 py-0.5 rounded-md hover:bg-brand-50 font-medium">Today</button>
                <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="p-1 rounded-md hover:bg-surface-2">
                  <ChevronRight size={12} />
                </button>
                <button onClick={() => setShowCalendarModal(true)} className="p-1 rounded-md hover:bg-surface-2 ml-1" title="Expand calendar">
                  <Maximize2 size={12} className="text-gray-400" />
                </button>
              </div>
            </div>

            <div className="max-w-xs mx-auto">
              <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} className="text-center text-[8px] font-semibold text-gray-400 py-0.5">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map((day: any, idx: number) => (
                  <button key={idx} disabled={day.date === 0}
                    onClick={() => day.dateStr && setSelectedDate(day.dateStr)}
                    className={cn(
                      'rounded-md flex flex-col items-center justify-center text-[9px] transition-all py-1.5 px-0.5',
                      day.date === 0 && 'invisible',
                      day.isSelected && 'ring-1.5 ring-brand-500 ring-offset-1',
                      day.isToday && !day.isSelected && 'ring-1 ring-brand-300',
                      STATUS_BG[day.status] || (day.date > 0 ? 'bg-white hover:bg-gray-50' : ''),
                    )}>
                    <span className={cn('font-medium leading-none text-[10px]', day.isToday ? 'text-brand-600' : 'text-gray-700', day.status === 'WEEKEND' && 'text-gray-400')}>
                      {day.date > 0 ? day.date : ''}
                    </span>
                    {day.status && day.date > 0 && (
                      <span className={cn('text-[6px] font-bold leading-none mt-0.5',
                        day.status === 'PRESENT' ? 'text-emerald-600' :
                        day.status === 'ABSENT' ? 'text-red-500' :
                        day.status === 'HALF_DAY' ? 'text-amber-600' :
                        day.status === 'ON_LEAVE' ? 'text-purple-500' :
                        day.status === 'WORK_FROM_HOME' ? 'text-teal-500' :
                        day.status === 'HOLIDAY' ? 'text-blue-500' :
                        'text-gray-400'
                      )}>
                        {STATUS_LABEL[day.status] || ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Compact Legend with descriptions */}
            <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100 justify-center">
              {[
                { l: 'P', d: 'Present', c: 'text-emerald-600 bg-emerald-50' },
                { l: 'A', d: 'Absent', c: 'text-red-500 bg-red-50' },
                { l: 'HD', d: 'Half Day', c: 'text-amber-600 bg-amber-50' },
                { l: 'L', d: 'Leave', c: 'text-purple-500 bg-purple-50' },
                { l: 'WFH', d: 'WFH', c: 'text-teal-500 bg-teal-50' },
                { l: 'WO', d: 'Week Off', c: 'text-gray-400 bg-gray-50' },
                { l: 'H', d: 'Holiday', c: 'text-blue-500 bg-blue-50' },
              ].map(i => (
                <span key={i.l} className={cn('text-[7px] font-bold px-1 py-0.5 rounded cursor-default', i.c)} title={i.d}>{i.l}</span>
              ))}
            </div>
          </div>

          {/* Calendar Expand Modal */}
          <AnimatePresence>
            {showCalendarModal && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={(e) => e.target === e.currentTarget && setShowCalendarModal(false)}>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-display font-semibold text-gray-900 flex items-center gap-2">
                      <Calendar size={18} className="text-brand-500" /> {monthName}
                    </h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft size={16} /></button>
                      <button onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date().toISOString().split('T')[0]); }} className="text-xs text-brand-600 px-3 py-1 rounded-lg hover:bg-brand-50 font-medium">Today</button>
                      <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
                      <button onClick={() => setShowCalendarModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 ml-2"><X size={16} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day: any, idx: number) => (
                      <button key={idx} disabled={day.date === 0}
                        onClick={() => { day.dateStr && setSelectedDate(day.dateStr); setShowCalendarModal(false); }}
                        className={cn(
                          'aspect-square rounded-xl flex flex-col items-center justify-center text-sm transition-all',
                          day.date === 0 && 'invisible',
                          day.isSelected && 'ring-2 ring-brand-500 ring-offset-2',
                          day.isToday && !day.isSelected && 'ring-1 ring-brand-300',
                          STATUS_BG[day.status] || (day.date > 0 ? 'bg-white hover:bg-gray-50 border border-gray-100' : ''),
                        )}>
                        <span className={cn('font-semibold', day.isToday ? 'text-brand-600' : 'text-gray-800', day.status === 'WEEKEND' && 'text-gray-400')}>
                          {day.date > 0 ? day.date : ''}
                        </span>
                        {day.status && day.date > 0 && (
                          <span className={cn('text-[9px] font-bold mt-0.5',
                            day.status === 'PRESENT' ? 'text-emerald-600' :
                            day.status === 'ABSENT' ? 'text-red-500' :
                            day.status === 'HALF_DAY' ? 'text-amber-600' :
                            day.status === 'ON_LEAVE' ? 'text-purple-500' :
                            day.status === 'HOLIDAY' ? 'text-blue-500' :
                            'text-gray-400'
                          )}>{STATUS_LABEL[day.status] || ''}</span>
                        )}
                        {day.record?.totalHours && (
                          <span className="text-[8px] font-mono text-gray-400" data-mono>{Number(day.record.totalHours).toFixed(1)}h</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-gray-100 justify-center">
                    {[
                      { l: 'P', desc: 'Present', c: 'text-emerald-600 bg-emerald-50' },
                      { l: 'A', desc: 'Absent', c: 'text-red-500 bg-red-50' },
                      { l: 'HD', desc: 'Half Day', c: 'text-amber-600 bg-amber-50' },
                      { l: 'L', desc: 'Leave', c: 'text-purple-500 bg-purple-50' },
                      { l: 'WO', desc: 'Week Off', c: 'text-gray-400 bg-gray-50' },
                      { l: 'H', desc: 'Holiday', c: 'text-blue-500 bg-blue-50' },
                    ].map(i => (
                      <div key={i.l} className="flex items-center gap-1">
                        <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded', i.c)}>{i.l}</span>
                        <span className="text-xs text-gray-500">{i.desc}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Map Section (lazy loaded) */}
          {(checkInLoc?.lat || (shiftType === 'FIELD' && gpsTrail.length > 0)) && (
            <Suspense fallback={<div className="layer-card overflow-hidden"><div className="px-4 pt-3 pb-1.5"><div className="w-28 h-3 bg-gray-100 rounded animate-pulse" /></div><div className={shiftType === 'FIELD' ? 'h-[320px]' : 'h-[200px]'} style={{ background: '#f9fafb' }} /></div>}>
              <MapSection
                checkInLoc={checkInLoc}
                geofenceCoords={geofenceCoords}
                geofence={geofence}
                shiftType={shiftType}
                gpsTrail={gpsTrail}
                gpsVisits={gpsVisits}
                selectedDate={selectedDate}
                geofenceViolation={selectedRecord?.geofenceViolation}
              />
            </Suspense>
          )}

          {/* Regularization History */}
          {detail?.regularizations?.length > 0 && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                <FileText size={12} className="text-indigo-500" /> Regularization History
              </h3>
              <div className="space-y-2">
                {detail.regularizations.map((r: any) => (
                  <div key={r.id} className="bg-surface-2 rounded-lg p-2.5 text-[11px]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-500">Date: {formatDate(r.attendance?.date)}</span>
                      <span className={cn('badge text-[9px]',
                        r.status === 'PENDING' ? 'badge-warning' :
                        r.status === 'APPROVED' ? 'badge-success' : 'badge-error'
                      )}>{r.status}</span>
                    </div>
                    <p className="text-gray-600">{r.reason}</p>
                    {r.requestedCheckIn && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Requested: {formatTime(r.requestedCheckIn)} → {formatTime(r.requestedCheckOut)}
                      </p>
                    )}
                    {r.approverRemarks && (
                      <p className="text-[10px] text-gray-400 mt-0.5 italic">Remarks: {r.approverRemarks}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Desktop Activity */}
          {activityData?.summary && activityData.summary.logCount > 0 && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5 flex items-center gap-1.5">
                <Activity size={12} className="text-brand-500" /> Desktop Activity — {formatDate(selectedDate)}
              </h3>
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="text-center py-1.5 bg-emerald-50 rounded-lg">
                  <p className="text-sm font-bold font-mono text-emerald-600" data-mono>{activityData.summary.totalActiveMinutes}m</p>
                  <p className="text-[9px] text-gray-500">Active</p>
                </div>
                <div className="text-center py-1.5 bg-gray-50 rounded-lg">
                  <p className="text-sm font-bold font-mono text-gray-500" data-mono>{activityData.summary.totalIdleMinutes}m</p>
                  <p className="text-[9px] text-gray-500">Idle</p>
                </div>
                <div className="text-center py-1.5 bg-blue-50 rounded-lg">
                  <p className="text-sm font-bold font-mono text-blue-600" data-mono>{activityData.summary.totalKeystrokes}</p>
                  <p className="text-[9px] text-gray-500">Keystrokes</p>
                </div>
                <div className="text-center py-1.5 bg-purple-50 rounded-lg">
                  <p className="text-sm font-bold font-mono text-purple-600" data-mono>{activityData.summary.totalClicks}</p>
                  <p className="text-[9px] text-gray-500">Clicks</p>
                </div>
              </div>
              {activityData.summary.topApps?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-600 mb-1.5">Top Applications</p>
                  <div className="space-y-1">
                    {activityData.summary.topApps.slice(0, 5).map((app: any, i: number) => {
                      const max = activityData.summary.topApps[0].minutes || 1;
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-600 w-24 truncate">{app.app}</span>
                          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-400 rounded-full" style={{ width: `${Math.max((app.minutes / max) * 100, 5)}%` }} />
                          </div>
                          <span className="text-[9px] font-mono text-gray-500 w-8 text-right" data-mono>{app.minutes}m</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <div className="layer-card p-4">
              <h3 className="text-xs font-semibold text-gray-700 mb-2.5">Screenshots ({screenshots.length})</h3>
              <div className="grid grid-cols-4 gap-2">
                {screenshots.map((s: any) => (
                  <div key={s.id} className="group relative cursor-pointer" onClick={() => window.open(getUploadUrl(s.imageUrl), '_blank')}>
                    <img src={getUploadUrl(s.imageUrl)} alt={s.activeApp || 'Screenshot'} className="w-full h-20 object-cover rounded-lg border border-gray-200 group-hover:border-brand-300" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 rounded-b-lg px-1.5 py-0.5">
                      <p className="text-[8px] text-white truncate">{s.activeApp || 'Desktop'}</p>
                      <p className="text-[7px] text-gray-300">{formatTime(s.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily Records Table */}
          <div className="layer-card overflow-hidden">
            <div className="px-4 pt-3 pb-1.5">
              <h3 className="text-xs font-semibold text-gray-700">Daily Records</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5">Date</th>
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5">In</th>
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5">Out</th>
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5">Hours</th>
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5">Status</th>
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5 hidden md:table-cell">Mode</th>
                    <th className="text-left text-[10px] text-gray-500 px-4 py-1.5 hidden md:table-cell">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 31).map((r: any, i: number) => {
                    const rowDate = new Date(r.date).toISOString().split('T')[0];
                    const isFieldSales = r.workMode === 'FIELD_SALES';
                    return (
                    <tr key={i} onClick={() => setSelectedDate(rowDate)}
                      className={cn('border-b border-gray-50 hover:bg-surface-2 cursor-pointer',
                        rowDate === selectedDate && 'bg-brand-50/50')}>
                      <td className="px-4 py-1.5 text-gray-600">{formatDate(r.date)}</td>
                      <td className="px-4 py-1.5 font-mono text-gray-600" data-mono>{formatTime(r.checkIn)}</td>
                      <td className="px-4 py-1.5 font-mono text-gray-600" data-mono>{formatTime(r.checkOut)}</td>
                      <td className="px-4 py-1.5 font-mono text-gray-600" data-mono>{r.totalHours ? `${Number(r.totalHours).toFixed(1)}h` : '--'}</td>
                      <td className="px-4 py-1.5"><span className={cn('badge text-[9px]', getStatusColor(r.status))}>{r.status?.replace(/_/g, ' ')}</span></td>
                      <td className="px-4 py-1.5 text-gray-400 hidden md:table-cell">{r.workMode || 'OFFICE'}</td>
                      <td className="px-4 py-1.5 hidden md:table-cell">
                        {r.geofenceViolation && <Flag size={10} className="text-red-500 inline" />}
                        {r.clockInCount > 1 && <span className="text-[9px] text-amber-500 ml-1">x{r.clockInCount}</span>}
                        {isFieldSales && (
                          <button
                            onClick={e => { e.stopPropagation(); setGpsTrailModal({ date: rowDate }); }}
                            className="ml-1 inline-flex items-center gap-0.5 text-[9px] text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 hover:bg-green-100 transition-colors"
                            title="View GPS Trail"
                          >
                            <Navigation size={9} /> GPS
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
        </div>
      </div>

      {/* GPS Trail Modal */}
      <Suspense fallback={null}>
        {gpsTrailModal && employee && (
          <GpsTrailModal
            isOpen={!!gpsTrailModal}
            onClose={() => setGpsTrailModal(null)}
            employeeId={employeeId || ''}
            employeeName={`${employee.firstName} ${employee.lastName}`}
            date={gpsTrailModal.date}
          />
        )}
      </Suspense>
    </div>
  );
}
