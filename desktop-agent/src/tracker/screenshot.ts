import * as screenshot from 'screenshot-desktop';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CONFIG } from '../config';

let screenshotInterval: NodeJS.Timeout | null = null;
let screenshotQueue: string[] = [];
let isPaused = false;

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), 'aniston-agent-screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function captureScreenshot(): Promise<string | null> {
  if (isPaused) return null;

  try {
    const filename = `screenshot-${Date.now()}.jpg`;
    const filepath = path.join(getTempDir(), filename);

    await screenshot({ filename: filepath, format: 'jpg' });

    // Check file size — skip if too large (> 2MB)
    const stats = fs.statSync(filepath);
    if (stats.size > 2 * 1024 * 1024) {
      fs.unlinkSync(filepath);
      return null;
    }

    screenshotQueue.push(filepath);
    return filepath;
  } catch (err) {
    console.error('[Agent] Screenshot capture failed:', err);
    return null;
  }
}

export function startScreenshotCapture() {
  if (screenshotInterval) return;
  screenshotInterval = setInterval(captureScreenshot, CONFIG.SCREENSHOT_INTERVAL_MS);
  console.log('[Agent] Screenshot capture started');
}

export function stopScreenshotCapture() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
}

export function pauseScreenshots() { isPaused = true; }
export function resumeScreenshots() { isPaused = false; }

export function drainScreenshotQueue(): string[] {
  const queue = [...screenshotQueue];
  screenshotQueue = [];
  return queue;
}

export function cleanupScreenshotFile(filepath: string) {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch { /* ignore cleanup errors */ }
}
