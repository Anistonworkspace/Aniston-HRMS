import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { onboardingController } from './onboarding.controller.js';
import { getEmployeeKycUrl } from '../../middleware/upload.middleware.js';

const router = Router();

// HR: Create invite
router.post('/invite/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => onboardingController.createInvite(req, res, next)
);

// HR: Get pending invites
router.get('/invites', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => onboardingController.getPendingInvites(req, res, next)
);

// PUBLIC: Get onboarding status (token-based, no auth)
router.get('/status/:token', (req, res, next) => onboardingController.getStatus(req, res, next));

// PUBLIC: Save step data
router.patch('/step/:token/:step', (req, res, next) => onboardingController.saveStep(req, res, next));

// PUBLIC: Complete onboarding
router.post('/complete/:token', (req, res, next) => onboardingController.complete(req, res, next));

// ==================
// AUTHENTICATED ONBOARDING (post-login flow — employee fills profile after accepting invite)
// ==================
router.get('/my-status', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee profile not linked. Please contact HR.' } });
      return;
    }
    const { onboardingService } = await import('./onboarding.service.js');
    const data = await onboardingService.getMyOnboardingStatus(employeeId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.patch('/my-step/:step', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee profile not linked. Please contact HR.' } });
      return;
    }
    const { onboardingService } = await import('./onboarding.service.js');
    const step = parseInt(req.params.step);
    const result = await onboardingService.saveMyOnboardingStep(employeeId, step, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/my-complete', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user?.employeeId;
    if (!employeeId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee profile not linked. Please contact HR.' } });
      return;
    }
    const { onboardingService } = await import('./onboarding.service.js');
    const result = await onboardingService.completeMyOnboarding(employeeId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Document gate (HR+)
router.get('/document-gate/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.getGate(req.params.employeeId);
      res.json({ success: true, data: gate });
    } catch (err) { next(err); }
  }
);

router.patch('/document-gate/:employeeId/unlock', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.unlockOfferLetter(req.params.employeeId, req.user!.userId);
      res.json({ success: true, data: gate, message: 'Offer letter unlocked' });
    } catch (err) { next(err); }
  }
);

// ==================
// KYC ENDPOINTS
// ==================

// Employee: Get own KYC status (includes document statuses for flagging)
router.get('/kyc/me', authenticate,
  async (req, res, next) => {
    try {
      const employeeId = req.user?.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee profile not linked to your account. Please contact HR.' } });
        return;
      }

      const { documentGateService } = await import('./document-gate.service.js');
      const { prisma } = await import('../../lib/prisma.js');

      // Auto-create gate if it doesn't exist (e.g., first visit to KYC page)
      let gate = await documentGateService.getGate(employeeId);
      if (!gate) {
        gate = await documentGateService.createGate(employeeId);
        // Re-fetch with relations
        gate = await documentGateService.getGate(employeeId);
      }

      // Include per-document-type status so frontend can show flags/rejections
      const docs = await prisma.document.findMany({
        where: { employeeId, deletedAt: null },
        select: { type: true, status: true, rejectionReason: true, tamperDetected: true },
        orderBy: { createdAt: 'desc' },
      });
      // Build a map: { AADHAAR: 'VERIFIED', PAN: 'FLAGGED', ... } (latest per type)
      const documentStatuses: Record<string, string> = {};
      const documentReasons: Record<string, string> = {};
      for (const doc of docs) {
        if (!documentStatuses[doc.type]) {
          documentStatuses[doc.type] = doc.status;
          if (doc.rejectionReason) documentReasons[doc.type] = doc.rejectionReason;
        }
      }

      res.json({ success: true, data: { ...gate, documentStatuses, documentReasons } });
    } catch (err) { next(err); }
  }
);

