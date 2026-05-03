import { Worker } from 'bullmq';
import { bullmqConnection, enqueueNotification } from '../queues.js';
import { logger } from '../../lib/logger.js';
import { backupService } from '../../modules/backup/backup.service.js';
import { prisma } from '../../lib/prisma.js';

// Notify all SUPER_ADMIN users in the org about a backup failure
async function notifyAdminsOfFailure(orgId: string, category: string, errorMessage: string) {
  try {
    const admins = await prisma.user.findMany({
      where: { organizationId: orgId, role: 'SUPER_ADMIN' },
      select: { id: true },
    });
    for (const admin of admins) {
      await enqueueNotification({
        userId: admin.id,
        organizationId: orgId,
        title: `⚠️ Scheduled ${category} Backup Failed`,
        message: `The weekly ${category.toLowerCase()} backup failed: ${errorMessage}. Check Settings → Database Backup and run a manual backup.`,
        type: 'BACKUP_FAILED',
        link: '/settings?tab=backup',
      }).catch(() => { /* non-blocking */ });
    }
  } catch (err: any) {
    logger.warn(`[Backup Worker] Could not send failure notifications: ${err.message}`);
  }
}

export function startBackupWorker() {
  // Reset any backups that got stuck IN_PROGRESS due to a previous crash/restart
  backupService.cleanupStuckBackups().catch((err: any) => {
    logger.warn(`[Backup Worker] Startup stuck-backup cleanup failed: ${err.message}`);
  });

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
          // Log + notify admins — do not abort files backup due to DB backup failure
          logger.error(`[Backup Worker] DB backup failed for org ${org.id}: ${err.message}`);
          await notifyAdminsOfFailure(org.id, 'Database', err.message);
        }

        // ── Files backup ─────────────────────────────────────────────────────
        try {
          await backupService.createBackup(org.id, 'SCHEDULED', undefined, 'FILES');
          logger.info(`[Backup Worker] Files backup completed for org ${org.id}`);
        } catch (err: any) {
          logger.error(`[Backup Worker] Files backup failed for org ${org.id}: ${err.message}`);
          await notifyAdminsOfFailure(org.id, 'Files', err.message);
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
