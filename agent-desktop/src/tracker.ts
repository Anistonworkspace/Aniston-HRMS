import { powerMonitor } from 'electron';
import { execSync } from 'child_process';
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
 * Get active window using PowerShell (works on Windows without native modules)
 */
function getActiveWindowInfo(): { app: string; title: string } {
  try {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Win32 {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        }
"@
      $hwnd = [Win32]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 256
      [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
      $title = $sb.ToString()
      $pid = 0
      [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      "$($proc.ProcessName)|$title"
    `;
    const result = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true,
    }).trim();
    const [app, ...titleParts] = result.split('|');
    return { app: app || 'Unknown', title: titleParts.join('|') || '' };
  } catch {
    return { app: 'Unknown', title: '' };
  }
}

export function startTracking() {
  if (trackingInterval) return;

  console.log('[Tracker] Starting activity tracking...');
  startInputTracking();

  trackingInterval = setInterval(() => {
    if (isPaused) return;

    try {
      const { app, title } = getActiveWindowInfo();
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
