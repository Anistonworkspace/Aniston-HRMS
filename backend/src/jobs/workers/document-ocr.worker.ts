import { Worker, Job } from 'bullmq';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { documentOcrService } from '../../modules/document-ocr/document-ocr.service.js';
import { enqueueEmail, enqueueNotification } from '../queues.js';
import { validateDocumentFormat } from '../../utils/documentFormatValidator.js';

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
      // 1. Run OCR extraction
      const ocrResult = await documentOcrService.triggerOcr(documentId, organizationId);
      logger.info(`[OCR Worker] OCR done for ${documentId} — confidence: ${ocrResult.confidence}`);

      // 1b. Run LLM-based OCR extraction in parallel (non-blocking)
      try {
        await documentOcrService.triggerLlmOcr(documentId, organizationId);
        logger.info(`[OCR Worker] LLM OCR done for ${documentId}`);
      } catch (llmErr: any) {
        logger.warn(`[OCR Worker] LLM OCR failed for ${documentId}: ${llmErr.message}`);
      }

      // 2. Get the document to find the employee
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, userId: true },
          },
        },
      });
      if (!doc?.employee) return ocrResult;

      const employee = doc.employee;

      // 3. Auto cross-validate if employee has 2+ documents with OCR data
      try {
        await documentOcrService.crossValidateEmployee(employee.id, organizationId);
        logger.info(`[OCR Worker] Cross-validation completed for employee ${employee.id}`);
      } catch (e: any) {
        logger.warn(`[OCR Worker] Cross-validation skipped: ${e.message}`);
      }

      // 3b. Format validation (Aadhaar 12 digits, PAN ABCDE1234F, etc.)
      try {
        const ocrVerification = await prisma.documentOcrVerification.findUnique({
          where: { documentId },
        });
        if (ocrVerification?.extractedDocNumber) {
          const formatResult = validateDocumentFormat(doc.type, ocrVerification.extractedDocNumber);
          await prisma.documentOcrVerification.update({
            where: { documentId },
            data: {
              formatValid: formatResult.valid,
              formatErrors: formatResult.errors as any,
            },
          });

          if (!formatResult.valid) {
            // Flag the document
            await prisma.document.update({
              where: { id: documentId },
              data: {
                status: 'FLAGGED',
                rejectionReason: `Document number format invalid: ${formatResult.errors.join('; ')}`,
              },
            });

            // Notify employee
            if (doc.employee.userId) {
              await enqueueNotification({
                userId: doc.employee.userId,
                organizationId,
                title: 'Document Flagged',
                message: `Your ${doc.type.replace(/_/g, ' ')} has been flagged: ${formatResult.errors[0]}. Please re-upload a valid document.`,
                type: 'DOCUMENT_FLAGGED',
                link: '/my-documents',
              });
            }
            logger.warn(`[OCR Worker] Format validation failed for ${documentId}: ${formatResult.errors.join(', ')}`);
          }
        }
      } catch (e: any) {
        logger.warn(`[OCR Worker] Format validation error: ${e.message}`);
      }

      // 4. Check for issues — fake/tampered/low quality
      const isFake = doc.tamperDetected === true;
      const isScreenshot = ocrResult.isScreenshot === true;
      const isLowQuality = ocrResult.resolutionQuality === 'LOW';
      const lowConfidence = ocrResult.confidence < 0.4;
      const tamperIndicators: string[] = Array.isArray(ocrResult.tamperingIndicators) ? ocrResult.tamperingIndicators : [];
      const hasIssues = isFake || isScreenshot || tamperIndicators.length > 0;
      const isInvalid = isLowQuality || lowConfidence;

      // 5. If fake/tampered → alert HR via email + in-app notification
      if (hasIssues) {
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, adminNotificationEmail: true },
        });
        const hrEmail = org?.adminNotificationEmail || 'hr@anistonav.com';
        const frontendUrl = process.env.FRONTEND_URL || 'https://hr.anistonav.com';
        const issues = [
          ...(isFake ? ['Document may be altered or fake'] : []),
          ...(isScreenshot ? ['Screenshot detected instead of original scan'] : []),
          ...tamperIndicators,
        ];

        // Email HR
        await enqueueEmail({
          to: hrEmail,
          subject: `ALERT: Suspicious Document Uploaded by ${employee.firstName} ${employee.lastName}`,
          template: 'document-tamper-alert',
          context: {
            employeeName: `${employee.firstName} ${employee.lastName}`,
            employeeCode: employee.employeeCode,
            documentType: doc.type.replace(/_/g, ' '),
            documentName: doc.name,
            issues,
            reviewUrl: `${frontendUrl}/employees/${employee.id}`,
            orgName: org?.name || 'Aniston Technologies',
          },
        });

        // In-app notification to all HR/Admin users
        const hrUsers = await prisma.user.findMany({
          where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, deletedAt: null },
          select: { id: true },
        });
        for (const hrUser of hrUsers) {
          await enqueueNotification({
            userId: hrUser.id,
            organizationId,
            title: 'Suspicious Document Detected',
            message: `${employee.firstName} ${employee.lastName} (${employee.employeeCode}) uploaded a ${doc.type.replace(/_/g, ' ')} that appears suspicious: ${issues[0]}`,
            type: 'DOCUMENT_ALERT',
            link: `/employees/${employee.id}`,
          });
        }

        // Mark OCR status as FLAGGED
        await prisma.documentOcrVerification.update({
          where: { documentId },
          data: { ocrStatus: 'FLAGGED' },
        });

        logger.warn(`[OCR Worker] FAKE/TAMPER alert sent for document ${documentId}`);

        // Notify employee about flagged document
        if (doc.employee.userId) {
          await enqueueNotification({
            userId: doc.employee.userId,
            organizationId,
            title: 'Document Requires Attention',
            message: `Your ${doc.type.replace(/_/g, ' ')} has been flagged for review: ${issues[0]}. Please check your documents page.`,
            type: 'DOCUMENT_FLAGGED',
            link: '/my-documents',
          });
        }
      }

      // 6. If invalid quality → mark document for re-upload
      if (isInvalid && !hasIssues) {
        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: 'REJECTED',
            rejectionReason: lowConfidence
              ? 'Document is unclear or unreadable. Please upload a clear, original scan.'
              : 'Document image quality is too low. Please upload a higher resolution scan.',
          },
        });
        logger.info(`[OCR Worker] Document ${documentId} auto-rejected for low quality`);
      }

      return ocrResult;
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
