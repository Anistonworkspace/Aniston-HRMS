import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Award, TrendingUp, Clock, Zap } from 'lucide-react';
import { useGetMyReportQuery } from '../attendanceApi';

export default function SelfServiceReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { data: res, isLoading } = useGetMyReportQuery({ month, year });
  const report = res?.data;

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const attendanceScore = report ? Math.round(((report.present || 0) / Math.max(report.totalWorkingDays || 1, 1)) * 100) : 0;

  const handleDownloadPDF = () => {
    const token = localStorage.getItem('accessToken');
    const apiUrl = import.meta.env.VITE_API_URL || '/api';
    window.open(`${apiUrl}/attendance/my/report/pdf?month=${month}&year=${year}&token=${token}`, '_blank');
  };

  return (
    <div className="space-y-5">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100"><ChevronLeft size={16} /></button>
          <h3 className="text-sm font-display font-semibold text-gray-800 min-w-[140px] text-center">{monthName}</h3>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
        </div>
        <button onClick={handleDownloadPDF}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-medium">
          <Download size={14} /> Download PDF
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Working Days', value: report?.totalWorkingDays || 0, color: 'text-gray-800', bg: 'bg-gray-50' },
              { label: 'Present', value: report?.present || 0, color: 'text-emerald-700', bg: 'bg-emerald-50' },
              { label: 'Absent', value: report?.absent || 0, color: 'text-red-600', bg: 'bg-red-50' },
              { label: 'Half Day', value: report?.halfDay || 0, color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: 'On Leave', value: report?.onLeave || 0, color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'Late Arrivals', value: report?.lateCount || 0, color: 'text-orange-600', bg: 'bg-orange-50' },
              { label: 'Avg Hours/Day', value: `${(report?.avgHoursPerDay || 0).toFixed(1)}h`, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Total Hours', value: `${(report?.totalHours || 0).toFixed(0)}h`, color: 'text-indigo-600', bg: 'bg-indigo-50' },
            ].map((stat, i) => (
              <div key={i} className={`${stat.bg} rounded-xl p-3 text-center`}>
                <p className={`text-xl font-display font-bold ${stat.color}`} data-mono>{stat.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Insights */}
          {report && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <TrendingUp size={14} className="text-brand-500" /> Insights
              </h4>
              <ul className="space-y-2 text-xs text-gray-600">
                <li className="flex items-start gap-2">
                  <Clock size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                  <span>You worked <strong>{(report.totalHours || 0).toFixed(0)}</strong> hours this month (target: <strong>{(report.totalWorkingDays || 0) * 9}</strong>h)</span>
                </li>
                {(report.lateCount || 0) > 0 && (
                  <li className="flex items-start gap-2">
                    <Clock size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <span>You were late <strong>{report.lateCount}</strong> time{report.lateCount > 1 ? 's' : ''} this month. Avg delay: <strong>{report.avgLateMinutes || '?'} min</strong></span>
                  </li>
                )}
                {(report.earlyDepartures || 0) > 0 && (
                  <li className="flex items-start gap-2">
                    <Clock size={12} className="text-orange-400 mt-0.5 flex-shrink-0" />
                    <span>You left early <strong>{report.earlyDepartures}</strong> time{report.earlyDepartures > 1 ? 's' : ''} this month</span>
                  </li>
                )}
                {attendanceScore >= 95 && (
                  <li className="flex items-start gap-2">
                    <Award size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-emerald-700 font-medium">Outstanding attendance — you're in the top performers this month!</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
