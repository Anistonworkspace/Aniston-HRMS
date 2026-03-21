import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);
router.use(authorize(Role.SUPER_ADMIN, Role.ADMIN));

// Get organization settings
router.get('/organization', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const org = await prisma.organization.findFirst({
      where: { id: req.user!.organizationId },
      include: {
        officeLocations: true,
        _count: {
          select: { employees: true, departments: true, designations: true },
        },
      },
    });
    res.json({ success: true, data: org });
  } catch (err) { next(err); }
});

// Update organization
const orgUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  logo: z.string().optional(),
  timezone: z.string().optional(),
  fiscalYear: z.string().optional(),
  currency: z.string().optional(),
  address: z.any().optional(),
  settings: z.any().optional(),
});

router.patch('/organization', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = orgUpdateSchema.parse(req.body);
    const org = await prisma.organization.update({
      where: { id: req.user!.organizationId },
      data,
    });
    res.json({ success: true, data: org, message: 'Organization updated' });
  } catch (err) { next(err); }
});

// Office locations
router.get('/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locations = await prisma.officeLocation.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: locations });
  } catch (err) { next(err); }
});

const locationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('India'),
  timezone: z.string().default('Asia/Kolkata'),
});

router.post('/locations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = locationSchema.parse(req.body);
    const location = await prisma.officeLocation.create({
      data: { ...data, organizationId: req.user!.organizationId },
    });
    res.status(201).json({ success: true, data: location, message: 'Location added' });
  } catch (err) { next(err); }
});

router.patch('/locations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = locationSchema.partial().parse(req.body);
    const location = await prisma.officeLocation.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: location });
  } catch (err) { next(err); }
});

router.delete('/locations/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.officeLocation.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: null, message: 'Location deleted' });
  } catch (err) { next(err); }
});

// Audit logs
router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const entity = req.query.entity as string | undefined;
    const skip = (page - 1) * limit;

    const where: any = { organizationId: req.user!.organizationId };
    if (entity) where.entity = entity;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    });
  } catch (err) { next(err); }
});

// System info
router.get('/system', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      version: '1.0.0',
      nodeVersion: process.version,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      platform: process.platform,
    },
  });
});

export { router as settingsRouter };
