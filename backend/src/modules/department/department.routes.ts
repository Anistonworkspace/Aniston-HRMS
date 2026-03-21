import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

const router = Router();
router.use(authenticate);

const departmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  headId: z.string().uuid().optional().nullable(),
});

// List departments
router.get('/', requirePermission('department', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const departments = await prisma.department.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null },
      include: {
        _count: { select: { employees: true } },
        head: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: departments });
  } catch (err) { next(err); }
});

// Create department
router.post('/', requirePermission('department', 'create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = departmentSchema.parse(req.body);
    const dept = await prisma.department.create({
      data: { ...data, organizationId: req.user!.organizationId },
    });
    res.status(201).json({ success: true, data: dept, message: 'Department created' });
  } catch (err) { next(err); }
});

// Update department
router.patch('/:id', requirePermission('department', 'update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = departmentSchema.partial().parse(req.body);
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: dept, message: 'Department updated' });
  } catch (err) { next(err); }
});

// Delete department
router.delete('/:id', requirePermission('department', 'delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dept = await prisma.department.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!dept) throw new NotFoundError('Department');

    await prisma.department.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    res.json({ success: true, data: null, message: 'Department deleted' });
  } catch (err) { next(err); }
});

export { router as departmentRouter };
