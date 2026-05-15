import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

// BullMQ has its own nested ioredis, causing type incompatibility with the shared Redis
// instance. Pass connection options (URL-based) so BullMQ resolves its own connection.
export const bullmqConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null as null,
};

// G-04: Default retry options for all queues — 3 attempts with exponential back-off.
// Without this, BullMQ defaults to 1 attempt and 0 retries, meaning any failed job
// (email, OCR, payroll) is permanently lost on first failure.
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 200 },
};

const connection = { connection: bullmqConnection, defaultJobOptions };

export const emailQueue = new Queue('email', connection);
export const notificationQueue = new Queue('notification', connection);
export const payrollQueue = new Queue('payroll-processing', connection);
export const bulkResumeQueue = new Queue('bulk-resume', connection);
export const documentOcrQueue = new Queue('document-ocr', connection);
export const backupQueue = new Queue('database-backup', connection);
export const activityRetentionQueue = new Queue('activity-retention', connection);

export const attendanceCronQueue = new Queue('attendance-cron', connection);
export const leaveCarryForwardQueue = new Queue('leave-carry-forward', connection);

logger.info('✅ BullMQ queues initialized');

// Schedule backup cron job: every day at 02:00 UTC
// This covers both database backup + uploaded files backup in one job.
(async () => {
  try {
    // Remove only scheduled-backup repeatable jobs (not any future jobs added to this queue)
    const existingBackupJobs = await backupQueue.getRepeatableJobs();
    for (const job of existingBackupJobs) {
      if (job.name === 'scheduled-backup') {
        await backupQueue.removeRepeatableByKey(job.key);
      }
    }
    await backupQueue.add('scheduled-backup', {}, {
      repeat: { pattern: '0 2 * * *' }, // 02:00 UTC every day
    });
    logger.info('✅ Backup cron job scheduled (daily at 02:00 UTC — DB + Files)');
  } catch (err) {
    logger.warn('Failed to schedule backup cron job:', err);
  }
})();

// Schedule attendance cron jobs (IST 23:59 = UTC 18:29, IST 00:04 = UTC 18:34)
(async () => {
  try {
    // Remove old repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await attendanceCronQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await attendanceCronQueue.removeRepeatableByKey(job.key);
    }
    // Auto-close stale records at 23:59 IST daily
    await attendanceCronQueue.add('auto-close-stale', {}, {
      repeat: { pattern: '29 18 * * *' }, // 18:29 UTC = 23:59 IST
    });
    // Auto-mark absent at 00:04 IST daily (for previous day)
    await attendanceCronQueue.add('auto-mark-absent', {}, {
      repeat: { pattern: '34 18 * * *' }, // 18:34 UTC = 00:04 IST
    });
    // Auto-detect anomalies at 00:15 IST daily (after close + absent marking settle)
    await attendanceCronQueue.add('auto-detect-anomalies', {}, {
      repeat: { pattern: '45 18 * * *' }, // 18:45 UTC = 00:15 IST
    });
    // GPS heartbeat monitor — every 10 min, detects force-stopped apps
    await attendanceCronQueue.add('gps-heartbeat-monitor', {}, {
      jobId: 'gps-heartbeat-monitor',
      repeat: { every: 10 * 60 * 1000 }, // every 10 minutes
    });
    // Shift-end checkout reminder — every 15 min between 16:00–23:59 IST
    await attendanceCronQueue.add('shift-end-reminder', {}, {
      jobId: 'shift-end-reminder',
      repeat: { every: 15 * 60 * 1000 }, // every 15 minutes
    });
    // GPS trail purge — every Sunday at 02:00 IST (20:30 UTC Saturday)
    await attendanceCronQueue.add('purge-gps-trail', {}, {
      repeat: { pattern: '30 20 * * 0' }, // 20:30 UTC Sunday = 02:00 IST Monday
    });
    logger.info('✅ Attendance cron jobs scheduled');
  } catch (err) {
    logger.warn('Failed to schedule attendance cron jobs:', err);
  }
})();

// Schedule leave carry-forward cron: April 1 at 01:00 UTC (Indian FY start)
// Also supports manual trigger via leaveCarryForwardQueue.add('year-end-carry-forward', { targetYear: 2026 })
(async () => {
  try {
    const existingCFJobs = await leaveCarryForwardQueue.getRepeatableJobs();
    for (const job of existingCFJobs) {
      await leaveCarryForwardQueue.removeRepeatableByKey(job.key);
    }
    await leaveCarryForwardQueue.add('year-end-carry-forward', {}, {
      repeat: { pattern: '0 1 1 4 *' }, // 01:00 UTC on April 1 every year
    });
    logger.info('✅ Leave carry-forward cron scheduled (April 1 at 01:00 UTC)');
  } catch (err) {
    logger.warn('Failed to schedule leave carry-forward cron:', err);
  }
})();

// Schedule activity data retention: configurable via ACTIVITY_CLEANUP_CRON (default 03:00 UTC)
if (env.ACTIVITY_CLEANUP_ENABLED === 'true') {
  (async () => {
    try {
      const existing = await activityRetentionQueue.getRepeatableJobs();
      for (const job of existing) {
        if (job.name === 'cleanup') await activityRetentionQueue.removeRepeatableByKey(job.key);
      }
      await activityRetentionQueue.add('cleanup', {}, {
        repeat: { pattern: env.ACTIVITY_CLEANUP_CRON },
      });
      logger.info(`✅ Activity retention cron scheduled (${env.ACTIVITY_CLEANUP_CRON} UTC, ${env.ACTIVITY_RETENTION_DAYS}-day window)`);
    } catch (err) {
      logger.warn('Failed to schedule activity retention cron:', err);
    }
  })();
}

// Helper to enqueue an email job
export async function enqueueEmail(data: {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
  attachments?: { filename: string; path: string }[];
}) {
  return emailQueue.add('send-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

// Helper to enqueue a notification
export async function enqueueNotification(data: {
  userId: string;
  organizationId: string;
  title: string;
  message: string;
  type: string;
  link?: string;
}) {
  return notificationQueue.add('push-notification', data, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 1000 },
  });
}

// Helper to enqueue document OCR processing
// timeout: 120s — enough for a large multi-page PDF (images: 60s, PDFs: 120s)
export async function enqueueDocumentOcr(documentId: string, organizationId: string) {
  return documentOcrQueue.add('process-document-ocr', { documentId, organizationId }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });
}

// Document digest: batched HR email (5-min debounce per employee)
export const documentDigestQueue = new Queue('document-digest', { connection: bullmqConnection });

export async function enqueueDocumentDigest(employeeId: string, organizationId: string, documentInfo: { type: string; name: string }) {
  const key = `doc-digest:${organizationId}:${employeeId}`;
  await redis.rpush(key, JSON.stringify(documentInfo));
  await redis.expire(key, 600);
  const jobId = `digest-${organizationId}-${employeeId}`;
  // Remove existing delayed job if any (to restart the 5-min timer)
  try {
    const existing = await documentDigestQueue.getJob(jobId);
    if (existing && (await existing.getState()) === 'delayed') {
      await existing.remove();
    }
  } catch { /* ignore */ }
  await documentDigestQueue.add('send-digest', { employeeId, organizationId }, {
    delay: 5 * 60 * 1000,
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

// Helper to enqueue bulk resume processing
export async function enqueueBulkResume(uploadId: string, organizationId: string, uploadedBy: string) {
  return bulkResumeQueue.add('process-bulk-resume', { uploadId, organizationId, uploadedBy }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  });
}
