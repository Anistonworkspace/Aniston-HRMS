import { Request, Response, NextFunction } from 'express';
import { documentService } from './document.service.js';
import { createDocumentSchema, verifyDocumentSchema, documentQuerySchema } from './document.validation.js';
import { enqueueDocumentOcr } from '../../jobs/queues.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { emitToUser } from '../../sockets/index.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';

export class DocumentController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = documentQuerySchema.parse(req.query);
      const result = await documentService.list(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const doc = await documentService.getById(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: doc });
    } catch (err) { next(err); }
  }

  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      // Clean up empty string fields from FormData (multer parses them as strings)
      if (req.body?.employeeId === '') delete req.body.employeeId;
      const data = createDocumentSchema.parse(req.body);
      // Use structured path if available (employee-specific KYC folder), else fallback to employee-documents/
      const fileUrl = (req as any)._structuredFileUrl ||
        (req.file ? storageService.buildUrl(StorageFolder.EMPLOYEE_DOCUMENTS, req.file.filename) : '');
      if (!fileUrl) {
        res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
        return;
      }

      // Auto-set employeeId from authenticated user if not provided
      if (!data.employeeId && req.user?.employeeId) {
        data.employeeId = req.user.employeeId;
      }

      const doc = await documentService.create(data, fileUrl, req.user!.userId);

      // Auto-update KYC document gate if this is a KYC document
      const kycTypes = ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE',
        'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE',
        'POST_GRADUATION_CERTIFICATE', 'EXPERIENCE_LETTER', 'OFFER_LETTER_DOC',
        'RELIEVING_LETTER', 'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'SALARY_SLIP_DOC',
        'RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF', 'PROFESSIONAL_CERTIFICATION', 'PHOTO'];
      if (data.employeeId && kycTypes.includes(data.type)) {
        try {
          const { documentGateService } = await import('../onboarding/document-gate.service.js');
          await documentGateService.checkDocumentSubmission(data.employeeId, data.type);
        } catch { /* non-blocking */ }
      }

      // Trigger async OCR processing — if enqueue fails, mark doc FLAGGED so it
      // doesn't sit as PENDING forever and HR / employee can see it needs attention.
      try {
        await enqueueDocumentOcr(doc.id, req.user!.organizationId);
      } catch (e: any) {
        logger.error(`[OCR] Failed to enqueue OCR job for document ${doc.id}: ${e?.message}`);
        try {
          await prisma.document.update({
            where: { id: doc.id },
            data: { status: 'FLAGGED', rejectionReason: 'OCR processing could not start. HR must review manually or re-run OCR.' },
          });
          // Notify the employee via socket so the UI updates immediately
          if (doc.employeeId) {
            const emp = await prisma.employee.findUnique({ where: { id: doc.employeeId }, select: { userId: true } });
            if (emp?.userId) {
              emitToUser(emp.userId, 'kyc:status-changed', {
                employeeId: doc.employeeId,
                status: 'OCR_FAILED',
                message: 'OCR processing could not start for your document. Please contact HR.',
              });
            }
          }
        } catch { /* best-effort — do not fail the upload response */ }
      }

      // Queue for consolidated HR email (5-min debounce per employee)
      if (data.employeeId) {
        try {
          const { enqueueDocumentDigest } = await import('../../jobs/queues.js');
          await enqueueDocumentDigest(data.employeeId, req.user!.organizationId, {
            type: data.type,
            name: data.name,
          });
        } catch (e) { logger.warn('Failed to enqueue document digest', e); }
      }

      res.status(201).json({ success: true, data: doc, message: 'Document uploaded' });
    } catch (err) { next(err); }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, rejectionReason } = verifyDocumentSchema.parse(req.body);
      const doc = await documentService.verify(req.params.id, status, req.user!.userId, rejectionReason, req.user!.organizationId);

      // Auto-verify KYC gate when HR verifies documents
      if (status === 'VERIFIED' && doc.employeeId) {
        try {
          const { documentGateService } = await import('../onboarding/document-gate.service.js');
          const gate = await documentGateService.getGate(doc.employeeId);

          if (gate && gate.kycStatus !== 'VERIFIED') {
            // Check if all required KYC documents (Aadhaar + PAN) are now verified
            const allDocs = await prisma.document.findMany({
              where: { employeeId: doc.employeeId, deletedAt: null },
            });
            const verifiedTypes = allDocs
              .filter((d: any) => d.status === 'VERIFIED')
              .map((d: any) => d.type);

            const hasPan = verifiedTypes.includes('PAN');
            const hasIdentity = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'].some(t => verifiedTypes.includes(t));
            const hasTenth = verifiedTypes.includes('TENTH_CERTIFICATE');
            const hasTwelfth = verifiedTypes.includes('TWELFTH_CERTIFICATE');
            const hasDegree = verifiedTypes.includes('DEGREE_CERTIFICATE');
            const hasResidence = verifiedTypes.includes('RESIDENCE_PROOF');
            const hasCancelledCheque = verifiedTypes.includes('CANCELLED_CHEQUE');

            if (hasPan && hasIdentity && hasTenth && hasTwelfth && hasDegree && hasResidence && hasCancelledCheque) {
              await documentGateService.verifyKyc(doc.employeeId, req.user!.userId);
              logger.info(`KYC auto-verified for employee ${doc.employeeId} — all required docs verified by HR`);
            }
          }
        } catch (err) {
          logger.warn('Failed to auto-verify KYC gate:', err);
        }
      }

      // Auto-fill employee profile from OCR data when document is verified
      let autoFilledFields: string[] = [];
      if (status === 'VERIFIED' && doc.employeeId) {
        try {
          autoFilledFields = await documentService.autoFillFromOcr(
            doc.id, doc.employeeId, req.user!.userId, req.user!.organizationId
          );
          if (autoFilledFields.length > 0) {
            logger.info(`OCR auto-filled [${autoFilledFields.join(', ')}] for employee ${doc.employeeId} from document ${doc.id}`);

            // Notify the employee via Socket.io that fields were auto-filled
            try {
              const emp = await prisma.employee.findUnique({ where: { id: doc.employeeId }, select: { userId: true } });
              if (emp?.userId) {
                emitToUser(emp.userId, 'document:verified', {
                  documentId: doc.id,
                  documentType: doc.type,
                  status: 'VERIFIED',
                  autoFilledFields,
                  message: `Your ${(doc.type || '').replace(/_/g, ' ')} was approved. ${autoFilledFields.join(', ')} auto-filled in your profile.`,
                });
              }
            } catch (socketErr) {
              logger.warn('Failed to emit document:verified event:', socketErr);
            }
          }
        } catch (err) {
          logger.warn('Failed to auto-fill from OCR:', err);
        }
      }

      // When HR rejects a document, reset KYC gate so employee must re-upload
      if (status === 'REJECTED' && doc.employeeId) {
        try {
          const { documentGateService } = await import('../onboarding/document-gate.service.js');
          await documentGateService.resetKycOnDocumentRejection(
            doc.employeeId,
            doc.type,
            rejectionReason || 'Document rejected by HR',
            req.user!.userId,
          );
        } catch (err) {
          logger.warn('Failed to reset KYC gate on document rejection:', err);
        }
      }

      res.json({
        success: true,
        data: doc,
        message: `Document ${status.toLowerCase()}`,
        autoFilledFields,
      });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      // HR can optionally supply a deletion reason — sent in request body
      const reason: string | undefined = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;

      // Fetch doc before deletion so we have employeeId, type, name for KYC reset + email
      const docToDelete = await documentService.getById(req.params.id as string, req.user!.organizationId);
      await documentService.remove(req.params.id, req.user!.userId, req.user!.organizationId);

      // Reset KYC gate if this doc was part of an employee's KYC submission
      if (docToDelete?.employeeId) {
        try {
          const { documentGateService } = await import('../onboarding/document-gate.service.js');
          // Detect combined PDFs by name pattern or OTHER type
          const name: string = (docToDelete as any).name || '';
          const isCombinedPdf =
            (docToDelete as any).type === 'OTHER' ||
            /combined|pre.?joining|all.?docs/i.test(name);

          await documentGateService.resetKycOnDocumentDeletion(
            docToDelete.employeeId,
            (docToDelete as any).type,
            reason,
            name,
            isCombinedPdf,
          );
        } catch (err) {
          logger.warn('Failed to reset KYC gate on document deletion:', err);
        }
      }

      res.json({ success: true, data: null, message: 'Document deleted' });
    } catch (err) { next(err); }
  }

  async myDocuments(req: Request, res: Response, next: NextFunction) {
    try {
      const docs = await documentService.getMyDocuments(req.user!.employeeId!);
      res.json({ success: true, data: docs });
    } catch (err) { next(err); }
  }

  async issueLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const { type } = req.body;
      const validTypes = ['OFFER_LETTER_DOC', 'JOINING_LETTER', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER'];
      if (!validTypes.includes(type)) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid letter type' } });
        return;
      }
      const doc = await documentService.issueLetterDocument(
        req.params.employeeId, type, req.user!.userId, req.user!.organizationId
      );
      res.status(201).json({ success: true, data: doc, message: `${type.replace(/_/g, ' ')} issued successfully` });
    } catch (err) { next(err); }
  }

  async stream(req: Request, res: Response, next: NextFunction) {
    try {
      const { readFileSync, existsSync } = await import('fs');
      const { extname } = await import('path');

      // HR/Admin/SuperAdmin see any doc in their org; employees see their own
      const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'].includes(req.user!.role);
      const doc = await prisma.document.findFirst({
        where: isManagement
          ? { id: req.params.id, deletedAt: null, employee: { organizationId: req.user!.organizationId } }
          : { id: req.params.id, deletedAt: null, employee: { userId: req.user!.userId } },
        select: { id: true, fileUrl: true, name: true },
      });

      if (!doc?.fileUrl) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
        return;
      }

      // ── Path traversal protection ────────────────────────────────────────────
      // Reject any fileUrl that contains traversal sequences before path resolution.
      const rawUrl = doc.fileUrl;
      const decodedUrl = decodeURIComponent(rawUrl);
      if (
        decodedUrl.includes('..') ||
        rawUrl.includes('%2e') || rawUrl.includes('%2E') ||
        rawUrl.includes('\0') ||
        decodedUrl.includes('\0')
      ) {
        logger.warn(`[Security] Path traversal attempt blocked — documentId: ${req.params.id}`);
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
        return;
      }

      // Use StorageService as single source of truth for path resolution.
      // storageService.resolvePath strips the leading /uploads/ prefix correctly,
      // avoiding the double-uploads bug (resolve(uploadsRoot, 'uploads/...') → .../uploads/uploads/...).
      const { sep } = await import('path');
      const uploadsRoot = storageService.getUploadsRoot();
      const filePath = storageService.resolvePath(rawUrl);

      // Ensure the resolved path cannot escape the uploads directory.
      if (!filePath.startsWith(uploadsRoot + sep) && filePath !== uploadsRoot) {
        logger.warn(`[Security] Resolved path escapes uploads root — documentId: ${req.params.id}`);
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
        return;
      }

      if (!existsSync(filePath)) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document file not found on disk' } });
        return;
      }

      // HEIC/HEIF → JPEG conversion for iPhone-uploaded files
      let servePath = filePath;
      let ext = extname(filePath).toLowerCase();
      if (ext === '.heic' || ext === '.heif') {
        const { convertHeicToJpeg } = await import('../../utils/heicConverter.js');
        const converted = await convertHeicToJpeg(filePath);
        if (converted !== filePath) { servePath = converted; ext = '.jpg'; }
      }

      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain', '.csv': 'text/csv',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const fileBuffer = readFileSync(servePath);

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="document${ext}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(fileBuffer.length),
      });
      res.send(fileBuffer);
    } catch (err) { next(err); }
  }
}

export const documentController = new DocumentController();
