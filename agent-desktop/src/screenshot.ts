import path from 'path';
import os from 'os';
import fs from 'fs';
import Store from 'electron-store';
import { app } from 'electron';
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

// Safe store initializer — mirrors the one in main.ts.
// The screenshot-queue store uses an encryption key because it may hold
// temporary file paths; corruption from a key mismatch must not crash the app.
function createQueueStore(): Store<{ screenshotQueue: QueuedScreenshot[] }> {
  const storeName = 'screenshot-queue';
  let storeFilePath: string | null = null;
  try {
    const userData = app.getPath('userData');
    storeFilePath = path.join(userData, `${storeName}.json`);
  } catch { /* app not ready yet — will be fine by first use */ }

  if (storeFilePath && fs.existsSync(storeFilePath)) {
    try {
      const raw = fs.readFileSync(storeFilePath, 'utf-8');
      JSON.parse(raw);
    } catch {
      const backupPath = `${storeFilePath}.corrupt.${Date.now()}.bak`;
      try {
        fs.renameSync(storeFilePath, backupPath);
        console.warn(`[Screenshot] Corrupt queue store backed up to: ${backupPath}`);
      } catch {
        try { fs.unlinkSync(storeFilePath); } catch { /* ignore */ }
      }
    }
  }

  // A-018: Remove encryptionKey from the screenshot-queue store.
  // The store only holds temporary local file paths — not credentials or PII.
  // The encryption key is derived from hostname+username; if the machine is renamed or the
  // user profile changes (common after Windows domain migrations), the key changes and the
  // previously encrypted file becomes unreadable, producing a JSON corruption crash.
  // File paths are not sensitive enough to warrant this fragility risk.
  try {
    return new Store<{ screenshotQueue: QueuedScreenshot[] }>({
      name: storeName,
      defaults: { screenshotQueue: [] },
    });
  } catch (err) {
    console.error('[Screenshot] Queue store constructor failed — resetting:', err);
    if (storeFilePath) {
      try { fs.unlinkSync(storeFilePath); } catch { /* ignore */ }
    }
    return new Store<{ screenshotQueue: QueuedScreenshot[] }>({
      name: storeName,
      defaults: { screenshotQueue: [] },
    });
  }
}

// Lazily initialised — created on first use after app is ready.
let queueStore: Store<{ screenshotQueue: QueuedScreenshot[] }> | null = null;

function getQueueStore(): Store<{ screenshotQueue: QueuedScreenshot[] }> {
  if (!queueStore) queueStore = createQueueStore();
  return queueStore;
}

const QUEUE_KEY = 'screenshotQueue';
const MAX_QUEUE_SIZE = 20;           // Don't grow unbounded
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Drop items older than 24h
let retrying = false; // prevents concurrent retryQueue() executions (critical in live mode at 10-30s intervals)

function getQueue(): QueuedScreenshot[] {
  try {
    return getQueueStore().get(QUEUE_KEY) || [];
  } catch { return []; }
}

function saveQueue(queue: QueuedScreenshot[]) {
  try {
    getQueueStore().set(QUEUE_KEY, queue);
  } catch (err) {
    console.warn('[Screenshot] Failed to save queue:', (err as Error).message);
  }
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

    // A-015: Delete files that were dropped from the queue (stale or missing)
    const dropped = queue.filter(
      item => !toRetry.find(r => r.filePath === item.filePath)
    );
    for (const item of dropped) {
      try { fs.unlinkSync(item.filePath); } catch { /* already deleted or never existed */ }
    }

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
      const hostname = os.hostname().replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20);
      const filename = `screenshot-${hostname}-${Date.now()}.png`;
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
  // AGENT-003: Allow up to 3600s (60 min) — admin can set long intervals for low-frequency monitoring.
  // Previous cap of 600s silently ignored any admin-configured interval > 10 min.
  const clamped = Math.max(30_000, Math.min(3_600_000, newIntervalMs));
  if (clamped !== currentIntervalMs) {
    console.log(`[Screenshot] Interval changed: ${currentIntervalMs / 1000}s → ${clamped / 1000}s`);
    currentIntervalMs = clamped;
    if (screenshotInterval) {
      startScreenshots(clamped); // restart with new interval
    }
  }
}

export function getCurrentInterval() { return currentIntervalMs; }
