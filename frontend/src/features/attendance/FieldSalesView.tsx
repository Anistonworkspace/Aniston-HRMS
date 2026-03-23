import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Play, Square, Clock, Navigation, Wifi, WifiOff, Upload } from 'lucide-react';
import { useClockInMutation, useClockOutMutation, useStoreGPSTrailMutation } from './attendanceApi';
import toast from 'react-hot-toast';

interface GPSPoint {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number;
}

const GPS_INTERVAL = 60000; // 60 seconds
const SYNC_BATCH_SIZE = 30;

export default function FieldSalesView({ todayStatus }: { todayStatus: any }) {
  const [isTracking, setIsTracking] = useState(false);
  const [points, setPoints] = useState<GPSPoint[]>([]);
  const [currentPos, setCurrentPos] = useState<GPSPoint | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const watchIdRef = useRef<number | null>(null);
  const bufferRef = useRef<GPSPoint[]>([]);

  const [clockIn, { isLoading: isClockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: isClockingOut }] = useClockOutMutation();
  const [storeTrail] = useStoreGPSTrailMutation();

  const isCheckedIn = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync buffered points when online
  const syncPoints = useCallback(async () => {
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current.splice(0, SYNC_BATCH_SIZE);
    try {
      await storeTrail({
        points: batch.map(p => ({
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy,
          speed: p.speed || null,
          timestamp: new Date(p.timestamp).toISOString(),
        })),
      }).unwrap();
    } catch {
      // Put back on failure
      bufferRef.current.unshift(...batch);
    }
  }, [storeTrail]);

  useEffect(() => {
    if (isOnline && bufferRef.current.length > 0) {
      syncPoints();
    }
  }, [isOnline, syncPoints]);

  const startTracking = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }

    try {
      // Clock in first
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true })
      );

      if (!isCheckedIn) {
        await clockIn({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          source: 'MANUAL_APP',
        }).unwrap();
        toast.success('Field day started!');
      }

      setIsTracking(true);

      // Start watching position
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const point: GPSPoint = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || undefined,
            timestamp: Date.now(),
          };
          setCurrentPos(point);
          setPoints(prev => [...prev, point]);
          bufferRef.current.push(point);

          // Auto-sync when buffer is full
          if (bufferRef.current.length >= SYNC_BATCH_SIZE && isOnline) {
            syncPoints();
          }
        },
        (err) => {
          if (import.meta.env.DEV) console.error('GPS error:', err);
        },
        { enableHighAccuracy: true, maximumAge: GPS_INTERVAL, timeout: 30000 }
      );
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to start tracking');
    }
  };

  const stopTracking = async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Sync remaining points
    await syncPoints();

    try {
      await clockOut({
        latitude: currentPos?.lat,
        longitude: currentPos?.lng,
      }).unwrap();
      toast.success('Field day ended!');
      setIsTracking(false);
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to end tracking');
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Calculate distance and visits
  const totalDistance = points.length > 1
    ? points.reduce((total, point, i) => {
        if (i === 0) return 0;
        const prev = points[i - 1];
        const R = 6371;
        const dLat = (point.lat - prev.lat) * Math.PI / 180;
        const dLon = (point.lng - prev.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(point.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return total + R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }, 0)
    : 0;

  return (
    <div className="space-y-4">
      <div className="layer-card p-5">
        <h3 className="text-lg font-display font-bold text-gray-900 mb-1">Field Sales Tracking</h3>
        <p className="text-sm text-gray-400 mb-4">GPS trail is recorded every 60 seconds while active.</p>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            {isOnline ? (
              <><Wifi className="w-4 h-4 text-emerald-500" /><span className="text-emerald-600">Online</span></>
            ) : (
              <><WifiOff className="w-4 h-4 text-red-500" /><span className="text-red-600">Offline (data buffered)</span></>
            )}
          </div>
          {bufferRef.current.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-amber-600">
              <Upload className="w-4 h-4" /> {bufferRef.current.length} pending sync
            </div>
          )}
        </div>

        {/* Main Action */}
        {!isTracking ? (
          <button
            onClick={startTracking}
            disabled={isClockingIn}
            className="w-full py-4 rounded-xl bg-emerald-600 text-white font-medium text-lg flex items-center justify-center gap-3 hover:bg-emerald-700 transition-colors"
          >
            <Play className="w-6 h-6" /> Start Field Day
          </button>
        ) : (
          <button
            onClick={stopTracking}
            disabled={isClockingOut}
            className="w-full py-4 rounded-xl bg-red-600 text-white font-medium text-lg flex items-center justify-center gap-3 hover:bg-red-700 transition-colors"
          >
            <Square className="w-6 h-6" /> End Field Day
          </button>
        )}
      </div>

      {/* Live Stats */}
      {isTracking && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-3 gap-3">
          <div className="stat-card text-center">
            <p className="text-2xl font-display font-bold text-gray-900" data-mono>{points.length}</p>
            <p className="text-xs text-gray-400">GPS Points</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-2xl font-display font-bold text-gray-900" data-mono>{totalDistance.toFixed(1)}</p>
            <p className="text-xs text-gray-400">km Traveled</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-2xl font-display font-bold text-gray-900" data-mono>
              {currentPos ? `±${Math.round(currentPos.accuracy)}m` : '—'}
            </p>
            <p className="text-xs text-gray-400">Accuracy</p>
          </div>
        </motion.div>
      )}

      {/* Current Location */}
      {currentPos && (
        <div className="layer-card p-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Navigation className="w-4 h-4 text-brand-500" />
            <span className="font-mono text-xs" data-mono>
              {currentPos.lat.toFixed(6)}, {currentPos.lng.toFixed(6)}
            </span>
            <span className="text-gray-400 ml-auto">
              {new Date(currentPos.timestamp).toLocaleTimeString('en-IN')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
