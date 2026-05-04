import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserCheck, UserX, Coffee, Clock, Wifi, RefreshCw } from 'lucide-react';
import { useGetLiveBoardQuery } from '../attendanceApi';
import { onSocketEvent, offSocketEvent } from '../../../lib/socket';

export default function LiveAttendanceWidget() {
  const navigate = useNavigate();
  const { data: res, isLoading, refetch } = useGetLiveBoardQuery(undefined, { pollingInterval: 30000 });
  const live = res?.data;
  const [pulse, setPulse] = useState(false);

  // Live refresh via WebSocket — stable ref to avoid listener leak
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => { refetchRef.current(); setPulse(true); setTimeout(() => setPulse(false), 1500); };
    onSocketEvent('attendance:checkin', handler);
    onSocketEvent('attendance:checkout', handler);
    return () => { offSocketEvent('attendance:checkin', handler); offSocketEvent('attendance:checkout', handler); };
  }, []);

  // Map the actual API response structure
  const totals = live?.totals || {};
  const present = (totals.inOffice || 0) + (totals.onField || 0) + (totals.wfh || 0);
  const onBreak = totals.onBreak || 0;
  const notCheckedIn = totals.notCheckedIn || 0;
  const checkedOut = totals.checkedOut || 0;
  const total = present + onBreak + notCheckedIn + checkedOut;
  const presentPct = total > 0 ? Math.round((present / total) * 100) : 0;

  // Donut chart values
  const size = 80;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const presentOffset = circumference - (presentPct / 100) * circumference;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-gray-800 text-sm flex items-center gap-2">
          <Users size={16} className="text-brand-500" />
          Live Attendance
          {pulse && <span className="w-2 h-2 bg-green-500 rounded-full animate-ping" />}
        </h3>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            <Wifi size={10} /> Live
          </span>
          <button onClick={() => refetch()} className="p-1 hover:bg-gray-100 rounded">
            <RefreshCw size={12} className="text-gray-400" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Donut + Summary */}
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              <svg width={size} height={size} className="-rotate-90">
                <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth} />
                <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#10b981" strokeWidth={strokeWidth}
                  strokeDasharray={circumference} strokeDashoffset={presentOffset}
                  strokeLinecap="round" className="transition-all duration-700" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-display font-bold text-gray-900">{presentPct}%</span>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <UserCheck size={13} className="text-emerald-500" />
                <div>
                  <p className="text-xs text-gray-500">Present</p>
                  <p className="text-sm font-bold text-gray-800" data-mono>{present}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <UserX size={13} className="text-red-400" />
                <div>
                  <p className="text-xs text-gray-500">Checked Out</p>
                  <p className="text-sm font-bold text-gray-800" data-mono>{checkedOut}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Coffee size={13} className="text-amber-500" />
                <div>
                  <p className="text-xs text-gray-500">On Break</p>
                  <p className="text-sm font-bold text-gray-800" data-mono>{onBreak}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Not In</p>
                  <p className="text-sm font-bold text-gray-800" data-mono>{notCheckedIn}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Status Breakdown */}
          {total > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Breakdown</p>
              <div className="space-y-1.5">
                {[
                  { label: 'In Office', count: totals.inOffice || 0, color: 'bg-emerald-500' },
                  { label: 'On Field', count: totals.onField || 0, color: 'bg-orange-500' },
                  { label: 'WFH', count: totals.wfh || 0, color: 'bg-teal-500' },
                  { label: 'Checked Out', count: totals.checkedOut || 0, color: 'bg-gray-400' },
                  { label: 'Not Checked In', count: totals.notCheckedIn || 0, color: 'bg-red-400' },
                ].filter(s => s.count > 0).map(s => {
                  const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                  return (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-24 truncate">{s.label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className={`${s.color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-gray-500 w-6 text-right">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick link */}
          <button onClick={() => navigate('/attendance')}
            className="mt-4 w-full text-center text-xs text-brand-600 hover:text-brand-700 font-medium py-2 bg-brand-50 rounded-xl hover:bg-brand-100 transition-colors">
            View Full Attendance →
          </button>
        </>
      )}
    </div>
  );
}
