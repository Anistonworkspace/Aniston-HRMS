import { powerMonitor } from 'electron';
import { CONFIG, categorizeApp } from './config';

export interface ActivityEntry {
  activeApp: string;
  activeWindow: string;
  activeUrl: string;
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';
  durationSeconds: number;
  idleSeconds: number;
  keystrokes: number;
  mouseClicks: number;
  mouseDistance: number;
  timestamp: string;
}

let activityBuffer: ActivityEntry[] = [];
let trackingInterval: NodeJS.Timeout | null = null;
let isPaused = false;

// Simple counters (incremented by global hooks if available)
let keystrokeCount = 0;
let mouseClickCount = 0;

export function getBuffer(): ActivityEntry[] {
  const entries = [...activityBuffer];
  activityBuffer = [];
  return entries;
}

export function pauseTracking() { isPaused = true; }
export function resumeTracking() { isPaused = false; }
export function isTracking() { return trackingInterval !== null && !isPaused; }

export async function startTracking() {
  if (trackingInterval) return;

  trackingInterval = setInterval(async () => {
    if (isPaused) return;

    try {
      // Dynamic import for ESM module
      const activeWin = await import('active-win');
      const result = await activeWin.default();

      const idleTime = powerMonitor.getSystemIdleTime();
      const isIdle = idleTime >= CONFIG.IDLE_THRESHOLD_S;

      const entry: ActivityEntry = {
        activeApp: result?.owner?.name || 'Unknown',
        activeWindow: result?.title || '',
        activeUrl: (result as any)?.url || '',
        category: isIdle ? 'NEUTRAL' : categorizeApp(result?.owner?.name || ''),
        durationSeconds: CONFIG.TRACKING_INTERVAL_MS / 1000,
        idleSeconds: idleTime,
        keystrokes: keystrokeCount,
        mouseClicks: mouseClickCount,
        mouseDistance: 0,
        timestamp: new Date().toISOString(),
      };

      activityBuffer.push(entry);

      // Reset counters
      keystrokeCount = 0;
      mouseClickCount = 0;
    } catch (err) {
      // Silently skip if active-win fails
      console.error('[Tracker] Error:', (err as Error).message);
    }
  }, CONFIG.TRACKING_INTERVAL_MS);
}

export function stopTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
}
