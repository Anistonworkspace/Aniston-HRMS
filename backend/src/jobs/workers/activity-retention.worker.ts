import { Worker } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { storageService } from '../../services/storage.service.js';

const LOCK_KEY = 'activity-retention:lock';
const LOCK_TTL = 300; // 5 minutes — enough to complete a full retention sweep

/**
 * Delete ActivityLog rows + AgentScreenshot rows (and their files on disk)
 * older than ACTIVITY_RETENTION_DAYS. Runs once per day.
 *
 * Multi-replica safety: uses a Redis SET NX lock so only one instance
 * runs the cleanup when multiple backend replicas are deployed.
 */
async function runRetention(): Promise<{ logsDeleted: number; screenshotsDeleted: number; filesDeleted: number }> {
  const retentionDays = env.ACTIVITY_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.info(`[ActivityRetention] Starting cleanup — cutoff: ${cutoff.toISOString()} (${retentionDays}-day retention)`);

  // ── Delete activity logs ────────────────────────────────────────────────────
  const { count: logsDeleted } = await prisma.activityLog.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });
  logger.info(`[ActivityRetention] Deleted ${logsDeleted} ActivityLog rows`);

  // ── Delete screenshots (fetch URLs first, then delete rows, then delete files) ──
  // Fetch in batches to avoid loading thousands of rows into memory at once
  let screenshotsDeleted = 0;
  let filesDeleted = 0;
  const BATCH = 500;

  while (true) {
    const batch = await prisma.agentScreenshot.findMany({
      where: { timestamp: { lt: cutoff } },
      select: { id: true, imageUrl: true },
      take: BATCH,
    });
    if (batch.length === 0) break;

    const ids = batch.map(s => s.id);
    await prisma.agentScreenshot.deleteMany({ where: { id: { in: ids } } });
    screenshotsDeleted += batch.length;

    // Delete physical files — non-blocking per file so one bad path doesn't abort the sweep
    for (const s of batch) {
      if (s.imageUrl) {
        try {
          await storageService.deleteFile(s.imageUrl);
          filesDeleted++;
        } catch (err: any) {
          logger.warn(`[ActivityRetention] Could not delete file ${s.imageUrl}: ${err.message}`);
        }
      }
    }
  }

  logger.info(`[ActivityRetention] Deleted ${screenshotsDeleted} AgentScreenshot rows, ${filesDeleted} files`);
  return { logsDeleted, screenshotsDeleted, filesDeleted };
}

export function startActivityRetentionWorker() {
  if (env.ACTIVITY_CLEANUP_ENABLED !== 'true') {
    logger.info('[ActivityRetention] Cleanup disabled via ACTIVITY_CLEANUP_ENABLED=false');
    return null;
  }

  const worker = new Worker(
    'activity-retention',
    async (job) => {
      if (job.name !== 'cleanup') return;

      // Redis lock — prevents concurrent runs across replicas
      const locked = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL, 'NX');
      if (!locked) {
        logger.info('[ActivityRetention] Lock held by another replica — skipping this cycle');
        return;
      }

      try {
        const result = await runRetention();
        logger.info('[ActivityRetention] Cleanup complete', result);
      } finally {
        await redis.del(LOCK_KEY);
      }
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.info(`[ActivityRetention] Job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`[ActivityRetention] Job ${job?.id} failed: ${err.message}`));

  logger.info('[ActivityRetention] Worker started');
  return worker;
}

/**
 * Run retention synchronously — used by the CLI script and manual triggers.
 * Does NOT use Redis lock (caller is responsible for ensuring single execution).
 */
export async function runRetentionNow() {
  return runRetention();
}
