import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, LogIn, LogOut, Coffee, Play, Square, MapPin,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon
} from 'lucide-react';
import {
  useGetTodayStatusQuery,
  useClockInMutation,
  useClockOutMutation,
  useStartBreakMutation,
  useEndBreakMutation,
  useGetMyAttendanceQuery,
} from './attendanceApi';
import { cn, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-500',
  ABSENT: 'bg-red-400',
  HALF_DAY: 'bg-amber-400',
  HOLIDAY: 'bg-blue-400',
  WEEKEND: 'bg-gray-300',
  ON_LEAVE: 'bg-purple-400',
  WORK_FROM_HOME: 'bg-teal-400',
};

export default function AttendancePage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [liveTime, setLiveTime] = useState(new Date());

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

  return (
    <div className="page-container">
      <h1 className="text-2xl font-display font-bold text-gray-900 mb-6">Attendance</h1>

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
