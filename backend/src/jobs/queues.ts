import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const connection = { connection: redis };

export const emailQueue = new Queue('email', connection);
export const notificationQueue = new Queue('notification', connection);
export const payrollQueue = new Queue('payroll-processing', connection);
export const bulkResumeQueue = new Queue('bulk-resume', connection);
export const documentOcrQueue = new Queue('document-ocr', connection);

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

// Helper to enqueue document OCR processing
export async function enqueueDocumentOcr(documentId: string, organizationId: string) {
  return documentOcrQueue.add('process-document-ocr', { documentId, organizationId }, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

// Document digest: batched HR email (5-min debounce per employee)
export const documentDigestQueue = new Queue('document-digest', connection);

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
    attempts: 1,
  });
}
