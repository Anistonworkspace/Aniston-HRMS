import * as fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { CONFIG } from '../config';
import { getAuthHeaders } from '../auth';
import store from '../store';
import { drainActivityQueue } from './activeWindow';
import { drainScreenshotQueue, cleanupScreenshotFile } from './screenshot';
import { drainIdleSeconds } from './idleDetector';

let syncInterval: NodeJS.Timeout | null = null;

async function syncHeartbeat() {
  const activities = drainActivityQueue();
  const idleSeconds = drainIdleSeconds();

  // Add idle time to last activity if any
  if (activities.length > 0 && idleSeconds > 0) {
    activities[activities.length - 1].idleSeconds = idleSeconds;
  }

  if (activities.length === 0) return;

  try {
    const res = await fetch(`${CONFIG.API_URL}/agent/heartbeat`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities }),
    });

    if (!res.ok) {
      // Queue for offline retry
      const offline = store.get('offlineQueue') || [];
      offline.push(...activities);
      if (offline.length > CONFIG.MAX_OFFLINE_QUEUE) offline.splice(0, offline.length - CONFIG.MAX_OFFLINE_QUEUE);
      store.set('offlineQueue', offline);
      console.log(`[Agent] Heartbeat failed (${res.status}), queued ${activities.length} entries`);
    } else {
      console.log(`[Agent] Synced ${activities.length} activity entries`);
      // Try to flush offline queue
      await flushOfflineQueue();
    }
  } catch (err) {
    const offline = store.get('offlineQueue') || [];
    offline.push(...activities);
    store.set('offlineQueue', offline);
    console.log('[Agent] Heartbeat failed (network), queued for retry');
  }
}

async function syncScreenshots() {
  const screenshots = drainScreenshotQueue();

  for (const filepath of screenshots) {
    try {
      if (!fs.existsSync(filepath)) continue;

      const form = new FormData();
      form.append('screenshot', fs.createReadStream(filepath));
      form.append('timestamp', new Date().toISOString());

      const res = await fetch(`${CONFIG.API_URL}/agent/screenshot`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), ...form.getHeaders() },
        body: form,
      });

      if (res.ok) {
        console.log('[Agent] Screenshot uploaded');
        cleanupScreenshotFile(filepath);
      } else {
        console.log(`[Agent] Screenshot upload failed (${res.status})`);
        // Keep file for retry
      }
    } catch (err) {
      console.log('[Agent] Screenshot upload failed (network)');
    }
  }
}

async function flushOfflineQueue() {
  const offline = store.get('offlineQueue') || [];
  if (offline.length === 0) return;

  try {
    const res = await fetch(`${CONFIG.API_URL}/agent/heartbeat`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ activities: offline }),
    });

    if (res.ok) {
      store.set('offlineQueue', []);
      console.log(`[Agent] Flushed ${offline.length} offline entries`);
    }
  } catch {
    // Keep queue for next try
  }
}

async function syncAll() {
  await syncHeartbeat();
  await syncScreenshots();
}

export function startSync() {
  if (syncInterval) return;
  syncInterval = setInterval(syncAll, CONFIG.SYNC_INTERVAL_MS);
  console.log('[Agent] Sync manager started');
}

export function stopSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// Force immediate sync
export async function forceSyncNow() {
  await syncAll();
}
