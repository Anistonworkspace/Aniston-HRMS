import { useState } from 'react';
import { MapPin, CheckCircle, Clock, XCircle, Send, RefreshCw, Loader2, Home, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useGetMyHomeLocationRequestQuery, useSubmitHomeLocationRequestMutation } from '../../workforce/workforceApi';
import { cn } from '../../../lib/utils';
import { isNativeAndroid, getCurrentPosition } from '../../../lib/capacitorGPS';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border border-red-200',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING: <Clock size={14} className="text-amber-500" />,
  APPROVED: <CheckCircle size={14} className="text-emerald-500" />,
  REJECTED: <XCircle size={14} className="text-red-500" />,
};

export default function HomeLocationRequestPanel() {
  const { data: reqRes, isLoading } = useGetMyHomeLocationRequestQuery();
  const [submitRequest, { isLoading: submitting }] = useSubmitHomeLocationRequestMutation();
  const [gettingGps, setGettingGps] = useState(false);
  const [capturedCoords, setCapturedCoords] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [address, setAddress] = useState('');
  const [showForm, setShowForm] = useState(false);

  const request = reqRes?.data;
  const hasApproved = request?.status === 'APPROVED';
  const hasPending = request?.status === 'PENDING';

  const handleCaptureGPS = async () => {
    setGettingGps(true);
    try {
      if (isNativeAndroid) {
        const pos = await getCurrentPosition();
        setCapturedCoords({ latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy ?? 0 });
      } else if (navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
        );
        setCapturedCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
      } else {
        toast.error('Geolocation not supported on this device.');
      }
    } catch (err: any) {
      toast.error(err?.code === 1 ? 'Location access denied. Please enable GPS.' : 'Could not get your location. Try again.');
    } finally {
      setGettingGps(false);
    }
  };

  const handleSubmit = async () => {
    if (!capturedCoords) { toast.error('Please capture your GPS location first.'); return; }
    try {
      await submitRequest({ ...capturedCoords, address: address.trim() || undefined }).unwrap();
      toast.success('Home location request submitted! Awaiting admin approval.');
      setShowForm(false);
      setCapturedCoords(null);
      setAddress('');
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to submit request');
    }
  };

  return (
    <div className="layer-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Home size={16} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Home Location</p>
            <p className="text-xs text-gray-400">For WFH attendance marking</p>
          </div>
        </div>
        {!hasApproved && !hasPending && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}
          >
            {showForm ? 'Cancel' : 'Set Location'}
          </button>
        )}
        {(hasApproved || hasPending) && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex items-center gap-1"
          >
            <RefreshCw size={11} /> Update
          </button>
        )}
      </div>

      {/* Current status */}
      {!isLoading && request && (
        <div className={cn('rounded-lg px-3 py-2.5 mb-3 flex items-start gap-2', STATUS_STYLE[request.status])}>
          {STATUS_ICON[request.status]}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">
              {request.status === 'APPROVED' ? 'Home location approved' :
               request.status === 'PENDING' ? 'Request pending admin review' :
               'Request rejected'}
            </p>
            {request.status === 'APPROVED' && request.approvedGeofence && (
              <p className="text-[11px] mt-0.5 opacity-80">
                {request.latitude.toFixed(5)}, {request.longitude.toFixed(5)} · {request.approvedGeofence.radiusMeters}m radius
              </p>
            )}
            {request.status === 'REJECTED' && request.reviewNotes && (
              <p className="text-[11px] mt-0.5 opacity-80">Reason: {request.reviewNotes}</p>
            )}
            {request.address && (
              <p className="text-[11px] mt-0.5 opacity-70 truncate">{request.address}</p>
            )}
          </div>
        </div>
      )}

      {!isLoading && !request && !showForm && (
        <div className="text-center py-4">
          <MapPin size={28} className="mx-auto text-gray-200 mb-2" />
          <p className="text-xs text-gray-400">No home location set yet.</p>
          <p className="text-[11px] text-gray-300 mt-0.5">Tap "Set Location" to submit your home GPS for approval.</p>
        </div>
      )}

      {/* Submission form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 pt-3 space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <p className="text-xs text-blue-700 font-medium flex items-center gap-1.5">
                  <MapPin size={12} /> How it works
                </p>
                <p className="text-[11px] text-blue-600 mt-1">
                  Stand at your home, tap "Capture GPS", then submit for admin approval. A 100m geofence will be created around your location.
                </p>
              </div>

              {/* GPS capture */}
              <div>
                <button
                  onClick={handleCaptureGPS}
                  disabled={gettingGps}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed transition-colors text-sm font-medium disabled:opacity-60"
                  style={{ borderColor: 'var(--primary-color)', color: 'var(--primary-color)' }}
                >
                  {gettingGps ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
                  {gettingGps ? 'Getting GPS...' : capturedCoords ? 'Re-capture GPS' : 'Capture My GPS Location'}
                </button>
                {capturedCoords && (
                  <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-emerald-700">Location captured</p>
                      <p className="text-[11px] text-emerald-600">
                        {capturedCoords.latitude.toFixed(6)}, {capturedCoords.longitude.toFixed(6)}
                        {capturedCoords.accuracy ? ` · ±${Math.round(capturedCoords.accuracy)}m accuracy` : ''}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Address (optional) */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Address (optional)</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Flat 12, Green Residency, Mumbai"
                  className="input-glass w-full text-xs py-2"
                />
              </div>

              {!capturedCoords && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700">GPS location required. Please capture your location before submitting.</p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || !capturedCoords}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--primary-color)', color: 'var(--text-color-on-primary)' }}
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
