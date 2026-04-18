import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
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
    const upload = await prisma.bulkResumeUpload.findFirst({
      where: { id: uploadId, organizationId },
      include: {
        items: true,
        jobOpening: { select: { id: true, title: true, description: true, requirements: true } },
      },
    });

    if (!upload) {
      throw new Error(`Upload not found or org mismatch: ${uploadId}`);
    }

    const jobDescription = upload.jobOpening.description;
    const jobTitle = upload.jobOpening.title;
    const jobRequirements = upload.jobOpening.requirements;
    let processedCount = 0;

    // Process each item — uses real OCR + AI scoring pipeline (no mock/random data)
    for (const item of upload.items) {
      try {
        const result = await bulkResumeService.processResumeItem(
          item.id,
          jobDescription,
          jobTitle,
          jobRequirements,
          organizationId
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
        } catch (emitErr) {
          logger.debug(`[BulkResume] Socket emit failed for ${item.fileName}:`, emitErr);
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
        } catch (emitErr) {
          logger.debug(`[BulkResume] Socket emit (error) failed for ${item.fileName}:`, emitErr);
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
    connection: bullmqConnection,
    concurrency: 1, // Process one upload at a time
  }
);

resumeWorker.on('failed', (job, err) => {
  logger.error(`Resume worker failed for job ${job?.id}: ${err.message}`);
});

export { resumeWorker };