// Employee: Upload KYC photo via camera capture
router.post('/kyc/:employeeId/photo', authenticate,
  async (req, res, next) => {
    try {
      const employeeId = req.params.employeeId as string;
      if (!employeeId || employeeId === 'undefined' || employeeId === 'null') {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee ID is required' } });
        return;
      }
      // Ownership check: only the employee themselves or HR/Admin can upload KYC
      const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
      if (!isManagement && req.user!.employeeId !== employeeId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to upload KYC for this employee' } });
        return;
      }
      // Save photo in employee's KYC folder: uploads/employees/{employeeId}/kyc/
      const { createEmployeeKycUpload } = await import('../../middleware/upload.middleware.js');
      const kycUpload = createEmployeeKycUpload(employeeId);
      kycUpload.photo.single('photo')(req, res, async (err: any) => {
        if (err) return next(err);
        if (!req.file) {
          res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No photo provided' } });
          return;
        }
        try {
          const { documentGateService } = await import('./document-gate.service.js');
          const photoUrl = getEmployeeKycUrl(employeeId, req.file.filename);
          const gate = await documentGateService.saveKycPhoto(employeeId, photoUrl);
          res.json({ success: true, data: gate, message: 'Photo uploaded' });
        } catch (innerErr) {
          console.error('[KYC Photo] Upload error:', innerErr);
          next(innerErr);
        }
      });
    } catch (err) { next(err); }
  }
);

