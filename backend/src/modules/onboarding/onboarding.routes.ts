import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { onboardingController } from './onboarding.controller.js';
import { getEmployeeKycUrl } from '../../middleware/upload.middleware.js';
import { logger } from '../../lib/logger.js';

const router = Router();

// ─── Utility: Normalize Combined PDF Analysis ─────────────────────────────────
/**
 * Converts a classification result to a consistent camelCase shape regardless
 * of whether it came from Python (snake_case) or the Node.js fallback (camelCase).
 *
 * Storing a normalized result means:
 * - Frontend never needs `analysis?.detectedDocs || analysis?.detected_docs` chains.
 * - New fields added to either tier are handled in one place.
 * - Debugging is simpler because the stored JSON is always the same shape.
 */
function normalizeCombinedPdfAnalysis(data: any, source: 'python' | 'node_fallback'): any {
  return {
    _source: source,
    totalPages: data.total_pages ?? data.totalPages ?? 0,
    detectedDocs: data.detected_docs ?? data.detectedDocs ?? [],
    pageResults: data.page_results ?? data.pageResults ?? [],
    pageGroups: data.page_groups ?? data.pageGroups ?? [],
    qualityFlags: data.quality_flags ?? data.qualityFlags ?? [],
    suspicionFlags: data.suspicion_flags ?? data.suspicionFlags ?? [],
    suspicionScore: data.suspicion_score ?? data.suspicionScore ?? 0,
    riskLevel: data.risk_level ?? data.riskLevel ?? 'LOW',
    summary: data.summary ?? '',
    missingDocuments: data.missing_docs ?? data.missingDocuments ?? data.missingFromRequired ?? [],
    presentDocs: data.present_docs ?? data.presentDocs ?? [],
    // Per-page deep validation results for HR panel
    pageValidations: data.page_validations ?? data.pageValidations ?? [],
    wrongUploadPages: data.wrong_upload_pages ?? data.wrongUploadPages ?? [],
    wrongUploadCount: data.wrong_upload_count ?? data.wrongUploadCount
      ?? (data.wrong_upload_pages ?? data.wrongUploadPages ?? []).length,
    // Infrastructure warning: non-null when Python OCR failed for systemic reasons
    // (missing language data, Tesseract crash, etc.) rather than genuinely blank pages
    ocrInfrastructureWarning: data.ocr_infrastructure_warning ?? data.ocrInfrastructureWarning ?? null,
    pythonTimedOut: data.pythonTimedOut ?? false,
    // Cross-verification results (NEW)
    nameCrossVerification: data.name_cross_verification ?? data.nameCrossVerification ?? null,
    dobCrossVerification: data.dob_cross_verification ?? data.dobCrossVerification ?? null,
    duplicateDetection: data.duplicate_detection ?? data.duplicateDetection ?? null,
    // Node.js fallback-specific enrichment fields
    ...(source === 'node_fallback' ? {
      overallConfidence: data.overallConfidence,
      requiresManualReview: data.requiresManualReview ?? false,
      manualReviewReasons: data.manualReviewReasons ?? [],
      employeeVisibleReasons: data.employeeVisibleReasons ?? [],
      hrVisibleFindings: data.hrVisibleFindings ?? [],
      duplicateDocs: data.duplicateDocs ?? [],
      blankPages: data.blankPages ?? [],
      unknownPages: data.unknownPages ?? [],
      processingMode: 'node_fallback',
      fallbackUsed: true,
    } : {}),
  };
}

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

