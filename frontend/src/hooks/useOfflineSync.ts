import { useEffect, useCallback } from 'react';
import { getQueuedActions, removeAction, incrementRetries } from '../lib/offlineQueue';
import { useClockInMutation, useClockOutMutation } from '../features/attendance/attendanceApi';
import toast from 'react-hot-toast';

const MAX_RETRIES = 3;
const MAX_OFFLINE_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours — reject stale offline actions

/**
 * Auto-syncs queued offline attendance actions when the app comes back online.
 * Mount once in AppShell.
 *
 * Security: Offline clock-ins older than 4 hours are discarded (stale GPS data
 * would bypass geofence validation). Fresh GPS is re-acquired when possible.
 */
export function useOfflineSync() {
  const [clockIn] = useClockInMutation();
  const [clockOut] = useClockOutMutation();

  const syncQueue = useCallback(async () => {
    const actions = getQueuedActions();
    if (actions.length === 0) return;

    for (const action of actions) {
      // Reject stale offline actions — GPS coordinates are too old for geofence validation
      const age = Date.now() - action.timestamp;
      if (age > MAX_OFFLINE_AGE_MS) {
        removeAction(action.id);
        toast.error(`Offline ${action.type === 'CLOCK_IN' ? 'check-in' : 'check-out'} expired (queued ${Math.round(age / 3600000)}h ago). Please mark again.`);
        continue;
      }

      // Re-acquire fresh GPS if available, so geofence validation uses current location
      let payload = { ...action.payload };
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 })
          );
          payload.latitude = pos.coords.latitude;
          payload.longitude = pos.coords.longitude;
          payload.accuracy = pos.coords.accuracy;
        } catch {
          // Use original coordinates if GPS unavailable
        }
      }

      try {
        if (action.type === 'CLOCK_IN') {
          await clockIn(payload).unwrap();
        } else if (action.type === 'CLOCK_OUT') {
          await clockOut(payload).unwrap();
        }
        removeAction(action.id);
        toast.success(`Offline ${action.type === 'CLOCK_IN' ? 'check-in' : 'check-out'} synced`);
      } catch {
        const retries = incrementRetries(action.id);
        if (retries >= MAX_RETRIES) {
          removeAction(action.id);
          toast.error(`Failed to sync offline ${action.type === 'CLOCK_IN' ? 'check-in' : 'check-out'} after ${MAX_RETRIES} attempts`);
        }
      }
    }
  }, [clockIn, clockOut]);

  useEffect(() => {
    // Sync on mount if online and there are queued actions
    if (navigator.onLine) {
      syncQueue();
    }

    const handleOnline = () => {
      // Small delay to let the network stabilize
      setTimeout(syncQueue, 1500);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncQueue]);
}