// Employee: Upload combined PDF (all documents in one file)
router.post('/kyc/:employeeId/combined-pdf', authenticate,
  async (req, res, next) => {
    try {
      const employeeId = req.params.employeeId as string;

      // Validate employeeId exists
      if (!employeeId || employeeId === 'undefined' || employeeId === 'null') {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee ID is required' } });
        return;
      }
      // Ownership check
      const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
      if (!isManagement && req.user!.employeeId !== employeeId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to upload KYC for this employee' } });
        return;
      }

      // Verify the employee record exists before attempting upload
      const { prisma } = await import('../../lib/prisma.js');
      const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
      if (!employee) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found. Please contact HR.' } });
        return;
      }

      const { createEmployeeKycUpload } = await import('../../middleware/upload.middleware.js');
      const kycUpload = createEmployeeKycUpload(employeeId);
      kycUpload.document.single('file')(req, res, async (err: any) => {
        if (err) {
          console.error('[KYC Combined PDF] Multer error:', err);
          return next(err);
        }
        if (!req.file) {
          res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file provided' } });
          return;
        }
        try {
          const fileUrl = getEmployeeKycUrl(employeeId, req.file.filename);
          // Create document record
          const { documentService } = await import('../document/document.service.js');
          const doc = await documentService.create(
            { name: 'Combined KYC Documents', type: 'OTHER', employeeId },
            fileUrl,
            req.user!.userId
          );
          // Mark combined PDF uploaded and set kycStatus=PROCESSING
          const { documentGateService } = await import('./document-gate.service.js');
          await documentGateService.setCombinedPdfUploaded(employeeId);
          await (await import('../../lib/prisma.js')).prisma.onboardingDocumentGate.update({
            where: { employeeId },
            data: { kycStatus: 'PROCESSING' },
          });

          // Classify combined PDF — try Python AI service first, then Node.js fallback
          (async () => {
            try {
              const fs = await import('fs');
              const filePath = req.file!.path;
              const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
              const fileBuffer = fs.readFileSync(filePath);

              let pythonSuccess = false;
              let analysisResult: any = null;

              // ── Try Python AI service (primary) ──
              try {
                const blob = new Blob([fileBuffer], { type: 'application/pdf' });
                const formData = new FormData();
                formData.append('file', blob, req.file!.originalname || 'combined.pdf');
                const classifyRes = await fetch(`${AI_URL}/ai/ocr/classify-combined-pdf`, {
                  method: 'POST',
                  body: formData,
                  signal: AbortSignal.timeout(120_000),
                });
                if (classifyRes.ok) {
                  const classifyJson = await classifyRes.json() as { success: boolean; data: any };
                  if (classifyJson.success && classifyJson.data) {
                    analysisResult = classifyJson.data;
                    pythonSuccess = true;
                    console.log('[KYC Combined PDF] Python AI classification succeeded');
                  }
                }
              } catch (pythonErr: any) {
                console.warn('[KYC Combined PDF] Python AI service unavailable:', pythonErr.message);
              }

              // ── Node.js fallback (if Python failed) ──
              if (!pythonSuccess) {
                try {
                  const { processCombinedPdfFallback } = await import('../../services/combined-pdf-processor.service.js');
                  const gate = await (await import('../../lib/prisma.js')).prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
                  const requiredDocs = (gate?.requiredDocs as string[]) || ['PAN', 'AADHAAR', 'TENTH_CERTIFICATE'];
                  const nodeResult = await processCombinedPdfFallback(fileBuffer, requiredDocs);
                  analysisResult = { ...nodeResult, _source: 'node_fallback' };
                  console.log('[KYC Combined PDF] Node.js fallback classification succeeded');
                } catch (nodeErr: any) {
                  console.warn('[KYC Combined PDF] Node.js fallback also failed:', nodeErr.message);
                  // Both failed — mark for manual review
                  await documentGateService.setCombinedPdfClassified(employeeId, {
                    analysisResult: { error: 'Both Python and Node.js classification failed', _source: 'manual_review' },
                    processingMode: 'MANUAL_REVIEW_ONLY',
                    fallbackUsed: true,
                    employeeVisibleReasons: ['Your document package is being reviewed by HR manually. No action needed from you.'],
                  });
                  return;
                }
              }

              // ── Persist result and transition to PENDING_HR_REVIEW ──
              const missingDocs: string[] = analysisResult?.missingDocuments || analysisResult?.missing_docs || [];
              const duplicateDocs: string[] = analysisResult?.duplicateDocuments || analysisResult?.duplicate_docs || [];
              const employeeReasons: string[] = analysisResult?.employeeVisibleReasons || analysisResult?.employee_visible_reasons || [];

              await documentGateService.setCombinedPdfClassified(employeeId, {
                analysisResult,
                processingMode: pythonSuccess ? 'PYTHON_ADVANCED' : 'NODE_FALLBACK',
                fallbackUsed: !pythonSuccess,
                missingDocuments: missingDocs,
                duplicateDocuments: duplicateDocs,
                employeeVisibleReasons: employeeReasons,
              });
            } catch (classifyErr: any) {
              console.error('[KYC Combined PDF] Classification pipeline failed:', classifyErr.message);
              // Ensure gate doesn't stay stuck in PROCESSING
              try {
                await documentGateService.setCombinedPdfClassified(employeeId, {
                  analysisResult: { error: classifyErr.message, _source: 'error' },
                  processingMode: 'MANUAL_REVIEW_ONLY',
                  fallbackUsed: true,
                  employeeVisibleReasons: ['Your document is under review. HR will contact you if anything is needed.'],
                });
              } catch { /* last resort */ }
            }
          })().catch(err => console.error('[KYC Combined PDF] Background classification error:', err));
          // Trigger per-page OCR (non-blocking)
          try {
            const { enqueueDocumentOcr } = await import('../../jobs/queues.js');
            await enqueueDocumentOcr(doc.id, req.user!.organizationId);
          } catch { /* non-blocking */ }
          // Queue HR digest (non-blocking)
          try {
            const { enqueueDocumentDigest } = await import('../../jobs/queues.js');
            await enqueueDocumentDigest(employeeId, req.user!.organizationId, {
              type: 'OTHER', name: 'Combined KYC Documents',
            });
          } catch { /* non-blocking */ }
          res.status(201).json({ success: true, data: doc, message: 'Combined PDF uploaded' });
        } catch (innerErr) {
          console.error('[KYC Combined PDF] Post-upload error:', innerErr);
          next(innerErr);
        }
      });
    } catch (err) {
      console.error('[KYC Combined PDF] Outer error:', err);
      next(err);
    }
  }
);