// SUPER_ADMIN: Enforce Cancelled Cheque requirement on all verified employees
router.post('/admin/enforce-cancelled-cheque', authenticate, authorize(Role.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const { documentGateService } = await import('./document-gate.service.js');
      const result = await documentGateService.enforceCancelledChequeRequirement(req.user!.organizationId);
      res.json({ success: true, data: result, message: `Enforcement complete: ${result.enforced} employees flagged, ${result.skipped} already had it` });
    } catch (err) { next(err); }
  }
);

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
        await documentGateService.createGate(employeeId);
        gate = await documentGateService.getGate(employeeId);
      }

      // Fetch employee profile to get experienceLevel + qualification for skip-able PROFILE_INFO step
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { experienceLevel: true, qualification: true },
      });

      // Auto-populate gate config if not already set and employee has profile data
      if (gate && !gate.fresherOrExperienced && employee?.experienceLevel) {
        const fresherOrExperienced = employee.experienceLevel === 'EXPERIENCED' ? 'EXPERIENCED' : 'FRESHER';
        const highestQualification = employee.qualification || 'GRADUATION';
        try {
          await documentGateService.saveKycConfig(employeeId, 'SEPARATE', fresherOrExperienced, highestQualification);
          gate = await documentGateService.getGate(employeeId);
        } catch { /* non-blocking — proceed with existing gate */ }
      }

      // Include per-document-type status so frontend can show flags/rejections
      const docs = await prisma.document.findMany({
        where: { employeeId, deletedAt: null },
        select: { type: true, status: true, rejectionReason: true, tamperDetected: true },
        orderBy: { createdAt: 'desc' },
      });
      const documentStatuses: Record<string, string> = {};
      const documentReasons: Record<string, string> = {};
      for (const doc of docs) {
        if (!documentStatuses[doc.type]) {
          documentStatuses[doc.type] = doc.status;
          if (doc.rejectionReason) documentReasons[doc.type] = doc.rejectionReason;
        }
      }

      res.json({
        success: true,
        data: {
          ...gate,
          documentStatuses,
          documentReasons,
          // Employee profile data for the KYC page to use
          employeeExperienceLevel: employee?.experienceLevel || null,
          employeeQualification: employee?.qualification || null,
        },
      });
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
          const { convertUploadedHeic } = await import('../../utils/heicConverter.js');
          await convertUploadedHeic(req);
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

// Combined PDF upload has been removed — employees must upload each document separately.
// The reclassify endpoint below remains for legacy combined PDFs already in the system.
// router.post('/kyc/:employeeId/combined-pdf', authenticate,
//   REMOVED — separate document upload only
// );

// Tombstone: return 410 Gone if old clients try to hit this endpoint
router.post('/kyc/:employeeId/combined-pdf', authenticate, (req, res) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'GONE',
      message: 'Combined PDF upload is no longer supported. Please upload each document separately.',
    },
  });
});


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
          const { convertUploadedHeic } = await import('../../utils/heicConverter.js');
          await convertUploadedHeic(req);
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

// HR: KYC statistics — counts per status for the org (for the dashboard header)
router.get('/kyc/stats', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [statusCounts, thisMonth] = await Promise.all([
        prisma.onboardingDocumentGate.groupBy({
          by: ['kycStatus'],
          where: { employee: { organizationId: orgId } },
          _count: { id: true },
        }),
        prisma.onboardingDocumentGate.count({
          where: {
            employee: { organizationId: orgId },
            kycStatus: 'VERIFIED',
            verifiedAt: { gte: startOfMonth },
          },
        }),
      ]);

      const counts: Record<string, number> = {};
      for (const row of statusCounts) counts[row.kycStatus] = row._count.id;

      res.json({
        success: true,
        data: {
          pending: (counts['SUBMITTED'] || 0) + (counts['PENDING_HR_REVIEW'] || 0),
          processing: counts['PROCESSING'] || 0,
          reuploadRequired: counts['REUPLOAD_REQUIRED'] || 0,
          verified: counts['VERIFIED'] || 0,
          rejected: counts['REJECTED'] || 0,
          verifiedThisMonth: thisMonth,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
        },
      });
    } catch (err) { next(err); }
  }
);

