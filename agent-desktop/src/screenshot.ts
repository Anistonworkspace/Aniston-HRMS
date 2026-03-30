import path from 'path';
import os from 'os';
import fs from 'fs';
import { uploadScreenshot, isLoggedIn } from './api';

let screenshotInterval: NodeJS.Timeout | null = null;
let currentIntervalMs = 600_000; // 10 minutes default
let lastActiveApp = 'Unknown';
let lastActiveWindow = '';

export function updateActiveWindow(app: string, window: string) {
  lastActiveApp = app;
  lastActiveWindow = window;
}

export function startScreenshots(intervalMs?: number) {
  stopScreenshots();
  currentIntervalMs = intervalMs || currentIntervalMs;

  screenshotInterval = setInterval(async () => {
    if (!isLoggedIn()) return;

    try {
      const screenshot = await import('screenshot-desktop');
      const tmpDir = path.join(os.tmpdir(), 'aniston-agent');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const filename = `screenshot-${Date.now()}.png`;
      const filePath = path.join(tmpDir, filename);

      await screenshot.default({ filename: filePath, format: 'png' });

      try {
        const sharp = await import('sharp');
        const jpgPath = filePath.replace('.png', '.jpg');
        await sharp.default(filePath).resize(1280, 720, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(jpgPath);
        await uploadScreenshot(jpgPath, { activeApp: lastActiveApp, activeWindow: lastActiveWindow });
        fs.unlinkSync(filePath);
        fs.unlinkSync(jpgPath);
      } catch {
        await uploadScreenshot(filePath, { activeApp: lastActiveApp, activeWindow: lastActiveWindow });
        try { fs.unlinkSync(filePath); } catch {}
      }
    } catch (err) {
      console.error('[Screenshot] Error:', (err as Error).message);
    }
  }, currentIntervalMs);

  console.log(`[Screenshot] Started with interval: ${currentIntervalMs / 1000}s`);
}

export function stopScreenshots() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
}

/**
 * Update screenshot interval dynamically (called when config changes)
 */
export function updateInterval(newIntervalMs: number) {
  if (newIntervalMs !== currentIntervalMs && newIntervalMs >= 10000) {
    console.log(`[Screenshot] Interval changed: ${currentIntervalMs / 1000}s → ${newIntervalMs / 1000}s`);
    currentIntervalMs = newIntervalMs;
    if (screenshotInterval) {
      startScreenshots(newIntervalMs); // restart with new interval
    }
  }
}

export function getCurrentInterval() { return currentIntervalMs; }
