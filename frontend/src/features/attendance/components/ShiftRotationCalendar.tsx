import { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useGetAllAttendanceQuery } from '../attendanceApi';
import { useGetShiftsQuery, useGetAllAssignmentsQuery } from '../../workforce/workforceApi';
import { onSocketEvent, offSocketEvent } from '../../../lib/socket';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  OFFICE: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  FIELD: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  PROJECT_SITE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  OFF: { bg: 'bg-gray-50', text: 'text-gray-400', border: 'border-gray-100' },
};

function getWeekDates(weekOffset: number) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export default function ShiftRotationCalendar() {
  const [weekOffset, setWeekOffset] = useState(0);
  const dates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const startDate = dates[0].toISOString().split('T')[0];
  const endDate = dates[6].toISOString().split('T')[0];
  const weekLabel = `${dates[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — ${dates[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const { data: shiftsRes } = useGetShiftsQuery();
  const { data: assignRes } = useGetAllAssignmentsQuery();
  const { data: attRes, isLoading, refetch } = useGetAllAttendanceQuery({ startDate, endDate, limit: 100 });

  // Real-time: refetch when any employee marks attendance so HR calendar updates instantly
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => refetchRef.current();
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:checkout', handler);
    return () => {
      offSocketEvent('attendance:checkin', handler);
      offSocketEvent('attendance:checkout', handler);
    };
  }, []);

  const shifts = shiftsRes?.data || [];
  const assignments = assignRes?.data || [];
  const allRecords = attRes?.data || [];

  // Build employee rows with shift info
  const employees = useMemo(() => {
    const empMap = new Map<string, any>();
    // Get unique employees from assignments
    assignments.forEach((a: any) => {
      if (!empMap.has(a.employeeId)) {
        empMap.set(a.employeeId, {
          id: a.employeeId,
          name: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : a.employeeId.slice(0, 8),
          code: a.employee?.employeeCode || '',
          department: a.employee?.department?.name || '',
          shiftId: a.shiftId,
          shift: shifts.find((s: any) => s.id === a.shiftId),
        });
      }
    });
    // Also add from attendance records
    allRecords.forEach((r: any) => {
      if (!empMap.has(r.employeeId)) {
        empMap.set(r.employeeId, {
          id: r.employeeId,
          name: r.employeeName || r.employee?.firstName || 'Unknown',
          code: r.employeeCode || '',
          department: r.department || '',
          shift: null,
        });
      }
    });
    return Array.from(empMap.values());
  }, [assignments, allRecords, shifts]);

  // Get cell data for employee + date
  const getCellData = (empId: string, date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay(); // 0=Sun
    const emp = employees.find((e: any) => e.id === empId);
    const shift = emp?.shift;

    // Check if it's a week off day
    const workDays = shift?.workDays || ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const isWorkDay = workDays.includes(dayNames[dayOfWeek]);

    if (!isWorkDay) return { label: 'OFF', type: 'OFF' };

    // Check attendance record
    const record = allRecords.find((r: any) => r.employeeId === empId && r.date?.startsWith(dateStr));
    if (record) {
      if (record.status === 'PRESENT') return { label: shift?.name?.slice(0, 3) || 'GEN', type: shift?.type || 'OFFICE', time: record.checkIn };
      if (record.status === 'ON_LEAVE') return { label: 'Leave', type: 'OFF' };
      if (record.status === 'HALF_DAY') return { label: 'Half', type: 'OFFICE' };
      if (record.status === 'WORK_FROM_HOME') return { label: 'WFH', type: 'OFFICE' };
    }

    // Future date: show planned shift
    if (date > new Date()) return { label: shift?.name?.slice(0, 3) || 'GEN', type: shift?.type || 'OFFICE', planned: true };

    return { label: '—', type: 'OFF' };
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-lg hover:bg-gray-100"><ChevronLeft size={16} /></button>
          <h3 className="text-sm font-display font-semibold text-gray-800 min-w-[220px] text-center">{weekLabel}</h3>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(0)} className="text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1 bg-brand-50 rounded-lg">This Week</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px]">
        {Object.entries(SHIFT_COLORS).map(([key, val]) => (
          <span key={key} className={`flex items-center gap-1 px-2 py-0.5 rounded ${val.bg} ${val.text} border ${val.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${key === 'OFFICE' ? 'bg-blue-500' : key === 'FIELD' ? 'bg-orange-500' : key === 'PROJECT_SITE' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            {key === 'PROJECT_SITE' ? 'Site' : key === 'OFF' ? 'Off/Leave' : key.charAt(0) + key.slice(1).toLowerCase()}
          </span>
        ))}
      </div>

      {/* Calendar Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 font-semibold text-gray-600 min-w-[140px] sticky left-0 bg-gray-50 z-10">Employee</th>
                {dates.map((date, i) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  return (
                    <th key={i} className={`text-center px-2 py-2 font-medium min-w-[72px] ${isToday ? 'bg-brand-50 text-brand-700' : 'text-gray-500'}`}>
                      <div>{DAYS[i]}</div>
                      <div className={`text-[10px] mt-0.5 ${isToday ? 'font-bold' : 'font-normal text-gray-400'}`}>
                        {date.getDate()}/{date.getMonth() + 1}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">No employees with shift assignments</td></tr>
              ) : (
                employees.map((emp: any) => (
                  <tr key={emp.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <p className="font-medium text-gray-800 text-xs truncate">{emp.name}</p>
                      <p className="text-[10px] text-gray-400">{emp.code} · {emp.department}</p>
                    </td>
                    {dates.map((date, i) => {
                      const cell = getCellData(emp.id, date);
                      const colors = SHIFT_COLORS[cell.type] || SHIFT_COLORS.OFF;
                      const isToday = date.toDateString() === new Date().toDateString();
                      return (
                        <td key={i} className={`text-center px-1 py-1.5 ${isToday ? 'bg-brand-50/30' : ''}`}>
                          <span className={`inline-block px-2 py-1 rounded-lg text-[10px] font-semibold border ${colors.bg} ${colors.text} ${colors.border} ${cell.planned ? 'opacity-50 border-dashed' : ''}`}>
                            {cell.label}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
