/**
 * capacitorGPS.ts — Unified GPS layer for Aniston HRMS
 *
 * Native Android (Capacitor APK):
 *   - GpsTrackingPlugin starts the native GpsTrackingService (Java ForegroundService).
 *   - The service survives swipe-from-recents (android:stopWithTask="false").
 *   - Only Force Stop (Settings → Apps → Force Stop) truly kills it.
 *   - The service posts GPS points + heartbeats directly to the backend via
 *     HttpURLConnection — no WebView dependency.
 *   - A persistent notification shows live lat/lng/speed in the notification center.
 *   - For foreground UI updates, Geolocation.watchPosition runs in parallel.
 *
 * Native iOS (Capacitor):
 *   - Uses @capacitor/geolocation watchPosition.
 *
 * Browser / PWA:
 *   - Falls back to navigator.geolocation (foreground only).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';

// Register our custom native plugin (GpsTrackingPlugin.java in MainActivity)
interface GpsTrackingPluginDef {
  start(opts: { backendUrl: string; authToken: string; employeeId: string; orgId: string; attendanceId?: string; trackingIntervalMinutes?: number; shiftEndEpochMs?: number; shiftType?: string }): Promise<void>;
  stop(): Promise<void>;
  updateToken(opts: { token: string }): Promise<void>;
  updateInterval(opts: { minutes: number }): Promise<void>;
  isRunning(): Promise<{ running: boolean }>;
  requestBatteryOptimizationExemption(): Promise<{ prompted: boolean; alreadyExempted?: boolean; error?: string }>;
  isBatteryOptimizationExempted(): Promise<{ exempted: boolean }>;
  getDiagnostics(): Promise<Record<string, string>>;
}

// On web/iOS, all methods are no-ops (plugin is Android-only)
const GpsTrackingPlugin = registerPlugin<GpsTrackingPluginDef>('GpsTracking', {
  web: {
    start: async () => {},
    stop: async () => {},
    updateToken: async () => {},
    updateInterval: async () => {},
    isRunning: async () => ({ running: false }),
    requestBatteryOptimizationExemption: async () => ({ prompted: false }),
    isBatteryOptimizationExempted: async () => ({ exempted: true }),
    getDiagnostics: async () => ({}),
  },
});

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
 * Start watching position for foreground UI updates.
 *
 * On native Android: uses Geolocation.watchPosition for foreground UI updates.
 *   Background GPS is handled by the native GpsTrackingService (Java ForegroundService)
 *   started separately via startNativeGpsService(). That service survives swipe-from-recents.
 *
 * On native iOS: uses Geolocation.watchPosition() (continuous updates).
 *
 * On web/PWA: uses navigator.geolocation.watchPosition() (foreground only).
 *
 * Returns an opaque watchId string used to stop tracking with clearWatch().
 */
export interface GPSCredentials {
  backendUrl: string;
  authToken: string;
  employeeId: string;
  orgId: string;
  attendanceId?: string;
  trackingIntervalMinutes?: number;
  /** Unix epoch ms of shift end time — service auto-stops when this is exceeded. 0 = no limit. */
  shiftEndEpochMs?: number;
  /** Shift type: 'FIELD' for full GPS trail, 'HYBRID' for lightweight geofence monitoring. */
  shiftType?: string;
  /** Refresh token forwarded to native service for background token refresh (empty when httpOnly cookie). */
  refreshToken?: string;
}

/**
 * Start the native Android GPS foreground service.
 * Survives swipe-from-recents — only Force Stop truly kills it.
 * No-op on iOS/web (those platforms use watchPosition directly).
 */
export async function startNativeGpsService(credentials: GPSCredentials): Promise<void> {
  if (!isNativeAndroid) return;
  await GpsTrackingPlugin.start({
    backendUrl: credentials.backendUrl,
    authToken: credentials.authToken,
    employeeId: credentials.employeeId,
    orgId: credentials.orgId,
    ...(credentials.attendanceId != null ? { attendanceId: credentials.attendanceId } : {}),
    ...(credentials.trackingIntervalMinutes != null
      ? { trackingIntervalMinutes: credentials.trackingIntervalMinutes }
      : {}),
    ...(credentials.shiftEndEpochMs != null && credentials.shiftEndEpochMs > 0
      ? { shiftEndEpochMs: credentials.shiftEndEpochMs }
      : {}),
    ...(credentials.shiftType != null ? { shiftType: credentials.shiftType } : {}),
  });
}

/**
 * Start GPS tracking tied to a specific shift check-in.
 * Should be called only from the check-in success handler, NOT on app init.
 *
 * Calculates the shift end epoch from shift times + grace minutes so the
 * native service can auto-stop when the shift ends.
 */
