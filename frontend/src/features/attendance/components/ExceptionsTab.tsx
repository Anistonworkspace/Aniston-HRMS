import { useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Clock, User } from 'lucide-react';
import { useGetAnomaliesQuery, useResolveAnomalyMutation } from '../attendanceApi';
import { cn, formatDate, getInitials } from '../../../lib/utils';
import toast from 'react-hot-toast';

const SEVERITY_COLORS: Record<string, string> = {
  LOW: 'bg-blue-50 text-blue-600 border-blue-200',
  MEDIUM: 'bg-amber-50 text-amber-600 border-amber-200',
  HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
};

const TYPE_LABELS: Record<string, string> = {
  LATE_ARRIVAL: 'Late Arrival',
  EARLY_EXIT: 'Early Exit',
  MISSING_PUNCH: 'Missing Punch',
  INSUFFICIENT_HOURS: 'Insufficient Hours',
  OUTSIDE_GEOFENCE: 'Outside Geofence',
  DUPLICATE_PUNCH: 'Duplicate Punch',
  SUSPICIOUS_GAP: 'Suspicious Gap',
  LEAVE_OVERLAP: 'Leave Overlap',
  HOLIDAY_ATTENDANCE: 'Holiday Attendance',
  LOCATION_MISMATCH: 'Location Mismatch',
  UNAPPROVED_REMOTE: 'Unapproved Remote',
  POLICY_BREACH: 'Policy Breach',
  GPS_SPOOF: 'GPS Spoof',
};

interface ExceptionsTabProps {
  selectedDate: string;
}

export default function ExceptionsTab({ selectedDate }: ExceptionsTabProps) {
  const [typeFilter, setTypeFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: res, isLoading } = useGetAnomaliesQuery({
    date: selectedDate,
    type: typeFilter || undefined,
    severity: sevFilter || undefined,
    resolution: 'PENDING',
    page,
    limit: 20,
  }, { pollingInterval: 60000 });
  const [resolveAnomaly] = useResolveAnomalyMutation();

  const anomalies = res?.data || [];
  const meta = res?.meta;

  const handleResolve = async (id: string, resolution: string) => {
    try {
      await resolveAnomaly({ id, resolution }).unwrap();
      toast.success(`Anomaly ${resolution.toLowerCase()}`);
    } catch { toast.error('Failed to resolve'); }
  };

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-glass text-xs py-1.5">
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="input-glass text-xs py-1.5">
          <option value="">All Severity</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <span className="text-[10px] text-gray-400 ml-auto">{meta?.total || 0} pending exceptions</span>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="layer-card p-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2"><div className="w-28 h-3 bg-gray-100 rounded animate-pulse" /><div className="w-12 h-4 bg-gray-100 rounded-full animate-pulse" /></div>
                <div className="w-20 h-3 bg-gray-50 rounded animate-pulse" />
                <div className="w-full h-3 bg-gray-50 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : anomalies.length === 0 ? (
        <div className="layer-card p-8 text-center">
          <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
          <p className="text-sm text-gray-400">No pending exceptions for this date</p>
        </div>
      ) : (
        <div className="space-y-2">
          {anomalies.map((a: any) => (
            <div key={a.id} className="layer-card p-3 flex items-start gap-3 hover:shadow-sm transition-shadow">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0" style={{ background: 'var(--primary-highlighted-color)', color: 'var(--primary-color)' }}>
                {getInitials(a.employee?.firstName, a.employee?.lastName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs font-medium text-gray-800">
                    {a.employee?.firstName} {a.employee?.lastName}
                  </p>
                  <span className="text-[10px] text-gray-400 font-mono" data-mono>{a.employee?.employeeCode}</span>
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border font-medium', SEVERITY_COLORS[a.severity] || SEVERITY_COLORS.MEDIUM)}>
                    {a.severity}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium">
                    {TYPE_LABELS[a.type] || a.type}
                  </span>
                  <span className="text-[10px] text-gray-400">{a.employee?.department?.name}</span>
                </div>
                <p className="text-[11px] text-gray-500">{a.description}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleResolve(a.id, 'HR_APPROVED')}
                  className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                  title="Approve"
                >
                  <CheckCircle size={14} />
                </button>
                <button
                  onClick={() => handleResolve(a.id, 'DISMISSED')}
                  className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                  title="Dismiss"
                >
                  <XCircle size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
