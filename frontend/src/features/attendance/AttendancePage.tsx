import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { onSocketEvent, offSocketEvent } from '../../lib/socket';
import {
  Clock, LogIn, LogOut, Coffee, Play, Square, MapPin,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Users, Search, Filter, UserCheck, UserX, UserMinus, Eye, Monitor,
  Shield, Bell, RefreshCw,
} from 'lucide-react';
import {
  useGetTodayStatusQuery,
  useClockInMutation,
  useClockOutMutation,
  useStartBreakMutation,
  useEndBreakMutation,
  useGetMyAttendanceQuery,
  useGetAllAttendanceQuery,
} from './attendanceApi';
import { cn, formatDate, getStatusColor } from '../../lib/utils';
import { useAppSelector } from '../../app/store';
import toast from 'react-hot-toast';
import FieldSalesView from './FieldSalesView';
import ProjectSiteView from './ProjectSiteView';

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-500',
  ABSENT: 'bg-red-400',
  HALF_DAY: 'bg-amber-400',
  HOLIDAY: 'bg-blue-400',
  WEEKEND: 'bg-gray-300',
  ON_LEAVE: 'bg-purple-400',
  WORK_FROM_HOME: 'bg-teal-400',
  NOT_CHECKED_IN: 'bg-gray-300',
};

export default function AttendancePage() {
  const user = useAppSelector((state) => state.auth.user);
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user?.role || '');

  return isManagement ? <AttendanceManagementView /> : <AttendancePersonalView />;
}

/* =============================================================================
   MANAGEMENT VIEW
   ============================================================================= */

