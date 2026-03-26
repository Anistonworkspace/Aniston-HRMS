import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { bulkResumeService } from '../../modules/recruitment/bulk-resume.service.js';
import { emitToUser } from '../../sockets/index.js';

const resumeWorker = new Worker(
  'bulk-resume',
  async (job: Job) => {
    const { uploadId, organizationId, uploadedBy } = job.data;

    logger.info(`Processing bulk resume upload: ${uploadId}`);

    // Update upload status to PROCESSING
    await prisma.bulkResumeUpload.update({
      where: { id: uploadId },
      data: { status: 'PROCESSING' },
    });

    // Get upload with job info
    const upload = await prisma.bulkResumeUpload.findUnique({
      where: { id: uploadId },
      include: {
        items: true,
        jobOpening: { select: { title: true, description: true, requirements: true } },
      },
    });

    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    const jobDescription = upload.jobOpening.description;
    const jobRequirements = upload.jobOpening.requirements;
    let processedCount = 0;

    // Process each item
    for (const item of upload.items) {
      try {
        const result = await bulkResumeService.processResumeItem(
          item.id,
          jobDescription,
          jobRequirements
        );

        processedCount++;

        // Update processed count
        await prisma.bulkResumeUpload.update({
          where: { id: uploadId },
          data: { processedFiles: processedCount },
        });

        // Emit progress via Socket.io
        try {
          emitToUser(uploadedBy, 'bulk-resume-progress', {
            uploadId,
            itemId: item.id,
            fileName: item.fileName,
            status: 'SCORED',
            candidateName: result.candidateName,
            aiScore: result.aiScore,
            processed: processedCount,
            total: upload.items.length,
          });
        } catch {
          // Socket emission failure is non-blocking
        }

        logger.info(`Scored resume: ${item.fileName} → ${result.aiScore}/100`);
      } catch (error: any) {
        processedCount++;
        logger.error(`Failed to process resume ${item.fileName}: ${error.message}`);

        try {
          emitToUser(uploadedBy, 'bulk-resume-progress', {
            uploadId,
            itemId: item.id,
            fileName: item.fileName,
            status: 'FAILED',
            error: error.message,
            processed: processedCount,
            total: upload.items.length,
          });
        } catch {
          // Non-blocking
        }
      }
    }

    // Mark upload as complete
    await prisma.bulkResumeUpload.update({
      where: { id: uploadId },
      data: {
        status: 'COMPLETED',
        processedFiles: processedCount,
      },
    });

    logger.info(`Bulk resume upload completed: ${uploadId} (${processedCount}/${upload.items.length})`);
  },
  {
    connection: redis,
    concurrency: 1, // Process one upload at a time
  }
);

resumeWorker.on('failed', (job, err) => {
  logger.error(`Resume worker failed for job ${job?.id}: ${err.message}`);
});

export { resumeWorker };
