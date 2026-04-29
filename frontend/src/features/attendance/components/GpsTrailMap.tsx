import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(L.latLngBounds(positions), { padding: [24, 24] });
    else if (positions.length === 1) map.setView(positions[0], 15);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]);
  return null;
}

function fmtTime(ts: any) {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function fmtDur(mins: number) {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

interface Props {
  points: any[];
  visits: any[];
}

export default function GpsTrailMap({ points, visits }: Props) {
  const positions: [number, number][] = points.map((p: any) => [Number(p.lat), Number(p.lng)]);

  if (positions.length === 0) return null;

  return (
    <MapContainer center={positions[0]} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
      <FitBounds positions={positions} />

      {/* Trail polyline */}
      <Polyline positions={positions} pathOptions={{ color: '#6366f1', weight: 3, opacity: 0.7 }} />

      {/* GPS point markers */}
      {points.map((p: any, i: number) => {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        const isFirst = i === 0;
        const isLast = i === points.length - 1;
        const color = isFirst ? '#10b981' : isLast ? '#ef4444' : '#6366f1';
        const radius = isFirst || isLast ? 9 : 4;
        return (
          <CircleMarker key={i} center={[lat, lng]} radius={radius}
            pathOptions={{ fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.9 }}>
            <Popup>
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                <strong>{isFirst ? '🟢 Start' : isLast ? '🔴 End' : `📍 #${i + 1}`}</strong><br />
                🕐 {fmtTime(p.timestamp)}<br />
                {lat.toFixed(5)}, {lng.toFixed(5)}<br />
                {p.accuracy != null && <>🎯 ±{Math.round(Number(p.accuracy))}m<br /></>}
                {p.speed != null && <>🚀 {(Number(p.speed) * 3.6).toFixed(1)} km/h</>}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Significant visit stops (≥60 min) — red ring */}
      {visits.filter((v: any) => v.isSignificant).map((v: any, i: number) => (
        <CircleMarker key={`sig-${i}`} center={[Number(v.lat), Number(v.lng)]} radius={18}
          pathOptions={{ fillColor: '#ef4444', color: '#dc2626', weight: 2, fillOpacity: 0.2 }}>
          <Popup>
            <div style={{ fontSize: 11, lineHeight: 1.7, minWidth: 160 }}>
              <strong>🔴 {v.customName || v.locationName || `Named Stop ${i + 1}`}</strong><br />
              ⏱ {fmtDur(v.durationMinutes)}<br />
              {fmtTime(v.startTime)} → {fmtTime(v.endTime)}<br />
              {Number(v.lat).toFixed(5)}, {Number(v.lng).toFixed(5)}
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {/* Brief visit stops (<60 min) — orange ring */}
      {visits.filter((v: any) => !v.isSignificant).map((v: any, i: number) => (
        <CircleMarker key={`brief-${i}`} center={[Number(v.lat), Number(v.lng)]} radius={13}
          pathOptions={{ fillColor: '#f97316', color: '#ea580c', weight: 2, fillOpacity: 0.2 }}>
          <Popup>
            <div style={{ fontSize: 11, lineHeight: 1.6, minWidth: 140 }}>
              <strong>🟠 Stop {i + 1}</strong><br />
              ⏱ {fmtDur(v.durationMinutes)}<br />
              {fmtTime(v.startTime)} → {fmtTime(v.endTime)}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
