import { useState } from 'react';
import { MapPin, CheckCircle, XCircle, Loader2, RefreshCw, Home, Navigation, Map, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useGetHomeLocationRequestsQuery, useReviewHomeLocationRequestMutation } from '../workforce/workforceApi';
import { cn, formatDate } from '../../lib/utils';

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

interface MapPopupRequest {
  id: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  address?: string;
  status: string;
  employee: any;
  radiusMeters?: number;
}

function HomeLocationMapModal({ req, radiusMeters, onClose, onApprove, onReject, reviewing }: {
  req: MapPopupRequest;
  radiusMeters: number;
  onClose: () => void;
  onApprove: (radius: number, notes: string) => void;
  onReject: (notes: string) => void;
  reviewing: boolean;
}) {
  const [localRadius, setLocalRadius] = useState(radiusMeters);
  const [notes, setNotes] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
              {(req.employee?.firstName?.[0] || '') + (req.employee?.lastName?.[0] || '')}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {req.employee?.firstName} {req.employee?.lastName}
                <span className="text-gray-400 text-xs font-normal ml-2">{req.employee?.employeeCode}</span>
              </p>
              <p className="text-xs text-gray-400">Home Location Request</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Map */}
        <div style={{ height: 360 }}>
          <MapContainer
            center={[req.latitude, req.longitude]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[req.latitude, req.longitude]} />
            <Circle
              center={[req.latitude, req.longitude]}
              radius={localRadius}
              pathOptions={{ color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.15, weight: 2 }}
            />
            {req.accuracy && (
              <Circle
                center={[req.latitude, req.longitude]}
                radius={req.accuracy}
                pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.08, weight: 1, dashArray: '4' }}
              />
            )}
          </MapContainer>
        </div>

        {/* Info + actions */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Navigation size={11} className="text-indigo-400" />
              <span className="font-mono" data-mono>{req.latitude.toFixed(6)}, {req.longitude.toFixed(6)}</span>
            </span>
            {req.accuracy && <span>GPS accuracy: ±{Math.round(req.accuracy)}m</span>}
            {req.address && <span className="flex items-center gap-1"><MapPin size={11} />{req.address}</span>}
          </div>

          {req.status === 'PENDING' && (
            <div className="flex flex-wrap gap-3 items-end pt-1">
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Geofence radius (m)</label>
                <input
                  type="number" min={50} max={1000} value={localRadius}
                  onChange={(e) => setLocalRadius(Math.max(50, Math.min(1000, Number(e.target.value))))}
                  className="input-glass text-xs py-1.5 px-2 w-24"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="text-[10px] text-gray-400 block mb-1">Review notes (optional)</label>
                <input
                  type="text" placeholder="Notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input-glass text-xs py-1.5 px-2 w-full"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onApprove(localRadius, notes)}
                  disabled={reviewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-60"
                >
                  {reviewing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  Approve {localRadius}m geofence
                </button>
                <button
                  onClick={() => onReject(notes)}
                  disabled={reviewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  <XCircle size={12} /> Reject
                </button>
              </div>
            </div>
          )}

          {req.status === 'APPROVED' && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <CheckCircle size={12} /> Approved with {req.radiusMeters ?? 100}m geofence
            </p>
          )}
          {req.status === 'REJECTED' && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <XCircle size={12} /> Rejected
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function HomeLocationRequestsTab() {
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [radiusValues, setRadiusValues] = useState<Record<string, string>>({});
  const [mapPopupReq, setMapPopupReq] = useState<any | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const { data: res, isLoading, refetch } = useGetHomeLocationRequestsQuery(statusFilter ? { status: statusFilter } : undefined);
  const [reviewRequest] = useReviewHomeLocationRequestMutation();

  const requests: any[] = res?.data || [];

  const handleReview = async (id: string, action: 'APPROVED' | 'REJECTED', radiusOverride?: number, notesOverride?: string) => {
    setReviewingId(id);
    try {
      const radius = radiusOverride ?? (radiusValues[id] ? parseInt(radiusValues[id], 10) : undefined);
      const notes = notesOverride ?? reviewNotes[id]?.trim();
      if (action === 'APPROVED' && radius !== undefined && (isNaN(radius) || radius < 50 || radius > 1000)) {
        toast.error('Geofence radius must be between 50m and 1000m');
        return;
      }
      await reviewRequest({
        id,
        action,
        reviewNotes: notes || undefined,
        radiusMeters: action === 'APPROVED' ? radius : undefined,
      }).unwrap();
      toast.success(
        action === 'APPROVED'
          ? `Home location approved with ${radius ?? 100}m geofence`
          : 'Home location request rejected'
      );
      setReviewNotes(prev => { const n = { ...prev }; delete n[id]; return n; });
      setRadiusValues(prev => { const n = { ...prev }; delete n[id]; return n; });
      setMapPopupReq(null);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to update request');
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-display font-semibold text-gray-900">Home Location Requests</h2>
          <p className="text-sm text-gray-400 mt-0.5">Approve employee WFH home locations — creates a geofence for clock-in/out</p>
        </div>
        <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <RefreshCw size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              statusFilter === s ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            )}
            style={statusFilter === s ? { background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' } : {}}
          >
            {s === '' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
        </div>
      ) : requests.length === 0 ? (
        <div className="layer-card p-10 text-center">
          <Home size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No {statusFilter.toLowerCase() || ''} home location requests</p>
          <p className="text-xs text-gray-300 mt-1">Employees submit their home GPS from the Attendance page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req: any, i: number) => (
            <motion.div
              key={req.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="layer-card p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                    {(req.employee?.firstName?.[0] || '') + (req.employee?.lastName?.[0] || '')}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {req.employee?.firstName} {req.employee?.lastName}
                      <span className="text-gray-400 text-xs font-normal ml-2">{req.employee?.employeeCode}</span>
                      {req.employee?.department?.name && (
                        <span className="text-gray-400 text-xs font-normal ml-1">· {req.employee.department.name}</span>
                      )}
                    </p>
                    {/* Clickable coordinates — opens map popup */}
                    <button
                      onClick={() => setMapPopupReq(req)}
                      className="flex items-center gap-1.5 mt-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors group"
                      title="Click to view on map"
                    >
                      <Navigation size={11} className="text-indigo-400 group-hover:text-indigo-600" />
                      <span className="font-mono text-[11px] underline underline-offset-2 decoration-dotted" data-mono>
                        {req.latitude.toFixed(6)}, {req.longitude.toFixed(6)}
                      </span>
                      <Map size={11} className="opacity-60" />
                      {req.accuracy && (
                        <span className="text-gray-400 no-underline">· ±{Math.round(req.accuracy)}m</span>
                      )}
                    </button>
                    {req.address && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <MapPin size={10} /> {req.address}
                      </p>
                    )}
                    {req.status === 'APPROVED' && req.approvedGeofence && (
                      <p className="text-[11px] text-emerald-600 mt-0.5 flex items-center gap-1">
                        <CheckCircle size={10} /> Geofence: {req.approvedGeofence.radiusMeters}m radius approved
                      </p>
                    )}
                    <p className="text-[11px] text-gray-300 mt-1">{formatDate(req.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={cn('badge text-xs px-2 py-0.5 rounded-full', STATUS_STYLE[req.status])}>
                    {req.status}
                  </span>
                  {req.status === 'PENDING' && (
                    <div className="flex flex-col gap-1.5 w-full sm:w-56">
                      {/* Radius picker */}
                      <div>
                        <label className="text-[10px] text-gray-400 block mb-0.5">Geofence radius (m, default 100)</label>
                        <input
                          type="number"
                          min={50}
                          max={1000}
                          placeholder="100"
                          value={radiusValues[req.id] || ''}
                          onChange={(e) => setRadiusValues(prev => ({ ...prev, [req.id]: e.target.value }))}
                          className="input-glass text-xs py-1.5 px-2 w-full"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Notes (optional)"
                        value={reviewNotes[req.id] || ''}
                        onChange={(e) => setReviewNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                        className="input-glass text-xs py-1.5 px-2 w-full"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setMapPopupReq(req)}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors"
                        >
                          <Map size={11} /> View Map
                        </button>
                        <button
                          onClick={() => handleReview(req.id, 'APPROVED')}
                          disabled={reviewingId === req.id}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-medium hover:bg-emerald-600 transition-colors disabled:opacity-60"
                        >
                          {reviewingId === req.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                        </button>
                        <button
                          onClick={() => handleReview(req.id, 'REJECTED')}
                          disabled={reviewingId === req.id}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-60"
                        >
                          {reviewingId === req.id ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
                        </button>
                      </div>
                    </div>
                  )}
                  {req.status !== 'PENDING' && (
                    <button
                      onClick={() => setMapPopupReq(req)}
                      className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1 transition-colors"
                    >
                      <Map size={11} /> View on map
                    </button>
                  )}
                  {req.status !== 'PENDING' && req.reviewNotes && (
                    <p className="text-[11px] text-gray-400 italic text-right max-w-[200px]">"{req.reviewNotes}"</p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Map popup modal */}
      <AnimatePresence>
        {mapPopupReq && (
          <HomeLocationMapModal
            req={mapPopupReq}
            radiusMeters={radiusValues[mapPopupReq.id] ? parseInt(radiusValues[mapPopupReq.id], 10) : 100}
            reviewing={reviewing}
            onClose={() => setMapPopupReq(null)}
            onApprove={(radius, notes) => handleReview(mapPopupReq.id, 'APPROVED', radius, notes)}
            onReject={(notes) => handleReview(mapPopupReq.id, 'REJECTED', undefined, notes)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
