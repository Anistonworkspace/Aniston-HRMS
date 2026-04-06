import { cn } from '../../../lib/utils';
import {
  Users, UserCheck, UserX, UserMinus, Clock, AlertTriangle,
  MapPin, Wifi, FileWarning, Timer, Coffee, CalendarOff,
} from 'lucide-react';

interface KpiStripProps {
  stats: {
    expectedToday: number;
    present: number;
    absent: number;
    onLeave: number;
    weeklyOff: number;
    notCheckedIn: number;
    lateArrivals: number;
    earlyExits: number;
    missingPunch: number;
    halfDay: number;
    attendanceExceptions: number;
    fieldActive: number;
    wfhActive: number;
    pendingRegularizations: number;
  } | null;
  isLoading: boolean;
}

const KPI_CONFIG = [
  { key: 'expectedToday', label: 'Expected', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
  { key: 'present', label: 'Present', icon: UserCheck, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
  { key: 'absent', label: 'Absent', icon: UserX, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-100' },
  { key: 'onLeave', label: 'On Leave', icon: CalendarOff, color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-100' },
  { key: 'notCheckedIn', label: 'Not Checked In', icon: Clock, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' },
  { key: 'lateArrivals', label: 'Late', icon: Timer, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  { key: 'earlyExits', label: 'Early Exit', icon: UserMinus, color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-100' },
  { key: 'missingPunch', label: 'Missing Punch', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' },
  { key: 'halfDay', label: 'Half Day', icon: Coffee, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100' },
  { key: 'attendanceExceptions', label: 'Exceptions', icon: FileWarning, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
  { key: 'fieldActive', label: 'Field Active', icon: MapPin, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' },
  { key: 'wfhActive', label: 'WFH', icon: Wifi, color: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-100' },
  { key: 'pendingRegularizations', label: 'Pending Reg.', icon: FileWarning, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
] as const;

export default function KpiStrip({ stats, isLoading }: KpiStripProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-13 gap-2">
        {Array.from({ length: 13 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-100 p-2.5 animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-2/3 mb-1.5" />
            <div className="h-5 bg-gray-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-13 gap-1.5">
      {KPI_CONFIG.map(({ key, label, icon: Icon, color, bg, border }) => {
        const value = stats?.[key as keyof typeof stats] ?? 0;
        const isAlert = (key === 'lateArrivals' || key === 'missingPunch' || key === 'attendanceExceptions' || key === 'earlyExits') && value > 0;
        return (
          <div
            key={key}
            className={cn(
              'rounded-lg border p-2 transition-all hover:shadow-sm cursor-default',
              isAlert ? `${bg} ${border} ring-1 ring-inset ring-current/10` : `bg-white ${border}`,
            )}
          >
            <div className="flex items-center gap-1 mb-0.5">
              <Icon size={11} className={cn(color, 'flex-shrink-0')} />
              <span className="text-[9px] text-gray-500 font-medium truncate leading-tight">{label}</span>
            </div>
            <p className={cn('text-base font-bold font-mono leading-none', color)} data-mono>
              {value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
