import { useState, useEffect, lazy, Suspense } from 'react';
import { X, MapPin, Clock, Navigation, Edit2, Check, AlertTriangle, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGetEmployeeGPSTrailQuery, useUpdateLocationVisitNameMutation } from '../attendanceApi';
import { cn } from '../../../lib/utils';
import toast from 'react-hot-toast';

const TrailMap = lazy(() => import('./GpsTrailMap'));

interface GpsTrailModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  date: string;
}

function fmtTime(ts: any): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function haversineKm(positions: [number, number][]): number {
  let km = 0;
  const R = 6371;
  for (let i = 1; i < positions.length; i++) {
    const [lat1, lng1] = positions[i - 1];
    const [lat2, lng2] = positions[i];
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    km += R * 2 * Math.asin(Math.sqrt(a));
  }
  return km;
}

export default function GpsTrailModal({ isOpen, onClose, employeeId, employeeName, date }: GpsTrailModalProps) {
  const { data, isLoading } = useGetEmployeeGPSTrailQuery(
    { employeeId, date },
    { skip: !isOpen || !employeeId || !date }
  );

  const [updateName] = useUpdateLocationVisitNameMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const points: any[] = data?.data?.points || [];
  const visits: any[] = data?.data?.visits || [];

  const positions: [number, number][] = points.map((p: any) => [Number(p.lat), Number(p.lng)]);
  const totalKm = haversineKm(positions);
  const significantVisits = visits.filter((v: any) => v.isSignificant);

  const firstTs = points[0]?.timestamp;
  const lastTs = points[points.length - 1]?.timestamp;
  const durationMs = firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : 0;
  const durationMins = Math.round(durationMs / 60000);

  useEffect(() => {
    if (!isOpen) { setEditingId(null); setEditValue(''); }
  }, [isOpen]);

  const handleSaveName = async (id: string) => {
    if (!editValue.trim()) return;
    try {
      await updateName({ id, customName: editValue.trim() }).unwrap();
      toast.success('Location name updated');
      setEditingId(null);
    } catch {
      toast.error('Failed to update name');
    }
  };

  const displayDate = new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <Navigation size={15} className="text-green-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{employeeName} — GPS Trail</h2>
                  <p className="text-[11px] text-gray-500">{displayDate}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : points.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <AlertTriangle size={28} className="text-amber-400" />
                  <p className="text-sm font-medium text-gray-600">No GPS data for this day</p>
                  <p className="text-xs text-gray-400">The employee may not have had location enabled</p>
                </div>
              ) : (
                <>
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-3 px-5 py-3 border-b border-gray-50">
                    <div className="text-center py-2 bg-indigo-50 rounded-xl">
                      <p className="text-base font-bold font-mono text-indigo-600" data-mono>{points.length}</p>
                      <p className="text-[10px] text-gray-500">Points</p>
                    </div>
                    <div className="text-center py-2 bg-emerald-50 rounded-xl">
                      <p className="text-base font-bold font-mono text-emerald-600" data-mono>{totalKm.toFixed(1)} km</p>
                      <p className="text-[10px] text-gray-500">Distance</p>
                    </div>
                    <div className="text-center py-2 bg-amber-50 rounded-xl">
                      <p className="text-base font-bold font-mono text-amber-600" data-mono>{fmtDuration(durationMins)}</p>
                      <p className="text-[10px] text-gray-500">Duration</p>
                    </div>
                    <div className="text-center py-2 bg-orange-50 rounded-xl">
                      <p className="text-base font-bold font-mono text-orange-600" data-mono>{significantVisits.length}</p>
                      <p className="text-[10px] text-gray-500">Named Stops</p>
                    </div>
                  </div>

                  {/* Map */}
                  <div style={{ height: 360 }} className="border-b border-gray-100">
                    <Suspense fallback={<div className="h-full bg-gray-50 animate-pulse flex items-center justify-center"><p className="text-xs text-gray-400">Loading map…</p></div>}>
                      <TrailMap points={points} visits={visits} />
                    </Suspense>
                  </div>

                  {/* Named Locations (≥60 min stops) */}
                  {significantVisits.length > 0 && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                        <MapPin size={12} className="text-red-500" />
                        Named Stops (stayed ≥1 hour)
                      </p>
                      <div className="space-y-2">
                        {significantVisits.map((v: any, i: number) => {
                          const name = v.customName || v.locationName || `Stop ${i + 1}`;
                          const isEditing = editingId === v.id;
                          return (
                            <div key={v.id || i} className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                              <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <span className="text-[10px] font-bold text-red-600">{i + 1}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      className="flex-1 text-xs border border-gray-300 rounded-lg px-2 py-1 outline-none focus:border-brand-400"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onKeyDown={e => e.key === 'Enter' && handleSaveName(v.id)}
                                      autoFocus
                                    />
                                    <button onClick={() => handleSaveName(v.id)} className="p-1 rounded-lg bg-green-100 hover:bg-green-200">
                                      <Check size={12} className="text-green-600" />
                                    </button>
                                    <button onClick={() => setEditingId(null)} className="p-1 rounded-lg bg-gray-100 hover:bg-gray-200">
                                      <X size={12} className="text-gray-500" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-gray-800 truncate">{name}</span>
                                    {v.id && (
                                      <button
                                        onClick={() => { setEditingId(v.id); setEditValue(v.customName || v.locationName || ''); }}
                                        className="p-0.5 rounded hover:bg-red-100 flex-shrink-0"
                                      >
                                        <Edit2 size={10} className="text-red-400" />
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
                                  <span className="flex items-center gap-0.5">
                                    <Clock size={9} /> {fmtTime(v.startTime)} → {fmtTime(v.endTime)}
                                  </span>
                                  <span className="font-medium text-red-600">{fmtDuration(v.durationMinutes)}</span>
                                  <span className="font-mono">{Number(v.lat).toFixed(4)}, {Number(v.lng).toFixed(4)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* All visit stops */}
                  {visits.filter((v: any) => !v.isSignificant).length > 0 && (
                    <div className="px-5 py-3 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                        <Activity size={12} className="text-orange-400" />
                        Brief Stops (&lt;1 hour)
                      </p>
                      <div className="space-y-1">
                        {visits.filter((v: any) => !v.isSignificant).map((v: any, i: number) => (
                          <div key={i} className="flex items-center gap-2.5 bg-orange-50 border border-orange-100 rounded-lg px-3 py-1.5 text-[11px]">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                            <span className="text-gray-500 font-mono w-[120px] flex-shrink-0">{fmtTime(v.startTime)} → {fmtTime(v.endTime)}</span>
                            <span className="text-orange-700 font-medium">{fmtDuration(v.durationMinutes)}</span>
                            <span className="text-gray-400 font-mono ml-auto">{Number(v.lat).toFixed(4)}, {Number(v.lng).toFixed(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Journey timeline */}
                  <div className="px-5 py-3">
                    <p className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1">
                      <Clock size={10} className="text-indigo-400" /> Journey Timeline ({points.length} points)
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-px pr-1">
                      {points.map((p: any, i: number) => {
                        const isFirst = i === 0;
                        const isLast = i === points.length - 1;
                        const speedKmh = p.speed != null ? (Number(p.speed) * 3.6).toFixed(1) : null;
                        return (
                          <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                            <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                              isFirst ? 'bg-emerald-500' : isLast ? 'bg-red-500' : 'bg-indigo-300')} />
                            <span className="font-mono text-gray-400 w-[60px] flex-shrink-0" data-mono>{fmtTime(p.timestamp)}</span>
                            <span className="text-gray-600 flex-1 font-mono truncate">{Number(p.lat).toFixed(4)}, {Number(p.lng).toFixed(4)}</span>
                            {speedKmh && <span className="text-gray-400 flex-shrink-0">{speedKmh} km/h</span>}
                            {p.accuracy != null && <span className="text-gray-300 flex-shrink-0">±{Math.round(Number(p.accuracy))}m</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