// HR: KYC analytics dashboard data
router.get('/kyc/analytics', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const now = new Date();

      // Last 8 weeks approval trend
      const weeklyData: Array<{ week: string; approved: number; rejected: number; submitted: number }> = [];
      for (let i = 7; i >= 0; i--) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - i * 7);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const [approved, rejected, submitted] = await Promise.all([
          prisma.onboardingDocumentGate.count({ where: { employee: { organizationId: orgId }, kycStatus: 'VERIFIED', verifiedAt: { gte: weekStart, lt: weekEnd } } }),
          prisma.onboardingDocumentGate.count({ where: { employee: { organizationId: orgId }, kycStatus: 'REJECTED', updatedAt: { gte: weekStart, lt: weekEnd } } }),
          prisma.onboardingDocumentGate.count({ where: { employee: { organizationId: orgId }, kycStatus: { in: ['SUBMITTED', 'PENDING_HR_REVIEW'] }, updatedAt: { gte: weekStart, lt: weekEnd } } }),
        ]);
        weeklyData.push({
          week: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`,
          approved, rejected, submitted,
        });
      }

      // Average turnaround time (submission → verification) for verified employees
      const verifiedGates = await prisma.onboardingDocumentGate.findMany({
        where: { employee: { organizationId: orgId }, kycStatus: 'VERIFIED', verifiedAt: { not: null } },
        select: { createdAt: true, verifiedAt: true },
        take: 100,
        orderBy: { verifiedAt: 'desc' },
      });
      const turnarounds = verifiedGates
        .filter(g => g.verifiedAt)
        .map(g => (g.verifiedAt!.getTime() - g.createdAt.getTime()) / (1000 * 3600));
      const avgTurnaroundHours = turnarounds.length > 0
        ? Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length)
        : null;

      // Per-department compliance
      const deptData = await prisma.employee.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: {
          department: { select: { name: true } },
          documentGate: { select: { kycStatus: true } },
        },
      });
      const deptMap: Record<string, { total: number; verified: number; pending: number; rejected: number }> = {};
      for (const emp of deptData) {
        const dept = emp.department?.name || 'No Department';
        if (!deptMap[dept]) deptMap[dept] = { total: 0, verified: 0, pending: 0, rejected: 0 };
        deptMap[dept].total++;
        const status = emp.documentGate?.kycStatus || 'PENDING';
        if (status === 'VERIFIED') deptMap[dept].verified++;
        else if (status === 'REJECTED') deptMap[dept].rejected++;
        else deptMap[dept].pending++;
      }
      const deptCompliance = Object.entries(deptMap).map(([dept, d]) => ({
        dept,
        ...d,
        compliancePct: d.total > 0 ? Math.round((d.verified / d.total) * 100) : 0,
      })).sort((a, b) => b.total - a.total);

      // OCR score distribution (from OcrVerification across org)
      const scoreDistrib = await prisma.documentOcrVerification.groupBy({
        by: ['ocrStatus'],
        where: { organizationId: orgId },
        _count: { id: true },
      });
      const ocrStatusCounts: Record<string, number> = {};
      for (const s of scoreDistrib) ocrStatusCounts[s.ocrStatus] = s._count.id;

      // Flagged doc type frequency (most common doc types that get FLAGGED)
      const flaggedTypes = await prisma.document.groupBy({
        by: ['type'],
        where: { employee: { organizationId: orgId }, status: 'FLAGGED', deletedAt: null },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 8,
      });

      // KYC expiry in next 30/60/90 days
      const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
      const d60 = new Date(now); d60.setDate(d60.getDate() + 60);
      const d90 = new Date(now); d90.setDate(d90.getDate() + 90);
      const [expiring30, expiring60, expiring90] = await Promise.all([
        prisma.onboardingDocumentGate.count({ where: { employee: { organizationId: orgId }, kycStatus: 'VERIFIED', kycExpiresAt: { lte: d30, gt: now } } }),
        prisma.onboardingDocumentGate.count({ where: { employee: { organizationId: orgId }, kycStatus: 'VERIFIED', kycExpiresAt: { lte: d60, gt: d30 } } }),
        prisma.onboardingDocumentGate.count({ where: { employee: { organizationId: orgId }, kycStatus: 'VERIFIED', kycExpiresAt: { lte: d90, gt: d60 } } }),
      ]);

      res.json({
        success: true,
        data: {
          weeklyTrend: weeklyData,
          avgTurnaroundHours,
          deptCompliance,
          ocrStatusCounts,
          flaggedDocTypes: flaggedTypes.map(f => ({ type: f.type, count: f._count.id })),
          kycExpiry: { next30Days: expiring30, next60Days: expiring60, next90Days: expiring90 },
        },
      });
    } catch (err) { next(err); }
  }
);

// System: KYC expiry check — moves expired VERIFIED employees back to REUPLOAD_REQUIRED
// Called by a cron job daily. Also exposed as an HTTP endpoint for manual trigger.
router.post('/kyc/expiry-check', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const now = new Date();

      const expired = await prisma.onboardingDocumentGate.findMany({
        where: {
          employee: { organizationId: orgId },
          kycStatus: 'VERIFIED',
          kycExpiresAt: { lte: now },
        },
        select: { employeeId: true },
      });

      for (const gate of expired) {
        await prisma.onboardingDocumentGate.update({
          where: { employeeId: gate.employeeId },
          data: {
            kycStatus: 'REUPLOAD_REQUIRED',
            reuploadRequested: true,
            employeeVisibleReasons: ['Your KYC documents have expired. Please re-upload to regain portal access.'] as any,
          },
        });
        const emp = await prisma.employee.findUnique({
          where: { id: gate.employeeId },
          select: { userId: true, organizationId: true },
        });
        if (emp?.userId) {
          const { enqueueNotification } = await import('../../jobs/queues.js');
          await enqueueNotification({
            userId: emp.userId,
            organizationId: emp.organizationId,
            title: 'KYC Renewal Required',
            message: 'Your KYC verification has expired. Please re-upload your documents to maintain access.',
            type: 'DOCUMENT_FLAGGED',
            link: '/kyc-pending',
          });
        }
      }

      res.json({ success: true, data: { expired: expired.length } });
    } catch (err) { next(err); }
  }
);

// HR: Securely stream a KYC document (no download, no direct URL exposure)
// The file is served through this authenticated proxy — the real file path is never exposed to the browser.
router.get('/kyc/:employeeId/document/:docId/view',
  authenticate,
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const { readFileSync, existsSync } = await import('fs');
      const { join, extname } = await import('path');

      const { employeeId, docId } = req.params as { employeeId: string; docId: string };

      // Fetch document and verify it belongs to the employee + HR's org
      const doc = await prisma.document.findFirst({
        where: {
          id: docId,
          employeeId,
          deletedAt: null,
          employee: { organizationId: req.user!.organizationId },
        },
        select: { id: true, fileUrl: true, name: true },
      });

      if (!doc?.fileUrl) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
        return;
      }

      // Resolve file path (fileUrl is stored relative to project root, e.g. /uploads/kyc/...)
      let basePath = process.cwd();
      if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
        basePath = join(basePath, '..');
      }
      const filePath = join(basePath, doc.fileUrl);

      if (!existsSync(filePath)) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document file not found on disk' } });
        return;
      }

      // HEIC/HEIF from iPhone — convert to JPEG before streaming so the browser can render it
      let servePath = filePath;
      let ext = extname(filePath).toLowerCase();
      if (ext === '.heic' || ext === '.heif') {
        const { convertHeicToJpeg } = await import('../../utils/heicConverter.js');
        const converted = await convertHeicToJpeg(filePath);
        if (converted !== filePath) {
          servePath = converted;
          ext = '.jpg';
        }
      }

      const fileBuffer = readFileSync(servePath);
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Security headers — serve inline, no caching, block save-as
      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="document${ext}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; object-src 'none'; plugin-types application/pdf",
        'Content-Length': String(fileBuffer.length),
      });

      res.send(fileBuffer);
    } catch (err) { next(err); }
  }
);

// HR: Download all KYC documents as a ZIP archive
router.get('/kyc/:employeeId/documents/zip',
  authenticate,
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const { existsSync } = await import('fs');
      const { join, extname, basename } = await import('path');
      const archiver = (await import('archiver')).default;

      const { employeeId } = req.params as { employeeId: string };

      const employee = await prisma.employee.findFirst({
        where: { id: employeeId, organizationId: req.user!.organizationId },
        select: { firstName: true, lastName: true, employeeCode: true },
      });
      if (!employee) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
        return;
      }

      const documents = await prisma.document.findMany({
        where: { employeeId, deletedAt: null },
        select: { id: true, fileUrl: true, name: true, type: true },
        orderBy: { createdAt: 'asc' },
      });

      const empName = `${employee.firstName ?? ''}_${employee.lastName ?? ''}_${employee.employeeCode ?? ''}`.replace(/\s+/g, '_');

      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="KYC_${empName}.zip"`,
        'Cache-Control': 'no-store',
      });

      let basePath = process.cwd();
      if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
        basePath = join(basePath, '..');
      }

      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err: Error) => next(err));
      archive.pipe(res);

      let fileCount = 0;
      for (const doc of documents) {
        if (!doc.fileUrl) continue;
        const filePath = join(basePath, doc.fileUrl);
        if (!existsSync(filePath)) continue;
        const ext = extname(filePath);
        const safeName = `${doc.type}_${doc.id.slice(0, 8)}${ext}`;
        archive.file(filePath, { name: safeName });
        fileCount++;
      }

      if (fileCount === 0) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No documents found to download' } });
        return;
      }

      await archive.finalize();
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

