import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { emitToUser } from '../../sockets/index.js';

interface NotificationJob {
  userId: string;
  organizationId: string;
  title: string;
  message: string;
  type: string;
  link?: string;
}

export function startNotificationWorker() {
  const worker = new Worker<NotificationJob>(
    'notification',
    async (job: Job<NotificationJob>) => {
      try {
        const { userId, title, message, type, link } = job.data;

        // Emit via Socket.io to the target user
        emitToUser(userId, 'notification:new', {
          id: job.id,
          title,
          message,
          type,
          link,
          timestamp: new Date().toISOString(),
        });

        logger.info(`Notification sent to user ${userId}: ${title}`);
      } catch (err) {
        logger.error(`Notification worker failed for job ${job.id}:`, err);
        throw err;
      }
    },
    { connection: redis, concurrency: 10 }
  );

  worker.on('failed', (job, err) => {
    logger.error(`Notification job ${job?.id} failed:`, err);
  });

  logger.info('✅ Notification worker started');
  return worker;
}
