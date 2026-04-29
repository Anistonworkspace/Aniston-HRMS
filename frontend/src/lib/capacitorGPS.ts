/**
 * capacitorGPS.ts — Unified GPS layer for Aniston HRMS
 *
 * Native Android (Capacitor APK / Play Store):
 *   - Uses @capacitor-community/background-geolocation which starts a foreground
 *     service with a persistent notification. This keeps the Android process alive
 *     when the screen is off or the app is minimised, providing true background GPS.
 *   - Falls back to @capacitor/geolocation for non-watch calls (getCurrentPosition).
 *
 * Native iOS (Capacitor):
 *   - Uses @capacitor/geolocation watchPosition (same as before).
 *   - iOS allows location updates in background if the "Location Updates" background
 *     mode is enabled in the Info.plist (handled by the Geolocation plugin).
 *
 * Browser / PWA / TWA:
 *   - Falls back to navigator.geolocation.
 *   - Background tracking is NOT possible — Wake Lock keeps the screen on as a
 *     best-effort workaround. FieldSalesView shows a "keep screen on" warning.
 */

import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

// Lazily imported so the web bundle doesn't fail to load when the plugin
// is not present (browser builds don't include native modules).
// Promise cache ensures concurrent callers share the same import, not race.
let _bgGeoPromise: Promise<typeof import('@capacitor-community/background-geolocation')> | null = null;
function getBgGeo() {
  if (!_bgGeoPromise) {
    _bgGeoPromise = import('@capacitor-community/background-geolocation').catch((err) => {
      // Reset cache so the next caller retries the import rather than receiving
      // the same rejected promise forever (e.g. after a hot-reload or plugin load race)
      _bgGeoPromise = null;
      throw err;
    });
  }
  return _bgGeoPromise;
}

export const isNativeAndroid =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const isNativeIOS =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export const isNative = Capacitor.isNativePlatform();

export interface GPSPosition {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
}

function toGPSPosition(pos: Position): GPSPosition {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: pos.coords.speed ?? null,
    timestamp: pos.timestamp,
  };
}

/**
 * Request all required location permissions.
 * On Android 10+ requests ACCESS_BACKGROUND_LOCATION ("Allow all the time").
 * Returns true if at least foreground location was granted.
 */
export async function requestNativePermissions(): Promise<boolean> {
  if (!isNative) return true;

  try {
    const current = await Geolocation.checkPermissions();

    if (current.location === 'granted' || current.coarseLocation === 'granted') {
      if (isNativeAndroid) {
        try {
          await (Geolocation as any).requestPermissions({
            permissions: ['location', 'background_location'],
          });
        } catch { /* older API levels — fine */ }
      }
      return true;
    }

    const result = await Geolocation.requestPermissions({ permissions: ['location'] } as any);
    const granted = result.location === 'granted' || result.coarseLocation === 'granted';

    if (granted && isNativeAndroid) {
      try {
        await (Geolocation as any).requestPermissions({
          permissions: ['location', 'background_location'],
        });
      } catch { /* older API levels */ }
    }

    return granted;
  } catch {
    return false;
  }
}

/**
 * Get a single fresh GPS fix.
 */
export async function getCurrentPosition(): Promise<GPSPosition> {
  if (isNative) {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 30000,
    });
    return toGPSPosition(pos);
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      }),
      reject,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  });
}

/**
 * Start watching position.
 *
 * On native Android: uses BackgroundGeolocation.addWatcher() which starts a
 *   foreground service. GPS fires even when screen is off / app is minimised.
 *   The user sees a persistent "Aniston HRMS — Field GPS Active" notification
 *   while tracking is running (required by Android 8+).
 *
 * On native iOS: uses Geolocation.watchPosition() (continuous updates).
 *
 * On web/PWA: uses navigator.geolocation.watchPosition() (foreground only).
 *
 * Returns an opaque watchId string used to stop tracking with clearWatch().
 */
export async function watchPosition(
  onPosition: (pos: GPSPosition) => void,
  onError: (err: { code?: number; message: string }) => void,
  trackingIntervalMinutes = 60,
): Promise<string | number> {

  // ── Native Android: BackgroundGeolocation foreground service ────────────────
  if (isNativeAndroid) {
    try {
      const { BackgroundGeolocation } = await getBgGeo();
      const watchId = await BackgroundGeolocation.addWatcher(
        {
          // Foreground service notification (Android 8+ requirement)
          backgroundMessage: `Location recorded every ${trackingIntervalMinutes >= 60 ? `${trackingIntervalMinutes / 60}h` : `${trackingIntervalMinutes} min`}`,
          backgroundTitle: 'Aniston HRMS — Field GPS Active',
          // Request permissions inline if not yet granted
          requestPermissions: true,
          // Accept any fresh fix (distanceFilter: 0 = no movement threshold)
          stale: false,
          distanceFilter: 0,
        },
        (position, error) => {
          if (error) {
            onError({ code: (error as any).code, message: error.message ?? 'GPS error' });
            return;
          }
          if (position) {
            onPosition({
              lat: position.latitude,
              lng: position.longitude,
              accuracy: position.accuracy,
              speed: position.speed ?? null,
              timestamp: position.time,
            });
          }
        }
      );
      return watchId;
    } catch (err: any) {
      // Plugin not available (e.g. dev build without native sync) — fall through
      console.warn('BackgroundGeolocation unavailable, falling back to standard GPS:', err?.message);
    }
  }

  // ── Native iOS: standard Capacitor geolocation ──────────────────────────────
  if (isNativeIOS) {
    const watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30000 },
      (pos, err) => {
        if (err) { onError({ message: err.message ?? 'GPS error' }); return; }
        if (pos) onPosition(toGPSPosition(pos));
      }
    );
    return watchId;
  }

  // ── Browser / PWA fallback ───────────────────────────────────────────────────
  return navigator.geolocation.watchPosition(
    (pos) => onPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      timestamp: pos.timestamp,
    }),
    (err) => onError({ code: err.code, message: err.message }),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
  );
}

/**
 * Stop watching position.
 * Must be called with the id returned by watchPosition().
 */
export async function clearWatch(watchId: string | number): Promise<void> {
  if (isNativeAndroid) {
    try {
      const { BackgroundGeolocation } = await getBgGeo();
      await BackgroundGeolocation.removeWatcher({ id: watchId as string });
      return;
    } catch {
      // Plugin not available — fall through to standard Capacitor
    }
  }

  if (isNative) {
    await Geolocation.clearWatch({ id: watchId as string });
  } else {
    navigator.geolocation.clearWatch(watchId as number);
  }
}