// HR: Revoke KYC access (revert VERIFIED → PENDING_HR_REVIEW — e.g. for offboarding or fraud)
router.post('/kyc/:employeeId/revoke-kyc', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const employeeId = req.params.employeeId as string;
      const { prisma } = await import('../../lib/prisma.js');

      const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
      if (!gate) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'KYC gate not found for this employee' } });
        return;
      }
      if (gate.kycStatus !== 'VERIFIED') {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'KYC is not currently VERIFIED — nothing to revoke' } });
        return;
      }

      await prisma.onboardingDocumentGate.update({
        where: { employeeId },
        data: { kycStatus: 'PENDING_HR_REVIEW' as any },
      });

      // Audit log
      const { createAuditLog } = await import('../../utils/auditLogger.js');
      await createAuditLog({
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
        action: 'KYC_REVOKED',
        entity: 'KYC',
        entityId: employeeId,
        newValue: { reason: req.body.reason || 'HR revoked KYC access', revokedBy: req.user!.userId },
      });

      // Emit real-time revocation — AppShell listener will immediately lock the employee out
      const { getIO } = await import('../../sockets/index.js');
      const io = getIO();
      if (io) {
        io.to(`employee:${employeeId}`).emit('kyc:status-changed', { kycStatus: 'PENDING_HR_REVIEW', kycCompleted: false });
      }

      res.json({ success: true, data: { kycStatus: 'PENDING_HR_REVIEW', message: 'KYC access revoked. Employee will be locked out on next page load.' } });
    } catch (err) {
      next(err);
    }
  }
);

