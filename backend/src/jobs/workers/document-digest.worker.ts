import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { bullmqConnection, enqueueEmail } from '../queues.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';

interface DigestJob {
  employeeId: string;
  organizationId: string;
}

const worker = new Worker<DigestJob>(
  'document-digest',
  async (job: Job<DigestJob>) => {
    const { employeeId, organizationId } = job.data;
    const key = `doc-digest:${organizationId}:${employeeId}`;
    try {

    // Read all buffered documents
    const items = await redis.lrange(key, 0, -1);
    await redis.del(key);

    if (items.length === 0) return;

    const documents = items.map(i => {
      try { return JSON.parse(i); } catch { return null; }
    }).filter(Boolean);

    // Fetch employee and org info
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, adminNotificationEmail: true },
    });

    if (!employee) return;

    const hrEmail = org?.adminNotificationEmail || 'hr@anistonav.com';
    const frontendUrl = 'https://hr.anistonav.com';

    await enqueueEmail({
      to: hrEmail,
      subject: `${documents.length} Document${documents.length > 1 ? 's' : ''} Uploaded by ${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
      template: 'document-batch-submitted',
      context: {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeCode: employee.employeeCode,
        documents,
        reviewUrl: `${frontendUrl}/employees/${employeeId}`,
        orgName: org?.name || 'Aniston Technologies',
      },
    });

    logger.info(`[Document Digest] Sent consolidated email for ${documents.length} docs from ${employee.employeeCode}`);
    } catch (err: any) {
      logger.error(`[Document Digest] Job ${job.id} failed for employee ${employeeId}: ${err.message}`);
      throw err;
    }
  },
  { connection: bullmqConnection, concurrency: 5 }
);

worker.on('completed', (job) => {
  logger.info(`[Document Digest] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`[Document Digest] Job ${job?.id} failed: ${err.message}`);
});

export { worker as documentDigestWorker };
