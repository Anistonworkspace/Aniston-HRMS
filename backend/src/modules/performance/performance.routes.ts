import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize, requirePermission } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { NotFoundError } from '../../middleware/errorHandler.js';

const router = Router();
router.use(authenticate);

// ==================
// REVIEW CYCLES
// ==================

const reviewCycleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL']).default('QUARTERLY'),
  startDate: z.string(),
  endDate: z.string(),
});

router.get('/cycles', requirePermission('performance', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cycles = await prisma.reviewCycle.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { reviews: true, goals: true } } },
    });
    res.json({ success: true, data: cycles });
  } catch (err) { next(err); }
});

router.post('/cycles', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = reviewCycleSchema.parse(req.body);
    const cycle = await prisma.reviewCycle.create({
      data: { ...data, startDate: new Date(data.startDate), endDate: new Date(data.endDate), organizationId: req.user!.organizationId },
    });
    res.status(201).json({ success: true, data: cycle, message: 'Review cycle created' });
  } catch (err) { next(err); }
});

router.patch('/cycles/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    const cycle = await prisma.reviewCycle.update({ where: { id: req.params.id }, data: { status } });
    res.json({ success: true, data: cycle });
  } catch (err) { next(err); }
});

// ==================
// GOALS
// ==================

const goalSchema = z.object({
  employeeId: z.string().uuid(),
  reviewCycleId: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(['INDIVIDUAL', 'TEAM', 'COMPANY']).default('INDIVIDUAL'),
  targetValue: z.number().optional(),
  unit: z.string().optional(),
  weight: z.number().int().min(1).max(100).default(100),
  dueDate: z.string().optional(),
});

router.get('/goals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeId = (req.query.employeeId as string) || req.user!.employeeId;
    const goals = await prisma.goal.findMany({
      where: { employeeId: employeeId!, organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: goals });
  } catch (err) { next(err); }
});

router.post('/goals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = goalSchema.parse(req.body);
    const goal = await prisma.goal.create({
      data: {
        ...data,
        targetValue: data.targetValue || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: goal, message: 'Goal created' });
  } catch (err) { next(err); }
});

router.patch('/goals/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, currentValue } = req.body;
    const data: any = {};
    if (status) data.status = status;
    if (currentValue !== undefined) data.currentValue = currentValue;
    if (status === 'COMPLETED') data.completedAt = new Date();
    const goal = await prisma.goal.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: goal });
  } catch (err) { next(err); }
});

// ==================
// REVIEWS
// ==================

const reviewSchema = z.object({
  employeeId: z.string().uuid(),
  reviewCycleId: z.string().uuid(),
  selfRating: z.number().min(1).max(5).optional(),
  selfComments: z.string().optional(),
  managerRating: z.number().min(1).max(5).optional(),
  managerComments: z.string().optional(),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
});

router.get('/reviews', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeId = (req.query.employeeId as string) || req.user!.employeeId;
    const reviews = await prisma.performanceReview.findMany({
      where: { employeeId: employeeId! },
      orderBy: { createdAt: 'desc' },
      include: { reviewCycle: { select: { name: true, type: true } } },
    });
    res.json({ success: true, data: reviews });
  } catch (err) { next(err); }
});

router.post('/reviews', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = reviewSchema.parse(req.body);
    const review = await prisma.performanceReview.create({
      data: {
        ...data,
        selfRating: data.selfRating || null,
        managerRating: data.managerRating || null,
        reviewerId: req.user!.userId,
        status: 'PENDING',
      },
    });
    res.status(201).json({ success: true, data: review, message: 'Review submitted' });
  } catch (err) { next(err); }
});

router.patch('/reviews/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { managerRating, managerComments, overallRating, status, strengths, improvements } = req.body;
    const data: any = {};
    if (managerRating) data.managerRating = managerRating;
    if (managerComments) data.managerComments = managerComments;
    if (overallRating) data.overallRating = overallRating;
    if (status) data.status = status;
    if (strengths) data.strengths = strengths;
    if (improvements) data.improvements = improvements;
    if (status === 'REVIEWED') data.reviewedAt = new Date();

    const review = await prisma.performanceReview.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

export { router as performanceRouter };
