import { useState, useEffect } from 'react';
import { X, MapPin, Navigation, Shield, Loader2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const employeeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const officeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

interface Props {
  isOpen: boolean;
  onClose: () => void;
  checkInData?: {
    employeeName?: string;
    latitude?: number;
    longitude?: number;
    checkInTime?: string;
    officeName?: string;
    officeLatitude?: number;
    officeLongitude?: number;
    geofenceRadius?: number;
    distanceFromOffice?: number;
    withinGeofence?: boolean;
  };
  officeLocations?: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    geofenceRadius: number;
  }>;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [map, points]);
  return null;
}

export default function GeofenceMapModal({ isOpen, onClose, checkInData, officeLocations = [] }: Props) {
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [loadingGPS, setLoadingGPS] = useState(false);

  if (!isOpen) return null;

  const empLat = checkInData?.latitude;
  const empLng = checkInData?.longitude;

  // Collect all map points for fitting bounds
  const allPoints: [number, number][] = [];
  if (empLat && empLng) allPoints.push([empLat, empLng]);
  officeLocations.forEach(loc => {
    if (loc.latitude && loc.longitude) allPoints.push([loc.latitude, loc.longitude]);
  });
  if (checkInData?.officeLatitude && checkInData?.officeLongitude) {
    allPoints.push([checkInData.officeLatitude, checkInData.officeLongitude]);
  }
  if (userPos) allPoints.push([userPos.lat, userPos.lng]);

  const defaultCenter: [number, number] = allPoints.length > 0 ? allPoints[0] : [28.6139, 77.209];

  const getCurrentLocation = () => {
    setLoadingGPS(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLoadingGPS(false); },
      () => { setLoadingGPS(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-brand-500" />
            <h3 className="font-display font-bold text-gray-900 text-sm">
              {checkInData?.employeeName ? `${checkInData.employeeName} — Check-in Location` : 'Geofence Map'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-400" /></button>
        </div>

        {/* Info strip */}
        {checkInData && (
          <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs">
            {checkInData.checkInTime && (
              <span className="text-gray-500">Check-in: <strong className="text-gray-700">{new Date(checkInData.checkInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</strong></span>
            )}
            {checkInData.officeName && (
              <span className="text-gray-500">Office: <strong className="text-gray-700">{checkInData.officeName}</strong></span>
            )}
            {checkInData.distanceFromOffice != null && (
              <span className="text-gray-500">Distance: <strong className={checkInData.withinGeofence ? 'text-emerald-600' : 'text-red-600'}>{Math.round(checkInData.distanceFromOffice)}m</strong></span>
            )}
            {checkInData.withinGeofence != null && (
              <span className={`flex items-center gap-1 font-semibold ${checkInData.withinGeofence ? 'text-emerald-600' : 'text-red-600'}`}>
                <Shield size={12} /> {checkInData.withinGeofence ? 'Inside Geofence' : 'Outside Geofence'}
              </span>
            )}
          </div>
        )}

        {/* Map */}
        <div className="flex-1 min-h-[400px] relative">
          <MapContainer center={defaultCenter} zoom={14} scrollWheelZoom={true}
            style={{ height: '100%', width: '100%', borderRadius: '0 0 1rem 1rem' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {allPoints.length > 0 && <FitBounds points={allPoints} />}

            {/* Employee check-in pin */}
            {empLat && empLng && (
              <Marker position={[empLat, empLng]} icon={employeeIcon}>
                <Popup>
                  <strong>{checkInData?.employeeName || 'Employee'}</strong><br />
                  Check-in location<br />
                  {empLat.toFixed(5)}, {empLng.toFixed(5)}
                </Popup>
              </Marker>
            )}

            {/* Office locations with geofence circles */}
            {officeLocations.map(loc => (
              loc.latitude && loc.longitude ? (
                <div key={loc.id}>
                  <Marker position={[loc.latitude, loc.longitude]} icon={officeIcon}>
                    <Popup><strong>{loc.name}</strong><br />Geofence: {loc.geofenceRadius}m</Popup>
                  </Marker>
                  <Circle center={[loc.latitude, loc.longitude]} radius={loc.geofenceRadius}
                    pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.1, weight: 2 }} />
                </div>
              ) : null
            ))}

            {/* Specific office from check-in data */}
            {checkInData?.officeLatitude && checkInData?.officeLongitude && (
              <>
                <Marker position={[checkInData.officeLatitude, checkInData.officeLongitude]} icon={officeIcon}>
                  <Popup><strong>{checkInData.officeName || 'Office'}</strong><br />Geofence: {checkInData.geofenceRadius || 200}m</Popup>
                </Marker>
                <Circle center={[checkInData.officeLatitude, checkInData.officeLongitude]} radius={checkInData.geofenceRadius || 200}
                  pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.1, weight: 2 }} />
              </>
            )}

            {/* User's current location */}
            {userPos && (
              <Marker position={[userPos.lat, userPos.lng]}>
                <Popup>Your current location</Popup>
              </Marker>
            )}
          </MapContainer>

          {/* My Location button */}
          <button onClick={getCurrentLocation} disabled={loadingGPS}
            className="absolute top-3 right-3 z-[1000] bg-white shadow-lg border border-gray-200 rounded-xl p-2.5 hover:bg-gray-50">
            {loadingGPS ? <Loader2 size={16} className="animate-spin text-gray-400" /> : <Navigation size={16} className="text-brand-600" />}
          </button>
        </div>

        {/* Legend */}
        <div className="px-5 py-2.5 border-t border-gray-100 flex items-center gap-5 text-[11px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded-full inline-block" /> Employee check-in</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded-full inline-block" /> Office location</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 border-2 border-indigo-400 rounded-full inline-block" /> Geofence zone</span>
        </div>
      </div>
    </div>
  );
}
