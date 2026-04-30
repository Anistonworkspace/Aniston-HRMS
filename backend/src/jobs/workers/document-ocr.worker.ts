import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
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
      // 1. Run Tesseract/PDF OCR extraction
      const ocrResult = await documentOcrService.triggerOcr(documentId, organizationId);
      logger.info(`[OCR Worker] OCR done for ${documentId} — confidence: ${ocrResult.confidence}`);

      // 2. Run LLM-based extraction (uses DeepSeek/configured AI to intelligently parse)
      // This fills gaps that Tesseract missed and applies OCR error corrections
      try {
        await documentOcrService.triggerLlmOcr(documentId, organizationId);
        logger.info(`[OCR Worker] LLM extraction done for ${documentId}`);
      } catch (llmErr: any) {
        // LLM is optional — if not configured or fails, we still have Tesseract data
        logger.warn(`[OCR Worker] LLM extraction skipped for ${documentId}: ${llmErr.message}`);
      }

      // 3. Get the document with employee info
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

      // 4. Auto cross-validate if employee has 2+ documents
      try {
        await documentOcrService.crossValidateEmployee(employee.id, organizationId);
        logger.info(`[OCR Worker] Cross-validation completed for employee ${employee.id}`);
      } catch (e: any) {
        logger.warn(`[OCR Worker] Cross-validation skipped: ${e.message}`);
      }

      // 5. Format validation (Aadhaar 12 digits, PAN ABCDE1234F, etc.)
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
            // Flag both Document and OcrVerification so statuses stay in sync
            await Promise.all([
              prisma.document.update({
                where: { id: documentId },
                data: {
                  status: 'FLAGGED',
                  rejectionReason: `Document number format issue: ${formatResult.errors.join('; ')}. Please verify.`,
                },
              }),
              prisma.documentOcrVerification.update({
                where: { documentId },
                data: {
                  ocrStatus: 'FLAGGED',
                  hrNotes: `Format validation failed: ${formatResult.errors.join('; ')}`,
                },
              }),
            ]);

            if (doc.employee.userId) {
              await enqueueNotification({
                userId: doc.employee.userId,
                organizationId,
                title: 'Document Needs Attention',
                message: `Your ${doc.type.replace(/_/g, ' ')} has a format issue: ${formatResult.errors[0]}. HR will review it.`,
                type: 'DOCUMENT_FLAGGED',
                link: '/my-documents',
              });
            }
            logger.warn(`[OCR Worker] Format validation issue for ${documentId}: ${formatResult.errors.join(', ')}`);
          }
        }
      } catch (e: any) {
        logger.warn(`[OCR Worker] Format validation error: ${e.message}`);
      }

      // 6. Check for tampering/fake indicators
      const isFake = doc.tamperDetected === true;
      const isScreenshot = ocrResult.isScreenshot === true;
      const tamperIndicators: string[] = Array.isArray(ocrResult.tamperingIndicators) ? ocrResult.tamperingIndicators as string[] : [];
      const hasIssues = isFake || isScreenshot || tamperIndicators.length > 0;

      // 7. If suspicious → alert HR (but do NOT auto-reject)
      if (hasIssues) {
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, adminNotificationEmail: true },
        });
        const hrEmail = org?.adminNotificationEmail || 'hr@anistonav.com';
        const frontendUrl = 'https://hr.anistonav.com';
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

        // In-app notification to HR users
        const hrUsers = await prisma.user.findMany({
          where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] } },
          select: { id: true },
        });
        for (const hrUser of hrUsers) {
          await enqueueNotification({
            userId: hrUser.id,
            organizationId,
            title: 'Document Needs Review',
            message: `${employee.firstName} ${employee.lastName} (${employee.employeeCode}) uploaded a ${doc.type.replace(/_/g, ' ')} with issues: ${issues[0]}`,
            type: 'DOCUMENT_ALERT',
            link: `/employees/${employee.id}`,
          });
        }

        // Sync both OCR status and Document status to FLAGGED
        await Promise.all([
          prisma.documentOcrVerification.update({
            where: { documentId },
            data: { ocrStatus: 'FLAGGED' },
          }),
          prisma.document.update({
            where: { id: documentId },
            data: {
              status: 'FLAGGED',
              tamperDetected: true,
              rejectionReason: `Suspicious indicators detected: ${issues[0]}. HR review required.`,
            },
          }),
        ]);

        logger.warn(`[OCR Worker] Suspicious document alert sent for ${documentId}`);
      }

      // 8. NEVER auto-reject — flag for HR when quality is low
      const lowConfidence = ocrResult.confidence < 0.3;
      const isLowQuality = ocrResult.resolutionQuality === 'LOW';
      if ((lowConfidence || isLowQuality) && !hasIssues) {
        const flagNote = lowConfidence
          ? 'Auto-flagged: Low OCR confidence. Document may be unclear — needs manual review.'
          : 'Auto-flagged: Low resolution image. Please verify document quality.';

        await Promise.all([
          prisma.documentOcrVerification.update({
            where: { documentId },
            data: { ocrStatus: 'FLAGGED', hrNotes: flagNote },
          }),
          prisma.document.update({
            where: { id: documentId },
            data: {
              status: 'FLAGGED',
              rejectionReason: flagNote,
            },
          }),
        ]);
        logger.info(`[OCR Worker] Document ${documentId} flagged for HR review (low quality/confidence)`);
      }

      // 9. Emit real-time progress to all org HR/admin users so batch "Run All KYC" has live feedback
      try {
        const { emitToOrg } = await import('../../sockets/index.js');
        const finalOcr = await prisma.documentOcrVerification.findUnique({
          where: { documentId },
          select: { ocrStatus: true, kycScore: true, confidence: true },
        });
        emitToOrg(organizationId, 'ocr:document-processed', {
          documentId,
          employeeId: employee.id,
          docType: doc.type,
          docName: doc.name,
          status: finalOcr?.ocrStatus ?? 'PENDING',
          kycScore: finalOcr?.kycScore ?? 0,
          confidence: finalOcr?.confidence ?? 0,
        });
      } catch (socketErr: any) {
        logger.warn(`[OCR Worker] Socket emit failed: ${socketErr.message}`);
      }

      return ocrResult;
    } catch (err: any) {
      logger.error(`[OCR Worker] Failed for document ${documentId}: ${err.message}`);
      // Even on failure, emit a failed event so the frontend counter still progresses
      try {
        const { emitToOrg } = await import('../../sockets/index.js');
        const failedDoc = await prisma.document.findUnique({
          where: { id: documentId },
          select: { type: true, name: true, employeeId: true },
        });
        if (failedDoc?.employeeId) {
          emitToOrg(organizationId, 'ocr:document-processed', {
            documentId,
            employeeId: failedDoc.employeeId,
            docType: failedDoc.type,
            docName: failedDoc.name,
            status: 'FAILED',
            kycScore: 0,
            confidence: 0,
          });
        }
      } catch { /* best-effort */ }
      throw err;
    }
  },
  {
    connection: bullmqConnection,
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
