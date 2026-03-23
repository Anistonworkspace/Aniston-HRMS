import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { recruitmentService } from './recruitment.service.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { z } from 'zod';
import {
  createJobSchema, updateJobSchema, createApplicationSchema,
  moveStageSchema, interviewScoreSchema, createOfferSchema, jobQuerySchema,
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
    const job = await recruitmentService.getJobById(req.params.id);
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
    const job = await recruitmentService.updateJob(req.params.id, data);
    res.json({ success: true, data: job, message: 'Job updated' });
  } catch (err) { next(err); }
});

// =====================
// APPLICATIONS
// =====================

router.get('/jobs/:jobId/applications', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const apps = await recruitmentService.getApplications(req.params.jobId, status);
    res.json({ success: true, data: apps });
  } catch (err) { next(err); }
});

router.get('/applications/:id', authenticate, requirePermission('recruitment', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const app = await recruitmentService.getApplicationById(req.params.id);
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
    const app = await recruitmentService.moveApplicationStage(req.params.id, status);
    res.json({ success: true, data: app, message: `Application moved to ${status}` });
  } catch (err) { next(err); }
});

// =====================
// INTERVIEW SCORES
// =====================

router.post('/scores', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = interviewScoreSchema.parse(req.body);
    const score = await recruitmentService.addInterviewScore(data, req.user!.userId);
    res.status(201).json({ success: true, data: score, message: 'Score recorded' });
  } catch (err) { next(err); }
});

// =====================
// AI SCORING
// =====================

router.post('/applications/:id/ai-score', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await recruitmentService.triggerAIScoring(req.params.id, process.env.AI_SERVICE_URL || 'http://localhost:8000');
    res.json({ success: true, data: result, message: 'AI scoring complete' });
  } catch (err) { next(err); }
});

// =====================
// OFFER LETTERS
// =====================

router.post('/offers', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createOfferSchema.parse(req.body);
    const offer = await recruitmentService.createOffer(data);
    res.status(201).json({ success: true, data: offer, message: 'Offer created' });
  } catch (err) { next(err); }
});

router.patch('/offers/:id/status', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'NEGOTIATING', 'EXPIRED']) }).parse(req.body);
    const offer = await recruitmentService.updateOfferStatus(req.params.id, status);
    res.json({ success: true, data: offer, message: `Offer ${status.toLowerCase()}` });
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

export { router as recruitmentRouter };
