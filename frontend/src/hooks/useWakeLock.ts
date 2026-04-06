/**
 * useWakeLock — Prevents screen/device from sleeping during GPS tracking.
 *
 * iOS LIMITATIONS ADDRESSED:
 * 1. iOS Safari kills background GPS tracking after ~3 minutes when screen locks.
 *    The Screen Wake Lock API (navigator.wakeLock) prevents this by keeping the
 *    screen active. Supported on iOS 16.4+ and all modern Android browsers.
 *
 * 2. iOS re-acquires the wake lock automatically on visibilitychange when the
 *    user returns to the app — this is built into the API spec.
 *
 * 3. For older iOS (< 16.4), we use a "NoSleep" video workaround: a tiny silent
 *    video plays in a loop, preventing iOS from suspending the page.
 *
 * USAGE:
 *   const { isLocked, request, release } = useWakeLock();
 *   // Call request() when starting GPS tracking
 *   // Call release() when stopping
 */
import { useState, useRef, useCallback, useEffect } from 'react';

// Detect iOS for fallback strategy
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

export function useWakeLock() {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const noSleepVideoRef = useRef<HTMLVideoElement | null>(null);

  // Native Wake Lock API (iOS 16.4+, Chrome, Edge, Samsung Internet)
  const requestNative = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current!.addEventListener('release', () => setIsLocked(false));
        setIsLocked(true);
        return true;
      }
    } catch {
      // Wake lock request failed (e.g., low battery mode)
    }
    return false;
  }, []);

  // Fallback: silent video loop for older iOS
  const requestFallback = useCallback(() => {
    if (noSleepVideoRef.current) return;
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.style.position = 'fixed';
    video.style.top = '-1px';
    video.style.left = '-1px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0.01';
    // Use a data URI for a tiny silent MP4 (163 bytes)
    video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0AAAA1m1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAPoAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAACYdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAPoAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAABJG1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAKAAAACgAVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAz21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAI9zdGJsAAAAY3N0c2QAAAAAAAAAAQAAAFNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAdY29scm5jbHgABQAFAAUABgAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAAAgAAFAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABRzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAABcAAAAMAAAAFHN0Y28AAAAAAAAAAQAAADQ=';
    document.body.appendChild(video);
    video.play().catch(() => {}); // autoplay may fail silently
    noSleepVideoRef.current = video;
    setIsLocked(true);
  }, []);

  const request = useCallback(async () => {
    const native = await requestNative();
    if (!native && isIOS) {
      requestFallback();
    }
  }, [requestNative, requestFallback]);

  const release = useCallback(() => {
    // Release native wake lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
    // Remove fallback video
    if (noSleepVideoRef.current) {
      noSleepVideoRef.current.pause();
      noSleepVideoRef.current.remove();
      noSleepVideoRef.current = null;
    }
    setIsLocked(false);
  }, []);

  // Re-acquire wake lock when page becomes visible again (iOS restores it)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isLocked && !wakeLockRef.current) {
        await requestNative();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      release();
    };
  }, [isLocked, requestNative, release]);

  return { isLocked, request, release };
}
