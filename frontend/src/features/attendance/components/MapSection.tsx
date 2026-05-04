import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, Clock, Flag, MapPin, Maximize2, Minimize2, Navigation, Edit2, Check, X } from 'lucide-react';
import { cn, formatDate } from '../../../lib/utils';
import { useUpdateLocationVisitNameMutation } from '../attendanceApi';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
}

function FitTrail({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), { padding: [30, 30] });
    } else if (positions.length === 1) {
      map.setView(positions[0], 15);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]);
  return null;
}

function fmtTime(ts: number | string | undefined | null): string {
  if (!ts) return '--:--';
  return new Date(typeof ts === 'number' ? ts : ts).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface MapSectionProps {
  checkInLoc: any;
  geofenceCoords: any;
  geofence: any;
  shiftType: string;
  gpsTrail: any[];
  gpsVisits?: any[];
  selectedDate: string;
  geofenceViolation?: boolean;
}

/** Edit state for a single visit stop label */
interface LabelEditState {
  visitId: string | null;
  index: number | null;
  value: string;
}

export default function MapSection({
  checkInLoc,
  geofenceCoords,
  geofence,
  shiftType,
  gpsTrail,
  gpsVisits = [],
  selectedDate,
  geofenceViolation,
}: MapSectionProps) {
  const [labelEdit, setLabelEdit] = useState<LabelEditState>({ visitId: null, index: null, value: '' });
  const [updateVisitName, { isLoading: isSavingLabel }] = useUpdateLocationVisitNameMutation();
  const [trailFullscreen, setTrailFullscreen] = useState(false);
  const [officeFullscreen, setOfficeFullscreen] = useState(false);

  const saveLabel = async () => {
    if (!labelEdit.visitId || !labelEdit.value.trim()) { setLabelEdit({ visitId: null, index: null, value: '' }); return; }
    try {
      await updateVisitName({ id: labelEdit.visitId, customName: labelEdit.value.trim() }).unwrap();
    } catch { /* label save failure is non-critical */ }
    setLabelEdit({ visitId: null, index: null, value: '' });
  };

  // ── FIELD SALES: full GPS trail view ──────────────────────────────────────
  if (gpsTrail.length > 0) {
    const positions: [number, number][] = gpsTrail.map((p: any) => [
      Number(p.lat ?? p.latitude),
      Number(p.lng ?? p.longitude),
    ]);

    // Jitter-filtered distance: skip a segment if its length is smaller than the GPS accuracy
    // of either endpoint. This avoids inflating distance when the device is stationary.
    let totalKm = 0;
    for (let i = 1; i < positions.length; i++) {
      const segKm = haversineKm(positions[i - 1], positions[i]);
      const acc1 = (gpsTrail[i - 1]?.accuracy ?? 0) / 1000; // convert m → km
      const acc2 = (gpsTrail[i]?.accuracy ?? 0) / 1000;
      const jitterThresholdKm = Math.max(acc1, acc2);
      if (segKm > jitterThresholdKm) {
        totalKm += segKm;
      }
    }

    const firstTs = gpsTrail[0]?.timestamp ?? gpsTrail[0]?.time ?? gpsTrail[0]?.recordedAt;
    const lastTs =
      gpsTrail[gpsTrail.length - 1]?.timestamp ??
      gpsTrail[gpsTrail.length - 1]?.time ??
      gpsTrail[gpsTrail.length - 1]?.recordedAt;
    const durationMs =
      firstTs && lastTs
        ? new Date(lastTs).getTime() - new Date(firstTs).getTime()
        : 0;

    return (
      <div className="layer-card overflow-hidden">
        {/* Header + stats */}
        <div className="px-4 pt-3 pb-2">
          <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
            <Activity size={12} className="text-green-500" />
            GPS Trail — {formatDate(selectedDate, 'long')}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-indigo-50 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold font-mono text-indigo-600" data-mono>
                {gpsTrail.length}
              </p>
              <p className="text-[9px] text-gray-500">Points</p>
            </div>
            <div className="bg-emerald-50 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold font-mono text-emerald-600" data-mono>
                {totalKm.toFixed(2)} km
              </p>
              <p className="text-[9px] text-gray-500">Distance</p>
            </div>
            <div className="bg-amber-50 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold font-mono text-amber-600" data-mono>
                {durationMs > 0 ? fmtDuration(durationMs) : '--'}
              </p>
              <p className="text-[9px] text-gray-500">Duration</p>
            </div>
          </div>
        </div>

        {/* Map */}
        <div style={{ height: 320 }} className="relative">
          <MapContainer
            center={positions[0]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OSM"
            />
            <FitTrail positions={positions} />
            <Polyline
              positions={positions}
              pathOptions={{ color: '#6366f1', weight: 3, opacity: 0.65 }}
            />

            {/* One CircleMarker per GPS point */}
            {gpsTrail.map((p: any, i: number) => {
              const lat = Number(p.lat ?? p.latitude);
              const lng = Number(p.lng ?? p.longitude);
              const ts = p.timestamp ?? p.time ?? p.recordedAt;
              const isFirst = i === 0;
              const isLast = i === gpsTrail.length - 1;
              const color = isFirst ? '#10b981' : isLast ? '#ef4444' : '#6366f1';
              const radius = isFirst || isLast ? 8 : 5;
              const speedKmh =
                p.speed != null ? (p.speed * 3.6).toFixed(1) : null;
              return (
                <CircleMarker
                  key={i}
                  center={[lat, lng]}
                  radius={radius}
                  pathOptions={{
                    fillColor: color,
                    color: '#fff',
                    weight: 1.5,
                    fillOpacity: 0.9,
                  }}
                >
                  <Popup>
                    <div style={{ fontSize: 11, minWidth: 165, lineHeight: 1.6 }}>
                      <strong>
                        {isFirst ? '🟢 Start' : isLast ? '🔴 End' : `📍 Point ${i + 1}`}
                      </strong>
                      <br />
                      🕐 {fmtTime(ts)}
                      <br />
                      {lat.toFixed(5)}, {lng.toFixed(5)}
                      <br />
                      🎯 Accuracy: ±{p.accuracy != null ? Math.round(p.accuracy) : '--'}m
                      {speedKmh != null && (
                        <>
                          <br />
                          🚀 Speed: {speedKmh} km/h
                        </>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* Visit stop markers (orange ring) */}
            {gpsVisits.map((v: any, i: number) => {
              const lat = Number(v.lat);
              const lng = Number(v.lng);
              if (!v.lat || !v.lng) return null;
              const dwellMs = v.durationMinutes != null ? v.durationMinutes * 60 * 1000 : 0;
              return (
                <CircleMarker
                  key={`v-${i}`}
                  center={[lat, lng]}
                  radius={14}
                  pathOptions={{
                    fillColor: '#f97316',
                    color: '#ea580c',
                    weight: 2,
                    fillOpacity: 0.25,
                  }}
                >
                  <Popup>
                    <div style={{ fontSize: 11, minWidth: 150, lineHeight: 1.6 }}>
                      <strong>🟠 Visit Stop {i + 1}</strong>
                      {v.startTime && (
                        <>
                          <br />
                          In: {fmtTime(v.startTime)}
                        </>
                      )}
                      {v.endTime && (
                        <>
                          <br />
                          Out: {fmtTime(v.endTime)}
                        </>
                      )}
                      {dwellMs > 0 && (
                        <>
                          <br />
                          ⏱ Dwell: {fmtDuration(dwellMs)}
                        </>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>

          {/* Fullscreen button */}
          <button
            onClick={() => setTrailFullscreen(true)}
            className="absolute top-3 right-3 z-[500] bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-1.5 shadow-md hover:bg-white transition-colors"
            title="View fullscreen"
          >
            <Maximize2 size={15} className="text-gray-600" />
          </button>
        </div>

        {/* GPS Trail Fullscreen Modal */}
        {trailFullscreen && (
          <div className="fixed inset-0 z-[80] flex flex-col bg-gray-900">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-green-400" />
                <span className="text-sm font-semibold text-white">GPS Trail — {formatDate(selectedDate, 'long')}</span>
                <span className="text-xs text-gray-400 ml-1">{gpsTrail.length} points</span>
              </div>
              <button
                onClick={() => setTrailFullscreen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs transition-colors"
              >
                <Minimize2 size={14} />
                Exit Fullscreen
              </button>
            </div>
            <div className="flex-1">
              <MapContainer
                center={positions[0]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OSM"
                />
                <FitTrail positions={positions} />
                <Polyline positions={positions} pathOptions={{ color: '#6366f1', weight: 3, opacity: 0.65 }} />
                {gpsTrail.map((p: any, i: number) => {
                  const lat = Number(p.lat ?? p.latitude);
                  const lng = Number(p.lng ?? p.longitude);
                  const ts = p.timestamp ?? p.time ?? p.recordedAt;
                  const isFirst = i === 0;
                  const isLast = i === gpsTrail.length - 1;
                  const color = isFirst ? '#10b981' : isLast ? '#ef4444' : '#6366f1';
                  const speedKmh = p.speed != null ? (p.speed * 3.6).toFixed(1) : null;
                  return (
                    <CircleMarker key={i} center={[lat, lng]} radius={isFirst || isLast ? 9 : 5}
                      pathOptions={{ fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.9 }}>
                      <Popup>
                        <div style={{ fontSize: 11, minWidth: 165, lineHeight: 1.6 }}>
                          <strong>{isFirst ? '🟢 Start' : isLast ? '🔴 End' : `📍 Point ${i + 1}`}</strong>
                          <br />🕐 {fmtTime(ts)}
                          <br />{lat.toFixed(5)}, {lng.toFixed(5)}
                          <br />🎯 Accuracy: ±{p.accuracy != null ? Math.round(p.accuracy) : '--'}m
                          {speedKmh != null && <><br />🚀 Speed: {speedKmh} km/h</>}
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
                {gpsVisits.map((v: any, i: number) => {
                  if (!v.lat || !v.lng) return null;
                  const dwellMs = v.durationMinutes != null ? v.durationMinutes * 60 * 1000 : 0;
                  return (
                    <CircleMarker key={`vf-${i}`} center={[Number(v.lat), Number(v.lng)]} radius={16}
                      pathOptions={{ fillColor: '#f97316', color: '#ea580c', weight: 2, fillOpacity: 0.25 }}>
                      <Popup>
                        <div style={{ fontSize: 11, minWidth: 150, lineHeight: 1.6 }}>
                          <strong>🟠 Visit Stop {i + 1}</strong>
                          {v.startTime && <><br />In: {fmtTime(v.startTime)}</>}
                          {v.endTime && <><br />Out: {fmtTime(v.endTime)}</>}
                          {dwellMs > 0 && <><br />⏱ Dwell: {fmtDuration(dwellMs)}</>}
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          </div>
        )}

        {/* Journey Timeline */}
        <div className="px-4 py-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <Clock size={10} className="text-indigo-400" /> Journey Timeline
          </p>
          <div className="max-h-44 overflow-y-auto space-y-0.5 pr-1">
            {gpsTrail.map((p: any, i: number) => {
              const ts = p.timestamp ?? p.time ?? p.recordedAt;
              const lat = Number(p.lat ?? p.latitude);
              const lng = Number(p.lng ?? p.longitude);
              const speedKmh =
                p.speed != null ? (p.speed * 3.6).toFixed(1) : null;
              const isFirst = i === 0;
              const isLast = i === gpsTrail.length - 1;
              return (
                <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                  <div
                    className={cn(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      isFirst
                        ? 'bg-emerald-500'
                        : isLast
                        ? 'bg-red-500'
                        : 'bg-indigo-400'
                    )}
                  />
                  <span
                    className="text-gray-400 font-mono w-[72px] flex-shrink-0 tabular-nums"
                    data-mono
                  >
                    {fmtTime(ts)}
                  </span>
                  <span className="text-gray-600 flex-1 truncate">
                    {lat.toFixed(4)}, {lng.toFixed(4)}
                    {speedKmh != null && (
                      <span className="text-gray-400 ml-1">· {speedKmh} km/h</span>
                    )}
                  </span>
                  {p.accuracy != null && (
                    <span className="text-gray-400 flex-shrink-0">
                      ±{Math.round(p.accuracy)}m
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Visit stops summary with editable labels */}
        {gpsVisits.length > 0 && (
          <div className="px-4 pb-3 border-t border-gray-100 pt-2">
            <p className="text-[10px] font-semibold text-gray-600 mb-1.5 flex items-center gap-1">
              <Navigation size={10} className="text-orange-400" />
              Visit Stops ({gpsVisits.length})
              <span className="text-gray-400 ml-1 font-normal">(click pencil to name a stop)</span>
            </p>
            <div className="space-y-1">
              {gpsVisits.map((v: any, i: number) => {
                const dwellMs = v.durationMinutes != null ? v.durationMinutes * 60 * 1000 : 0;
                const displayName = v.customName || v.locationName || null;
                const isEditing = labelEdit.index === i;
                return (
                  <div key={i} className="text-[10px] bg-orange-50 rounded px-2 py-1.5 border border-orange-100">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={labelEdit.value}
                          onChange={e => setLabelEdit(s => ({ ...s, value: e.target.value }))}
                          placeholder={`Name for Stop ${i + 1}`}
                          className="flex-1 text-[10px] border border-orange-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setLabelEdit({ visitId: null, index: null, value: '' }); }}
                        />
                        <button onClick={saveLabel} disabled={isSavingLabel} className="text-green-600 hover:text-green-700 p-0.5">
                          <Check size={12} />
                        </button>
                        <button onClick={() => setLabelEdit({ visitId: null, index: null, value: '' })} className="text-gray-400 hover:text-gray-600 p-0.5">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                        <span className="text-orange-700 font-medium flex-shrink-0">
                          {displayName || `Stop ${i + 1}`}
                        </span>
                        {!displayName && v.startTime && (
                          <span className="text-gray-500">{fmtTime(v.startTime)}</span>
                        )}
                        {!displayName && v.endTime && (
                          <>
                            <span className="text-gray-400">→</span>
                            <span className="text-gray-500">{fmtTime(v.endTime)}</span>
                          </>
                        )}
                        {dwellMs > 0 && (
                          <span className="text-orange-600 ml-auto font-medium">{fmtDuration(dwellMs)}</span>
                        )}
                        {/* Edit button — only shows if visit has been persisted to DB (has an id) */}
                        {v.id && (
                          <button
                            onClick={() => setLabelEdit({ visitId: v.id, index: i, value: v.customName || '' })}
                            className="text-orange-300 hover:text-orange-600 p-0.5 ml-1 flex-shrink-0"
                            title="Name this location"
                          >
                            <Edit2 size={10} />
                          </button>
                        )}
                      </div>
                    )}
                    {displayName && (
                      <div className="mt-0.5 ml-3.5 text-gray-400">
                        {v.startTime && fmtTime(v.startTime)}
                        {v.endTime && <> → {fmtTime(v.endTime)}</>}
                        {dwellMs > 0 && <span className="ml-1">· {fmtDuration(dwellMs)}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── OFFICE: single check-in location map ──────────────────────────────────
  if (checkInLoc?.lat) {
    return (
      <div className="layer-card overflow-hidden">
        <div className="px-4 pt-3 pb-1.5">
          <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            <MapPin size={12} className="text-brand-500" /> Check-in Location
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {geofenceViolation ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-200 font-medium flex items-center gap-0.5">
                <Flag size={8} /> Outside Geofence
              </span>
            ) : geofenceCoords ? (
              <span className="text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-200 font-medium">
                Inside Approved Zone
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ height: 200 }} className="relative">
          <MapContainer
            center={[checkInLoc.lat, checkInLoc.lng]}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OSM"
            />
            <CircleMarker
              center={[checkInLoc.lat, checkInLoc.lng]}
              radius={8}
              pathOptions={{
                fillColor: '#4f46e5',
                color: '#fff',
                weight: 2,
                fillOpacity: 0.9,
              }}
            />
            {geofenceCoords?.lat && (
              <Circle
                center={[geofenceCoords.lat, geofenceCoords.lng]}
                radius={geofence?.radiusMeters || 200}
                pathOptions={{
                  color: geofenceViolation ? '#ef4444' : '#4f46e5',
                  fillOpacity: 0.1,
                }}
              />
            )}
          </MapContainer>

          {/* Fullscreen button */}
          <button
            onClick={() => setOfficeFullscreen(true)}
            className="absolute top-3 right-3 z-[500] bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg p-1.5 shadow-md hover:bg-white transition-colors"
            title="View fullscreen"
          >
            <Maximize2 size={15} className="text-gray-600" />
          </button>
        </div>

        {/* Office Check-in Fullscreen Modal */}
        {officeFullscreen && (
          <div className="fixed inset-0 z-[80] flex flex-col bg-gray-900">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-brand-400" />
                <span className="text-sm font-semibold text-white">Check-in Location</span>
                {geofenceViolation ? (
                  <span className="text-xs px-2 py-0.5 bg-red-900/60 text-red-300 rounded-full border border-red-700">Outside Geofence</span>
                ) : geofenceCoords ? (
                  <span className="text-xs px-2 py-0.5 bg-emerald-900/60 text-emerald-300 rounded-full border border-emerald-700">Inside Approved Zone</span>
                ) : null}
              </div>
              <button
                onClick={() => setOfficeFullscreen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs transition-colors"
              >
                <Minimize2 size={14} />
                Exit Fullscreen
              </button>
            </div>
            <div className="flex-1">
              <MapContainer
                center={[checkInLoc.lat, checkInLoc.lng]}
                zoom={16}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OSM"
                />
                <CircleMarker
                  center={[checkInLoc.lat, checkInLoc.lng]}
                  radius={10}
                  pathOptions={{ fillColor: '#4f46e5', color: '#fff', weight: 2, fillOpacity: 0.9 }}
                >
                  <Popup>
                    <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                      <strong>📍 Check-in Point</strong>
                      <br />{Number(checkInLoc.lat).toFixed(5)}, {Number(checkInLoc.lng).toFixed(5)}
                    </div>
                  </Popup>
                </CircleMarker>
                {geofenceCoords?.lat && (
                  <Circle
                    center={[geofenceCoords.lat, geofenceCoords.lng]}
                    radius={geofence?.radiusMeters || 200}
                    pathOptions={{ color: geofenceViolation ? '#ef4444' : '#4f46e5', fillOpacity: 0.1 }}
                  />
                )}
              </MapContainer>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
