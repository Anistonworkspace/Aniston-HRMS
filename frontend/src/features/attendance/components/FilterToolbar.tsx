import { useState, useCallback } from 'react';
import { Search, Filter, X, Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface AttendanceFilters {
  date: string;
  search: string;
  status: string;
  department: string;
  workMode: string;
  shiftType: string;
  anomalyType: string;
  regularizationStatus: string;
  employeeType: string;
}

interface FilterToolbarProps {
  filters: AttendanceFilters;
  onChange: (filters: AttendanceFilters) => void;
  departments?: { id: string; name: string }[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'HALF_DAY', label: 'Half Day' },
  { value: 'ON_LEAVE', label: 'On Leave' },
  { value: 'WORK_FROM_HOME', label: 'WFH' },
  { value: 'NOT_CHECKED_IN', label: 'Not Checked In' },
];

const WORK_MODE_OPTIONS = [
  { value: '', label: 'All Modes' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'FIELD_SALES', label: 'Field Sales' },
];

const ANOMALY_OPTIONS = [
  { value: '', label: 'All Anomalies' },
  { value: 'LATE_ARRIVAL', label: 'Late Arrival' },
  { value: 'EARLY_EXIT', label: 'Early Exit' },
  { value: 'MISSING_PUNCH', label: 'Missing Punch' },
  { value: 'INSUFFICIENT_HOURS', label: 'Insufficient Hours' },
  { value: 'OUTSIDE_GEOFENCE', label: 'Outside Geofence' },
  { value: 'GPS_SPOOF', label: 'GPS Spoof' },
  { value: 'POLICY_BREACH', label: 'Policy Breach' },
];

const EMPLOYEE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'ACTIVE', label: 'Full-Time' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'INTERN', label: 'Intern' },
];

export default function FilterToolbar({ filters, onChange, departments }: FilterToolbarProps) {
  const [expanded, setExpanded] = useState(false);

  const updateFilter = useCallback((key: keyof AttendanceFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  }, [filters, onChange]);

  const activeFilterCount = Object.entries(filters).filter(
    ([key, val]) => val && key !== 'date' && key !== 'search'
  ).length;

  const clearAll = () => {
    onChange({
      date: filters.date,
      search: '',
      status: '',
      department: '',
      workMode: '',
      shiftType: '',
      anomalyType: '',
      regularizationStatus: '',
      employeeType: '',
    });
  };

  // Active filter chips
  const chips = Object.entries(filters)
    .filter(([key, val]) => val && key !== 'date' && key !== 'search')
    .map(([key, val]) => ({ key, label: `${key.replace(/([A-Z])/g, ' $1').trim()}: ${val.replace(/_/g, ' ')}` }));

  return (
    <div className="layer-card p-3 space-y-2">
      {/* Primary row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <CalendarIcon size={14} className="text-gray-400" />
          <input
            type="date"
            value={filters.date}
            onChange={(e) => updateFilter('date', e.target.value)}
            className="input-glass text-xs py-1.5 w-[140px]"
          />
        </div>

        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, ID, email, phone..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="input-glass w-full pl-8 text-xs py-1.5"
          />
        </div>

        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="input-glass text-xs py-1.5"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={filters.department}
          onChange={(e) => updateFilter('department', e.target.value)}
          className="input-glass text-xs py-1.5"
        >
          <option value="">All Depts</option>
          {departments?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
            expanded ? '' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50',
          )}
          style={expanded ? { background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)', borderColor: 'var(--ui-border-color)' } : undefined}
        >
          <Filter size={13} />
          More
          {activeFilterCount > 0 && (
            <span className="text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}>
              {activeFilterCount}
            </span>
          )}
          <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>

      {/* Expanded filters */}
      {expanded && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
          <select value={filters.workMode} onChange={(e) => updateFilter('workMode', e.target.value)} className="input-glass text-xs py-1.5">
            {WORK_MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.anomalyType} onChange={(e) => updateFilter('anomalyType', e.target.value)} className="input-glass text-xs py-1.5">
            {ANOMALY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.employeeType} onChange={(e) => updateFilter('employeeType', e.target.value)} className="input-glass text-xs py-1.5">
            {EMPLOYEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.shiftType} onChange={(e) => updateFilter('shiftType', e.target.value)} className="input-glass text-xs py-1.5">
            <option value="">All Shifts</option>
            <option value="OFFICE">Office Shift</option>
            <option value="FIELD">Field Shift</option>
          </select>
          <select value={filters.regularizationStatus} onChange={(e) => updateFilter('regularizationStatus', e.target.value)} className="input-glass text-xs py-1.5">
            <option value="">All Regularization</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      )}

      {/* Filter chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map(c => (
            <span key={c.key} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)', borderColor: 'var(--ui-border-color)' }}>
              {c.label}
              <button onClick={() => updateFilter(c.key as keyof AttendanceFilters, '')}>
                <X size={10} />
              </button>
            </span>
          ))}
          <button onClick={clearAll} className="text-[10px] text-gray-400 hover:text-gray-600 underline">Clear all</button>
        </div>
      )}
    </div>
  );
}
