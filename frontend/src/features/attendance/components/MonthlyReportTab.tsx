import { useState } from 'react';
import { Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGetMonthlyReportQuery } from '../attendanceApi';
import { useAuthDownload } from '../../../hooks/useAuthDownload';

export default function MonthlyReportTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { data: res, isLoading } = useGetMonthlyReportQuery({ month, year });
  const report = res?.data;
  const { download, downloading } = useAuthDownload();
  const exporting = !!downloading;

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const handleExport = () => {
    download(`/attendance/monthly-report/export?month=${month}&year=${year}`, `attendance-report-${month}-${year}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100"><ChevronLeft size={16} /></button>
          <h3 className="text-sm font-display font-semibold text-gray-800 min-w-[140px] text-center">{monthName}</h3>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>Working Days: <strong className="text-gray-800">{report.totalWorkingDays}</strong></span>
              <span>Holidays: <strong className="text-gray-800">{report.holidays}</strong></span>
            </div>
          )}
          <button onClick={handleExport} disabled={exporting || isLoading}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-medium">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export Excel
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 text-xs">Employee</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 text-xs">Dept</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">Present</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">Absent</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">Half</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">Leave</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">WFH</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">Late</th>
                <th className="text-center px-2 py-2.5 font-semibold text-gray-600 text-xs">Hours</th>
                <th className="text-center px-2 py-2.5 font-semibold text-red-600 text-xs">LOP</th>
                <th className="text-center px-2 py-2.5 font-semibold text-orange-600 text-xs">OT</th>
              </tr>
            </thead>
            <tbody>
              {report?.employees?.map((emp: any) => (
                <tr key={emp.employeeId} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-800 text-xs">{emp.name}</p>
                    <p className="text-[10px] text-gray-400">{emp.employeeCode}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{emp.department}</td>
                  <td className="text-center px-2 py-2.5 text-xs font-medium text-emerald-600">{emp.present}</td>
                  <td className="text-center px-2 py-2.5 text-xs font-medium text-red-500">{emp.absent}</td>
                  <td className="text-center px-2 py-2.5 text-xs text-amber-600">{emp.halfDay}</td>
                  <td className="text-center px-2 py-2.5 text-xs text-purple-500">{emp.onLeave}</td>
                  <td className="text-center px-2 py-2.5 text-xs text-teal-500">{emp.wfh}</td>
                  <td className="text-center px-2 py-2.5 text-xs text-amber-600">{emp.lateCount}</td>
                  <td className="text-center px-2 py-2.5 text-xs font-mono text-gray-600" data-mono>{emp.totalHours}h</td>
                  <td className="text-center px-2 py-2.5">
                    {emp.lopDays > 0 ? <span className="text-xs font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{emp.lopDays}</span> : <span className="text-xs text-gray-300">0</span>}
                  </td>
                  <td className="text-center px-2 py-2.5">
                    {emp.otHours > 0 ? <span className="text-xs font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">{emp.otHours}h</span> : <span className="text-xs text-gray-300">0</span>}
                  </td>
                </tr>
              ))}
              {(!report?.employees || report.employees.length === 0) && (
                <tr><td colSpan={11} className="text-center py-8 text-sm text-gray-400">No data for this month</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
