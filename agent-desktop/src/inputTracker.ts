import { powerMonitor } from 'electron';
import { execSync } from 'child_process';

/**
 * Tracks keyboard and mouse input activity between polling intervals.
 * Uses Windows GetAsyncKeyState + GetCursorPos via PowerShell for actual counts,
 * with a fallback heuristic based on idle time changes.
 */

let lastKeystrokes = 0;
let lastClicks = 0;
let lastMouseX = 0;
let lastMouseY = 0;
let totalKeystrokes = 0;
let totalClicks = 0;
let totalMouseDistance = 0;
let pollInterval: NodeJS.Timeout | null = null;

// Track input state between snapshots via PowerShell
// Polls every 2 seconds to detect key presses and mouse movement
const INPUT_POLL_MS = 2000;

/**
 * Get current mouse position and detect keyboard/mouse activity
 * Uses PowerShell with Win32 API — lightweight, no native modules needed
 */
function pollInputState(): void {
  try {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class InputHelper {
          [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
          [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
          [StructLayout(LayoutKind.Sequential)]
          public struct POINT { public int X; public int Y; }
        }
"@
      $p = New-Object InputHelper+POINT
      [InputHelper]::GetCursorPos([ref]$p) | Out-Null
      $keys = 0
      $clicks = 0
      # Check common key ranges: A-Z (65-90), 0-9 (48-57), Space(32), Enter(13), Backspace(8), Tab(9)
      foreach ($k in @(8,9,13,32) + (48..57) + (65..90) + (186..192) + (219..222)) {
        if (([InputHelper]::GetAsyncKeyState($k) -band 1) -ne 0) { $keys++ }
      }
      # Check mouse buttons: Left(1), Right(2), Middle(4)
      if (([InputHelper]::GetAsyncKeyState(1) -band 1) -ne 0) { $clicks++ }
      if (([InputHelper]::GetAsyncKeyState(2) -band 1) -ne 0) { $clicks++ }
      "$($p.X)|$($p.Y)|$keys|$clicks"
    `;

    const result = execSync(
      `powershell -NoProfile -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { timeout: 3000, encoding: 'utf-8', windowsHide: true }
    ).trim();

    const [xStr, yStr, keysStr, clicksStr] = result.split('|');
    const x = parseInt(xStr, 10) || 0;
    const y = parseInt(yStr, 10) || 0;
    const keys = parseInt(keysStr, 10) || 0;
    const clicks = parseInt(clicksStr, 10) || 0;

    totalKeystrokes += keys;
    totalClicks += clicks;

    // Calculate mouse distance (Euclidean)
    if (lastMouseX !== 0 || lastMouseY !== 0) {
      const dx = x - lastMouseX;
      const dy = y - lastMouseY;
      totalMouseDistance += Math.round(Math.sqrt(dx * dx + dy * dy));
    }
    lastMouseX = x;
    lastMouseY = y;
  } catch {
    // PowerShell poll failed — use idle heuristic fallback
    const idleTime = powerMonitor.getSystemIdleTime();
    if (idleTime < 3) {
      // User was active in last 3 seconds — estimate some input
      totalKeystrokes += 2; // ~1 key per second average when active
      totalClicks += 1;
    }
  }
}

/**
 * Start input tracking — polls every 2 seconds
 */
export function startInputTracking(): void {
  if (pollInterval) return;
  lastMouseX = 0;
  lastMouseY = 0;
  pollInterval = setInterval(pollInputState, INPUT_POLL_MS);
  console.log('[InputTracker] Started');
}

/**
 * Stop input tracking
 */
export function stopInputTracking(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  console.log('[InputTracker] Stopped');
}

/**
 * Get accumulated input counts since last call, then reset counters.
 * Called by tracker.ts when building each activity entry.
 */
export function getAndResetInputCounts(): { keystrokes: number; mouseClicks: number; mouseDistance: number } {
  const result = {
    keystrokes: totalKeystrokes,
    mouseClicks: totalClicks,
    mouseDistance: totalMouseDistance,
  };
  totalKeystrokes = 0;
  totalClicks = 0;
  totalMouseDistance = 0;
  return result;
}
