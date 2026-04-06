import { MapContainer, TileLayer, Marker, Circle, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity, Flag, MapPin } from 'lucide-react';
import { cn, formatDate } from '../../../lib/utils';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MapSectionProps {
  checkInLoc: any;
  geofenceCoords: any;
  geofence: any;
  shiftType: string;
  gpsTrail: any[];
  selectedDate: string;
  geofenceViolation?: boolean;
}

export default function MapSection({ checkInLoc, geofenceCoords, geofence, shiftType, gpsTrail, selectedDate, geofenceViolation }: MapSectionProps) {
  // GPS trail map for field employees
  if (shiftType === 'FIELD' && gpsTrail.length > 0) {
    return (
      <div className="layer-card overflow-hidden">
        <div className="px-4 pt-3 pb-1.5 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Activity size={12} className="text-green-500" /> GPS Trail — {formatDate(selectedDate, 'long')}
            </h3>
            <p className="text-[10px] text-gray-400">{gpsTrail.length} points recorded</p>
          </div>
        </div>
        <div style={{ height: 280 }}>
          <MapContainer
            center={[gpsTrail[0]?.lat || gpsTrail[0]?.latitude || 28.6, gpsTrail[0]?.lng || gpsTrail[0]?.longitude || 77.2]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
            <Polyline
              positions={gpsTrail.map((p: any) => [p.lat || p.latitude, p.lng || p.longitude])}
              pathOptions={{ color: '#10b981', weight: 3 }}
            />
            <Marker position={[gpsTrail[0]?.lat || gpsTrail[0]?.latitude, gpsTrail[0]?.lng || gpsTrail[0]?.longitude]} />
            {gpsTrail.length > 1 && (
              <Marker position={[gpsTrail[gpsTrail.length - 1]?.lat || gpsTrail[gpsTrail.length - 1]?.latitude, gpsTrail[gpsTrail.length - 1]?.lng || gpsTrail[gpsTrail.length - 1]?.longitude]} />
            )}
          </MapContainer>
        </div>
      </div>
    );
  }

  // Check-in location map for office employees
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
        <div style={{ height: 200 }}>
          <MapContainer center={[checkInLoc.lat, checkInLoc.lng]} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
            <Marker position={[checkInLoc.lat, checkInLoc.lng]} />
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
    );
  }

  return null;
}