export async function startTrackingForShift(opts: {
  attendanceId: string;
  shiftEndTime: string;        // "HH:mm" IST
  graceMinutes: number;
  trackingIntervalMinutes: number;
  trackingStartsOnCheckIn?: boolean;
  /** Shift type passed to native service to control notification text and behaviour. */
  shiftType?: string;
  credentials: Omit<GPSCredentials, 'attendanceId' | 'trackingIntervalMinutes' | 'shiftEndEpochMs' | 'shiftType'>;
}): Promise<void> {
  if (!isNativeAndroid) return;
  // Guard: only start if the shift policy allows tracking to start on check-in
  if (opts.trackingStartsOnCheckIn === false) return;

  // Compute shift end epoch in UTC. Shift times are IST (UTC+5:30).
  const [endHour, endMin] = opts.shiftEndTime.split(':').map(Number);
  const nowIst = new Date(Date.now() + (5.5 * 60 * 60 * 1000)); // approximate IST now
  const shiftEndIst = new Date(nowIst);
  shiftEndIst.setHours(endHour, endMin + opts.graceMinutes, 0, 0);
  // If shift end is before now (night shift past midnight), add 24h
  if (shiftEndIst.getTime() < nowIst.getTime()) {
    shiftEndIst.setDate(shiftEndIst.getDate() + 1);
  }
  const shiftEndEpochMs = shiftEndIst.getTime() - (5.5 * 60 * 60 * 1000); // convert IST back to UTC epoch

  await startNativeGpsService({
    ...opts.credentials,
    attendanceId: opts.attendanceId,
    trackingIntervalMinutes: opts.trackingIntervalMinutes,
    shiftEndEpochMs,
    shiftType: opts.shiftType,
  });
}

/**
 * Stop GPS tracking on check-out.
 * Should be called only from the check-out success handler.
 */
export async function stopTrackingForShift(trackingStopsOnCheckOut = true): Promise<void> {
  if (!isNativeAndroid) return;
  if (!trackingStopsOnCheckOut) return;
  await stopNativeGpsService();
}

/** Stop the native Android GPS foreground service. No-op on iOS/web. */
export async function stopNativeGpsService(): Promise<void> {
  if (!isNativeAndroid) return;
  await GpsTrackingPlugin.stop();
}

/** Update the auth token inside the running native GPS service. No-op on iOS/web. */
export async function updateNativeGpsToken(token: string): Promise<void> {
  if (!isNativeAndroid) return;
  await GpsTrackingPlugin.updateToken({ token });
}

/**
 * Update the GPS tracking interval in a running native service without restarting it.
 * Called when HR reassigns an employee to a different FIELD shift mid-day.
 * No-op on iOS/web.
 */
export async function updateNativeGpsInterval(minutes: number): Promise<void> {
  if (!isNativeAndroid) return;
  await GpsTrackingPlugin.updateInterval({ minutes });
}

/** Returns true if the native GPS service is currently running. */
export async function isNativeGpsRunning(): Promise<boolean> {
  if (!isNativeAndroid) return false;
  const { running } = await GpsTrackingPlugin.isRunning();
  return running;
}

/**
 * Programmatically show the system battery optimization exemption dialog.
 * On Samsung/Xiaomi/Oppo/OnePlus this opens the one-tap "Allow" dialog.
 * No-op on web/iOS.
 */
export async function requestBatteryOptimizationExemption(): Promise<{ prompted: boolean; alreadyExempted?: boolean }> {
  if (!isNativeAndroid) return { prompted: false };
  return GpsTrackingPlugin.requestBatteryOptimizationExemption();
}

/** Returns true if the app is already exempted from battery optimizations. */
export async function isBatteryOptimizationExempted(): Promise<boolean> {
  if (!isNativeAndroid) return true;
  const { exempted } = await GpsTrackingPlugin.isBatteryOptimizationExempted();
  return exempted;
}

/**
 * Start watching position for UI updates.
 *
 * On Android: uses Geolocation.watchPosition for foreground UI updates.
 *   The native GpsTrackingService (started separately) handles background posting.
 *
 * On iOS: uses Geolocation.watchPosition.
 *
 * On web/PWA: uses navigator.geolocation.watchPosition.
 */
export async function watchPosition(
  onPosition: (pos: GPSPosition) => void,
  onError: (err: { code?: number; message: string }) => void,
  _trackingIntervalMinutes = 60,
  _credentials?: GPSCredentials,
): Promise<string | number> {

  // ── Native Android / iOS: Capacitor Geolocation for foreground UI ────────────
  if (isNative) {
    const watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30000 },
      (pos, err) => {
        if (err) { onError({ code: (err as any).code, message: err.message ?? 'GPS error' }); return; }
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
  if (isNative) {
    await Geolocation.clearWatch({ id: watchId as string });
  } else {
    navigator.geolocation.clearWatch(watchId as number);
  }
}

/**
 * Fetch native GPS diagnostics from the Java GpsDiagnostics SharedPreferences store.
 * Returns an empty object on web/iOS.
 */
export async function getNativeGpsDiagnostics(): Promise<Record<string, string>> {
  if (!isNativeAndroid) return {};
  try {
    const result = await GpsTrackingPlugin.getDiagnostics();
    return result as Record<string, string>;
  } catch {
    return {};
  }
}
