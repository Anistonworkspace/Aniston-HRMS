import { powerMonitor } from 'electron';
import { CONFIG, categorizeApp } from './config';
import { getAndResetInputCounts, startInputTracking, stopInputTracking } from './inputTracker';

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

export function getBuffer(): ActivityEntry[] {
  const entries = [...activityBuffer];
  activityBuffer = [];
  return entries;
}

export function pauseTracking() { isPaused = true; }
export function resumeTracking() { isPaused = false; }
export function isTracking() { return trackingInterval !== null && !isPaused; }

/**
 * Get active window using the active-win npm package.
 * Replaces the old PowerShell approach — active-win uses a compiled native binary
 * instead of spawning a new powershell.exe process on every call (~2 spawns/min saved).
 */
async function getActiveWindowInfo(): Promise<{ app: string; title: string }> {
  try {
    // active-win is ESM-only; dynamic import works fine in Electron main process
    const { default: activeWin } = await import('active-win');
    const result = await activeWin();
    return {
      app: result?.owner?.name || 'Unknown',
      title: result?.title || '',
    };
  } catch {
    return { app: 'Unknown', title: '' };
  }
}

export function startTracking() {
  if (trackingInterval) return;

  console.log('[Tracker] Starting activity tracking...');
  startInputTracking();

  trackingInterval = setInterval(async () => {
    if (isPaused) return;

    try {
      const { app, title } = await getActiveWindowInfo();
      const idleTime = powerMonitor.getSystemIdleTime();
      const isIdle = idleTime >= CONFIG.IDLE_THRESHOLD_S;

      // Get actual input counts accumulated since last poll
      const inputCounts = getAndResetInputCounts();

      const entry: ActivityEntry = {
        activeApp: app,
        activeWindow: title,
        activeUrl: '',
        category: isIdle ? 'NEUTRAL' : categorizeApp(app),
        durationSeconds: CONFIG.TRACKING_INTERVAL_MS / 1000,
        idleSeconds: idleTime,
        keystrokes: inputCounts.keystrokes,
        mouseClicks: inputCounts.mouseClicks,
        mouseDistance: inputCounts.mouseDistance,
        timestamp: new Date().toISOString(),
      };

      activityBuffer.push(entry);
      console.log(`[Tracker] ${app} — ${title.substring(0, 50)} (idle: ${idleTime}s)`);
    } catch (err) {
      console.error('[Tracker] Error:', (err as Error).message);
    }
  }, CONFIG.TRACKING_INTERVAL_MS);

  console.log('[Tracker] Started with interval:', CONFIG.TRACKING_INTERVAL_MS / 1000, 's');
}

export function stopTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  stopInputTracking();
}