function AttendanceManagementView() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const { data: response, isLoading, refetch } = useGetAllAttendanceQuery({
    startDate: selectedDate,
    endDate: selectedDate,
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    page,
    limit: 25,
  });

  // WebSocket: auto-refresh on attendance events
  useEffect(() => {
    const handler = () => refetch();
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:checkout', handler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:checkout', handler);
    };
  }, [refetch]);

  const records = response?.data?.data || response?.data || [];
  const meta = response?.data?.meta || response?.meta || {};
  const apiSummary = response?.data?.summary || (response as any)?.summary;

  // Use API summary (totalEmployees from DB) or compute from records
  const summary = useMemo(() => {
    const all = Array.isArray(records) ? records : [];
    const present = apiSummary?.present ?? all.filter((r: any) => r.status === 'PRESENT').length;
    const absent = apiSummary?.absent ?? all.filter((r: any) => r.status === 'ABSENT').length;
    const onLeave = apiSummary?.onLeave ?? all.filter((r: any) => r.status === 'ON_LEAVE').length;
    return {
      totalEmployees: apiSummary?.totalEmployees ?? all.length,
      present,
      absent,
      onLeave,
    };
  }, [records, apiSummary]);

  // Filter records by search query (employee name)
  const filteredRecords = useMemo(() => {
    const all = Array.isArray(records) ? records : [];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((r: any) => {
      const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
      const code = (r.employee?.employeeCode || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [records, searchQuery]);

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-gray-900">Attendance Management</h1>
          <p className="text-gray-500 text-sm mt-0.5">Monitor and manage employee attendance</p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-gray-900" data-mono>{summary.totalEmployees}</p>
              <p className="text-xs text-gray-400">Total Employees</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <UserCheck size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-emerald-600" data-mono>{summary.present}</p>
              <p className="text-xs text-gray-400">Present</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <UserX size={20} className="text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-red-500" data-mono>{summary.absent}</p>
              <p className="text-xs text-gray-400">Absent</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
              <UserMinus size={20} className="text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono text-purple-500" data-mono>{summary.onLeave}</p>
              <p className="text-xs text-gray-400">On Leave</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters Row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="layer-card p-4 mb-6"
      >
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Date picker */}
          <div className="flex items-center gap-2">
            <CalendarIcon size={16} className="text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); setPage(1); }}
              className="input-glass text-sm"
            />
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by employee name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-glass w-full pl-9 text-sm"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="input-glass text-sm"
            >
              <option value="ALL">All Status</option>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="HALF_DAY">Half Day</option>
              <option value="ON_LEAVE">On Leave</option>
              <option value="WORK_FROM_HOME">WFH</option>
              <option value="NOT_CHECKED_IN">Not Checked In</option>
            </select>
          </div>
        </div>
      </motion.div>

      {/* Attendance Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="layer-card overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Employee</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check In</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check Out</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Total Hours</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Work Mode</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Activity</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-gray-400 mt-2">Loading attendance data...</p>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <Users size={40} className="mx-auto text-gray-200 mb-3" />
                    <p className="text-sm text-gray-400">No attendance records found for this date</p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record: any, idx: number) => (
                  <tr
                    key={record.id || idx}
                    onClick={() => record.employeeId && navigate(`/attendance/employee/${record.employeeId}`)}
                    className="border-b border-gray-50 hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-700">
                          {(record.employee?.firstName?.[0] || '') + (record.employee?.lastName?.[0] || '')}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {record.employee?.firstName} {record.employee?.lastName}
                          </p>
                          <p className="text-xs text-gray-400">{record.employee?.employeeCode || record.employee?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700" data-mono>
                        {formatTime(record.checkIn)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700" data-mono>
                        {formatTime(record.checkOut)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-700" data-mono>
                        {record.totalHours ? `${Number(record.totalHours).toFixed(1)}h` : '--'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`badge ${getStatusColor(record.status)} text-xs`}>
                        {record.status?.replace(/_/g, ' ') || '--'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin size={12} />
                        {record.workMode?.replace(/_/g, ' ') || 'OFFICE'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); record.employeeId && navigate(`/attendance/employee/${record.employeeId}`); }}
                        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                        title="View activity details, screenshots & GPS trail"
                      >
                        <Monitor size={12} /> Activity
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Page {meta.page} of {meta.totalPages} ({meta.total} records)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= (meta.totalPages || 1)}
                className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* =============================================================================
   PERSONAL VIEW (existing)
   ============================================================================= */

function AttendancePersonalView() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [liveTime, setLiveTime] = useState(new Date());
  const [locationStatus, setLocationStatus] = useState<'checking' | 'granted' | 'denied' | 'prompt'>('checking');
  const [notificationStatus, setNotificationStatus] = useState<'checking' | 'granted' | 'denied' | 'default'>('checking');
  const [requestingLocation, setRequestingLocation] = useState(false);
  const [requestingNotification, setRequestingNotification] = useState(false);

  // Check location permission on mount
  useEffect(() => {
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        setLocationStatus(result.state as any);
        result.onchange = () => setLocationStatus(result.state as any);
      }).catch(() => setLocationStatus('prompt'));
    } else {
      setLocationStatus('prompt');
    }
  }, []);

  // Check notification permission on mount
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationStatus(Notification.permission as any);
    } else {
      setNotificationStatus('default');
    }
  }, []);

  const handleRequestLocation = () => {
    setRequestingLocation(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationStatus('granted');
        setRequestingLocation(false);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLocationStatus('denied');
        }
        setRequestingLocation(false);
      },
      { timeout: 10000 }
    );
  };

  const handleRequestNotification = async () => {
    setRequestingNotification(true);
    try {
      const result = await Notification.requestPermission();
      setNotificationStatus(result as any);
    } catch {
      setNotificationStatus('default');
    }
    setRequestingNotification(false);
  };

  const { data: todayResponse, isLoading: statusLoading } = useGetTodayStatusQuery();
  const today = todayResponse?.data;

  const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString().split('T')[0];
  const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).toISOString().split('T')[0];
  const { data: monthResponse } = useGetMyAttendanceQuery({ startDate, endDate });
  const monthData = monthResponse?.data;

  const [clockIn, { isLoading: clockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: clockingOut }] = useClockOutMutation();
  const [startBreak] = useStartBreakMutation();
  const [endBreak] = useEndBreakMutation();

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleClockIn = async () => {
    try {
      // Try to get location
      let coords: { latitude?: number; longitude?: number } = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch {
          // Location not available, proceed without
        }
      }
      await clockIn({ ...coords, source: 'MANUAL_APP' }).unwrap();
      toast.success('Checked in successfully!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to clock in');
    }
  };

  const handleClockOut = async () => {
    try {
      let coords: { latitude?: number; longitude?: number } = {};
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch { /* proceed without */ }
      }
      await clockOut(coords).unwrap();
      toast.success('Checked out successfully!');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to clock out');
    }
  };

  const handleBreak = async () => {
    try {
      if (today?.isOnBreak) {
        await endBreak().unwrap();
        toast.success('Break ended');
      } else {
        await startBreak({ type: 'SHORT' }).unwrap();
        toast.success('Break started');
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed');
    }
  };

  // Calculate elapsed time
  const getElapsedTime = () => {
    if (!today?.record?.checkIn) return '00:00:00';
    const start = new Date(today.record.checkIn);
    const diff = liveTime.getTime() - start.getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Build calendar grid
  const buildCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const recordMap = new Map<string, any>();
    monthData?.records?.forEach((r: any) => {
      const dateKey = new Date(r.date).toISOString().split('T')[0];
      recordMap.set(dateKey, r);
    });

    const holidayDates = new Set(
      monthData?.holidays?.map((h: any) => new Date(h.date).toISOString().split('T')[0]) || []
    );

    const days: Array<{ date: number; status: string; isToday: boolean; record: any }> = [];

    for (let i = 0; i < firstDay; i++) {
      days.push({ date: 0, status: '', isToday: false, record: null });
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const record = recordMap.get(dateStr);
      const isHoliday = holidayDates.has(dateStr);

      let status = '';
      if (record) {
        status = record.status;
      } else if (isHoliday) {
        status = 'HOLIDAY';
      } else if (dayOfWeek === 0 || dayOfWeek === 6) {
        status = 'WEEKEND';
      } else if (new Date(dateStr) < new Date(todayStr)) {
        status = 'ABSENT';
      }

      days.push({
        date: d,
        status,
        isToday: dateStr === todayStr,
        record,
      });
    }

    return days;
  };

  const calendarDays = buildCalendar();
  const monthName = currentMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Detect work mode from today's status
  const workMode = today?.workMode || 'OFFICE';

  // BLOCKING: Location permission denied — cannot use attendance at all
  if (locationStatus === 'denied') {
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Shield size={40} className="text-red-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">Location Permission Required</h2>
            <p className="text-sm text-gray-500 mb-6">
              You must enable location access to use attendance. Please go to your browser/app settings and allow location for this site.
            </p>
            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6">
              <p className="text-xs font-semibold text-gray-700 mb-2">How to enable:</p>
              <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
                <li>Open your browser <span className="font-semibold">Settings</span></li>
                <li>Go to <span className="font-semibold">Site Settings</span> (or Privacy & Security)</li>
                <li>Tap <span className="font-semibold">Location</span></li>
                <li>Find this site and set to <span className="font-semibold">Allow</span></li>
              </ol>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // BLOCKING: Location permission not yet asked — prompt user to grant
  if (locationStatus === 'prompt' || locationStatus === 'checking') {
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Shield size={40} className="text-blue-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">Enable Location Access</h2>
            <p className="text-sm text-gray-500 mb-6">
              Attendance requires your location for GPS-based check-in and geofencing. Tap the button below to enable.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleRequestLocation}
              disabled={requestingLocation}
              className="btn-primary w-full py-3.5 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {requestingLocation ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <MapPin size={16} />
              )}
              Allow Location
            </motion.button>
          </motion.div>
        </div>
      </div>
    );
  }

  // BLOCKING: Location granted but notification not yet granted — prompt for notification
  if (locationStatus === 'granted' && notificationStatus !== 'granted' && notificationStatus !== 'default') {
    // notificationStatus is 'denied' — show info
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Bell size={40} className="text-amber-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">Enable Notifications</h2>
            <p className="text-sm text-gray-500 mb-6">
              Notifications are blocked. Please enable them in your browser settings for real-time alerts on attendance, leave approvals, and announcements.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // Location granted, notification is 'checking' — prompt for notification
  if (locationStatus === 'granted' && notificationStatus === 'checking') {
    return (
      <div className="page-container">
        <div className="min-h-[70vh] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="layer-card p-10 text-center max-w-md mx-auto"
          >
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <Bell size={40} className="text-amber-500" />
            </div>
            <h2 className="text-xl font-display font-bold text-gray-900 mb-3">Enable Notifications</h2>
            <p className="text-sm text-gray-500 mb-6">
              Please allow notifications for real-time alerts on attendance, leave approvals, and announcements.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleRequestNotification}
              disabled={requestingNotification}
              className="btn-primary w-full py-3.5 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {requestingNotification ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Bell size={16} />
              )}
              Allow Notifications
            </motion.button>
          </motion.div>
        </div>
      </div>
    );
  }

  // Both permissions satisfied (location: granted, notification: granted or default) — show attendance UI
  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-4">Attendance</h1>

      {/* Work Mode Indicator */}
      {(workMode === 'FIELD_SALES' || workMode === 'PROJECT_SITE') && (
        <div className="mb-6">
          <div className="flex gap-2 mb-4">
            {['OFFICE', 'FIELD_SALES', 'PROJECT_SITE'].map(mode => (
              <span
                key={mode}
                className={`badge text-xs ${mode === workMode ? 'badge-info' : 'badge-neutral'}`}
              >
                {mode.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          {workMode === 'FIELD_SALES' && <FieldSalesView todayStatus={today} />}
          {workMode === 'PROJECT_SITE' && <ProjectSiteView />}
        </div>
      )}

      {/* Office Mode (default) */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Clock-in widget */}
        <div className="lg:col-span-1 space-y-4">
          {/* Time & Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="layer-card p-6 text-center"
          >
            {/* Live time */}
            <p className="text-4xl font-mono font-bold text-gray-900 mb-1" data-mono>
              {liveTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-sm text-gray-400 mb-6">{formatDate(new Date(), 'long')}</p>

            {/* Status badge */}
            {today?.isCheckedIn && !today?.isCheckedOut && (
              <div className="mb-4">
                <span className="badge badge-success text-sm px-3 py-1">
                  {today.isOnBreak ? '☕ On Break' : '✅ Checked In'}
                </span>
                <p className="text-3xl font-mono font-bold text-brand-600 mt-3" data-mono>
                  {getElapsedTime()}
                </p>
                <p className="text-xs text-gray-400 mt-1">Time elapsed</p>
              </div>
            )}

            {today?.isCheckedOut && (
              <div className="mb-4">
                <span className="badge badge-neutral text-sm px-3 py-1">Day Complete</span>
                <p className="text-2xl font-mono font-bold text-gray-600 mt-3" data-mono>
                  {Number(today.record?.totalHours || 0).toFixed(1)}h
                </p>
                <p className="text-xs text-gray-400 mt-1">Total hours</p>
              </div>
            )}

            {/* Main CTA button */}
            {!today?.isCheckedIn && !today?.isCheckedOut && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleClockIn}
                disabled={clockingIn || statusLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-semibold text-lg flex items-center justify-center gap-3 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-200"
              >
                {clockingIn ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <LogIn size={22} />
                )}
                Check In
              </motion.button>
            )}

            {today?.isCheckedIn && !today?.isCheckedOut && (
              <div className="space-y-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleClockOut}
                  disabled={clockingOut}
                  className="w-full bg-red-500 hover:bg-red-400 text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {clockingOut ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <LogOut size={20} />
                  )}
                  Check Out
                </motion.button>

                <button
                  onClick={handleBreak}
                  className={cn(
                    'w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors',
                    today.isOnBreak
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-surface-2 text-gray-600 hover:bg-surface-3'
                  )}
                >
                  {today.isOnBreak ? <Square size={16} /> : <Coffee size={16} />}
                  {today.isOnBreak ? 'End Break' : 'Start Break'}
                </button>
              </div>
            )}

            {/* Work mode indicator */}
            {today?.workMode && (
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400">
                <MapPin size={12} />
                {today.workMode.replace('_', ' ')}
              </div>
            )}
          </motion.div>

          {/* Summary card */}
          {monthData?.summary && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="layer-card p-5"
            >
              <h3 className="text-sm font-semibold text-gray-700 mb-3">This Month</h3>
              <div className="grid grid-cols-2 gap-3">
                <SummaryItem label="Present" value={monthData.summary.present} color="text-emerald-600" />
                <SummaryItem label="Absent" value={monthData.summary.absent} color="text-red-500" />
                <SummaryItem label="Half Day" value={monthData.summary.halfDay} color="text-amber-500" />
                <SummaryItem label="On Leave" value={monthData.summary.onLeave} color="text-purple-500" />
                <SummaryItem label="Avg Hours" value={`${monthData.summary.averageHours}h`} color="text-blue-600" />
                <SummaryItem label="WFH" value={monthData.summary.workFromHome} color="text-teal-500" />
              </div>
            </motion.div>
          )}
        </div>

        {/* Right: Calendar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 layer-card p-6"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-display font-semibold text-gray-800 flex items-center gap-2">
              <CalendarIcon size={18} className="text-brand-500" />
              {monthName}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="text-sm text-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors font-medium"
              >
                Today
              </button>
              <button
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-gray-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => (
              <div
                key={idx}
                className={cn(
                  'aspect-square rounded-lg p-1.5 flex flex-col items-center justify-center text-sm transition-colors relative',
                  day.date === 0 && 'invisible',
                  day.isToday && 'ring-2 ring-brand-500 ring-offset-1',
                  day.status === 'PRESENT' && 'bg-emerald-50',
                  day.status === 'ABSENT' && 'bg-red-50',
                  day.status === 'HALF_DAY' && 'bg-amber-50',
                  day.status === 'HOLIDAY' && 'bg-blue-50',
                  day.status === 'WEEKEND' && 'bg-gray-50',
                  day.status === 'ON_LEAVE' && 'bg-purple-50',
                  day.status === 'WORK_FROM_HOME' && 'bg-teal-50',
                  !day.status && day.date > 0 && 'bg-white',
                )}
              >
                <span className={cn(
                  'font-medium',
                  day.isToday ? 'text-brand-600' : 'text-gray-700',
                  day.status === 'WEEKEND' && 'text-gray-400',
                )}>
                  {day.date > 0 ? day.date : ''}
                </span>
                {day.status && day.date > 0 && (
                  <div className={cn('w-1.5 h-1.5 rounded-full mt-0.5', STATUS_COLORS[day.status])} />
                )}
                {day.record?.totalHours && (
                  <span className="text-[9px] font-mono text-gray-400 mt-0.5" data-mono>
                    {Number(day.record.totalHours).toFixed(1)}h
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-5 pt-4 border-t border-gray-100">
            {[
              { label: 'Present', color: 'bg-emerald-500' },
              { label: 'Absent', color: 'bg-red-400' },
              { label: 'Half Day', color: 'bg-amber-400' },
              { label: 'Holiday', color: 'bg-blue-400' },
              { label: 'Weekend', color: 'bg-gray-300' },
              { label: 'Leave', color: 'bg-purple-400' },
              { label: 'WFH', color: 'bg-teal-400' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div className={cn('w-2.5 h-2.5 rounded-full', item.color)} />
                <span className="text-xs text-gray-500">{item.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="text-center py-2 px-2 bg-surface-2 rounded-lg">
      <p className={cn('text-lg font-bold font-mono', color)} data-mono>{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