// Employee: Upload photo file (alternative to camera capture)
router.post('/kyc/:employeeId/photo-upload', authenticate,
  async (req, res, next) => {
    try {
      const employeeId = req.params.employeeId as string;
      if (!employeeId || employeeId === 'undefined' || employeeId === 'null') {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee ID is required' } });
        return;
      }
      const { createEmployeeKycUpload } = await import('../../middleware/upload.middleware.js');
      const kycUpload = createEmployeeKycUpload(employeeId);
      kycUpload.photo.single('file')(req, res, async (err: any) => {
        if (err) return next(err);
        if (!req.file) {
          res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No file provided' } });
          return;
        }
        try {
          const photoUrl = getEmployeeKycUrl(employeeId, req.file.filename);
          const { documentGateService } = await import('./document-gate.service.js');
          const gate = await documentGateService.saveKycPhoto(employeeId, photoUrl);
          res.json({ success: true, data: gate, message: 'Photo uploaded' });
        } catch (innerErr) {
          console.error('[KYC Photo Upload] Error:', innerErr);
          next(innerErr);
        }
      });
    } catch (err) { next(err); }
  }
);

// Employee: Save KYC configuration (mode, fresher/experienced, qualification)
// Must be called before upload — drives the dynamic required-docs list
router.post('/kyc/:employeeId/config', authenticate,
  async (req, res, next) => {
    try {
      const employeeId = req.params.employeeId as string;
      const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
      if (!isManagement && req.user!.employeeId !== employeeId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } });
        return;
      }
      const { uploadMode, fresherOrExperienced, highestQualification } = req.body;
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.saveKycConfig(employeeId, uploadMode, fresherOrExperienced, highestQualification);
      res.json({ success: true, data: gate, message: 'KYC configuration saved' });
    } catch (err) { next(err); }
  }
);

// Employee: Submit KYC for review
router.post('/kyc/:employeeId/submit', authenticate,
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.submitKyc(req.params.employeeId);
      res.json({ success: true, data: gate, message: 'KYC submitted for review' });
    } catch (err) { next(err); }
  }
);

// HR: List pending KYC submissions
router.get('/kyc/pending', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await documentGateService.getPendingKyc(req.user!.organizationId, page, limit);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }
);

// HR: Verify KYC
router.post('/kyc/:employeeId/verify', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.verifyKyc(req.params.employeeId, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: gate, message: 'KYC verified' });
    } catch (err) { next(err); }
  }
);

// HR: Reject KYC
router.post('/kyc/:employeeId/reject', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.rejectKyc(req.params.employeeId, req.body.reason, req.user!.userId);
      res.json({ success: true, data: gate, message: 'KYC rejected' });
    } catch (err) { next(err); }
  }
);

// HR: Request re-upload of specific documents
router.post('/kyc/:employeeId/request-reupload', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { docTypes, reasons } = req.body;
      if (!Array.isArray(docTypes) || docTypes.length === 0) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'docTypes array is required' } });
        return;
      }
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.requestReupload(
        req.params.employeeId,
        docTypes,
        reasons || {},
        req.user!.userId
      );
      res.json({ success: true, data: gate, message: 'Re-upload requested' });
    } catch (err) { next(err); }
  }
);

// HR: Get full KYC review data (gate + documents + OCR + analysis)
router.get('/kyc/:employeeId/hr-review', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const data = await documentGateService.getKycForHrReview(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
);

// HR: Update internal review notes
router.patch('/kyc/:employeeId/hr-notes', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const gate = await documentGateService.updateHrNotes(req.params.employeeId, req.body.notes, req.user!.userId);
      res.json({ success: true, data: gate, message: 'Notes saved' });
    } catch (err) { next(err); }
  }
);

// HR: Manually trigger OCR re-processing for employee's combined PDF
router.post('/kyc/:employeeId/retrigger-ocr', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const { enqueueDocumentOcr } = await import('../../jobs/queues.js');
      // Find most recent documents for this employee
      const docs = await prisma.document.findMany({
        where: { employeeId: req.params.employeeId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      if (docs.length === 0) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No documents found for this employee' } });
        return;
      }
      let triggered = 0;
      for (const doc of docs) {
        try {
          await enqueueDocumentOcr(doc.id, req.user!.organizationId);
          triggered++;
        } catch { /* continue */ }
      }
      res.json({ success: true, data: { triggered }, message: `OCR re-queued for ${triggered} document(s)` });
    } catch (err) { next(err); }
  }
);

export { router as onboardingRouter };
