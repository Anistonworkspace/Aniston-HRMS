import { CONFIG } from '../config';

let idleCheckInterval: NodeJS.Timeout | null = null;
let isIdle = false;
let idleStartTime: Date | null = null;
let totalIdleSeconds = 0;
let onIdleChange: ((idle: boolean) => void) | null = null;

function checkIdle() {
  try {
    const desktopIdle = require('desktop-idle');
    const idleSeconds = desktopIdle.getIdleTime();
    const idleMs = idleSeconds * 1000;

    if (idleMs >= CONFIG.IDLE_THRESHOLD_MS && !isIdle) {
      // Went idle
      isIdle = true;
      idleStartTime = new Date(Date.now() - idleMs);
      onIdleChange?.(true);
      console.log('[Agent] User went idle');
    } else if (idleMs < CONFIG.IDLE_THRESHOLD_MS && isIdle) {
      // Returned from idle
      if (idleStartTime) {
        totalIdleSeconds += Math.round((Date.now() - idleStartTime.getTime()) / 1000);
      }
      isIdle = false;
      idleStartTime = null;
      onIdleChange?.(false);
      console.log('[Agent] User returned from idle');
    }
  } catch (err) {
    // desktop-idle might not work on all platforms
  }
}

export function startIdleDetector(callback?: (idle: boolean) => void) {
  if (idleCheckInterval) return;
  onIdleChange = callback || null;
  idleCheckInterval = setInterval(checkIdle, CONFIG.IDLE_CHECK_INTERVAL_MS);
  console.log('[Agent] Idle detector started');
}

export function stopIdleDetector() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  onIdleChange = null;
}

export function getIdleState(): { isIdle: boolean; totalIdleSeconds: number } {
  return { isIdle, totalIdleSeconds };
}

export function drainIdleSeconds(): number {
  const seconds = totalIdleSeconds;
  totalIdleSeconds = 0;
  return seconds;
}
