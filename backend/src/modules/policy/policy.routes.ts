import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize, requirePermission } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

const policySchema = z.object({
  title: z.string().min(1),
  category: z.enum(['HR_GENERAL', 'LEAVE', 'HYBRID', 'WORK_MANAGEMENT', 'ESCALATION', 'IT', 'CODE_OF_CONDUCT', 'HEALTH_SAFETY']),
  content: z.string().min(10),
  targetAudience: z.object({
    departments: z.array(z.string()).optional(),
    roles: z.array(z.string()).optional(),
    workModes: z.array(z.string()).optional(),
  }).optional(),
  attachments: z.array(z.string()).default([]),
});

// List policies
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = req.query.category as string | undefined;
    const where: any = { organizationId: req.user!.organizationId, isActive: true };
    if (category) where.category = category;

    const policies = await prisma.policy.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { acknowledgments: true } } },
    });
    res.json({ success: true, data: policies });
  } catch (err) { next(err); }
});

// Get single policy
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await prisma.policy.findUnique({
      where: { id: req.params.id },
      include: { acknowledgments: true, _count: { select: { acknowledgments: true } } },
    });
    res.json({ success: true, data: policy });
  } catch (err) { next(err); }
});

// Create policy
router.post('/', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = policySchema.parse(req.body);
    const policy = await prisma.policy.create({
      data: { ...data, organizationId: req.user!.organizationId },
    });
    res.status(201).json({ success: true, data: policy, message: 'Policy created' });
  } catch (err) { next(err); }
});

// Update policy
router.patch('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = policySchema.partial().parse(req.body);
    const existing = await prisma.policy.findUnique({ where: { id: req.params.id } });
    const policy = await prisma.policy.update({
      where: { id: req.params.id },
      data: { ...data, version: (existing?.version || 0) + 1 },
    });
    res.json({ success: true, data: policy, message: 'Policy updated' });
  } catch (err) { next(err); }
});

// Acknowledge policy
router.post('/:id/acknowledge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.employeeId) {
      res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } });
      return;
    }
    const ack = await prisma.policyAcknowledgment.create({
      data: { policyId: req.params.id, employeeId: req.user!.employeeId },
    });
    res.json({ success: true, data: ack, message: 'Policy acknowledged' });
  } catch (err) { next(err); }
});

// Get policy categories
router.get('/meta/categories', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      { value: 'HR_GENERAL', label: 'HR General' },
      { value: 'LEAVE', label: 'Leave Policy' },
      { value: 'HYBRID', label: 'Hybrid Work' },
      { value: 'WORK_MANAGEMENT', label: 'Work Management' },
      { value: 'ESCALATION', label: 'Escalation' },
      { value: 'IT', label: 'IT Policy' },
      { value: 'CODE_OF_CONDUCT', label: 'Code of Conduct' },
      { value: 'HEALTH_SAFETY', label: 'Health & Safety' },
    ],
  });
});

export { router as policyRouter };