// HR: KYC Audit Log — fetch action history for an employee's KYC (Category 4 item 15)
router.get('/kyc/:employeeId/audit-log', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const employeeId = req.params.employeeId as string;

      // Fetch from AuditLog where entity = 'KYC' and entityId = employeeId
      const logs = await prisma.auditLog.findMany({
        where: {
          OR: [
            { entity: 'KYC', entityId: employeeId },
            { entity: 'DOCUMENT', entityId: employeeId },
          ],
          organizationId: req.user!.organizationId,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          newValue: true,
          createdAt: true,
          userId: true,
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
      });

      res.json({ success: true, data: logs });
    } catch (err) { next(err); }
  }
);

// HR: Check if Aadhaar/PAN number is already registered to another employee (Category 2 item 8)
router.post('/kyc/:employeeId/check-duplicate', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const employeeId = req.params.employeeId as string;
      const { aadhaarNumber, panNumber, passportNumber } = req.body as {
        aadhaarNumber?: string;
        panNumber?: string;
        passportNumber?: string;
      };

      const duplicates: Array<{ field: string; value: string; conflictEmployeeId: string; conflictEmployeeName: string; conflictCode: string }> = [];

      if (aadhaarNumber && aadhaarNumber.length >= 12) {
        // Aadhaar is stored encrypted — check by looking at OCR-extracted ocrVerification records
        const conflict = await prisma.documentOcrVerification.findFirst({
          where: {
            extractedDocNumber: { contains: aadhaarNumber.slice(-4) }, // last 4 digits partial match
            document: {
              employee: { id: { not: employeeId }, organizationId: req.user!.organizationId },
              type: 'AADHAAR',
              deletedAt: null,
            },
          },
          include: {
            document: {
              include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
              },
            },
          },
        });
        if (conflict?.document?.employee) {
          const e = conflict.document.employee as any;
          duplicates.push({
            field: 'Aadhaar',
            value: `****${aadhaarNumber.slice(-4)}`,
            conflictEmployeeId: e.id,
            conflictEmployeeName: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
            conflictCode: e.employeeCode ?? '',
          });
        }
      }

      if (panNumber && /^[A-Z]{5}\d{4}[A-Z]$/.test(panNumber)) {
        const conflict = await prisma.documentOcrVerification.findFirst({
          where: {
            extractedDocNumber: panNumber,
            document: {
              employee: { id: { not: employeeId }, organizationId: req.user!.organizationId },
              type: 'PAN',
              deletedAt: null,
            },
          },
          include: {
            document: {
              include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
              },
            },
          },
        });
        if (conflict?.document?.employee) {
          const e = conflict.document.employee as any;
          duplicates.push({
            field: 'PAN',
            value: panNumber,
            conflictEmployeeId: e.id,
            conflictEmployeeName: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
            conflictCode: e.employeeCode ?? '',
          });
        }
      }

      res.json({
        success: true,
        data: {
          hasDuplicates: duplicates.length > 0,
          duplicates,
        },
      });
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

