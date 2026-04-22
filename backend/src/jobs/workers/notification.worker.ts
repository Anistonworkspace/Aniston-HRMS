import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { logger } from '../../lib/logger.js';
import { emitToUser } from '../../sockets/index.js';
import { prisma } from '../../lib/prisma.js';

interface NotificationJob {
  userId: string;
  organizationId: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  data?: Record<string, unknown>;
}

export function startNotificationWorker() {
  const worker = new Worker<NotificationJob>(
    'notification',
    async (job: Job<NotificationJob>) => {
      try {
        const { userId, organizationId, title, message, type, link, data } = job.data;

        // Persist notification to database first
        let dbNotification: { id: string } | null = null;
        try {
          dbNotification = await prisma.notification.create({
            data: {
              userId,
              organizationId,
              type,
              title,
              message,
              data: data ? { ...data, ...(link ? { link } : {}) } : (link ? { link } : undefined),
            },
            select: { id: true },
          });
        } catch (dbErr) {
          // Non-fatal — still deliver via socket even if DB write fails
          logger.error(`Notification DB persist failed for user ${userId}:`, dbErr);
        }

        // Emit via Socket.io to the target user
        emitToUser(userId, 'notification:new', {
          id: dbNotification?.id ?? job.id,
          title,
          message,
          type,
          link,
          data,
          timestamp: new Date().toISOString(),
        });

        logger.info(`Notification sent to user ${userId}: ${title}`);
      } catch (err) {
        logger.error(`Notification worker failed for job ${job.id}:`, err);
        throw err;
      }
    },
    { connection: bullmqConnection, concurrency: 10 }
  );

  worker.on('failed', (job, err) => {
    logger.error(`Notification job ${job?.id} failed:`, err);
  });

  logger.info('✅ Notification worker started');
  return worker;
}
