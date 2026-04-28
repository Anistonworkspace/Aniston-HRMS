import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Play, Square, Clock, Navigation, Wifi, WifiOff, Upload, Smartphone } from 'lucide-react';
import { useClockInMutation, useClockOutMutation, useStoreGPSTrailMutation } from './attendanceApi';
import { useWakeLock } from '../../hooks/useWakeLock';
import {
  isNative,
  isNativeAndroid,
  isNativeIOS,
  requestNativePermissions,
  getCurrentPosition,
  watchPosition,
  clearWatch,
} from '../../lib/capacitorGPS';
import toast from 'react-hot-toast';

const isIOS = isNativeIOS || (/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream);
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

const SYNC_BATCH_SIZE = 30;
const GPS_BUFFER_KEY = 'aniston_gps_buffer';
const MAX_SYNC_RETRIES = 3;
const MIN_INTERVAL_MS = 60_000; // never faster than 1 minute even if shift says so

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
  const [gpsPaused, setGpsPaused] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(!isBannerDismissed());
  const [gpsLostAt, setGpsLostAt] = useState<number | null>(null);
  const [gpsPauseNote, setGpsPauseNote] = useState('');
  const watchIdRef = useRef<string | number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferRef = useRef<GPSPoint[]>(loadPersistedBuffer());
  const syncRetryRef = useRef(0);
  const lastBufferedTimeRef = useRef<number>(0);
  const wakeLock = useWakeLock();

  const [clockIn, { isLoading: isClockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: isClockingOut }] = useClockOutMutation();
  const [storeTrail] = useStoreGPSTrailMutation();

  const isCheckedIn = todayStatus?.isCheckedIn && !todayStatus?.isCheckedOut;

  // Read configured interval from shift (default 60 min); enforce 1-min floor
  const trackingIntervalMs = useMemo(() => {
    const mins = todayStatus?.shift?.trackingIntervalMinutes || 60;
    return Math.max(mins * 60_000, MIN_INTERVAL_MS);
  }, [todayStatus?.shift?.trackingIntervalMinutes]);

  const trackingIntervalLabel = useMemo(() => {
    const ms = trackingIntervalMs;
    const mins = Math.round(ms / 60_000);
    return mins >= 60 ? `${mins / 60}h` : `${mins} min`;
  }, [trackingIntervalMs]);

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
      syncRetryRef.current = 0;
      persistBuffer(bufferRef.current);
      if (bufferRef.current.length === 0) clearPersistedBuffer();
    } catch {
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

  // ── Core: capture one GPS point and push to buffer ──────────────────────────
  const capturePoint = useCallback(async () => {
    try {
      const pos = await getCurrentPosition();
      const point: GPSPoint = {
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        speed: pos.speed ?? undefined,
        timestamp: pos.timestamp,
      };
      lastBufferedTimeRef.current = Date.now();
      setCurrentPos(point);
      setPoints(prev => [...prev, point]);
      bufferRef.current.push(point);
      persistBuffer(bufferRef.current, () => {
        toast('GPS storage full — syncing now', { icon: '⚠️' });
        syncPoints();
      });
      if (isOnline) syncPoints();
    } catch (err: any) {
      if (err?.code === 1) {
        toast.error('Location permission was revoked. Please re-enable GPS.', { duration: 6000 });
      }
      setGpsLostAt(prev => prev ?? Date.now());
    }
  }, [isOnline, syncPoints]);

  const startTracking = async () => {
    if (isNative) {
      const granted = await requestNativePermissions();
      if (!granted) {
        toast.error('Location permission is required for field tracking.');
        return;
      }
      if (isNativeAndroid) {
        toast('Background location granted — GPS tracks even when screen is off.', { icon: '📍', duration: 4000 });
      }
    } else if (!navigator.geolocation) {
      toast.error('Geolocation not supported on this device.');
      return;
    }

    try {
      // Keep screen on (web / iOS PWA) — native Android tracks in background without wake lock
      if (!isNativeAndroid) {
        await wakeLock.request();
      }

      // Capture initial position for clock-in
      const pos = await getCurrentPosition();

      if (!isCheckedIn) {
        await clockIn({
          latitude: pos.lat,
          longitude: pos.lng,
          accuracy: pos.accuracy,
          gpsTimestamp: new Date(pos.timestamp).toISOString(),
          source: 'MANUAL_APP',
        }).unwrap();
        toast.success('Field day started!');
      }

      setIsTracking(true);
      setGpsPaused(false);

      // Buffer the initial position immediately
      const initPoint: GPSPoint = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, speed: undefined, timestamp: pos.timestamp };
      lastBufferedTimeRef.current = Date.now();
      setCurrentPos(initPoint);
      setPoints([initPoint]);
      bufferRef.current.push(initPoint);
      persistBuffer(bufferRef.current);
      if (isOnline) syncPoints();

      // ── watchPosition ────────────────────────────────────────────────────────
      // Native Android: BackgroundGeolocation foreground service — fires even
      //   when screen is off / app is minimised. User sees a persistent
      //   notification: "Aniston HRMS — Field GPS Active".
      // Native iOS: Geolocation.watchPosition (continues while in background
      //   if Location background mode is enabled in Info.plist).
      // Web/PWA: navigator.geolocation.watchPosition (foreground only; screen
      //   must stay on via Wake Lock).
      const intervalMinsForPlugin = Math.round(trackingIntervalMs / 60_000);
      watchIdRef.current = await watchPosition(
        (position) => {
          setGpsPaused(false);
          setGpsLostAt(prev => {
            if (prev !== null) {
              const gapMinutes = Math.round((Date.now() - prev) / 60000);
              if (gapMinutes >= 5) toast(`GPS restored after ${gapMinutes} min gap.`, { icon: '📍' });
            }
            return null;
          });

          const point: GPSPoint = {
            lat: position.lat,
            lng: position.lng,
            accuracy: position.accuracy,
            speed: position.speed ?? undefined,
            timestamp: position.timestamp,
          };
          setCurrentPos(point);

          // Only buffer + sync at the configured interval
          const now = Date.now();
          if (now - lastBufferedTimeRef.current >= trackingIntervalMs) {
            lastBufferedTimeRef.current = now;
            setPoints(prev => [...prev, point]);
            bufferRef.current.push(point);
            persistBuffer(bufferRef.current, () => {
              toast('GPS storage full — syncing now', { icon: '⚠️' });
              syncPoints();
            });
            if (isOnline) syncPoints();
          }
        },
        (err) => {
          if (err.code === 1) {
            toast.error('Location permission was revoked. Please re-enable GPS.', { duration: 6000 });
          } else if (err.code === 2) {
            toast.error('GPS signal lost. Will resume automatically.', { duration: 4000 });
          }
          setGpsLostAt(prev => prev ?? Date.now());
        },
        intervalMinsForPlugin
      );

      // ── setInterval fallback (PWA/web only) ──────────────────────────────────
      // On native Android, the BackgroundGeolocation plugin fires natively in
      // the foreground service — JS timers are frozen in background anyway, so
      // setInterval is useless on native. Only run on web/PWA where watchPosition
      // may gap out (screen briefly locks, flaky signal, etc.).
      if (!isNativeAndroid) {
        intervalRef.current = setInterval(async () => {
          const now = Date.now();
          if (now - lastBufferedTimeRef.current < trackingIntervalMs - 10_000) return;
          await capturePoint();
        }, trackingIntervalMs);
      }

    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to start tracking');
    }
  };

  const stopTracking = async () => {
    if (watchIdRef.current !== null) {
      await clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    wakeLock.release();
    await syncPoints();

    try {
      await clockOut({
        latitude: currentPos?.lat,
        longitude: currentPos?.lng,
        notes: gpsPauseNote || undefined,
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
      if (watchIdRef.current !== null) clearWatch(watchIdRef.current);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, []);

  // ── visibilitychange: sync + capture on app resume ───────────────────────────
  // Covers two scenarios:
  //   1. iOS PWA: GPS is paused while screen is locked → grab fresh fix on return
  //   2. Android PWA: screen off for a while → fill gap with fresh position
  const lastVisibleRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!isTracking) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lastVisibleRef.current = Date.now();
      }
      if (document.visibilityState === 'visible') {
        const pausedMs = Date.now() - lastVisibleRef.current;
        if (isIOS && pausedMs > 3 * 60 * 1000) {
          setGpsPaused(true);
          const pauseMins = Math.round(pausedMs / 60000);
          toast(`GPS was paused for ${pauseMins} min while phone was locked.\nKeep screen on for uninterrupted tracking.`,
            { icon: '📍', duration: 5000 });
          setGpsPauseNote(prev =>
            prev ? `${prev}; [iOS GPS paused: ${pauseMins} min]` : `[iOS GPS paused: ${pauseMins} min]`
          );
        }
        // Always capture a fresh position on return to fill any gap
        capturePoint().then(() => setGpsPaused(false)).catch(() => {});
        if (isOnline && bufferRef.current.length > 0) syncPoints();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isTracking, isOnline, syncPoints, capturePoint]);

  // Calculate distance
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
      {/* iOS PWA install prompt */}
      {isIOS && !isPWA && !isNative && bannerVisible && (
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

      {/* iOS GPS paused warning */}
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
        <p className="text-sm text-gray-400 mb-2">
          Location recorded every <strong>{trackingIntervalLabel}</strong> as per your shift.
        </p>
        {isNativeAndroid && isTracking && (
          <div className="mb-3 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <Navigation className="w-3.5 h-3.5 flex-shrink-0" />
            Background GPS active — tracking continues when screen is off
          </div>
        )}
        {!isNativeAndroid && isTracking && (
          <div className="mb-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Navigation className="w-3.5 h-3.5 flex-shrink-0" />
            Keep screen on for uninterrupted GPS recording
          </div>
        )}

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

      {/* Next capture countdown */}
      {isTracking && lastBufferedTimeRef.current > 0 && (
        <NextCaptureCountdown lastCaptureAt={lastBufferedTimeRef.current} intervalMs={trackingIntervalMs} label={trackingIntervalLabel} />
      )}

      {/* Live Trail Map */}
      {points.length > 0 && (
        <div className="layer-card overflow-hidden" style={{ height: 200 }}>
          <div className="w-full h-full bg-gray-100 flex items-center justify-center relative">
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

                // Draw dots at each captured interval point
                points.forEach((p, i) => {
                  const x = pad + ((p.lng - minLng) / lngRange) * w;
                  const y = pad + ((maxLat - p.lat) / latRange) * h;
                  ctx.fillStyle = i === points.length - 1 ? '#ef4444' : '#4f46e5';
                  ctx.beginPath();
                  ctx.arc(x, y, i === points.length - 1 ? 5 : 3, 0, Math.PI * 2);
                  ctx.fill();
                });
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

// ── Next capture countdown widget ─────────────────────────────────────────────
function NextCaptureCountdown({ lastCaptureAt, intervalMs, label }: { lastCaptureAt: number; intervalMs: number; label: string }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - lastCaptureAt;
      const rem = Math.max(0, intervalMs - elapsed);
      setRemaining(rem);
    };
    tick();
    const id = setInterval(tick, 10_000); // update every 10 s
    return () => clearInterval(id);
  }, [lastCaptureAt, intervalMs]);

  const mins = Math.ceil(remaining / 60_000);
  if (remaining === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
      <Clock className="w-3.5 h-3.5" />
      Next location capture in ~{mins} min (interval: {label})
    </div>
  );
}
