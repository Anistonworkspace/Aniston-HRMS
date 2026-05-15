import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Play, Square, Clock, Navigation, Wifi, WifiOff, Upload, Smartphone, Battery, AlertTriangle, RefreshCw, Shield, CheckCircle, Tag, X, Flag } from 'lucide-react';
import { useClockInMutation, useClockOutMutation, useStoreGPSTrailMutation, useRecordGPSConsentMutation, useGetGPSConsentStatusQuery, useGpsAlertMutation, useGpsHeartbeatMutation, useGpsTrackingStopMutation, useTagStopMutation } from './attendanceApi';
import { useWakeLock } from '../../hooks/useWakeLock';
import {
  isNative,
  isNativeAndroid,
  isNativeIOS,
  requestNativePermissions,
  getCurrentPosition,
  watchPosition,
  clearWatch,
  startNativeGpsService,
  stopNativeGpsService,
  updateNativeGpsToken,
  isNativeGpsRunning,
  requestBatteryOptimizationExemption,
  isBatteryOptimizationExempted,
} from '../../lib/capacitorGPS';
import type { RootState } from '../../app/store';
import toast from 'react-hot-toast';

/** Current consent version — bump this string to force re-consent after policy changes */
const GPS_CONSENT_VERSION = 'v1';

/** Key to track if battery optimization prompt was shown this session */
const BATTERY_PROMPT_KEY = 'aniston_battery_prompt_dismissed';

/** Key persisted once location permission was confirmed granted (avoids re-prompting) */
const LOCATION_PERM_GRANTED_KEY = 'aniston_location_perm_granted';

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
const MAX_BUFFER_POINTS = 500; // drop oldest when limit hit to prevent unbounded RAM growth

/**
 * Module-level singleton — survives React remounts and SPA navigation.
 * Without this, unmounting + remounting FieldSalesView (e.g. switching tabs and
 * coming back) would call watchPosition a second time, creating two concurrent
 * native foreground-service watchers that double-report every GPS fix.
 */
