import type React from 'react';
import { cn } from '../../../lib/utils';
import {
  Users, UserCheck, UserX, UserMinus, Clock, Timer, MapPin, Coffee, CalendarOff,
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
  activeFilter?: { status?: string; anomalyType?: string; workMode?: string; isLate?: boolean } | null;
  onCardClick?: (filter: { status?: string; anomalyType?: string; workMode?: string; isLate?: boolean } | null) => void;
}

const KPI_CONFIG = [
  { key: 'expectedToday', label: 'Expected',      icon: Users,      color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-100',   filter: null },
  { key: 'present',       label: 'Present',        icon: UserCheck,  color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', filter: { status: 'PRESENT' } },
  { key: 'absent',        label: 'Absent',         icon: UserX,      color: 'text-red-500',     bg: 'bg-red-50',     border: 'border-red-100',    filter: { status: 'ABSENT' } },
  { key: 'onLeave',       label: 'On Leave',       icon: CalendarOff,color: 'text-purple-500',  bg: 'bg-purple-50',  border: 'border-purple-100', filter: { status: 'ON_LEAVE' } },
  { key: 'notCheckedIn',  label: 'Not Checked In', icon: Clock,      color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-200',   filter: { status: 'NOT_CHECKED_IN' } },
  { key: 'lateArrivals',  label: 'Late',           icon: Timer,      color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-100',  filter: { isLate: true } },
  { key: 'earlyExits',    label: 'Early Exit',     icon: UserMinus,  color: 'text-orange-500',  bg: 'bg-orange-50',  border: 'border-orange-100', filter: { anomalyType: 'EARLY_EXIT' } },
  { key: 'halfDay',       label: 'Half Day',       icon: Coffee,     color: 'text-amber-500',   bg: 'bg-amber-50',   border: 'border-amber-100',  filter: { status: 'HALF_DAY' } },
  { key: 'fieldActive',   label: 'Field Active',   icon: MapPin,     color: 'text-green-600',   bg: 'bg-green-50',   border: 'border-green-100',  filter: { workMode: 'FIELD_SALES' } },
] as const;

export default function KpiStrip({ stats, isLoading, activeFilter, onCardClick }: KpiStripProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-3 animate-pulse">
            <div className="h-2.5 bg-gray-100 rounded w-2/3 mb-2" />
            <div className="h-6 bg-gray-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const isCardActive = (filter: { status?: string; anomalyType?: string; workMode?: string; isLate?: boolean } | null) => {
    if (!filter || !activeFilter) return false;
    if (filter.status && activeFilter.status === filter.status) return true;
    if (filter.anomalyType && activeFilter.anomalyType === filter.anomalyType) return true;
    if (filter.workMode && activeFilter.workMode === filter.workMode) return true;
    if (filter.isLate && activeFilter.isLate === true) return true;
    return false;
  };

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
      {KPI_CONFIG.map(({ key, label, icon: Icon, color, bg, border, filter }) => {
        const value = stats?.[key as keyof typeof stats] ?? 0;
        const isAlert = (key === 'lateArrivals' || key === 'earlyExits') && (value as number) > 0;
        const isActive = isCardActive(filter);
        const isClickable = !!filter && !!onCardClick;
        return (
          <div
            key={key}
            onClick={() => {
              if (!onCardClick) return;
              // Toggle: clicking an active card clears the filter
              if (isActive) {
                onCardClick(null);
              } else {
                onCardClick(filter);
              }
            }}
            style={isActive ? { '--tw-ring-color': 'var(--primary-color)' } as React.CSSProperties : undefined}
            className={cn(
              'rounded-xl border p-3 transition-all hover:shadow-sm',
              isClickable ? 'cursor-pointer' : 'cursor-default',
              isActive ? `${bg} ${border} ring-2 ring-offset-1` : isAlert ? `${bg} ${border}` : 'bg-white border-gray-100 hover:border-gray-200',
            )}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon size={12} className={cn(color, 'flex-shrink-0')} />
              <span className="text-[10px] text-gray-500 font-medium leading-tight truncate">{label}</span>
            </div>
            <p className={cn('text-xl font-bold font-mono leading-none', color)} data-mono>
              {value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
