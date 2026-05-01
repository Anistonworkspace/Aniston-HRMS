import { powerMonitor } from 'electron';
import { CONFIG, categorizeApp } from './config';
import { getAndResetInputCounts, startInputTracking, stopInputTracking } from './inputTracker';

// ── Browser window-title classification ──────────────────────────────────────
// Chrome/Edge/Firefox classify the app as PRODUCTIVE by default, but the window
// title often contains the page title + domain, so we can do better.

const BROWSER_APPS = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'safari'];

/** Returns true if appName is a web browser */
function isBrowserApp(appName: string): boolean {
  const lower = appName.toLowerCase();
  return BROWSER_APPS.some(b => lower.includes(b));
}

/** Domains/keywords that indicate unproductive browsing */
const UNPRODUCTIVE_DOMAINS = [
  'youtube.com', 'netflix.com', 'primevideo.com', 'hotstar.com', 'disneyplus.com',
  'hulu.com', 'twitch.tv', 'tiktok.com', 'instagram.com', 'facebook.com',
  'twitter.com', 'x.com/', 'reddit.com', 'pinterest.com', 'snapchat.com',
  'discord.com', 'whatsapp.com', 'telegram.org',
  'store.steampowered.com', 'steamcommunity.com', 'epicgames.com',
];

/** Domains/keywords that indicate productive browsing */
const PRODUCTIVE_DOMAINS = [
  'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com',
  'docs.google.com', 'sheets.google.com', 'drive.google.com',
  'figma.com', 'notion.so', 'linear.app', 'jira.', 'confluence.',
  'trello.com', 'asana.com', 'clickup.com', 'npmjs.com', 'pypi.org',
  'developer.mozilla', 'developer.android', 'developer.apple',
  'vercel.com', 'netlify.com', 'aws.amazon.com', 'console.cloud.google',
  'portal.azure.com', 'prisma.io', 'tailwindcss.com',
];

/**
 * Classify a browser tab using its window title, which typically includes
 * the page title and domain (e.g. "YouTube - Google Chrome").
 */
function categorizeBrowserWindow(windowTitle: string): 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE' {
  const lower = windowTitle.toLowerCase();
  if (UNPRODUCTIVE_DOMAINS.some(d => lower.includes(d))) return 'UNPRODUCTIVE';
  if (PRODUCTIVE_DOMAINS.some(d => lower.includes(d))) return 'PRODUCTIVE';
  return 'NEUTRAL';
}

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

const BUFFER_MAX = 1000;

let activityBuffer: ActivityEntry[] = [];
let trackingInterval: NodeJS.Timeout | null = null;
let isPaused = false;

/** Returns a snapshot of the buffer without clearing it. */
export function getBuffer(): ActivityEntry[] {
  return [...activityBuffer];
}

/** Remove the first `count` entries from the buffer (called only after successful send). */
export function drainBuffer(count: number): void {
  activityBuffer.splice(0, count);
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

      // For browsers, classify by window title (contains page title + domain).
      // For all other apps, classify by app name.
      const category = isIdle
        ? 'NEUTRAL'
        : (isBrowserApp(app) ? categorizeBrowserWindow(title) : categorizeApp(app));

      const entry: ActivityEntry = {
        activeApp: app,
        activeWindow: title,
        activeUrl: '',
        category,
        durationSeconds: CONFIG.TRACKING_INTERVAL_MS / 1000,
        idleSeconds: idleTime,
        keystrokes: inputCounts.keystrokes,
        mouseClicks: inputCounts.mouseClicks,
        mouseDistance: inputCounts.mouseDistance,
        timestamp: new Date().toISOString(),
      };

      if (activityBuffer.length >= BUFFER_MAX) activityBuffer.shift();
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