const _gpsWatcher: { watchId: string | number | null; isActive: boolean } = {
  watchId: null,
  isActive: false,
};

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
  const accessToken = useSelector((state: RootState) => state.auth.accessToken);
  const user = useSelector((state: RootState) => state.auth.user);

  // Heartbeat interval ref — cleared on stop/unmount
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs declared first — state initializers below must not reference them before this point
  const watchIdRef = useRef<string | number | null>(_gpsWatcher.watchId);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferRef = useRef<GPSPoint[]>(loadPersistedBuffer());

  const [isTracking, setIsTracking] = useState(_gpsWatcher.isActive);
  const [points, setPoints] = useState<GPSPoint[]>([]);
  const [currentPos, setCurrentPos] = useState<GPSPoint | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [gpsPaused, setGpsPaused] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(!isBannerDismissed());
  const [gpsLostAt, setGpsLostAt] = useState<number | null>(null);
  const [gpsPauseNote, setGpsPauseNote] = useState('');
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [showLocationDenied, setShowLocationDenied] = useState(false);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(bufferRef.current.length);
  const syncRetryRef = useRef(0);
  const lastBufferedTimeRef = useRef<number>(0);
  const wakeLock = useWakeLock();

  // End-of-day summary state
  const [showDaySummary, setShowDaySummary] = useState(false);
  const [daySummary, setDaySummary] = useState<{
    totalPoints: number; totalDistanceKm: number; fieldMinutes: number;
    syncedPoints: number; pendingPoints: number; gapMinutes: number;
  } | null>(null);

  // Stop labeling — employee can tag detected stops (current position)
  const [showStopLabel, setShowStopLabel] = useState(false);
  const [pendingStopLabel, setPendingStopLabel] = useState<string>('');

  const [clockIn, { isLoading: isClockingIn }] = useClockInMutation();
  const [clockOut, { isLoading: isClockingOut }] = useClockOutMutation();
  const [storeTrail] = useStoreGPSTrailMutation();
  const [recordConsent, { isLoading: isConsenting }] = useRecordGPSConsentMutation();
  const [tagStop, { isLoading: isTagging }] = useTagStopMutation();
  const { data: consentRes } = useGetGPSConsentStatusQuery();
  const consentData = consentRes?.data;
  const [sendGpsAlert] = useGpsAlertMutation();
  const [sendGpsHeartbeat] = useGpsHeartbeatMutation();
  const [sendGpsTrackingStop] = useGpsTrackingStopMutation();
  const hasConsented = consentData?.consented && consentData?.consentVersion === GPS_CONSENT_VERSION;

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

  // Sync rotated auth token into the native GPS service (token refreshes every ~15 min)
  useEffect(() => {
    if (isNativeAndroid && accessToken && _gpsWatcher.isActive) {
      updateNativeGpsToken(accessToken).catch(() => {});
    }
  }, [accessToken]);

  // Auto-start GPS when employee checks in on a field shift.
  // Handles: (1) already checked in on mount, (2) HR changes shift to FIELD mid-day.
  // startTrackingCore() skips clockIn when isCheckedIn is already true.
  // Uses isNativeGpsRunning() to query actual native service state, preventing
  // duplicate starts when the component remounts (e.g. tab switch + return).
  const autoStartRef = useRef(false);
  useEffect(() => {
    // Don't auto-start if employee has already checked out today
    if (!isCheckedIn || isCheckedOut) {
      autoStartRef.current = false;
      return;
    }
    // Module-level singleton says a watcher is already registered this session
    if (_gpsWatcher.isActive || isTracking) {
      setIsTracking(true);
      autoStartRef.current = true;
      return;
    }
    if (autoStartRef.current) return;
    if (consentData === undefined) return; // consent query still loading
    autoStartRef.current = true;

    // On Android: check native service state before starting — the module-level singleton
    // does not survive a process restart, so we must ask the OS directly.
    if (isNativeAndroid) {
      isNativeGpsRunning().then((alreadyRunning) => {
        if (alreadyRunning) {
          // Service is alive from a previous session — restore UI state without re-starting
          _gpsWatcher.isActive = true;
          setIsTracking(true);
          return;
        }
        if (!hasConsented) {
          setShowConsentDialog(true);
          return;
        }
        startTrackingCore();
      }).catch(() => {
        // isRunning() failed (older device/API) — fall through to normal start
        if (!hasConsented) { setShowConsentDialog(true); return; }
        startTrackingCore();
      });
    } else {
      if (!hasConsented) {
        setShowConsentDialog(true);
        return;
      }
      startTrackingCore();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckedIn, hasConsented, consentData, isTracking]);

  // Auto-stop GPS when employee clocks out — prevents tracking continuing after shift ends.
  const isCheckedOut = todayStatus?.isCheckedOut ?? false;
  const prevCheckedOutRef = useRef(isCheckedOut);
  useEffect(() => {
    if (!prevCheckedOutRef.current && isCheckedOut && isTracking) {
      stopTracking();
    }
    prevCheckedOutRef.current = isCheckedOut;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckedOut, isTracking]);

  // H1: On mount, load any persisted buffer and flush immediately if online.
  // This handles the case where the employee reopens the app while already connected
  // (no offline→online transition fires, so the sync effect never triggers).
  useEffect(() => {
    const persisted = loadPersistedBuffer();
    if (persisted.length > 0) {
      bufferRef.current = persisted;
      if (navigator.onLine) {
        // Defer slightly so syncPoints callback is stable after first render
        setTimeout(() => {
          if (bufferRef.current.length > 0) syncPoints();
        }, 1500);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Smart location permission check — only show the "Enable Location Access" popup
  // when the device location is genuinely denied/unavailable. Once granted, persist
  // in localStorage so the prompt never shows again unless permission is revoked.
  useEffect(() => {
    if (!isNative) return;
    // Already confirmed granted this install? Skip the async check.
    const alreadyGranted = localStorage.getItem(LOCATION_PERM_GRANTED_KEY);
    if (alreadyGranted) { setShowLocationDenied(false); return; }

    import('@capacitor/geolocation').then(({ Geolocation }) => {
      Geolocation.checkPermissions().then(status => {
        const granted = status.location === 'granted' || status.coarseLocation === 'granted';
        if (granted) {
          localStorage.setItem(LOCATION_PERM_GRANTED_KEY, '1');
          setShowLocationDenied(false);
        } else {
          setShowLocationDenied(true);
        }
      }).catch(() => {
        // Can't check — don't show popup, try anyway when they start tracking
      });
    });
  }, []);

  // When app resumes (AppState change), re-check if permission was just granted
  useEffect(() => {
    if (!isNative) return;
    const recheckOnResume = () => {
      import('@capacitor/geolocation').then(({ Geolocation }) => {
        Geolocation.checkPermissions().then(status => {
          const granted = status.location === 'granted' || status.coarseLocation === 'granted';
          if (granted) {
            localStorage.setItem(LOCATION_PERM_GRANTED_KEY, '1');
            setShowLocationDenied(false);
          }
        }).catch(() => {});
      });
    };
    document.addEventListener('resume', recheckOnResume);
    document.addEventListener('visibilitychange', recheckOnResume);
    return () => {
      document.removeEventListener('resume', recheckOnResume);
      document.removeEventListener('visibilitychange', recheckOnResume);
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
          speed: p.speed != null ? p.speed : undefined,
          timestamp: new Date(p.timestamp).toISOString(),
        })),
      }).unwrap();
      syncRetryRef.current = 0;
      setSyncFailed(false);
      persistBuffer(bufferRef.current);
      setPendingSyncCount(bufferRef.current.length);
      if (bufferRef.current.length === 0) clearPersistedBuffer();
    } catch {
      bufferRef.current.unshift(...batch);
      syncRetryRef.current++;
      persistBuffer(bufferRef.current);
      setPendingSyncCount(bufferRef.current.length);
      if (syncRetryRef.current >= MAX_SYNC_RETRIES) {
        setSyncFailed(true);
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
      // C5: drop oldest point when buffer exceeds limit to prevent unbounded RAM growth
      if (bufferRef.current.length >= MAX_BUFFER_POINTS) {
        bufferRef.current.shift();
      }
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

  // Called when employee accepts the consent dialog
  const handleConsentAccepted = async () => {
    try {
      await recordConsent({ consentVersion: GPS_CONSENT_VERSION }).unwrap();
      setShowConsentDialog(false);
      // Proceed to actually start tracking after consent
      await startTrackingCore();
    } catch {
      toast.error('Failed to save consent. Please try again.');
    }
  };

  const startTracking = async () => {
    // Consent gate: require explicit acceptance before starting GPS tracking
    if (!hasConsented) {
      setShowConsentDialog(true);
      return;
    }
    await startTrackingCore();
  };

  const startTrackingCore = async () => {
    // Concurrent watcher protection — if a watcher was already started (e.g. user
    // navigated away and back without stopping), restore local tracking state and bail.
    // Starting a second watcher would create duplicate foreground services on Android.
    if (_gpsWatcher.isActive) {
      setIsTracking(true);
      toast('GPS tracking already active — resuming.', { icon: '📍', duration: 3000 });
      return;
    }

    if (isNative) {
      const granted = await requestNativePermissions();
      if (!granted) {
        setShowLocationDenied(true);
        return;
      }
      // Permission confirmed — persist so we never show the prompt again unless revoked
      localStorage.setItem(LOCATION_PERM_GRANTED_KEY, '1');
      setShowLocationDenied(false);
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

      // H4: Warn if initial GPS accuracy is poor before any points are committed
      if (pos.accuracy > 100) {
        toast(`GPS signal is weak (±${Math.round(pos.accuracy)}m). Move to an open area for best accuracy. Tracking will still start.`, {
          icon: '⚠️',
          duration: 6000,
        });
      }

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

      // ── Native Android: start the Java ForegroundService ────────────────────
      // The service survives swipe-from-recents (android:stopWithTask="false").
      // It handles GPS posting, persistent notification, and heartbeats natively.
      // Geolocation.watchPosition below handles UI-only foreground updates.
      if (isNativeAndroid) {
        // Always use the hard-coded production origin on native builds.
        // import.meta.env.VITE_API_URL is undefined in a production APK (env vars are
        // baked at Vite build time; Capacitor native builds don't set them).
        // We strip /api suffix so the service can append /api/... paths itself.
        const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
        const backendBase = rawApiUrl
          ? rawApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
          : 'https://hr.anistonav.com';
        const intervalMins = todayStatus?.shift?.trackingIntervalMinutes;
        const attendanceRecordId = todayStatus?.record?.id || '';
        await startNativeGpsService({
          backendUrl: backendBase,
          authToken: accessToken || '',
          employeeId: user?.employeeId || '',
          orgId: user?.organizationId || '',
          attendanceId: attendanceRecordId,
          ...(intervalMins != null ? { trackingIntervalMinutes: intervalMins } : {}),
        }).catch((e: any) => console.warn('Native GPS service start failed:', e?.message));
      }

      // ── watchPosition (foreground UI updates) ────────────────────────────────
      // All platforms: fires when app is in foreground to keep the map/trail live.
      // Background GPS is handled by the native service on Android.
      const intervalMinsForPlugin = Math.round(trackingIntervalMs / 60_000);
      const newWatchId = await watchPosition(
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
            if (bufferRef.current.length >= MAX_BUFFER_POINTS) bufferRef.current.shift();
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
            // GPS permission revoked mid-tracking — alert HR immediately
            toast.error('Location permission was revoked. HR has been notified.', { duration: 8000 });
            sendGpsAlert({ alertType: 'PERMISSION_REVOKED' }).catch(() => {});
          } else if (err.code === 2) {
            toast.error('GPS signal lost. Will resume automatically.', { duration: 4000 });
          }
          setGpsLostAt(prev => prev ?? Date.now());
        },
        intervalMinsForPlugin,
      );
      // Register with singleton so remounts don't spawn a second watcher
      _gpsWatcher.watchId = newWatchId;
      _gpsWatcher.isActive = true;
      watchIdRef.current = newWatchId;

      // ── Heartbeat (web/PWA only — native service handles its own heartbeat) ──
      // Pings backend every 5 min so the force-stop monitor can detect gaps.
      if (!isNativeAndroid) {
        sendGpsHeartbeat().catch(() => {}); // immediate first ping
        heartbeatIntervalRef.current = setInterval(() => {
          sendGpsHeartbeat().catch(() => {});
        }, 5 * 60 * 1000);
      }

      // ── setInterval fallback (PWA/web only) ──────────────────────────────────
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

    // Show battery optimization prompt once per week after tracking starts on Android
    if (isNativeAndroid) {
      const dismissed = localStorage.getItem(BATTERY_PROMPT_KEY);
      if (!dismissed || Date.now() - Number(dismissed) > 7 * 24 * 60 * 60 * 1000) {
        // Check if already exempted — if so, skip the prompt entirely
        isBatteryOptimizationExempted().then(exempted => {
          if (!exempted) setTimeout(() => setShowBatteryPrompt(true), 3000);
          else localStorage.setItem(BATTERY_PROMPT_KEY, String(Date.now()));
        }).catch(() => setTimeout(() => setShowBatteryPrompt(true), 3000));
      }
    }
  };

  const stopTracking = async () => {
    const watchIdToStop = _gpsWatcher.watchId ?? watchIdRef.current;
    _gpsWatcher.watchId = null;
    _gpsWatcher.isActive = false;

    if (watchIdToStop !== null) {
      await clearWatch(watchIdToStop);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (heartbeatIntervalRef.current !== null) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    // Stop native GPS service (Android) and inform backend tracking ended
    if (isNativeAndroid) {
      stopNativeGpsService().catch(() => {});
    }
    sendGpsTrackingStop().catch(() => {}); // remove from Redis active-tracking set

    wakeLock.release();

    // Capture summary before flushing
    const totalPts = points.length;
    const distKm = totalDistance;
    const fieldMins = todayStatus?.record?.checkIn
      ? Math.round((Date.now() - new Date(todayStatus.record.checkIn).getTime()) / 60000)
      : 0;
    const pendingBefore = bufferRef.current.length;

    await syncPoints();

    if (!currentPos) {
      toast.error('No GPS position available. Please ensure location is enabled and try again.');
      return;
    }

    try {
      await clockOut({
        latitude: currentPos.lat,
        longitude: currentPos.lng,
      }).unwrap();

      const remaining = bufferRef.current.length;
      setDaySummary({
        totalPoints: totalPts,
        totalDistanceKm: distKm,
        fieldMinutes: fieldMins,
        syncedPoints: totalPts - remaining,
        pendingPoints: remaining,
        gapMinutes: gpsLostAt ? Math.round((Date.now() - gpsLostAt) / 60000) : 0,
      });
      setShowDaySummary(true);
      setIsTracking(false);

      if (remaining === 0) {
        clearPersistedBuffer();
      } else {
        toast(`${remaining} GPS points still pending sync — they'll upload next time you open the app.`, {
          icon: '📤', duration: 5000,
        });
      }
    } catch (err: any) {
      toast.error(err?.data?.error?.message || 'Failed to end tracking');
    }
  };

  // Cleanup on unmount — intentionally does NOT clear the GPS watcher.
  // The watcher must survive React unmount/remount caused by SPA navigation.
  // _gpsWatcher.isActive ensures the next mount restores state without a new watch.
  // The watcher is only torn down inside stopTracking() via the "End Field Day" button.
  useEffect(() => {
    return () => {
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

  // Guard: only FIELD or HYBRID shift employees may use this view.
  // Once todayStatus has loaded (not undefined), check shift type.
  const assignedShiftType = todayStatus?.shift?.shiftType;
  if (todayStatus !== undefined && assignedShiftType !== 'FIELD' && assignedShiftType !== 'HYBRID') {
    return (
      <div className="layer-card p-10 text-center">
        <Navigation size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-sm font-semibold text-gray-600">GPS Field Tracking Not Available</p>
        <p className="text-xs text-gray-400 mt-1">
          Live GPS tracking is only available for employees assigned to a <strong>Field (Live Tracking)</strong> or <strong>Hybrid WFH</strong> shift.
          {assignedShiftType
            ? ` Your current shift type is "${assignedShiftType}".`
            : ' You have no shift assigned for today.'}
        </p>
        <p className="text-xs text-gray-300 mt-2">Contact HR to update your shift assignment.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── End-of-Day Summary Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showDaySummary && daySummary && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          >
            <motion.div
              initial={{ y: 60, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 60, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 text-white">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-display font-bold text-lg flex items-center gap-2">
                    <Flag className="w-5 h-5" /> Field Day Complete!
                  </h3>
                  <button onClick={() => setShowDaySummary(false)} className="p-1 rounded-lg hover:bg-white/20">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-emerald-100 text-xs">Today's field activity summary</p>
              </div>
              <div className="p-5 grid grid-cols-2 gap-3">
                <SummaryCard label="GPS Points" value={String(daySummary.totalPoints)} icon="📍" />
                <SummaryCard label="Distance" value={`${daySummary.totalDistanceKm.toFixed(1)} km`} icon="🛣️" />
                <SummaryCard label="Time on Field" value={daySummary.fieldMinutes >= 60
                  ? `${Math.floor(daySummary.fieldMinutes / 60)}h ${daySummary.fieldMinutes % 60}m`
                  : `${daySummary.fieldMinutes}m`} icon="⏱️" />
                <SummaryCard label="Points Synced" value={`${daySummary.syncedPoints}/${daySummary.totalPoints}`}
                  icon={daySummary.pendingPoints === 0 ? '✅' : '⚠️'}
                  highlight={daySummary.pendingPoints > 0 ? 'amber' : 'green'} />
              </div>
              {daySummary.gapMinutes > 5 && (
                <div className="mx-5 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-700">
                    ⚠️ GPS gap detected near end of day ({daySummary.gapMinutes}m). HR will see this in the trail.
                  </p>
                </div>
              )}
              {daySummary.pendingPoints > 0 && (
                <div className="mx-5 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700">
                    {daySummary.pendingPoints} points still pending upload — open the app when online to sync.
                  </p>
                </div>
              )}
              <div className="px-5 pb-5">
                <button
                  onClick={() => setShowDaySummary(false)}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── GPS Consent Dialog ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showConsentDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-gray-900">Location Tracking Consent</h3>
                  <p className="text-xs text-gray-400">Required before field tracking begins</p>
                </div>
              </div>
              <div className="space-y-2 mb-5 text-sm text-gray-600">
                <p className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  Your GPS location is recorded during your field shift after clock-in.
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  HR and authorized managers can view your location trail for that day.
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  Tracking stops automatically when you clock out.
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  On the official Android app, tracking continues in background. On PWA/browser, screen must remain on.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConsentDialog(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConsentAccepted}
                  disabled={isConsenting}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60"
                >
                  {isConsenting ? 'Saving…' : 'I Agree — Start Tracking'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Location Permission Denied Popup (only when GPS is actually off) ── */}
      <AnimatePresence>
        {showLocationDenied && isNativeAndroid && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center"
            >
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-indigo-500" />
              </div>
              <h3 className="font-display font-bold text-gray-900 text-lg mb-2">Enable Location Access</h3>
              <p className="text-sm text-gray-500 mb-6">
                Location permission is required for field sales GPS tracking. Please enable location access in your device settings to continue.
              </p>
              <button
                onClick={async () => {
                  try {
                    const granted = await requestNativePermissions();
                    if (granted) {
                      localStorage.setItem(LOCATION_PERM_GRANTED_KEY, '1');
                      setShowLocationDenied(false);
                    } else {
                      // Permanently denied — open app settings via Capacitor native bridge
                      try {
                        const { Capacitor, registerPlugin } = await import('@capacitor/core');
                        if (Capacitor.isNativePlatform()) {
                          const NativeSettings = registerPlugin<any>('NativeSettings');
                          NativeSettings.openAppSettings?.().catch(() => {});
                        }
                      } catch { /* fallback: do nothing if plugin unavailable */ }
                    }
                  } catch { /* ok */ }
                }}
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors"
              >
                <Navigation className="w-4 h-4" /> Enable Location Access
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Battery Optimization Prompt (Android only, once per week) ─────── */}
      <AnimatePresence>
        {showBatteryPrompt && isNativeAndroid && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-amber-50 border border-amber-200 rounded-xl p-4"
          >
            <div className="flex items-start gap-3">
              <Battery className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800 mb-2">Allow Unrestricted Battery Access</p>
                <p className="text-xs text-amber-700 mb-3">
                  Samsung, Xiaomi, Oppo and OnePlus devices can kill background GPS tracking.
                  Tap below to exempt Aniston HRMS — takes one tap.
                </p>
                <button
                  onClick={async () => {
                    try {
                      const result = await requestBatteryOptimizationExemption();
                      if (result.alreadyExempted) {
                        toast.success('Battery optimization already disabled — GPS will track reliably.');
                      } else if (result.prompted) {
                        toast('Select "Allow" in the dialog to ensure uninterrupted GPS tracking.', { icon: '🔋', duration: 5000 });
                      }
                    } catch { /* ok */ }
                    localStorage.setItem(BATTERY_PROMPT_KEY, String(Date.now()));
                    setShowBatteryPrompt(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  Allow Unrestricted Battery — 1 tap
                </button>
              </div>
              <button
                onClick={() => {
                  localStorage.setItem(BATTERY_PROMPT_KEY, String(Date.now()));
                  setShowBatteryPrompt(false);
                }}
                className="text-amber-400 hover:text-amber-600 p-1 flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PWA/Browser Background Tracking Limitation Warning ───────────── */}
      {!isNativeAndroid && !isNativeIOS && isTracking && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-orange-800">
              Background GPS limited in browser/PWA
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              GPS tracking may pause when screen locks or app backgrounds. Keep screen on, or download the official Android app for uninterrupted background tracking.
            </p>
          </div>
        </div>
      )}

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

        {/* C6: Prominent offline banner — shown when tracking is active and device is offline */}
        {isTracking && !isOnline && (
          <div className="mb-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
            <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong className="block mb-0.5">You are offline</strong>
              GPS points are being saved on your device ({bufferRef.current.length} buffered) and will upload automatically when you reconnect. Do not force-close the app.
            </div>
          </div>
        )}

        {/* Status Indicators */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            {isOnline ? (
              <><Wifi className="w-4 h-4 text-emerald-500" /><span className="text-emerald-600">Online</span></>
            ) : (
              <><WifiOff className="w-4 h-4 text-red-500" /><span className="text-red-600">Offline — {pendingSyncCount} pts buffered</span></>
            )}
          </div>
          {isOnline && pendingSyncCount > 0 && !syncFailed && (
            <div className="flex items-center gap-1 text-sm text-amber-600">
              <Upload className="w-4 h-4" /> {pendingSyncCount} syncing…
            </div>
          )}
          {syncFailed && isOnline && (
            <button
              onClick={() => { syncRetryRef.current = 0; setSyncFailed(false); syncPoints(); }}
              className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1 hover:bg-red-100 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync failed — {pendingSyncCount} pts pending. Tap to retry.
            </button>
          )}
          {syncFailed && !isOnline && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              {pendingSyncCount} pts pending sync (will retry when online)
            </div>
          )}
        </div>

        {/* Main Action
            States:
            - isTracking true → Check Out button
            - not checked in → Check In button (triggers clock-in + GPS start)
            - checked in but GPS not yet running → auto-start useEffect is handling it; show spinner status only (no manual button) */}
        {isTracking ? (
          <button
            onClick={stopTracking}
            disabled={isClockingOut}
            className="w-full py-4 rounded-xl bg-red-600 text-white font-medium text-lg flex items-center justify-center gap-3 hover:bg-red-700 transition-colors"
          >
            {isClockingOut
              ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Square className="w-6 h-6" />
            }
            Check Out
          </button>
        ) : isCheckedIn ? (
          <div className="w-full py-4 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium text-base flex items-center justify-center gap-3">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            Starting background GPS…
          </div>
        ) : (
          <button
            onClick={startTracking}
            disabled={isClockingIn}
            className="w-full py-4 rounded-xl bg-emerald-600 text-white font-medium text-lg flex items-center justify-center gap-3 hover:bg-emerald-700 transition-colors"
          >
            {isClockingIn
              ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Play className="w-6 h-6" />
            }
            Check In
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
          <div className={`stat-card text-center ${currentPos && currentPos.accuracy > 100 ? 'border border-amber-300 bg-amber-50' : ''}`}>
            <p className={`text-2xl font-display font-bold ${currentPos && currentPos.accuracy > 100 ? 'text-amber-600' : 'text-gray-900'}`} data-mono>
              {currentPos ? `±${Math.round(currentPos.accuracy)}m` : '—'}
            </p>
            <p className="text-xs text-gray-400">Accuracy</p>
          </div>
        </motion.div>
      )}

      {/* GPS accuracy warning */}
      {isTracking && currentPos && currentPos.accuracy > 100 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          <span className="mt-0.5 flex-shrink-0">⚠️</span>
          <span>GPS accuracy is weak (±{Math.round(currentPos.accuracy)}m). Move to an open area for better signal. Recorded points may be inaccurate.</span>
        </div>
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

      {/* Current Location + Stop Label */}
      {currentPos && (
        <div className="layer-card p-4 text-sm space-y-2">
          <div className="flex items-center gap-2 text-gray-600">
            <Navigation className="w-4 h-4" style={{ color: 'var(--primary-color)' }} />
            <span className="font-mono text-xs" data-mono>
              {currentPos.lat.toFixed(6)}, {currentPos.lng.toFixed(6)}
            </span>
            <span className="text-gray-400 ml-auto">
              {new Date(currentPos.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </span>
          </div>

          {/* Stop labeling — employee can tag current stop with custom name */}
          {isTracking && !showStopLabel && (
            <button
              onClick={() => setShowStopLabel(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <Tag className="w-3.5 h-3.5" /> Tag this stop
            </button>
          )}
          {isTracking && showStopLabel && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pendingStopLabel}
                onChange={e => setPendingStopLabel(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && pendingStopLabel.trim() && currentPos) {
                    try {
                      await tagStop({ lat: currentPos.lat, lng: currentPos.lng, name: pendingStopLabel.trim(), timestamp: new Date(currentPos.timestamp).toISOString() }).unwrap();
                      toast.success(`Stop saved: ${pendingStopLabel.trim()}`, { icon: '📍' });
                    } catch { toast.error('Failed to save stop'); }
                    setShowStopLabel(false); setPendingStopLabel('');
                  }
                }}
                placeholder="e.g. Client Visit, Lunch…"
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none bg-white"
                autoFocus
              />
              <button
                disabled={isTagging || !pendingStopLabel.trim()}
                onClick={async () => {
                  if (!pendingStopLabel.trim() || !currentPos) return;
                  try {
                    await tagStop({ lat: currentPos.lat, lng: currentPos.lng, name: pendingStopLabel.trim(), timestamp: new Date(currentPos.timestamp).toISOString() }).unwrap();
                    toast.success(`Stop saved: ${pendingStopLabel.trim()}`, { icon: '📍' });
                  } catch { toast.error('Failed to save stop'); }
                  setShowStopLabel(false); setPendingStopLabel('');
                }}
                className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >{isTagging ? '…' : 'Save'}</button>
              <button onClick={() => { setShowStopLabel(false); setPendingStopLabel(''); }}
                className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, highlight }: {
  label: string; value: string; icon: string; highlight?: 'green' | 'amber';
}) {
  return (
    <div className={`rounded-xl p-3 text-center border ${
      highlight === 'amber' ? 'bg-amber-50 border-amber-200' :
      highlight === 'green' ? 'bg-emerald-50 border-emerald-200' :
      'bg-gray-50 border-gray-100'
    }`}>
      <p className="text-lg mb-0.5">{icon}</p>
      <p className={`text-base font-bold font-mono ${highlight === 'amber' ? 'text-amber-700' : highlight === 'green' ? 'text-emerald-700' : 'text-gray-900'}`} data-mono>{value}</p>
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
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
