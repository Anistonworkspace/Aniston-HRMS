import { useGetLiveBoardQuery } from '../attendanceApi';
import { cn, getInitials } from '../../../lib/utils';
import { Users, MapPin, Wifi, Clock, Coffee, LogOut, AlertTriangle, Timer } from 'lucide-react';

const SECTION_CONFIG = [
  { key: 'inOffice', label: 'In Office', icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { key: 'onField', label: 'On Field', icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  { key: 'wfh', label: 'WFH / Remote', icon: Wifi, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-200' },
  { key: 'late', label: 'Late Arrivals', icon: Timer, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  { key: 'onBreak', label: 'On Break', icon: Coffee, color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
  { key: 'notCheckedIn', label: 'Not Checked In', icon: Clock, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' },
  { key: 'checkedOut', label: 'Checked Out', icon: LogOut, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200' },
  { key: 'anomalies', label: 'Anomalies', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
] as const;

export default function LiveBoardTab() {
  const { data: res, isLoading } = useGetLiveBoardQuery(undefined, { pollingInterval: 30000 });
  const board = res?.data;

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-gray-400 mt-2">Loading live board...</p>
      </div>
    );
  }

  if (!board) return null;

  const formatTime = (d: string | null) => {
    if (!d) return '--';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {SECTION_CONFIG.map(({ key, label, icon: Icon, color, bg, border }) => (
          <div key={key} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border min-w-[120px]', bg, border)}>
            <Icon size={14} className={color} />
            <div>
              <p className={cn('text-sm font-bold font-mono', color)} data-mono>{board.totals?.[key] || 0}</p>
              <p className="text-[9px] text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Sections */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {SECTION_CONFIG.map(({ key, label, icon: Icon, color, bg, border }) => {
          const items = board[key] || [];
          if (items.length === 0) return null;
          return (
            <div key={key} className="layer-card overflow-hidden">
              <div className={cn('flex items-center gap-2 px-3 py-2 border-b', bg, border)}>
                <Icon size={13} className={color} />
                <span className="text-xs font-semibold text-gray-700">{label}</span>
                <span className={cn('text-[10px] font-mono font-bold ml-auto', color)} data-mono>{items.length}</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {items.slice(0, 15).map((emp: any, i: number) => (
                  <div key={emp.id || i} className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-50 last:border-0">
                    <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-[9px] font-semibold text-brand-700 flex-shrink-0">
                      {getInitials(emp.firstName, emp.lastName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-gray-700 truncate">{emp.firstName} {emp.lastName}</p>
                      <p className="text-[9px] text-gray-400">{emp.department?.name || ''}</p>
                    </div>
                    {emp.checkIn && (
                      <span className="text-[9px] font-mono text-gray-400" data-mono>{formatTime(emp.checkIn)}</span>
                    )}
                    {emp.totalHours && (
                      <span className="text-[9px] font-mono text-gray-500 font-medium" data-mono>{Number(emp.totalHours).toFixed(1)}h</span>
                    )}
                  </div>
                ))}
                {items.length > 15 && (
                  <p className="text-[10px] text-gray-400 text-center py-1.5">+{items.length - 15} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
