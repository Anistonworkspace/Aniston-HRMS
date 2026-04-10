import { Worker } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { logger } from '../../lib/logger.js';
import { backupService } from '../../modules/backup/backup.service.js';
import { prisma } from '../../lib/prisma.js';

export function startBackupWorker() {
  const worker = new Worker(
    'database-backup',
    async (job) => {
      if (job.name !== 'scheduled-backup') return;

      logger.info('[Backup Worker] Starting scheduled backup cycle (DB + Files)...');

      const organizations = await prisma.organization.findMany({ select: { id: true } });

      for (const org of organizations) {
        // ── Database backup ──────────────────────────────────────────────────
        try {
          await backupService.createBackup(org.id, 'SCHEDULED', undefined, 'DATABASE');
          logger.info(`[Backup Worker] DB backup completed for org ${org.id}`);
        } catch (err: any) {
          // Log but continue — do not abort files backup due to DB backup failure
          logger.error(`[Backup Worker] DB backup failed for org ${org.id}: ${err.message}`);
        }

        // ── Files backup ─────────────────────────────────────────────────────
        try {
          await backupService.createBackup(org.id, 'SCHEDULED', undefined, 'FILES');
          logger.info(`[Backup Worker] Files backup completed for org ${org.id}`);
        } catch (err: any) {
          logger.error(`[Backup Worker] Files backup failed for org ${org.id}: ${err.message}`);
        }

        // ── Retention cleanup (keep 15 of each category per org) ────────────
        try {
          await backupService.applyRetentionPolicy(org.id, 15);
        } catch (err: any) {
          logger.warn(`[Backup Worker] Retention cleanup failed for org ${org.id}: ${err.message}`);
        }
      }

      logger.info('[Backup Worker] Scheduled backup cycle complete');
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  worker.on('completed', (job) => logger.info(`[Backup Worker] Job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`[Backup Worker] Job ${job?.id} failed: ${err.message}`));

  return worker;
}
