import { CONFIG } from '../config';

interface ActivityEntry {
  activeApp: string | null;
  activeWindow: string | null;
  activeUrl: string | null;
  durationSeconds: number;
  timestamp: string;
}

let currentApp: string | null = null;
let currentWindow: string | null = null;
let currentStart: Date | null = null;
let activityQueue: ActivityEntry[] = [];
let trackingInterval: NodeJS.Timeout | null = null;

async function checkActiveWindow() {
  try {
    // Dynamic import for ESM module
    const activeWin = (await import('active-win')).default;
    const win = await activeWin();

    if (!win) return;

    const app = win.owner?.name || 'Unknown';
    const title = win.title || '';

    if (app !== currentApp || title !== currentWindow) {
      // App switched — save previous entry
      if (currentApp && currentStart) {
        const duration = Math.round((Date.now() - currentStart.getTime()) / 1000);
        if (duration > 0) {
          activityQueue.push({
            activeApp: currentApp,
            activeWindow: currentWindow,
            activeUrl: null, // Could extract URL from browser titles
            durationSeconds: duration,
            timestamp: currentStart.toISOString(),
          });
        }
      }

      currentApp = app;
      currentWindow = title;
      currentStart = new Date();
    }
  } catch (err) {
    // Silently continue on error
  }
}

export function startActiveWindowTracker() {
  if (trackingInterval) return;
  currentStart = new Date();
  trackingInterval = setInterval(checkActiveWindow, CONFIG.TRACKING_INTERVAL_MS);
  console.log('[Agent] Active window tracker started');
}

export function stopActiveWindowTracker() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  // Flush current entry
  if (currentApp && currentStart) {
    const duration = Math.round((Date.now() - currentStart.getTime()) / 1000);
    if (duration > 0) {
      activityQueue.push({
        activeApp: currentApp,
        activeWindow: currentWindow,
        activeUrl: null,
        durationSeconds: duration,
        timestamp: currentStart.toISOString(),
      });
    }
  }
  currentApp = null;
  currentWindow = null;
  currentStart = null;
}

export function drainActivityQueue(): ActivityEntry[] {
  // Flush current active entry
  if (currentApp && currentStart) {
    const duration = Math.round((Date.now() - currentStart.getTime()) / 1000);
    if (duration > 0) {
      activityQueue.push({
        activeApp: currentApp,
        activeWindow: currentWindow,
        activeUrl: null,
        durationSeconds: duration,
        timestamp: currentStart.toISOString(),
      });
    }
    currentStart = new Date(); // Reset timer for next interval
  }

  const queue = [...activityQueue];
  activityQueue = [];
  return queue;
}
