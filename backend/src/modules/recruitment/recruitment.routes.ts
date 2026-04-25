import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { recruitmentService } from './recruitment.service.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { z } from 'zod';
import {
  createJobSchema, updateJobSchema, createApplicationSchema,
  moveStageSchema, interviewScoreSchema, createOfferSchema, jobQuerySchema,
  aiDescriptionSchema, interviewScoreSchemaRefined,
} from './recruitment.validation.js';
const router = Router();

// =====================
// JOB OPENINGS
// =====================

router.get('/jobs', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = jobQuerySchema.parse(req.query);
    const result = await recruitmentService.getJobOpenings(query, req.user!.organizationId);
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) { next(err); }
});

router.get('/jobs/:id', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await recruitmentService.getJobById(req.params.id as string, req.user!.organizationId);
    res.json({ success: true, data: job });
  } catch (err) { next(err); }
});

router.post('/jobs', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createJobSchema.parse(req.body);
    const job = await recruitmentService.createJob(data, req.user!.organizationId, req.user!.userId);
    res.status(201).json({ success: true, data: job, message: 'Job opening created' });
  } catch (err) { next(err); }
});

router.patch('/jobs/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = updateJobSchema.parse(req.body);
    const job = await recruitmentService.updateJob(req.params.id as string, data, req.user!.organizationId, req.user!.userId);
    res.json({ success: true, data: job, message: 'Job updated' });
  } catch (err) { next(err); }
});

router.delete('/jobs/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.deleteJob(req.params.id as string, req.user!.organizationId);
    res.json({ success: true, data: result, message: 'Job deleted' });
  } catch (err) { next(err); }
});

// =====================
// APPLICATIONS
// =====================

router.get('/jobs/:jobId/applications', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const apps = await recruitmentService.getApplications(req.params.jobId as string, req.user!.organizationId, status);
    res.json({ success: true, data: apps });
  } catch (err) { next(err); }
});

router.get('/applications/:id', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await recruitmentService.getApplicationById(req.params.id as string, req.user!.organizationId);
    res.json({ success: true, data: app });
  } catch (err) { next(err); }
});

// Public application endpoint (no auth needed for candidates)
router.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createApplicationSchema.parse(req.body);
    const app = await recruitmentService.createApplication(data);
    res.status(201).json({ success: true, data: app, message: 'Application submitted' });
  } catch (err) { next(err); }
});

router.patch('/applications/:id/stage', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = moveStageSchema.parse(req.body);
    const app = await recruitmentService.moveApplicationStage(req.params.id as string, status, req.user!.organizationId);
    res.json({ success: true, data: app, message: `Application moved to ${status}` });
  } catch (err) { next(err); }
});

// =====================
// INTERVIEW SCORES
// =====================

router.post('/scores', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER, Role.GUEST_INTERVIEWER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = interviewScoreSchemaRefined.parse(req.body);
    const score = await recruitmentService.addInterviewScore(data, req.user!.userId, req.user!.organizationId);
    res.status(201).json({ success: true, data: score, message: 'Score recorded' });
  } catch (err) { next(err); }
});

// =====================
// AI SCORING
// =====================

router.post('/applications/:id/ai-score', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.triggerAIScoring(req.params.id as string, req.user!.organizationId);
    res.json({ success: true, data: result, message: 'AI scoring complete' });
  } catch (err) { next(err); }
});

// =====================
// OFFER LETTERS
// =====================

router.post('/offers', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createOfferSchema.parse(req.body);
    const offer = await recruitmentService.createOffer(data, req.user!.organizationId);
    res.status(201).json({ success: true, data: offer, message: 'Offer created' });
  } catch (err) { next(err); }
});

router.patch('/offers/:id/status', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'NEGOTIATING', 'EXPIRED']) }).parse(req.body);
    const offer = await recruitmentService.updateOfferStatus(req.params.id as string, status, req.user!.organizationId);
    res.json({ success: true, data: offer, message: `Offer ${status.toLowerCase()}` });
  } catch (err) { next(err); }
});

// =====================
// SHARE JOB VIA EMAIL
// =====================

