import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const router = Router();
router.use(authenticate);

const designationSchema = z.object({
  name: z.string().min(1).max(100),
  level: z.number().int().min(1).max(20).optional(),
  description: z.string().optional(),
});

// List designations
router.get('/', requirePermission('designation', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const designations = await prisma.designation.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null },
      include: { _count: { select: { employees: true } } },
      orderBy: { level: 'asc' },
    });
    res.json({ success: true, data: designations });
  } catch (err) { next(err); }
});

// Create
router.post('/', requirePermission('designation', 'create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = designationSchema.parse(req.body);
    const desig = await prisma.designation.create({
      data: { ...data, organizationId: req.user!.organizationId },
    });
    res.status(201).json({ success: true, data: desig, message: 'Designation created' });
  } catch (err) { next(err); }
});

// Update
router.patch('/:id', requirePermission('designation', 'update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = designationSchema.partial().parse(req.body);
    const desig = await prisma.designation.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: desig, message: 'Designation updated' });
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', requirePermission('designation', 'delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = await prisma.designation.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!d) throw new NotFoundError('Designation');
    await prisma.designation.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    res.json({ success: true, data: null, message: 'Designation deleted' });
  } catch (err) { next(err); }
});

export { router as designationRouter };
