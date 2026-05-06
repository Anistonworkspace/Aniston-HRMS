import { useState, useMemo, lazy, Suspense, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getUploadUrl } from '../../lib/utils';
import { useAppSelector, useAppDispatch } from '../../app/store';
import { api } from '../../app/api';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Clock, MapPin, Calendar, ChevronLeft, ChevronRight, Activity,
  Flag, LogIn, LogOut, Coffee, Play, Shield, FileText, AlertTriangle,
  Download, PenSquare, User, Briefcase, Building, Maximize2, X, Navigation, CheckCircle,
} from 'lucide-react';
import { useGetEmployeeQuery } from '../employee/employeeApi';
import {
  useGetEmployeeAttendanceQuery, useGetEmployeeGPSTrailQuery,
  useGetEmployeeActivityLogsQuery, useGetEmployeeScreenshotsQuery,
  useGetAttendanceLogsQuery, useGetEmployeeAttendanceDetailQuery,
  useGetAttendancePolicyQuery, useSubmitRegularizationMutation, useMarkAttendanceMutation, useHandleRegularizationMutation,
} from './attendanceApi';
import { useGetEmployeeShiftQuery } from '../workforce/workforceApi';
import toast from 'react-hot-toast';
import { cn, formatDate, getInitials, getStatusColor } from '../../lib/utils';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';

