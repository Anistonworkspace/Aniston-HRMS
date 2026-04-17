import path from 'path';
import os from 'os';
import fs from 'fs';
import Store from 'electron-store';
import { uploadScreenshot, isLoggedIn } from './api';

let screenshotInterval: NodeJS.Timeout | null = null;
let currentIntervalMs = 600_000; // 10 minutes default
let lastActiveApp = 'Unknown';
let lastActiveWindow = '';

// ── Offline upload queue ──────────────────────────────────────────────────────
// When a screenshot upload fails (network down, server unreachable), we persist
// the file path to electron-store and retry on the next screenshot cycle.

interface QueuedScreenshot {
  filePath: string;
  metadata: { activeApp: string; activeWindow: string };
  queuedAt: number; // ms epoch — used to drop stale items
}

const queueStore = new Store<{ screenshotQueue: QueuedScreenshot[] }>({
  name: 'screenshot-queue',
  encryptionKey: 'aniston-agent-v1',
  defaults: { screenshotQueue: [] },
});
const QUEUE_KEY = 'screenshotQueue';
const MAX_QUEUE_SIZE = 20;           // Don't grow unbounded
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Drop items older than 24h

function getQueue(): QueuedScreenshot[] {
  return queueStore.get(QUEUE_KEY) || [];
}

function saveQueue(queue: QueuedScreenshot[]) {
  queueStore.set(QUEUE_KEY, queue);
}

function enqueue(item: QueuedScreenshot) {
  const queue = getQueue();
  queue.push(item);
  // Keep only the most recent MAX_QUEUE_SIZE items
  if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  saveQueue(queue);
}

async function retryQueue() {
  if (!isLoggedIn()) return;
  const queue = getQueue();
  if (queue.length === 0) return;

  const now = Date.now();
  // Filter: file must still exist and not be stale
  const toRetry = queue.filter(
    item => fs.existsSync(item.filePath) && now - item.queuedAt < MAX_AGE_MS
  );

  if (toRetry.length === 0) {
    saveQueue([]); // Clear empty/stale queue
    return;
  }

  console.log(`[Screenshot] Retrying ${toRetry.length} queued upload(s)`);
  const remaining: QueuedScreenshot[] = [];

  for (const item of toRetry) {
    try {
      await uploadScreenshot(item.filePath, item.metadata);
      try { fs.unlinkSync(item.filePath); } catch {}
      console.log(`[Screenshot] Queued upload succeeded: ${path.basename(item.filePath)}`);
    } catch {
      remaining.push(item); // Keep for next retry cycle
    }
  }

  saveQueue(remaining);
}

// ── Screenshot capture ────────────────────────────────────────────────────────

export function updateActiveWindow(app: string, window: string) {
  lastActiveApp = app;
  lastActiveWindow = window;
}

export function startScreenshots(intervalMs?: number) {
  stopScreenshots();
  currentIntervalMs = intervalMs || currentIntervalMs;

  screenshotInterval = setInterval(async () => {
    if (!isLoggedIn()) return;

    // Retry any previously failed uploads before capturing a new one
    await retryQueue();

    try {
      const screenshot = await import('screenshot-desktop');
      const tmpDir = path.join(os.tmpdir(), 'aniston-agent');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      const filename = `screenshot-${Date.now()}.png`;
      const filePath = path.join(tmpDir, filename);

      await screenshot.default({ filename: filePath, format: 'png' });

      const metadata = { activeApp: lastActiveApp, activeWindow: lastActiveWindow };

      try {
        const sharp = await import('sharp');
        const jpgPath = filePath.replace('.png', '.jpg');
        await sharp.default(filePath).resize(1280, 720, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(jpgPath);

        try {
          await uploadScreenshot(jpgPath, metadata);
          fs.unlinkSync(filePath);
          fs.unlinkSync(jpgPath);
        } catch (uploadErr) {
          // Upload failed — queue the jpg for retry; clean up the raw png
          console.warn('[Screenshot] Upload failed, queuing for retry:', (uploadErr as Error).message);
          try { fs.unlinkSync(filePath); } catch {}
          enqueue({ filePath: jpgPath, metadata, queuedAt: Date.now() });
        }
      } catch {
        // sharp compression failed — skip upload rather than sending a raw uncompressed PNG
        // (raw PNG is 5-10x larger than JPEG; uploading it wastes bandwidth and may exceed server limits)
        console.warn('[Screenshot] sharp compression failed — skipping upload to avoid oversized raw PNG');
        try { fs.unlinkSync(filePath); } catch {}
      }
    } catch (err) {
      console.error('[Screenshot] Capture error:', (err as Error).message);
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
 * Update screenshot interval dynamically (called when live mode config changes via socket).
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
