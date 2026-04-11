import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Play, Square, Clock, Navigation, Wifi, WifiOff, Upload, Smartphone } from 'lucide-react';
import { useClockInMutation, useClockOutMutation, useStoreGPSTrailMutation } from './attendanceApi';
import { useWakeLock } from '../../hooks/useWakeLock';
import toast from 'react-hot-toast';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
const isPWA = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

const IOS_BANNER_KEY = 'aniston_ios_banner_dismissed';
function isBannerDismissed(): boolean {
  try {
    const ts = localStorage.getItem(IOS_BANNER_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < 7 * 24 * 60 * 60 * 1000; // 7 days
  } catch { return false; }
}
function dismissBanner() {
  try { localStorage.setItem(IOS_BANNER_KEY, String(Date.now())); } catch { /* ok */ }
}

interface GPSPoint {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number;
}

const GPS_INTERVAL = 60000; // 60 seconds
const SYNC_BATCH_SIZE = 30;
const GPS_BUFFER_KEY = 'aniston_gps_buffer';
const MAX_SYNC_RETRIES = 3;

// Persist/restore GPS buffer to survive crashes
function loadPersistedBuffer(): GPSPoint[] {
  try { const raw = localStorage.getItem(GPS_BUFFER_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
let _quotaWarned = false;
function persistBuffer(buffer: GPSPoint[], onQuotaFull?: () => void) {
  try {
    localStorage.setItem(GPS_BUFFER_KEY, JSON.stringify(buffer));
    _quotaWarned = false;
  } catch (e: any) {
    // QuotaExceededError — storage is full. Notify caller so it can sync immediately.
    if (!_quotaWarned) {
      _quotaWarned = true;
      onQuotaFull?.();
    }
  }
}
function clearPersistedBuffer() {
  try { localStorage.removeItem(GPS_BUFFER_KEY); } catch { /* ok */ }
}

export default function FieldSalesView({ todayStatus }: { todayStatus: any }) {
  const [isTracking, setIsTracking] = useState(false);
  const [points, setPoints] = useState<GPSPoint[]>([]);
  const [currentPos, setCurrentPos] = useState<GPSPoint | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [gpsPaused, setGpsPaused] = useState(false); // iOS background pause indicator
  const [bannerVisible, setBannerVisible] = useState(!isBannerDismissed());
  const watchIdRef = useRef<number | null>(null);
  const bufferRef = useRef<GPSPoint[]>(loadPersistedBuffer());
  const syncRetryRef = useRef(0);
  const wakeLock = useWakeLock();

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

  // Sync buffered points when online — with retry limit and localStorage persistence
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
      syncRetryRef.current = 0; // reset on success
      persistBuffer(bufferRef.current);
      if (bufferRef.current.length === 0) clearPersistedBuffer();
    } catch {
      // Put back on failure
      bufferRef.current.unshift(...batch);
      syncRetryRef.current++;
      persistBuffer(bufferRef.current);
      if (syncRetryRef.current >= MAX_SYNC_RETRIES) {
        toast.error('GPS sync failed after multiple attempts. Data saved locally.');
        syncRetryRef.current = 0;
      }
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
      // Activate wake lock to keep GPS alive in background (iOS fix)
      await wakeLock.request();

      // Clock in with a guaranteed-fresh position (maximumAge: 0 = no cache allowed)
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,       // NEVER accept stale GPS for attendance marking
          timeout: 30000,
        })
      );

      if (!isCheckedIn) {
        await clockIn({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          gpsTimestamp: new Date(pos.timestamp).toISOString(),
          source: 'MANUAL_APP',
        }).unwrap();
        toast.success('Field day started!');
      }

      setIsTracking(true);
      setGpsPaused(false);

      // Start watching position
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          setGpsPaused(false); // position resumed after any pause
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
          // Pass syncPoints as quota-full callback so storage never silently drops data
          persistBuffer(bufferRef.current, () => {
            toast('GPS storage full — syncing to server now', { icon: '⚠️' });
            syncPoints();
          });

          // Auto-sync when buffer reaches batch size
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

    // Release wake lock
    wakeLock.release();

    // Sync remaining points
    await syncPoints();

    try {
      await clockOut({
        latitude: currentPos?.lat,
        longitude: currentPos?.lng,
      }).unwrap();
      toast.success('Field day ended!');
      setIsTracking(false);
      clearPersistedBuffer();
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

  // iOS foreground recovery: detect GPS pause + grab fresh fix when user returns to app
  const lastVisibleRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!isTracking) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lastVisibleRef.current = Date.now();
      }
      if (document.visibilityState === 'visible' && isTracking) {
        const pausedMs = Date.now() - lastVisibleRef.current;
        // If app was in background > 3 min, GPS was likely paused on iOS
        if (isIOS && pausedMs > 3 * 60 * 1000) {
          setGpsPaused(true);
          toast(`GPS was paused for ${Math.round(pausedMs / 60000)} min while phone was locked.\nKeep screen on for uninterrupted tracking.`,
            { icon: '📍', duration: 5000 });
        }
        // Grab a fresh position to fill the gap
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setGpsPaused(false);
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
            persistBuffer(bufferRef.current, () => syncPoints());
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        if (isOnline && bufferRef.current.length > 0) syncPoints();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isTracking, isOnline, syncPoints]);

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
      {/* iOS PWA install prompt — shown once per 7 days, dismissable */}
      {isIOS && !isPWA && bannerVisible && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-800">Install for best GPS tracking</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Tap <strong>Share →</strong> "Add to Home Screen" for reliable background GPS and notifications on iPhone.
            </p>
          </div>
          <button
            onClick={() => { dismissBanner(); setBannerVisible(false); }}
            className="text-blue-400 hover:text-blue-600 p-1 flex-shrink-0"
            aria-label="Dismiss"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* iOS GPS paused warning — shown when phone was locked during tracking */}
      {isIOS && gpsPaused && isTracking && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
          <Navigation className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700 font-medium">
            GPS paused while screen was locked. Keep screen on for continuous trail.
          </p>
        </div>
      )}

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

      {/* Live Trail Map */}
      {points.length > 0 && (
        <div className="layer-card overflow-hidden" style={{ height: 200 }}>
          <div className="w-full h-full bg-gray-100 flex items-center justify-center relative">
            {/* Simple canvas-based trail visualization */}
            <canvas
              ref={(canvas) => {
                if (!canvas || points.length < 2) return;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetHeight;
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const lats = points.map(p => p.lat);
                const lngs = points.map(p => p.lng);
                const minLat = Math.min(...lats), maxLat = Math.max(...lats);
                const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
                const pad = 20;
                const w = canvas.width - pad * 2, h = canvas.height - pad * 2;
                const latRange = maxLat - minLat || 0.001, lngRange = maxLng - minLng || 0.001;

                ctx.strokeStyle = '#4f46e5';
                ctx.lineWidth = 2;
                ctx.beginPath();
                points.forEach((p, i) => {
                  const x = pad + ((p.lng - minLng) / lngRange) * w;
                  const y = pad + ((maxLat - p.lat) / latRange) * h;
                  i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                });
                ctx.stroke();

                // Draw current position dot
                const last = points[points.length - 1];
                const cx = pad + ((last.lng - minLng) / lngRange) * w;
                const cy = pad + ((maxLat - last.lat) / latRange) * h;
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(cx, cy, 5, 0, Math.PI * 2);
                ctx.fill();
              }}
              className="w-full h-full"
            />
            <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] text-gray-500 font-medium">
              Live Trail — {points.length} points
            </div>
          </div>
        </div>
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
              {new Date(currentPos.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
