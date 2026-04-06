import { useState } from 'react';
import { AlertTriangle, Shield, MapPin, Clock, Users, Check, X, Loader2, Zap, Eye } from 'lucide-react';
import { useGetAnomaliesQuery, useResolveAnomalyMutation, useDetectAnomaliesMutation } from '../attendanceApi';
import toast from 'react-hot-toast';

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  HIGH: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: 'text-red-500' },
  MEDIUM: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: 'text-amber-500' },
  LOW: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: 'text-blue-500' },
};

const TYPE_LABELS: Record<string, { label: string; icon: typeof AlertTriangle }> = {
  GPS_SPOOF: { label: 'GPS Spoofing', icon: MapPin },
  BUDDY_PUNCH: { label: 'Buddy Punching', icon: Users },
  EARLY_CHECKOUT: { label: 'Early Checkout', icon: Clock },
  LATE_CHECKIN: { label: 'Late Check-in', icon: Clock },
  GEOFENCE_VIOLATION: { label: 'Geofence Violation', icon: Shield },
  PATTERN_ANOMALY: { label: 'Pattern Anomaly', icon: Zap },
  MISSING_CHECKOUT: { label: 'Missing Checkout', icon: AlertTriangle },
};

export default function AnomalyDetectionPanel() {
  const [severityFilter, setSeverityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveRemarks, setResolveRemarks] = useState('');

  const { data: res, isLoading } = useGetAnomaliesQuery({
    severity: severityFilter || undefined,
    type: typeFilter || undefined,
    limit: 50,
  });
  const anomalies = res?.data || [];

  const [resolve, { isLoading: resolving }] = useResolveAnomalyMutation();
  const [detect, { isLoading: detecting }] = useDetectAnomaliesMutation();

  const handleResolve = async (id: string, resolution: string) => {
    try {
      await resolve({ id, resolution, remarks: resolveRemarks }).unwrap();
      toast.success('Anomaly resolved');
      setResolveId(null);
      setResolveRemarks('');
    } catch { toast.error('Failed to resolve'); }
  };

  const handleDetect = async () => {
    try {
      const result = await detect({}).unwrap();
      toast.success(`Scan complete: ${result.data?.detected || 0} anomalies detected, ${result.data?.created || 0} new`);
    } catch { toast.error('Detection failed'); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-semibold text-gray-800 flex items-center gap-2">
          <Shield size={16} className="text-red-500" /> AI Anomaly Detection
        </h3>
        <button onClick={handleDetect} disabled={detecting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg text-xs font-medium">
          {detecting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          Run Detection
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300">
          <option value="">All Severity</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300">
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{anomalies.length} anomalies found</span>
      </div>

      {/* Anomaly List */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : anomalies.length === 0 ? (
        <div className="text-center py-12">
          <Shield size={32} className="mx-auto text-emerald-300 mb-2" />
          <p className="text-sm text-gray-500 font-medium">No anomalies detected</p>
          <p className="text-xs text-gray-400 mt-1">Click "Run Detection" to scan for attendance irregularities</p>
        </div>
      ) : (
        <div className="space-y-2">
          {anomalies.map((anomaly: any) => {
            const sev = SEVERITY_STYLES[anomaly.severity] || SEVERITY_STYLES.LOW;
            const typeInfo = TYPE_LABELS[anomaly.type] || { label: anomaly.type, icon: AlertTriangle };
            const TypeIcon = typeInfo.icon;
            const isExpanded = resolveId === anomaly.id;

            return (
              <div key={anomaly.id} className={`border rounded-xl p-3 ${sev.bg} transition-all`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${anomaly.severity === 'HIGH' ? 'bg-red-100' : anomaly.severity === 'MEDIUM' ? 'bg-amber-100' : 'bg-blue-100'}`}>
                      <TypeIcon size={16} className={sev.icon} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${sev.text}`}>{typeInfo.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          anomaly.severity === 'HIGH' ? 'bg-red-200 text-red-800' :
                          anomaly.severity === 'MEDIUM' ? 'bg-amber-200 text-amber-800' :
                          'bg-blue-200 text-blue-800'
                        }`}>{anomaly.severity}</span>
                        {anomaly.resolution && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Resolved</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 mt-0.5">
                        <strong>{anomaly.employee?.firstName} {anomaly.employee?.lastName}</strong>
                        {anomaly.employee?.employeeCode && <span className="text-gray-400"> ({anomaly.employee.employeeCode})</span>}
                        {' — '}{new Date(anomaly.date || anomaly.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      {anomaly.details && <p className="text-[10px] text-gray-500 mt-0.5">{anomaly.details}</p>}
                    </div>
                  </div>
                  {!anomaly.resolution && (
                    <div className="flex gap-1">
                      <button onClick={() => setResolveId(isExpanded ? null : anomaly.id)} title="Resolve"
                        className="p-1.5 rounded-lg hover:bg-white/50">
                        <Eye size={14} className="text-gray-500" />
                      </button>
                      <button onClick={() => handleResolve(anomaly.id, 'DISMISSED')} disabled={resolving} title="Dismiss"
                        className="p-1.5 rounded-lg hover:bg-white/50">
                        <X size={14} className="text-gray-400" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Resolve panel */}
                {isExpanded && !anomaly.resolution && (
                  <div className="mt-3 pt-3 border-t border-gray-200/50">
                    <input value={resolveRemarks} onChange={e => setResolveRemarks(e.target.value)}
                      placeholder="Add remarks (optional)..."
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 bg-white focus:outline-none" />
                    <div className="flex gap-2">
                      <button onClick={() => handleResolve(anomaly.id, 'LEGITIMATE')} disabled={resolving}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-medium">
                        <Check size={12} /> Mark Legitimate
                      </button>
                      <button onClick={() => handleResolve(anomaly.id, 'ACTION_TAKEN')} disabled={resolving}
                        className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[11px] font-medium">
                        <AlertTriangle size={12} /> Action Taken
                      </button>
                      <button onClick={() => handleResolve(anomaly.id, 'ESCALATED')} disabled={resolving}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-[11px] font-medium">
                        <Shield size={12} /> Escalate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
