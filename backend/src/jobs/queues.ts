import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const connection = { connection: redis };

export const emailQueue = new Queue('email', connection);
export const notificationQueue = new Queue('notification', connection);
export const payrollQueue = new Queue('payroll-processing', connection);

logger.info('✅ BullMQ queues initialized');

// Helper to enqueue an email job
export async function enqueueEmail(data: {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
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
