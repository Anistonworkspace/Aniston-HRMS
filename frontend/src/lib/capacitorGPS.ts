/**
 * capacitorGPS.ts — Unified GPS layer for Aniston HRMS
 *
 * On Capacitor Android/iOS (native APK):
 *   - Uses @capacitor/geolocation which calls the native Android Location API
 *   - Requests ACCESS_BACKGROUND_LOCATION permission so Android continues
 *     delivering positions when the screen is off
 *   - Works even when the app is minimised (Android respects the permission)
 *
 * On browser / TWA (PWABuilder play store):
 *   - Falls back to navigator.geolocation (existing behaviour)
 *   - Wake lock still keeps the screen on to maximise GPS time
 */

import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position, type WatchPositionCallback } from '@capacitor/geolocation';

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
 * Request all required location permissions for native Android.
 * On Android 10+ this includes ACCESS_BACKGROUND_LOCATION.
 * Returns true if at least foreground location was granted.
 */
export async function requestNativePermissions(): Promise<boolean> {
  if (!isNative) return true; // browser handles its own permission prompt

  try {
    // Check current status first
    const current = await Geolocation.checkPermissions();

    if (current.location === 'granted' || current.coarseLocation === 'granted') {
      // Already have foreground — try background on Android
      if (isNativeAndroid) {
        try {
          await (Geolocation as any).requestPermissions({
            permissions: ['location', 'background_location'],
          });
        } catch {
          // Background permission may not exist on older Android API levels — fine
        }
      }
      return true;
    }

    // Request foreground first
    const result = await Geolocation.requestPermissions({
      permissions: ['location'],
    } as any);

    const granted =
      result.location === 'granted' || result.coarseLocation === 'granted';

    // Then request background (Android 10+)
    if (granted && isNativeAndroid) {
      try {
        await (Geolocation as any).requestPermissions({
          permissions: ['location', 'background_location'],
        });
      } catch {
        // Old Android versions don't have background_location permission — fine
      }
    }

    return granted;
  } catch {
    return false;
  }
}

/**
 * Get a single fresh GPS position.
 * Uses native plugin on Capacitor, browser API on web.
 */
export async function getCurrentPosition(): Promise<GPSPosition> {
  if (isNative) {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 30000,
    });
    return toGPSPosition(pos);
  }

  // Browser fallback
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
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
 * Watch position continuously.
 * Returns an opaque watchId string (works for both native and browser).
 *
 * On native Android with background location granted, positions continue
 * to arrive even when the screen is off or the app is in the background.
 */
export async function watchPosition(
  onPosition: (pos: GPSPosition) => void,
  onError: (err: { code?: number; message: string }) => void
): Promise<string | number> {
  if (isNative) {
    const watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30000 },
      (pos, err) => {
        if (err) {
          onError({ message: err.message ?? 'GPS error' });
          return;
        }
        if (pos) onPosition(toGPSPosition(pos));
      }
    );
    return watchId;
  }

  // Browser fallback
  return navigator.geolocation.watchPosition(
    (pos) =>
      onPosition({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      }),
    (err) => onError({ code: err.code, message: err.message }),
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 }
  );
}

/**
 * Clear a watch created by watchPosition().
 */
export async function clearWatch(watchId: string | number): Promise<void> {
  if (isNative) {
    await Geolocation.clearWatch({ id: watchId as string });
  } else {
    navigator.geolocation.clearWatch(watchId as number);
  }
}
