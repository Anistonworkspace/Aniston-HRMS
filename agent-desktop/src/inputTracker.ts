import { powerMonitor } from 'electron';
import { exec } from 'child_process';

/**
 * Tracks keyboard and mouse input activity between polling intervals.
 * Uses Windows GetAsyncKeyState + GetCursorPos via PowerShell for actual counts,
 * with a fallback heuristic based on idle time changes.
 */

let lastMouseX = 0;
let lastMouseY = 0;
let totalKeystrokes = 0;
let totalClicks = 0;
let totalMouseDistance = 0;
let pollInterval: NodeJS.Timeout | null = null;
let isPaused = false;

// Poll every 500ms — 60 polls per 30-second tracking window.
// This dramatically reduces the missed-keystroke problem inherent in GAKS bit-0:
// each bit-0 flag is cleared after the first GAKS call, so polling at 5s meant
// a user who typed 100 keys in 1s could only register ~47 max (one per key per 5s window).
// At 500ms the floor is ~10× better, catching most burst-typing sessions.
// CPU cost: ~2 PowerShell spawns/sec. exec() is async so it does not block Electron.
const INPUT_POLL_MS = 500;

/**
 * Get current mouse position and detect keyboard/mouse activity
 * Uses PowerShell with Win32 API — lightweight, no native modules needed
 */
// Pre-encoded once at module load — avoids shell escaping risks entirely
const PS_SCRIPT = `
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
foreach ($k in @(8,9,13,32) + (48..57) + (65..90) + (186..192) + (219..222)) {
  if (([InputHelper]::GetAsyncKeyState($k) -band 1) -ne 0) { $keys++ }
}
if (([InputHelper]::GetAsyncKeyState(1) -band 1) -ne 0) { $clicks++ }
if (([InputHelper]::GetAsyncKeyState(2) -band 1) -ne 0) { $clicks++ }
"$($p.X)|$($p.Y)|$keys|$clicks"
`;

const PS_ENCODED = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

// BUG-006 fix: use async exec so PowerShell runs on a child thread, not the Electron main thread.
// execSync with a 5s timeout blocked the main thread every 5s, potentially freezing the UI.
let psRunning = false; // prevent concurrent executions if PS is slow

function pollInputState(): void {
  if (isPaused) return;
  if (psRunning) return; // skip if previous poll hasn't finished yet

  psRunning = true;
  exec(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${PS_ENCODED}`,
    { timeout: 400, windowsHide: true },
    (err, stdout) => {
      psRunning = false;
      if (isPaused) return; // may have been paused while PS was running

      if (err) {
        // PowerShell poll failed — use idle heuristic fallback
        const idleTime = powerMonitor.getSystemIdleTime();
        if (idleTime < 3) {
          totalKeystrokes += 2;
          totalClicks += 1;
        }
        return;
      }

      const result = stdout.trim();
      const [xStr, yStr, keysStr, clicksStr] = result.split('|');
      const x = parseInt(xStr, 10) || 0;
      const y = parseInt(yStr, 10) || 0;
      const keys = parseInt(keysStr, 10) || 0;
      const clicks = parseInt(clicksStr, 10) || 0;

      totalKeystrokes += keys;
      totalClicks += clicks;

      // BUG-020 fix: skip (0,0) sentinel — it means cursor pos unavailable, not "at origin"
      if (x === 0 && y === 0) {
        // Don't update lastMouseX/Y — treat as no-data frame
        return;
      }

      if (lastMouseX !== 0 || lastMouseY !== 0) {
        const dx = x - lastMouseX;
        const dy = y - lastMouseY;
        totalMouseDistance += Math.round(Math.sqrt(dx * dx + dy * dy));
      }
      lastMouseX = x;
      lastMouseY = y;
    }
  );
}

/**
 * Start input tracking — polls every 2 seconds
 * A-016: No-op on non-Windows platforms — the PowerShell script uses Win32 DLLs
 * (user32.dll GetAsyncKeyState/GetCursorPos) that do not exist on macOS/Linux.
 */
export function startInputTracking(): void {
  if (process.platform !== 'win32') {
    console.log('[InputTracker] Skipped — not Windows');
    return;
  }
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

export function pauseInputTracking(): void {
  isPaused = true;
}

export function resumeInputTracking(): void {
  isPaused = false;
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
