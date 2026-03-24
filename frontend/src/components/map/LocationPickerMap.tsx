import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Maximize2, Minimize2 } from 'lucide-react';

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface LocationPickerMapProps {
  value: { lat: number; lng: number } | null;
  onChange: (coords: { lat: number; lng: number }) => void;
  radius?: number;
  height?: number;
  showFullscreen?: boolean;
}

function MapClickHandler({ onChange }: { onChange: (coords: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FlyToLocation({ coords }: { coords: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (coords) {
      map.flyTo([coords.lat, coords.lng], 15, { duration: 1 });
    }
  }, [coords?.lat, coords?.lng]);
  return null;
}

export default function LocationPickerMap({ value, onChange, radius = 200, height = 300, showFullscreen = true }: LocationPickerMapProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const center: [number, number] = value ? [value.lat, value.lng] : [20.5937, 78.9629];
  const zoom = value ? 15 : 5;

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden border border-gray-200" style={{ height: isFullscreen ? '100vh' : height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <MapClickHandler onChange={onChange} />
        <FlyToLocation coords={value} />
        {value && (
          <>
            <Marker
              position={[value.lat, value.lng]}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const latlng = e.target.getLatLng();
                  onChange({ lat: latlng.lat, lng: latlng.lng });
                },
              }}
            />
            <Circle
              center={[value.lat, value.lng]}
              radius={radius}
              pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.15 }}
            />
          </>
        )}
      </MapContainer>

      {showFullscreen && (
        <button onClick={toggleFullscreen}
          className="absolute top-2 right-2 z-[1000] bg-white rounded-lg p-2 shadow-md hover:bg-gray-50 transition-colors">
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      )}

      {!value && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500]">
          <p className="text-sm text-gray-500 bg-white/90 px-3 py-1.5 rounded-lg shadow-sm">Click on the map to set location</p>
        </div>
      )}
    </div>
  );
}