router.post('/jobs/:jobId/share-email', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, message } = z.object({
      email: z.string().email(),
      message: z.string().optional(),
    }).parse(req.body);
    const result = await recruitmentService.shareJobViaEmail(req.params.jobId as string, email, message, req.user!.organizationId);
    res.json({ success: true, data: result, message: 'Job link sent via email' });
  } catch (err) { next(err); }
});

// =====================
// SHARE JOB VIA WHATSAPP
// =====================

router.post('/jobs/:jobId/share-whatsapp', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, customMessage } = z.object({
      phone: z.string().min(10),
      customMessage: z.string().optional(),
    }).parse(req.body);

    const { prisma } = await import('../../lib/prisma.js');
    const job = await prisma.jobOpening.findFirst({
      where: { id: req.params.jobId as string, organizationId: req.user!.organizationId },
      select: { title: true, department: true, location: true, type: true, publicFormToken: true, publicFormEnabled: true },
    });
    if (!job) { res.status(404).json({ success: false, error: { message: 'Job not found' } }); return; }
    if (!job.publicFormEnabled || !job.publicFormToken) {
      res.status(400).json({ success: false, error: { message: 'Public form not enabled for this job' } });
      return;
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://hr.anistonav.com';
    const applyLink = `${baseUrl}/apply/${job.publicFormToken}`;
    const defaultMessage = `Hello! Aniston Technologies LLP is hiring for *${job.title}* (${job.department || ''} | ${job.location || ''}).

Apply here: ${applyLink}

- Powered by Aniston HRMS`;

    const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
    const allowed = await whatsAppService.checkAutoSendQuota(req.user!.organizationId);
    if (!allowed) {
      res.status(429).json({ success: false, error: { code: 'QUOTA_EXCEEDED', message: 'Auto-send quota exceeded (10/min). Please wait a moment and try again.' } });
      return;
    }
    try {
      await whatsAppService.sendMessage(
        { to: phone, message: customMessage || defaultMessage },
        req.user!.organizationId,
        req.user!.userId,
        'JOB_LINK'
      );
      res.json({ success: true, data: { phone, applyLink, message: customMessage || defaultMessage, messageSent: true } });
    } catch (waErr: any) {
      // Return 503 with a clear message if WhatsApp is not connected — do not expose internal errors
      if (waErr.message?.includes('not connected') || waErr.message?.includes('Initialize')) {
        res.status(503).json({ success: false, error: { code: 'WA_NOT_CONNECTED', message: 'WhatsApp is not connected. Go to Settings → WhatsApp to connect, then try again.' } });
      } else {
        next(waErr);
      }
    }
  } catch (err) { next(err); }
});

// =====================
// AI JOB DESCRIPTION GENERATOR
// =====================

router.post('/ai-generate-description', authenticate, requirePermission('recruitment', 'create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = aiDescriptionSchema.parse(req.body);
    const result = await recruitmentService.generateJobDescription(req.user!.organizationId, data);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// =====================
// PIPELINE STATS
// =====================

router.get('/pipeline/stats', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await recruitmentService.getPipelineStats(req.user!.organizationId);
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// =====================
// M-2: UNIFIED READY-FOR-ONBOARDING VIEW
// =====================

router.get('/ready-for-onboarding', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.getReadyForOnboarding(req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// =====================
// M-1: MCQ SCORING FOR INTERNAL APPLICANTS
// =====================

router.get('/applications/:id/mcq-questions', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.getApplicationMCQQuestions(req.params.id as string, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/applications/:id/mcq-score', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { answers } = z.object({
      answers: z.array(z.object({ questionId: z.string(), selectedOption: z.string() })),
    }).parse(req.body);
    const result = await recruitmentService.scoreApplicationMCQ(req.params.id as string, answers, req.user!.organizationId);
    res.json({ success: true, data: result, message: 'MCQ score recorded' });
  } catch (err) { next(err); }
});

// =====================
// M-3: BULK ONBOARDING INVITES
// =====================

router.post('/bulk-invite', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walkInIds } = z.object({
      walkInIds: z.array(z.string().uuid()).min(1).max(50),
    }).parse(req.body);
    const result = await recruitmentService.bulkSendOnboardingInvites(walkInIds, req.user!.organizationId, req.user!.userId);
    res.json({ success: true, data: result, message: `Invited ${result.sent} of ${result.total} candidates` });
  } catch (err) { next(err); }
});

export { router as recruitmentRouter };
