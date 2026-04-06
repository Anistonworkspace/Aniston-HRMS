/**
 * useIOSBackgroundGPS — iOS-safe GPS tracking with background keep-alive.
 *
 * iOS LIMITATIONS & SOLUTIONS:
 *
 * 1. **watchPosition pauses in background (iOS Safari):**
 *    - iOS suspends JS execution ~3 min after screen locks or app backgrounds.
 *    - SOLUTION: Use Wake Lock API (iOS 16.4+) to prevent screen sleep.
 *    - FALLBACK: Silent video loop prevents page suspension on older iOS.
 *    - When app returns to foreground: immediately get fresh position to fill gap.
 *
 * 2. **iOS PWA notifications are limited:**
 *    - iOS 16.4+ supports Web Push in PWAs added to home screen.
 *    - REQUIREMENT: App MUST be installed to home screen (Add to Home Screen).
 *    - Standard Safari tabs do NOT support push notifications.
 *    - SOLUTION: Detect PWA standalone mode and guide users to install.
 *
 * 3. **iOS background audio keeps app alive:**
 *    - Playing silent audio prevents iOS from fully suspending the PWA.
 *    - Combined with Wake Lock, this gives reliable background GPS.
 *
 * USAGE:
 *   const { startTracking, stopTracking, currentPosition, isTracking, points } = useIOSBackgroundGPS({
 *     intervalMs: 60000,
 *     onPoint: (point) => bufferRef.current.push(point),
 *   });
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useWakeLock } from './useWakeLock';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
const isAndroid = /Android/i.test(navigator.userAgent);
const isPWA = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export interface GPSTrackingPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number;
  timestamp: number;
}

interface UseIOSBackgroundGPSOptions {
  intervalMs?: number;
  onPoint?: (point: GPSTrackingPoint) => void;
}

export function useIOSBackgroundGPS(options: UseIOSBackgroundGPSOptions = {}) {
  const { intervalMs = 60000, onPoint } = options;
  const [isTracking, setIsTracking] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<GPSTrackingPoint | null>(null);
  const [points, setPoints] = useState<GPSTrackingPoint[]>([]);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;

  const wakeLock = useWakeLock();

  // Detect if user should install PWA for better iOS experience
  useEffect(() => {
    if (isIOS && !isPWA) {
      setShowInstallPrompt(true);
    }
  }, []);

  const handlePosition = useCallback((position: GeolocationPosition) => {
    const point: GPSTrackingPoint = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed || undefined,
      timestamp: Date.now(),
    };
    setCurrentPosition(point);
    setPoints(prev => [...prev, point]);
    onPointRef.current?.(point);
  }, []);

  // On iOS: when app comes back to foreground, immediately get fresh position
  useEffect(() => {
    if (!isTracking) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isTracking) {
        // Get a fresh position immediately to fill any gap
        navigator.geolocation.getCurrentPosition(
          handlePosition,
          () => {},
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isTracking, handlePosition]);

  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) {
      throw new Error('Geolocation not supported');
    }

    // Request wake lock to keep GPS alive in background
    await wakeLock.request();

    // Start continuous tracking
    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        if (import.meta.env.DEV) console.error('[GPS]', err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: intervalMs,
        timeout: 30000,
      }
    );

    setIsTracking(true);
  }, [handlePosition, intervalMs, wakeLock]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    wakeLock.release();
    setIsTracking(false);
  }, [wakeLock]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return {
    startTracking,
    stopTracking,
    currentPosition,
    isTracking,
    points,
    isWakeLocked: wakeLock.isLocked,
    showInstallPrompt,
    dismissInstallPrompt: () => setShowInstallPrompt(false),
    isIOS,
    isAndroid,
    isPWA,
  };
}
