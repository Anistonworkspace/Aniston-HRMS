import { Request, Response, NextFunction } from 'express';
import { documentService } from './document.service.js';
import { createDocumentSchema, verifyDocumentSchema, documentQuerySchema } from './document.validation.js';
import { enqueueDocumentOcr, enqueueEmail } from '../../jobs/queues.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

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
      const doc = await documentService.getById(req.params.id);
      res.json({ success: true, data: doc });
    } catch (err) { next(err); }
  }

  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDocumentSchema.parse(req.body);
      // Use structured path if available (employee-specific folder), else default
      const fileUrl = (req as any)._structuredFileUrl || (req.file ? `/uploads/${req.file.filename}` : '');
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
      const kycTypes = ['AADHAAR', 'PAN'];
      if (data.employeeId && kycTypes.includes(data.type)) {
        try {
          const { documentGateService } = await import('../onboarding/document-gate.service.js');
          await documentGateService.checkDocumentSubmission(data.employeeId, data.type);
        } catch { /* non-blocking */ }
      }

      // Trigger async OCR processing (non-blocking)
      try {
        await enqueueDocumentOcr(doc.id, req.user!.organizationId);
      } catch (e) { logger.warn('Failed to enqueue OCR job', e); }

      // Send HR notification email (non-blocking)
      try {
        const org = await prisma.organization.findUnique({
          where: { id: req.user!.organizationId },
          select: { name: true, adminNotificationEmail: true },
        });
        const employee = data.employeeId
          ? await prisma.employee.findUnique({
              where: { id: data.employeeId },
              select: { firstName: true, lastName: true, employeeCode: true },
            })
          : null;
        const hrEmail = org?.adminNotificationEmail || 'hr@anistonav.com';
        const frontendUrl = process.env.FRONTEND_URL || 'https://hr.anistonav.com';
        await enqueueEmail({
          to: hrEmail,
          subject: `Document Uploaded: ${data.type.replace(/_/g, ' ')} by ${employee ? `${employee.firstName} ${employee.lastName}` : 'Employee'}`,
          template: 'document-submitted',
          context: {
            employeeName: employee ? `${employee.firstName} ${employee.lastName}` : 'Employee',
            employeeCode: employee?.employeeCode || '',
            documentType: data.type,
            documentName: data.name,
            reviewUrl: data.employeeId ? `${frontendUrl}/employees/${data.employeeId}` : `${frontendUrl}/settings`,
            orgName: org?.name || 'Aniston Technologies',
          },
        });
      } catch (e) { logger.warn('Failed to send HR notification email', e); }

      res.status(201).json({ success: true, data: doc, message: 'Document uploaded' });
    } catch (err) { next(err); }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, rejectionReason } = verifyDocumentSchema.parse(req.body);
      const doc = await documentService.verify(req.params.id, status, req.user!.userId, rejectionReason);

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

            const hasAadhaar = verifiedTypes.includes('AADHAAR');
            const hasPan = verifiedTypes.includes('PAN');

            if (hasAadhaar && hasPan) {
              await documentGateService.verifyKyc(doc.employeeId, req.user!.userId);
              logger.info(`KYC auto-verified for employee ${doc.employeeId} — all required docs verified by HR`);
            }
          }
        } catch (err) {
          logger.warn('Failed to auto-verify KYC gate:', err);
        }
      }

      res.json({ success: true, data: doc, message: `Document ${status.toLowerCase()}` });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await documentService.remove(req.params.id);
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
}

export const documentController = new DocumentController();
