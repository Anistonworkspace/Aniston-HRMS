import path from 'path';
import os from 'os';
import fs from 'fs';
import { CONFIG } from './config';
import { uploadScreenshot, isLoggedIn } from './api';

let screenshotInterval: NodeJS.Timeout | null = null;
let lastActiveApp = 'Unknown';
let lastActiveWindow = '';

export function updateActiveWindow(app: string, window: string) {
  lastActiveApp = app;
  lastActiveWindow = window;
}

export function startScreenshots() {
  if (screenshotInterval) return;

  screenshotInterval = setInterval(async () => {
    if (!isLoggedIn()) return;

    try {
      const screenshot = await import('screenshot-desktop');
      const tmpDir = path.join(os.tmpdir(), 'aniston-agent');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const filename = `screenshot-${Date.now()}.png`;
      const filePath = path.join(tmpDir, filename);

      // Capture screenshot
      await screenshot.default({ filename: filePath, format: 'png' });

      // Try to compress with sharp if available
      try {
        const sharp = await import('sharp');
        const jpgPath = filePath.replace('.png', '.jpg');
        await sharp.default(filePath).resize(1280, 720, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(jpgPath);
        // Upload compressed version
        await uploadScreenshot(jpgPath, { activeApp: lastActiveApp, activeWindow: lastActiveWindow });
        // Cleanup
        fs.unlinkSync(filePath);
        fs.unlinkSync(jpgPath);
      } catch {
        // If sharp fails, upload raw PNG
        await uploadScreenshot(filePath, { activeApp: lastActiveApp, activeWindow: lastActiveWindow });
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('[Screenshot] Error:', (err as Error).message);
    }
  }, CONFIG.SCREENSHOT_INTERVAL_MS);
}

export function stopScreenshots() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
}
