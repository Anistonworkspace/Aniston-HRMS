import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface Props {
  lat: number;
  lng: number;
  name: string;
}

export default function GeoLocationMiniMap({ lat, lng, name }: Props) {
  return (
    <MapContainer center={[lat, lng]} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
      <CircleMarker
        center={[lat, lng]}
        radius={12}
        pathOptions={{ fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 0.9 }}
      >
        <Popup>
          <div style={{ fontSize: 11, lineHeight: 1.6 }}>
            <strong>📍 {name}</strong><br />
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </div>
        </Popup>
      </CircleMarker>
    </MapContainer>
  );
}
