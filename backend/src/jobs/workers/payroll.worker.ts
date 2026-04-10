import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { logger } from '../../lib/logger.js';
import { payrollService } from '../../modules/payroll/payroll.service.js';

interface PayrollJobData {
  type: 'PROCESS_PAYROLL';
  runId: string;
  organizationId: string;
  userId?: string;
}

export function startPayrollWorker() {
  const worker = new Worker<PayrollJobData>(
    'payroll-processing',
    async (job: Job<PayrollJobData>) => {
      const { type, runId, organizationId } = job.data;
      try {
        switch (type) {
          case 'PROCESS_PAYROLL': {
            logger.info(`[PayrollWorker] Processing payroll run ${runId}`);
            const result = await payrollService.processPayroll(runId, organizationId);
            logger.info(`[PayrollWorker] Payroll processed: ${result.processed} employees, net: ${result.totalNet}`);
            return result;
          }

          default:
            throw new Error(`Unknown payroll job type: ${type}`);
        }
      } catch (err: any) {
        logger.error(`[PayrollWorker] Job ${job.id} failed (type=${type}, runId=${runId}): ${err.message}`);
        throw err;
      }
    },
    {
      connection: bullmqConnection,
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
