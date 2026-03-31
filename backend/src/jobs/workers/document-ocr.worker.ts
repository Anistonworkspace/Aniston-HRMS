import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { documentOcrService } from '../../modules/document-ocr/document-ocr.service.js';

interface DocumentOcrJob {
  documentId: string;
  organizationId: string;
}

const worker = new Worker<DocumentOcrJob>(
  'document-ocr',
  async (job: Job<DocumentOcrJob>) => {
    const { documentId, organizationId } = job.data;
    logger.info(`[OCR Worker] Processing document ${documentId}`);

    try {
      const result = await documentOcrService.triggerOcr(documentId, organizationId);
      logger.info(`[OCR Worker] Completed document ${documentId} — confidence: ${result.confidence}`);
      return result;
    } catch (err: any) {
      logger.error(`[OCR Worker] Failed for document ${documentId}: ${err.message}`);
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 3,
  }
);

worker.on('completed', (job) => {
  logger.info(`[OCR Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`[OCR Worker] Job ${job?.id} failed: ${err.message}`);
});

export { worker as documentOcrWorker };
