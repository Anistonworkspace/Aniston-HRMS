import { Worker } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { backupService } from '../../modules/backup/backup.service.js';
import { prisma } from '../../lib/prisma.js';

export function startBackupWorker() {
  const worker = new Worker(
    'database-backup',
    async (job) => {
      if (job.name !== 'scheduled-backup') return;

      logger.info('[Backup Worker] Starting scheduled database backup...');

      // Run backup for every organization (multi-tenant)
      const organizations = await prisma.organization.findMany({
        select: { id: true },
      });

      for (const org of organizations) {
        try {
          await backupService.createBackup(org.id, 'SCHEDULED');
          // Apply retention: keep at most 15 completed backups per org
          await backupService.applyRetentionPolicy(org.id, 15);
        } catch (err: any) {
          logger.error(`[Backup Worker] Failed for org ${org.id}: ${err.message}`);
          // Continue with other orgs, do not throw
        }
      }

      logger.info('[Backup Worker] Scheduled backup cycle complete');
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on('completed', (job) => {
    logger.info(`[Backup Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Backup Worker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