// HR: Re-run combined PDF classification (Python → Node.js fallback, synchronous)
router.post('/kyc/:employeeId/reclassify-combined-pdf', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      // Express params can technically be string|string[] — cast to string
      const employeeId = req.params.employeeId as string;
      const { prisma } = await import('../../lib/prisma.js');
      const { join } = await import('path');
      const { readFileSync } = await import('fs');

      // Find the most recent combined KYC PDF document for this employee.
      // The upload route stores these with name 'Combined KYC Documents' and type 'OTHER'.
      const doc = await prisma.document.findFirst({
        where: {
          employeeId,
          deletedAt: null,
          type: 'OTHER',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!doc) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No combined PDF found for this employee' } });
        return;
      }

      let basePath = process.cwd();
      if (basePath.endsWith('backend') || basePath.endsWith('backend/') || basePath.endsWith('backend\\')) {
        basePath = join(basePath, '..');
      }
      const filePath = join(basePath, doc.fileUrl);
      let fileBuffer: Buffer;
      try {
        fileBuffer = Buffer.from(readFileSync(filePath));
      } catch {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Combined PDF file not found on disk — employee may need to re-upload' } });
        return;
      }

      const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      let pythonSuccess = false;
      let analysisResult: any = null;

      // ── Build employee-specific required-docs for Python ──
      const gateForReclass = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
      const { computeRequiredDocs: computeReclassRequired } = await import('./document-gate.service.js');
      const fresherR = gateForReclass?.fresherOrExperienced || 'FRESHER';
      const qualR = gateForReclass?.highestQualification || 'GRADUATION';
      const { requiredDocs: reclassRequired, needsIdentityProof: reclassNeedsId, needsEmploymentProof: reclassNeedsEmp } = computeReclassRequired(fresherR, qualR);
      const reclassPythonDocs = [
        ...(reclassNeedsId ? ['AADHAAR'] : []),
        ...reclassRequired.filter((d: string) => d !== 'PHOTO'),
        ...(reclassNeedsEmp ? ['EXPERIENCE_LETTER'] : []),
      ].filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i);

      // ── Try Python AI service ──
      let pythonTimedOut = false;
      let pythonCrashReason: string | null = null;
      try {
        const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' });
        const formData = new FormData();
        formData.append('file', blob, 'combined.pdf');
        formData.append('required_docs', JSON.stringify(reclassPythonDocs));
        const classifyRes = await fetch(`${AI_URL}/ai/ocr/classify-combined-pdf`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(600_000),
        });
        if (classifyRes.ok) {
          const classifyJson = await classifyRes.json() as { success: boolean; data: any };
          if (classifyJson.success && classifyJson.data && !classifyJson.data.error) {
            analysisResult = normalizeCombinedPdfAnalysis(classifyJson.data, 'python');
            pythonSuccess = true;
            logger.info(`[Reclassify] Python AI succeeded for employee ${employeeId} — pages=${classifyJson.data.total_pages ?? 0} detected=${JSON.stringify(classifyJson.data.detected_docs ?? [])}`);
          } else if (classifyJson.data?.error) {
            pythonCrashReason = classifyJson.data.error;
            logger.warn(`[Reclassify] Python returned error (falling back to Node.js) for employee ${employeeId}: ${classifyJson.data.error}`);
          }
        } else {
          pythonCrashReason = `HTTP ${classifyRes.status}`;
          logger.warn(`[Reclassify] Python returned non-OK status ${classifyRes.status} for employee ${employeeId}`);
        }
      } catch (pythonErr: any) {
        const isTimeout = (pythonErr as any)?.name === 'TimeoutError' || (pythonErr as any)?.name === 'AbortError';
        pythonTimedOut = isTimeout;
        pythonCrashReason = isTimeout ? 'timeout' : (pythonErr as Error).message;
        logger.warn(`[Reclassify] Python ${isTimeout ? 'timed out' : 'unavailable'} for employee ${employeeId}: ${(pythonErr as Error).message}`);
      }

      // ── Node.js fallback ──
      if (!pythonSuccess) {
        const { processCombinedPdfFallback } = await import('../../services/combined-pdf-processor.service.js');
        const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId } });
        const requiredDocs = (gate?.requiredDocs as string[]) || ['PAN', 'AADHAAR', 'TENTH_CERTIFICATE'];
        const nodeResult = await processCombinedPdfFallback(fileBuffer, requiredDocs, {
          organizationId: req.user!.organizationId,
          employeeId,
        });
        analysisResult = normalizeCombinedPdfAnalysis(nodeResult, 'node_fallback');
        logger.info(`[Reclassify] Node.js fallback used for employee ${employeeId}`);
      }

      // ── Persist normalized result ──
      const { documentGateService } = await import('./document-gate.service.js');
      await documentGateService.setCombinedPdfClassified(employeeId, {
        analysisResult,
        processingMode: pythonSuccess ? 'PYTHON_ADVANCED' : 'NODE_FALLBACK',
        fallbackUsed: !pythonSuccess,
        missingDocuments: analysisResult?.missingDocuments ?? [],
        duplicateDocuments: analysisResult?.duplicateDocs ?? analysisResult?.duplicateDocuments ?? [],
        employeeVisibleReasons: analysisResult?.employeeVisibleReasons ?? [],
      });

      res.json({
        success: true,
        data: {
          message: `Reclassified via ${pythonSuccess ? 'Python AI' : 'Node.js fallback'}`,
          detectedDocs: analysisResult?.detectedDocs ?? [],
          totalPages: analysisResult?.totalPages ?? 0,
          source: pythonSuccess ? 'python' : 'node_fallback',
          pythonTimedOut: pythonTimedOut,
          pythonCrashReason: pythonCrashReason,
          fallbackUsed: !pythonSuccess,
        },
      });
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