// Lazy load map components
const GpsTrailSection = lazy(() => import('./components/MapSection').then(m => ({ default: m.GpsTrailSection })));
const CheckInSection = lazy(() => import('./components/MapSection').then(m => ({ default: m.CheckInSection })));
const CheckInModal = lazy(() => import('./components/MapSection').then(m => ({ default: m.CheckInModal })));
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
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector(s => s.auth.accessToken);
  const user = useAppSelector(s => s.auth.user);
  const isHR = user && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [gpsTrailModal, setGpsTrailModal] = useState<{ date: string } | null>(null);

  // Regularize modal state
  const [showRegularizeModal, setShowRegularizeModal] = useState(false);
  const [regReason, setRegReason] = useState('');
  const [regCheckIn, setRegCheckIn] = useState('');
  const [regCheckOut, setRegCheckOut] = useState('');
  const [submitRegularization, { isLoading: isSubmittingReg }] = useSubmitRegularizationMutation();
  const [handleRegularization, { isLoading: isHandlingReg }] = useHandleRegularizationMutation();

  // Calendar manual marking popover
  const [markingDate, setMarkingDate] = useState<string | null>(null);
  const [markAttendance, { isLoading: isMarking }] = useMarkAttendanceMutation();

  // Map picker — shown when HR clicks a daily record row for a FIELD employee
  const [mapPickerRow, setMapPickerRow] = useState<{ date: string; checkInLoc: any; geofenceViolation?: boolean } | null>(null);
  // Check-in modal — opened from map picker
  const [checkInModalDate, setCheckInModalDate] = useState<{ date: string; checkInLoc: any; geofenceViolation?: boolean } | null>(null);

  // Live hours counter — ticks every second when employee is clocked in today with no checkout
  const [liveElapsedSecs, setLiveElapsedSecs] = useState(0);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Selected record — hoisted so it can be used in trackingGapWarning below
  const selectedRecord = useMemo(() => {
    return records.find((r: any) => new Date(r.date).toISOString().split('T')[0] === selectedDate);
  }, [records, selectedDate]);

  // Enriched detail for selected date
  const { data: detailRes } = useGetEmployeeAttendanceDetailQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: !employeeId }
  );
  const detail = detailRes?.data;

  // GPS trail for FIELD — polls every 30 s fallback + instant socket-driven refetch
  const isToday = selectedDate === new Date().toISOString().split('T')[0];
  const { data: gpsRes, refetch: refetchGps } = useGetEmployeeGPSTrailQuery(
    { employeeId: employeeId || '', date: selectedDate },
    { skip: shiftType !== 'FIELD', pollingInterval: isToday ? 30000 : 0 }
  );
  const gpsTrail: any[] = gpsRes?.data?.points || [];
  const gpsVisits: any[] = gpsRes?.data?.visits || [];

  // Socket: when GPS batch arrives for this employee+today, refetch immediately
  // so HR sees new points on the live map without waiting for the 30s poll
  const refetchGpsRef = useRef(refetchGps);
  refetchGpsRef.current = refetchGps;
  useEffect(() => {
    if (!isToday || shiftType !== 'FIELD') return;
    const handler = (data: any) => {
      if (data?.employeeId === employeeId && data?.date === selectedDate) {
        refetchGpsRef.current();
      }
    };
    onSocketEvent('gps:trail-updated', handler);
    return () => offSocketEvent('gps:trail-updated', handler);
  }, [isToday, shiftType, employeeId, selectedDate]);

  // Socket: HR manual mark → invalidate Attendance cache so all calendars re-render instantly
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const handler = (data: any) => {
      if (data?.employeeId === employeeId) {
        dispatchRef.current(api.util.invalidateTags(['Attendance'] as any));
      }
    };
    onSocketEvent('attendance:marked', handler);
    return () => offSocketEvent('attendance:marked', handler);
  }, [employeeId]);

  // Live clock — only runs when viewing today's record with an active check-in (no checkout yet)
  useEffect(() => {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    const todayStr = new Date().toISOString().split('T')[0];
    const todayRecord = records.find((r: any) => new Date(r.date).toISOString().split('T')[0] === todayStr);
    if (!todayRecord?.checkIn || todayRecord?.checkOut) {
      setLiveElapsedSecs(0);
      return;
    }
    const checkInMs = new Date(todayRecord.checkIn).getTime();
    const breakMs = (todayRecord.breaks || []).reduce((sum: number, b: any) => sum + (b.durationMinutes || 0), 0) * 60_000;
    const calc = () => Math.max(0, Math.floor((Date.now() - checkInMs - breakMs) / 1000));
    setLiveElapsedSecs(calc());
    liveTimerRef.current = setInterval(() => setLiveElapsedSecs(calc()), 1000);
    return () => { if (liveTimerRef.current) clearInterval(liveTimerRef.current); };
  }, [records]);

  // C3 — detect tracking gap for HR: compare last GPS point to now
  const trackingIntervalMs = (shift?.trackingIntervalMinutes || 60) * 60_000;
  const lastGpsTs = gpsTrail.length > 0
    ? new Date(gpsTrail[gpsTrail.length - 1]?.timestamp).getTime()
    : null;
  const msSinceLastGps = lastGpsTs ? Date.now() - lastGpsTs : null;
  // Warn if last point is older than 2× the interval AND employee is currently checked in but not checked out
  const trackingGapWarning = isToday
    && shiftType === 'FIELD'
    && msSinceLastGps !== null
    && msSinceLastGps > trackingIntervalMs * 2
    && selectedRecord?.checkIn
    && !selectedRecord?.checkOut;

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
    // Today counts as absent only after shift start grace window (or default 9:30 + 30 min = 10:00)
    const nowHHMM = new Date().getHours() * 60 + new Date().getMinutes();
    const shiftStartMins = shift?.startTime
      ? (() => { const [h, m] = shift.startTime.split(':').map(Number); return h * 60 + m; })()
      : 9 * 60 + 30;
    const graceEnd = shiftStartMins + (shift?.graceMinutes || 30);
    const todayShiftStarted = nowHHMM >= graceEnd;

    const days: any[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ date: 0, status: '' });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const record = recordMap.get(dateStr);
      let status = '';
      if (record) {
        status = record.status;
      } else if (holidayDates.has(dateStr)) {
        status = 'HOLIDAY';
      } else if (weekOffDays.includes(dayOfWeek)) {
        status = 'WEEKEND';
      } else if (dateStr < todayStr) {
        // Past days with no record = absent
        status = 'ABSENT';
      } else if (dateStr === todayStr && todayShiftStarted) {
        // Today, only mark red after grace window has passed and employee still hasn't checked in
        status = 'ABSENT';
      }
      const hasAnomaly = record?.geofenceViolation || (record?.clockInCount || 0) > 1;
      const isMissingPunch = record?.checkIn && !record?.checkOut && record?.status === 'PRESENT';
      const isManualHR = record?.source === 'MANUAL_HR';
      days.push({ date: d, dateStr, status, record, isToday: dateStr === todayStr, isSelected: dateStr === selectedDate, hasAnomaly, isMissingPunch, isManualHR });
    }
    return days;
  }, [currentMonth, records, holidays, selectedDate, weekOffDays, shift]);

  // Format seconds as H:MM:SS for live counter
  const fmtLive = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

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

  // Live session detection — today's record checked in but not checked out yet
  const todayDateStr = new Date().toISOString().split('T')[0];
  const todayRecord = records.find((r: any) => new Date(r.date).toISOString().split('T')[0] === todayDateStr);
  const isClockedInNow = !!(todayRecord?.checkIn && !todayRecord?.checkOut);

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
              {/* Live session counter — only shown while employee is actively clocked in today */}
              {isClockedInNow && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-mono font-bold text-emerald-700" data-mono>
                    {fmtLive(liveElapsedSecs)}
                  </span>
                  <span className="text-[9px] text-emerald-600">active</span>
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
            {isHR && (
              <button
                onClick={() => { setRegReason(''); setRegCheckIn(''); setRegCheckOut(''); setShowRegularizeModal(true); }}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
                <PenSquare size={11} /> Regularize
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  const apiUrl = import.meta.env.VITE_API_URL || '/api';
                  const res = await fetch(
                    `${apiUrl}/attendance/export?employeeId=${employeeId}&month=${currentMonth.getMonth() + 1}&year=${currentMonth.getFullYear()}`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                  );
                  if (!res.ok) throw new Error('Export failed');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `attendance-${employeeId}-${currentMonth.getMonth() + 1}-${currentMonth.getFullYear()}.xlsx`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { toast.error('Export failed'); }
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-gray-500 bg-gray-50 rounded-lg hover:bg-gray-100 border border-gray-200">
              <Download size={11} /> Export
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
              {shiftAssignment?.endDate && new Date(shiftAssignment.endDate) < new Date() && (
                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2.5 text-[10px] text-amber-700">
                  <AlertTriangle size={11} className="shrink-0" />
                  Assignment expired {formatDate(shiftAssignment.endDate)} — using org default shift
                </div>
              )}
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
              {/* Dismiss backdrop for marking popover */}
              {markingDate && <div className="fixed inset-0 z-20" onClick={() => setMarkingDate(null)} />}
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map((day: any, idx: number) => (
                  <div key={idx} className="relative">
                    <button disabled={day.date === 0}
                      onClick={() => {
                        if (!day.dateStr) return;
                        setSelectedDate(day.dateStr);
                        // HR can mark past/today dates only (not holidays or weekends)
                        if (isHR && day.dateStr <= new Date().toISOString().split('T')[0] && day.status !== 'HOLIDAY' && day.status !== 'WEEKEND') {
                          setMarkingDate(markingDate === day.dateStr ? null : day.dateStr);
                        } else {
                          setMarkingDate(null);
                        }
                      }}
                      className={cn(
                        'w-full rounded-md flex flex-col items-center justify-center text-[9px] transition-all py-1.5 px-0.5 relative',
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
                      {/* HR manual mark indicator — small shield dot in top-right corner */}
                      {day.isManualHR && day.date > 0 && (
                        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-400" title="HR Manual" />
                      )}
                    </button>
                    {/* HR marking popover */}
                    {isHR && markingDate === day.dateStr && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 min-w-[90px]" onClick={e => e.stopPropagation()}>
                        <p className="text-[8px] text-gray-400 font-medium px-1 mb-1">Mark as</p>
                        {([
                          { s: 'PRESENT', label: 'Present', cls: 'text-emerald-600' },
                          { s: 'HALF_DAY', label: 'Half Day', cls: 'text-amber-600' },
                          { s: 'ABSENT', label: 'Absent', cls: 'text-red-500' },
                          { s: 'WEEKEND', label: 'Week Off', cls: 'text-gray-400' },
                        ] as const).map(({ s, label, cls }) => (
                          <button key={s}
                            disabled={isMarking}
                            onClick={async () => {
                              try {
                                await markAttendance({ employeeId: employeeId!, date: day.dateStr, status: s }).unwrap();
                                toast.success(`Marked ${label} for ${day.dateStr}`);
                                setMarkingDate(null);
                              } catch { toast.error('Failed to mark attendance'); }
                            }}
                            className={cn(
                              'w-full text-left text-[9px] font-medium px-1.5 py-1 rounded-lg hover:bg-gray-50 transition-colors',
                              cls
                            )}>
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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
              <span className="flex items-center gap-0.5 text-[7px] text-indigo-500 cursor-default" title="HR Manual Mark">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" /> HR
              </span>
            </div>
          </div>

          {/* Calendar Expand Modal */}
          <AnimatePresence>
            {showCalendarModal && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
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

          {/* Map Sections (lazy loaded) */}
          {/* FIELD: show GPS Trail then Check-in Location */}
          {shiftType === 'FIELD' && gpsTrail.length > 0 && (
            <Suspense fallback={<div className="layer-card overflow-hidden"><div className="px-4 pt-3 pb-1.5"><div className="w-28 h-3 bg-gray-100 rounded animate-pulse" /></div><div className="h-[300px]" style={{ background: '#f9fafb' }} /></div>}>
              <GpsTrailSection gpsTrail={gpsTrail} gpsVisits={gpsVisits} selectedDate={selectedDate} />
            </Suspense>
          )}
          {checkInLoc?.lat && (
            <Suspense fallback={<div className="layer-card overflow-hidden"><div className="px-4 pt-3 pb-1.5"><div className="w-28 h-3 bg-gray-100 rounded animate-pulse" /></div><div className="h-[200px]" style={{ background: '#f9fafb' }} /></div>}>
              <CheckInSection
                checkInLoc={checkInLoc}
                geofenceCoords={geofenceCoords}
                geofence={geofence}
                geofenceViolation={selectedRecord?.geofenceViolation}
              />
            </Suspense>
          )}

          {/* C3 — Tracking gap warning: last GPS point is stale while employee is on shift */}
          {trackingGapWarning && (
            <div className="layer-card p-3 border border-amber-200 bg-amber-50">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-700">Tracking May Have Stopped</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    Last GPS update was{' '}
                    <strong>
                      {msSinceLastGps! > 3600000
                        ? `${Math.floor(msSinceLastGps! / 3600000)}h ${Math.floor((msSinceLastGps! % 3600000) / 60000)}m`
                        : `${Math.floor(msSinceLastGps! / 60000)} min`}
                    </strong>{' '}
                    ago (shift interval: {shift?.trackingIntervalMinutes || 60} min). Employee may have force-stopped the app, disabled GPS, or lost signal.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* No GPS data reason — shown only for FIELD shift employees when trail is empty */}
          {shiftType === 'FIELD' && gpsTrail.length === 0 && (
            <div className="layer-card p-4">
              <div className="flex items-start gap-3">
                <Navigation size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-1">No GPS Trail Available</p>
                  <p className="text-[11px] text-gray-500">
                    {selectedDate > new Date().toISOString().split('T')[0]
                      ? 'Future date selected — GPS data is not available yet.'
                      : !selectedRecord
                      ? 'No attendance record found for this date.'
                      : !selectedRecord.checkIn
                      ? 'Employee has not clocked in on this date — GPS tracking only starts after clock-in.'
                      : selectedRecord.workMode !== 'FIELD_SALES'
                      ? `Attendance recorded in ${selectedRecord.workMode?.replace(/_/g, ' ') || 'Office'} mode — GPS trail is only available for Field Sales mode.`
                      : 'No GPS points were recorded. The employee may have had GPS disabled, been offline all day, or tracking was not active on this date.'}
                  </p>
                </div>
              </div>
            </div>
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
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 31).map((r: any, i: number) => {
                    const rowDate = new Date(r.date).toISOString().split('T')[0];
                    const isFieldRow = r.workMode === 'FIELD_SALES' || shiftType === 'FIELD';
                    const rowCheckInLoc = r.checkInLocation as any;
                    return (
                      <tr key={i}
                        onClick={() => {
                          setSelectedDate(rowDate);
                          if (isFieldRow && r.checkIn) {
                            setMapPickerRow({ date: rowDate, checkInLoc: rowCheckInLoc, geofenceViolation: r.geofenceViolation });
                          }
                        }}
                        className={cn('border-b border-gray-50 hover:bg-surface-2 cursor-pointer',
                          rowDate === selectedDate && 'bg-brand-50/50')}>
                        <td className="px-4 py-1.5 text-gray-600">
                          <div className="flex items-center gap-1.5">
                            {formatDate(r.date)}
                            {isFieldRow && r.checkIn && (
                              <Navigation size={9} className="text-green-500 flex-shrink-0" title="Click to view GPS / Check-in map" />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-1.5 font-mono text-gray-600" data-mono>{formatTime(r.checkIn)}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-600" data-mono>{formatTime(r.checkOut)}</td>
                        <td className="px-4 py-1.5 font-mono text-gray-600" data-mono>{r.totalHours ? `${Number(r.totalHours).toFixed(1)}h` : '--'}</td>
                        <td className="px-4 py-1.5"><span className={cn('badge text-[9px]', getStatusColor(r.status))}>{r.status?.replace(/_/g, ' ')}</span></td>
                        <td className="px-4 py-1.5 text-gray-400 hidden md:table-cell">{r.workMode || 'OFFICE'}</td>
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

      {/* Check-in Location Modal — opened from map picker */}
      <Suspense fallback={null}>
        {checkInModalDate && (
          <CheckInModal
            checkInLoc={checkInModalDate.checkInLoc}
            geofenceCoords={geofenceCoords}
            geofence={geofence}
            geofenceViolation={checkInModalDate.geofenceViolation}
            date={checkInModalDate.date}
            onClose={() => setCheckInModalDate(null)}
          />
        )}
      </Suspense>

      {/* Map Picker — shown when HR clicks a FIELD row in Daily Records */}
      <AnimatePresence>
        {mapPickerRow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[500] flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setMapPickerRow(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 12 }}
              className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-xs"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-800">View Map</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(mapPickerRow.date, 'long')}</p>
                </div>
                <button onClick={() => setMapPickerRow(null)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={14} className="text-gray-400" />
                </button>
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => { setGpsTrailModal({ date: mapPickerRow.date }); setMapPickerRow(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-green-200 bg-green-50 hover:bg-green-100 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
                    <Activity size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-green-800">GPS Trail</p>
                    <p className="text-[10px] text-green-600">Full route with stops & timeline</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (mapPickerRow.checkInLoc?.lat) {
                      setCheckInModalDate({ date: mapPickerRow.date, checkInLoc: mapPickerRow.checkInLoc, geofenceViolation: mapPickerRow.geofenceViolation });
                    }
                    setMapPickerRow(null);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
                    <MapPin size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-indigo-800">Check-in Location</p>
                    <p className="text-[10px] text-indigo-600">Where the employee clocked in</p>
                  </div>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Regularize Modal — HR sees approval panel, employee sees request form */}
      <AnimatePresence>
        {showRegularizeModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowRegularizeModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-display font-semibold text-gray-900 flex items-center gap-2">
                  <PenSquare size={15} className="text-brand-500" />
                  {isHR ? 'Regularization Requests' : 'Regularization Request'}
                </h3>
                <button onClick={() => setShowRegularizeModal(false)} className="p-1 rounded-lg hover:bg-gray-100">
                  <X size={15} />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-3">
                Date: <span className="font-medium text-gray-700">{selectedDate}</span>
              </p>

              {isHR ? (
                /* ── HR / Admin view — approve or reject employee's requests ── */
                <div className="space-y-2">
                  {!detail?.regularizations?.length ? (
                    <div className="text-center py-8">
                      <FileText size={24} className="text-gray-200 mx-auto mb-2" />
                      <p className="text-xs text-gray-400">No regularization requests for this date</p>
                    </div>
                  ) : (
                    detail.regularizations.map((r: any) => (
                      <div key={r.id} className="bg-surface-2 rounded-xl p-3 text-[11px]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={cn('badge text-[9px]',
                            r.status === 'PENDING' ? 'badge-warning' :
                            r.status === 'APPROVED' ? 'badge-success' : 'badge-error'
                          )}>{r.status}</span>
                          <span className="text-[10px] text-gray-400">{formatDate(r.attendance?.date)}</span>
                        </div>
                        <p className="text-gray-700 font-medium mb-1">{r.reason}</p>
                        {r.requestedCheckIn && (
                          <p className="text-[10px] text-gray-400 mb-2">
                            Requested: {formatTime(r.requestedCheckIn)} → {formatTime(r.requestedCheckOut)}
                          </p>
                        )}
                        {r.approverRemarks && (
                          <p className="text-[10px] text-gray-400 italic mb-2">Remarks: {r.approverRemarks}</p>
                        )}
                        {r.status === 'PENDING' && (
                          <div className="flex gap-2 mt-2">
                            <button
                              disabled={isHandlingReg}
                              onClick={async () => {
                                try {
                                  await handleRegularization({ id: r.id, action: 'APPROVED' }).unwrap();
                                  toast.success('Regularization approved');
                                } catch { toast.error('Failed to approve'); }
                              }}
                              className="flex-1 px-2.5 py-1.5 text-[10px] font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
                              Approve
                            </button>
                            <button
                              disabled={isHandlingReg}
                              onClick={async () => {
                                try {
                                  await handleRegularization({ id: r.id, action: 'REJECTED' }).unwrap();
                                  toast.success('Regularization rejected');
                                } catch { toast.error('Failed to reject'); }
                              }}
                              className="flex-1 px-2.5 py-1.5 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50">
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  <button onClick={() => setShowRegularizeModal(false)}
                    className="w-full mt-2 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                    Close
                  </button>
                </div>
              ) : (
                /* ── Employee view — submit a new regularization request ── */
                <div className="space-y-3">
                  {detail?.regularizations?.length > 0 && (
                    <div className="mb-1 space-y-1.5">
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Existing Requests</p>
                      {detail.regularizations.map((r: any) => (
                        <div key={r.id} className="bg-surface-2 rounded-lg p-2.5 text-[11px]">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-gray-500">{formatDate(r.attendance?.date)}</span>
                            <span className={cn('badge text-[9px]',
                              r.status === 'PENDING' ? 'badge-warning' :
                              r.status === 'APPROVED' ? 'badge-success' : 'badge-error'
                            )}>{r.status}</span>
                          </div>
                          <p className="text-gray-600">{r.reason}</p>
                          {r.requestedCheckIn && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {formatTime(r.requestedCheckIn)} → {formatTime(r.requestedCheckOut)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Requested Check-In</label>
                      <input type="time" value={regCheckIn} onChange={e => setRegCheckIn(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Requested Check-Out</label>
                      <input type="time" value={regCheckOut} onChange={e => setRegCheckOut(e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-400" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-medium">Reason <span className="text-red-400">*</span></label>
                    <textarea value={regReason} onChange={e => setRegReason(e.target.value)} rows={3}
                      placeholder="Explain why regularization is needed..."
                      className="w-full mt-0.5 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-400 resize-none" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setShowRegularizeModal(false)}
                      className="flex-1 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                      Cancel
                    </button>
                    <button
                      disabled={!regReason.trim() || isSubmittingReg}
                      onClick={async () => {
                        try {
                          const toISO = (time: string) => time ? `${selectedDate}T${time}:00` : undefined;
                          await submitRegularization({
                            date: selectedDate,
                            reason: regReason.trim(),
                            requestedCheckIn: toISO(regCheckIn),
                            requestedCheckOut: toISO(regCheckOut),
                          }).unwrap();
                          toast.success('Regularization request submitted');
                          setShowRegularizeModal(false);
                        } catch { toast.error('Failed to submit regularization'); }
                      }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                      <CheckCircle size={11} /> Submit Request
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dismiss marking popover on outside click */}
      {markingDate && (
        <div className="fixed inset-0 z-20" onClick={() => setMarkingDate(null)} />
      )}
    </div>
  );
}
