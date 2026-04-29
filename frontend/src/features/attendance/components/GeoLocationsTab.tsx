import { useState, lazy, Suspense } from 'react';
import { MapPin, Clock, Edit2, Check, X, Navigation, AlertTriangle, Search, ChevronLeft, ChevronRight, Map } from 'lucide-react';
import { useGetGeoLocationsQuery, useUpdateLocationVisitNameMutation } from '../attendanceApi';
import { cn, formatDate } from '../../../lib/utils';
import toast from 'react-hot-toast';

const MiniMap = lazy(() => import('./GeoLocationMiniMap'));

function fmtTime(ts: any): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function fmtDur(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function GeoLocationsTab() {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [mapPreview, setMapPreview] = useState<{ lat: number; lng: number; name: string } | null>(null);

  const { data, isLoading } = useGetGeoLocationsQuery({ startDate, endDate, page, limit: 30 });
  const [updateName] = useUpdateLocationVisitNameMutation();

  const visits: any[] = data?.data || [];
  const meta = data?.meta;

  const filtered = search.trim()
    ? visits.filter((v: any) => {
        const name = `${v.attendance?.employee?.firstName} ${v.attendance?.employee?.lastName} ${v.attendance?.employee?.employeeCode}`.toLowerCase();
        return name.includes(search.toLowerCase());
      })
    : visits;

  const handleSave = async (id: string) => {
    if (!editValue.trim()) return;
    try {
      await updateName({ id, customName: editValue.trim() }).unwrap();
      toast.success('Location name saved');
      setEditingId(null);
    } catch { toast.error('Failed to save name'); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="layer-card p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500 font-medium">From</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }}
              className="input-glass text-xs px-2 py-1.5 rounded-lg" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500 font-medium">To</label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }}
              className="input-glass text-xs px-2 py-1.5 rounded-lg" />
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search employee…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-glass w-full pl-7 pr-3 py-1.5 text-xs rounded-lg"
            />
          </div>
          {meta && (
            <span className="text-[11px] text-gray-400 ml-auto">
              {meta.total} location{meta.total !== 1 ? 's' : ''} found
            </span>
          )}
        </div>
      </div>

      {/* Map Preview Modal */}
      {mapPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMapPreview(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <MapPin size={13} className="text-red-500" />
                <span className="text-sm font-semibold text-gray-800">{mapPreview.name}</span>
              </div>
              <button onClick={() => setMapPreview(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X size={14} className="text-gray-500" />
              </button>
            </div>
            <div style={{ height: 320 }}>
              <Suspense fallback={<div className="h-full bg-gray-50 animate-pulse" />}>
                <MiniMap lat={mapPreview.lat} lng={mapPreview.lng} name={mapPreview.name} />
              </Suspense>
            </div>
            <div className="px-4 py-2.5 bg-gray-50 text-[11px] text-gray-500 font-mono">
              {mapPreview.lat.toFixed(6)}, {mapPreview.lng.toFixed(6)}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="layer-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Navigation size={24} className="text-gray-300" />
            <p className="text-sm text-gray-500">No location visits found</p>
            <p className="text-xs text-gray-400">Field sales employees who stay ≥1 hour at a location will appear here</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Employee</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Date</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Location Name</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Arrival</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Departure</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Duration</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Coordinates</th>
                    <th className="text-left text-[10px] font-semibold text-gray-500 px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v: any) => {
                    const emp = v.attendance?.employee;
                    const displayName = v.customName || v.locationName || 'Unnamed Location';
                    const isEditing = editingId === v.id;
                    const isSignificant = v.isSignificant;

                    return (
                      <tr key={v.id} className="border-b border-gray-50 hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-[9px] font-bold text-green-700">
                                {emp ? `${emp.firstName?.[0]}${emp.lastName?.[0]}` : '?'}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-800">{emp ? `${emp.firstName} ${emp.lastName}` : '—'}</p>
                              <p className="text-[9px] text-gray-400">{emp?.employeeCode}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {v.attendance?.date ? formatDate(v.attendance.date) : '—'}
                        </td>
                        <td className="px-4 py-2 max-w-[200px]">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                className="flex-1 text-[11px] border border-gray-300 rounded px-1.5 py-0.5 outline-none focus:border-brand-400"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSave(v.id)}
                                autoFocus
                              />
                              <button onClick={() => handleSave(v.id)} className="p-0.5 rounded bg-green-50 hover:bg-green-100">
                                <Check size={11} className="text-green-600" />
                              </button>
                              <button onClick={() => setEditingId(null)} className="p-0.5 rounded bg-gray-50 hover:bg-gray-100">
                                <X size={11} className="text-gray-400" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isSignificant ? 'bg-red-400' : 'bg-orange-400')} />
                              <span className={cn('truncate', v.customName ? 'text-gray-800 font-medium' : v.locationName ? 'text-gray-700' : 'text-gray-400 italic')}>
                                {displayName}
                              </span>
                              {v.customName && (
                                <span className="text-[8px] bg-green-50 text-green-600 border border-green-200 rounded px-1 flex-shrink-0">custom</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-gray-600" data-mono>{fmtTime(v.arrivalTime)}</td>
                        <td className="px-4 py-2 font-mono text-gray-600" data-mono>{fmtTime(v.departureTime)}</td>
                        <td className="px-4 py-2">
                          <span className={cn('text-xs font-semibold font-mono', isSignificant ? 'text-red-600' : 'text-orange-600')} data-mono>
                            {fmtDur(v.durationMinutes)}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-gray-400 text-[10px]" data-mono>
                          {Number(v.latitude).toFixed(4)}, {Number(v.longitude).toFixed(4)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setMapPreview({ lat: v.latitude, lng: v.longitude, name: displayName })}
                              className="p-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-colors"
                              title="View on map"
                            >
                              <Map size={11} className="text-indigo-500" />
                            </button>
                            <button
                              onClick={() => { setEditingId(v.id); setEditValue(v.customName || v.locationName || ''); }}
                              className="p-1 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                              title="Edit name"
                            >
                              <Edit2 size={11} className="text-gray-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100">
                <span className="text-[11px] text-gray-500">
                  Page {meta.page} of {meta.totalPages} ({meta.total} total)
                </span>
                <div className="flex items-center gap-1">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft size={13} className="text-gray-600" />
                  </button>
                  <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronRight size={13} className="text-gray-600" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Legend */}
      <div className="layer-card p-3">
        <p className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
          <AlertTriangle size={11} className="text-amber-500" /> Legend
        </p>
        <div className="flex flex-wrap gap-4 text-[10px] text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span>Named Stop — stayed ≥1 hour (auto-named from map, editable)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            <span>Brief Stop — 10 min to 59 min</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] bg-green-50 text-green-600 border border-green-200 rounded px-1">custom</span>
            <span>Name edited by HR</span>
          </div>
        </div>
      </div>
    </div>
  );
}
