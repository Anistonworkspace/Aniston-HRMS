import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { payrollService } from '../../modules/payroll/payroll.service.js';

interface PayrollJobData {
  type: 'PROCESS_PAYROLL' | 'BULK_EMAIL_SLIPS';
  runId: string;
  organizationId: string;
  userId?: string;
}

export function startPayrollWorker() {
  const worker = new Worker<PayrollJobData>(
    'payroll-processing',
    async (job: Job<PayrollJobData>) => {
      const { type, runId, organizationId } = job.data;

      switch (type) {
        case 'PROCESS_PAYROLL': {
          logger.info(`[PayrollWorker] Processing payroll run ${runId}`);
          const result = await payrollService.processPayroll(runId, organizationId);
          logger.info(`[PayrollWorker] Payroll processed: ${result.processed} employees, net: ${result.totalNet}`);
          return result;
        }

        case 'BULK_EMAIL_SLIPS': {
          logger.info(`[PayrollWorker] Sending salary slips for run ${runId}`);
          // Placeholder for bulk email functionality
          // This would iterate over all records and send individual PDFs via email worker
          return { sent: 0, message: 'Bulk email not yet implemented' };
        }

        default:
          throw new Error(`Unknown payroll job type: ${type}`);
      }
    },
    {
      connection: redis,
      concurrency: 1, // Process one payroll at a time
      limiter: {
        max: 1,
        duration: 5000,
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[PayrollWorker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[PayrollWorker] Job ${job?.id} failed:`, err.message);
  });

  logger.info('✅ Payroll worker started');

  return worker;
}
