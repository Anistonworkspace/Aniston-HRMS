import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MoreHorizontal, Eye, PenSquare, CheckSquare, MapPin, ClipboardList,
  ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { cn, getStatusColor, getInitials } from '../../../lib/utils';

interface AttendanceTableProps {
  records: any[];
  isLoading: boolean;
  meta: any;
  page: number;
  onPageChange: (page: number) => void;
  sortBy?: string;
  sortOrder?: string;
  onSort?: (field: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  GEOFENCE_AUTO: 'Geofence',
  MANUAL_APP: 'App',
  MANUAL_HR: 'HR Manual',
  QR_CODE: 'QR',
  BIOMETRIC: 'Biometric',
};

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  HALF_DAY: 'Half Day',
  ON_LEAVE: 'On Leave',
  WORK_FROM_HOME: 'WFH',
  NOT_CHECKED_IN: 'Not In',
  WEEKEND: 'Weekend',
  HOLIDAY: 'Holiday',
  LATE: 'Late',
};

/** Returns live elapsed hours when employee is checked in but not yet out */
const getLiveHours = (checkIn: string | null, checkOut: string | null, totalHours: number | null): string => {
  if (totalHours != null && totalHours > 0) return `${Number(totalHours).toFixed(1)}h`;
  if (checkIn && !checkOut) {
    const elapsed = (Date.now() - new Date(checkIn).getTime()) / 3600000;
    return elapsed > 0 ? `${elapsed.toFixed(1)}h` : '--';
  }
  return '--';
};

const COMPLIANCE_COLORS: Record<string, string> = {
  INSIDE_GEOFENCE: 'bg-emerald-50 text-emerald-600',
  OUTSIDE_GEOFENCE: 'bg-red-50 text-red-600',
  APPROVED_FIELD_SITE: 'bg-blue-50 text-blue-600',
  REMOTE_APPROVED: 'bg-teal-50 text-teal-600',
  UNKNOWN: 'bg-gray-50 text-gray-400',
};

const ANOMALY_COLORS: Record<string, string> = {
  LATE_ARRIVAL: 'bg-amber-50 text-amber-700 border-amber-200',
  EARLY_EXIT: 'bg-orange-50 text-orange-700 border-orange-200',
  MISSING_PUNCH: 'bg-red-50 text-red-700 border-red-200',
  INSUFFICIENT_HOURS: 'bg-rose-50 text-rose-700 border-rose-200',
  OUTSIDE_GEOFENCE: 'bg-red-50 text-red-700 border-red-200',
  GPS_SPOOF: 'bg-red-50 text-red-700 border-red-200',
  POLICY_BREACH: 'bg-rose-50 text-rose-700 border-rose-200',
};

const formatTime = (dateStr: string | null) => {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
};

const SortIcon = ({ field, sortBy, sortOrder }: { field: string; sortBy?: string; sortOrder?: string }) => {
  if (sortBy !== field) return <ArrowUpDown size={10} className="text-gray-300 ml-0.5" />;
  return sortOrder === 'desc'
    ? <ArrowDown size={10} className="text-brand-500 ml-0.5" />
    : <ArrowUp size={10} className="text-brand-500 ml-0.5" />;
};

