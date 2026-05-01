import path from 'path';
import os from 'os';
import fs from 'fs';
import Store from 'electron-store';
import { uploadScreenshot, isLoggedIn } from './api';
import { CONFIG } from './config';

let screenshotInterval: NodeJS.Timeout | null = null;
let currentIntervalMs = 600_000; // 10 minutes default
let lastActiveApp = 'Unknown';
let lastActiveWindow = '';

// ── Offline upload queue ──────────────────────────────────────────────────────
// When a screenshot upload fails (network down, server unreachable), we persist
// the file path to electron-store and retry on the next screenshot cycle.

interface QueuedScreenshot {
  filePath: string;
  metadata: { activeApp: string; activeWindow: string; timestamp: string };
  queuedAt: number; // ms epoch — used to drop stale items
}

const queueStore = new Store<{ screenshotQueue: QueuedScreenshot[] }>({
  name: 'screenshot-queue',
  encryptionKey: CONFIG.STORE_ENCRYPTION_KEY,
  defaults: { screenshotQueue: [] },
});
const QUEUE_KEY = 'screenshotQueue';
const MAX_QUEUE_SIZE = 20;           // Don't grow unbounded
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Drop items older than 24h
let retrying = false; // prevents concurrent retryQueue() executions (critical in live mode at 10-30s intervals)

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
  if (retrying || !isLoggedIn()) return;
  retrying = true;
  try {
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
    // Delay between retries to avoid hammering server when queue is large
    await new Promise(r => setTimeout(r, 1_000));
  }

  saveQueue(remaining);
  } finally {
    retrying = false;
  }
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
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

      const ts = new Date().toISOString();
      const filename = `screenshot-${Date.now()}.png`;
      const filePath = path.join(tmpDir, filename);

      await screenshot.default({ filename: filePath, format: 'png' });

      const metadata = { activeApp: lastActiveApp, activeWindow: lastActiveWindow, timestamp: ts };

      let uploadPath = filePath;
      let jpgPath: string | null = null;

      try {
        const sharp = await import('sharp');
        jpgPath = filePath.replace('.png', '.jpg');
        await sharp.default(filePath).resize(1280, 720, { fit: 'inside' }).jpeg({ quality: 70 }).toFile(jpgPath);
        uploadPath = jpgPath;
        try { fs.unlinkSync(filePath); } catch {}
      } catch {
        // sharp compression unavailable — fall back to raw PNG (larger but better than dropping)
        console.warn('[Screenshot] sharp compression failed — falling back to raw PNG');
      }

      try {
        await uploadScreenshot(uploadPath, metadata);
        try { fs.unlinkSync(uploadPath); } catch {}
      } catch (uploadErr) {
        console.warn('[Screenshot] Upload failed, queuing for retry:', (uploadErr as Error).message);
        enqueue({ filePath: uploadPath, metadata, queuedAt: Date.now() });
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