function AttendanceTable({ records, isLoading, meta, page, onPageChange, sortBy, sortOrder, onSort }: AttendanceTableProps) {
  const navigate = useNavigate();
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="layer-card overflow-hidden">
        <div className="p-3">
          {/* Table skeleton */}
          <div className="flex gap-3 mb-3 px-2.5">
            {[180, 80, 70, 72, 72, 50, 55, 80, 65].map((w, i) => (
              <div key={i} className="h-3 bg-gray-100 rounded animate-pulse flex-shrink-0" style={{ width: w }} />
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2.5 py-2.5 border-b border-gray-50">
              <div className="w-7 h-7 bg-gray-100 rounded-full animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-28" />
                <div className="h-2 bg-gray-50 rounded animate-pulse w-16" />
              </div>
              <div className="h-3 bg-gray-50 rounded animate-pulse w-12" />
              <div className="h-3 bg-gray-50 rounded animate-pulse w-12" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-10" />
              <div className="h-5 bg-gray-100 rounded-full animate-pulse w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="layer-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-gray-100">
              {[
                { key: 'name', label: 'Employee', w: 'min-w-[180px]' },
                { key: 'department', label: 'Dept', w: 'min-w-[80px]' },
                { key: 'shift', label: 'Shift', w: 'min-w-[70px]' },
                { key: 'checkIn', label: 'Check In', w: 'w-[72px]', sortable: true },
                { key: 'checkOut', label: 'Check Out', w: 'w-[72px]', sortable: true },
                { key: 'breaks', label: 'Break', w: 'w-[50px]' },
                { key: 'totalHours', label: 'Hours', w: 'w-[55px]', sortable: true },
                { key: 'status', label: 'Status', w: 'w-[80px]' },
                { key: 'workMode', label: 'Mode', w: 'w-[65px]' },
                { key: 'source', label: 'Source', w: 'w-[65px]' },
                { key: 'compliance', label: 'Location', w: 'w-[80px]' },
                { key: 'anomaly', label: 'Anomaly', w: 'w-[90px]' },
                { key: 'regularization', label: 'Reg.', w: 'w-[60px]' },
                { key: 'action', label: '', w: 'w-[36px]' },
              ].map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'text-left font-semibold text-gray-500 uppercase tracking-wider px-2.5 py-2.5 whitespace-nowrap',
                    col.w,
                    col.sortable && 'cursor-pointer hover:text-gray-700 select-none',
                  )}
                  onClick={() => col.sortable && onSort?.(col.key)}
                >
                  <span className="flex items-center">
                    {col.label}
                    {col.sortable && <SortIcon field={col.key} sortBy={sortBy} sortOrder={sortOrder} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={14} className="text-center py-10">
                  <p className="text-sm text-gray-400">No attendance records found</p>
                </td>
              </tr>
            ) : (
              records.map((r: any, idx: number) => (
                <tr
                  key={r.id || idx}
                  onClick={() => r.employeeId && navigate(`/attendance/employee/${r.employeeId}`)}
                  className="border-b border-gray-50 hover:bg-surface-2/50 transition-colors cursor-pointer group"
                >
                  {/* Employee */}
                  <td className="px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-semibold text-brand-700 flex-shrink-0">
                        {getInitials(r.employee?.firstName, r.employee?.lastName)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {r.employee?.firstName} {r.employee?.lastName}
                        </p>
                        <p className="text-[10px] text-gray-400 font-mono truncate" data-mono>
                          {r.employee?.employeeCode}
                        </p>
                      </div>
                    </div>
                  </td>
                  {/* Department */}
                  <td className="px-2.5 py-2">
                    <span className="text-gray-500 truncate block max-w-[80px]">{r.employee?.department?.name || '--'}</span>
                  </td>
                  {/* Shift */}
                  <td className="px-2.5 py-2">
                    <span className="text-gray-500 truncate block max-w-[70px]">{r.shift?.name || '--'}</span>
                  </td>
                  {/* Check In */}
                  <td className="px-2.5 py-2">
                    <span className="font-mono text-gray-700" data-mono>{formatTime(r.checkIn)}</span>
                  </td>
                  {/* Check Out */}
                  <td className="px-2.5 py-2">
                    <span className="font-mono text-gray-700" data-mono>{formatTime(r.checkOut)}</span>
                  </td>
                  {/* Break */}
                  <td className="px-2.5 py-2">
                    <span className="font-mono text-gray-500" data-mono>
                      {r.breakDuration ? `${r.breakDuration}m` : '--'}
                    </span>
                  </td>
                  {/* Total Hours */}
                  <td className="px-2.5 py-2">
                    {(() => {
                      const display = getLiveHours(r.checkIn, r.checkOut, r.totalHours);
                      const hours = parseFloat(display);
                      const isLive = r.checkIn && !r.checkOut && (!r.totalHours || r.totalHours === 0);
                      return (
                        <span className={cn(
                          'font-mono font-medium text-xs',
                          isLive ? 'text-emerald-600' : (!isNaN(hours) && hours < 4 ? 'text-red-500' : 'text-gray-700'),
                        )} data-mono>
                          {display}
                          {isLive && display !== '--' && <span className="ml-0.5 text-[8px] text-emerald-500 font-sans">●</span>}
                        </span>
                      );
                    })()}
                  </td>
                  {/* Status */}
                  <td className="px-2.5 py-2">
                    <span className={cn('inline-flex items-center rounded-full text-[10px] font-medium px-2 py-0.5 whitespace-nowrap', getStatusColor(r.status))}>
                      {STATUS_LABELS[r.status] || r.status?.replace(/_/g, ' ') || '--'}
                    </span>
                  </td>
                  {/* Work Mode */}
                  <td className="px-2.5 py-2">
                    <span className="text-gray-500 text-[10px]">{r.workMode?.replace(/_/g, ' ') || '--'}</span>
                  </td>
                  {/* Source */}
                  <td className="px-2.5 py-2">
                    <span className="text-gray-400 text-[10px]">{SOURCE_LABELS[r.source] || r.source || '--'}</span>
                  </td>
                  {/* Location Compliance */}
                  <td className="px-2.5 py-2">
                    {r.locationCompliance && r.locationCompliance !== 'UNKNOWN' ? (
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium', COMPLIANCE_COLORS[r.locationCompliance] || COMPLIANCE_COLORS.UNKNOWN)}>
                        {r.locationCompliance.replace(/_/g, ' ')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300">--</span>
                    )}
                  </td>
                  {/* Anomaly */}
                  <td className="px-2.5 py-2">
                    {r.anomalyCount > 0 ? (
                      <div className="flex flex-wrap gap-0.5">
                        {r.anomalyTypes?.slice(0, 2).map((t: string, i: number) => (
                          <span key={i} className={cn('text-[8px] px-1 py-0.5 rounded border font-medium', ANOMALY_COLORS[t] || 'bg-gray-50 text-gray-500 border-gray-200')}>
                            {t.replace(/_/g, ' ').split(' ').map((w: string) => w[0]).join('')}
                          </span>
                        ))}
                        {r.anomalyCount > 2 && <span className="text-[8px] text-gray-400">+{r.anomalyCount - 2}</span>}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-300">--</span>
                    )}
                  </td>
                  {/* Regularization */}
                  <td className="px-2.5 py-2">
                    {r.regularizationStatus ? (
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                        r.regularizationStatus === 'PENDING' ? 'bg-amber-50 text-amber-600' :
                        r.regularizationStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-600' :
                        'bg-red-50 text-red-600',
                      )}>
                        {r.regularizationStatus}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300">--</span>
                    )}
                  </td>
                  {/* Action */}
                  <td className="px-2 py-2 relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setActionMenuId(actionMenuId === r.id ? null : r.id); }}
                      className="p-1 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal size={14} className="text-gray-400" />
                    </button>
                    {actionMenuId === r.id && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setActionMenuId(null); }} />
                        <div className="absolute right-0 top-full mt-0.5 bg-white rounded-lg border border-gray-200 shadow-lg z-30 min-w-[180px] py-1">
                          {[
                            { icon: Eye, label: 'View Day Detail', onClick: () => r.employeeId && navigate(`/attendance/employee/${r.employeeId}`) },
                            { icon: PenSquare, label: 'Regularize', onClick: () => r.employeeId && navigate(`/attendance/employee/${r.employeeId}?action=regularize`) },
                            { icon: CheckSquare, label: 'Mark Attendance', onClick: () => r.employeeId && navigate(`/attendance/employee/${r.employeeId}?action=mark`) },
                            { icon: MapPin, label: 'View Location', onClick: () => r.employeeId && navigate(`/attendance/employee/${r.employeeId}?tab=map`) },
                            { icon: ClipboardList, label: 'Activity Logs', onClick: () => r.employeeId && navigate(`/attendance/employee/${r.employeeId}?tab=logs`) },
                          ].map(a => (
                            <button
                              key={a.label}
                              onClick={(e) => { e.stopPropagation(); a.onClick(); setActionMenuId(null); }}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              <a.icon size={12} /> {a.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta?.totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400">
            Page {meta.page} of {meta.totalPages} ({meta.total} records)
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} className="p-1 rounded hover:bg-surface-2 disabled:opacity-30">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => onPageChange(page + 1)} disabled={page >= (meta.totalPages || 1)} className="p-1 rounded hover:bg-surface-2 disabled:opacity-30">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(AttendanceTable);
