import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

const ticketSchema = z.object({
  category: z.enum(['IT', 'HR', 'FINANCE', 'ADMIN', 'PAYROLL', 'LEAVE', 'OTHER']),
  subject: z.string().min(3),
  description: z.string().min(10),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});

// Generate ticket code
async function generateTicketCode(orgId: string): Promise<string> {
  const count = await prisma.ticket.count({ where: { organizationId: orgId } });
  return `TKT-${String(count + 1).padStart(4, '0')}`;
}

// List my tickets
router.get('/my', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.employeeId) {
      res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } });
      return;
    }
    const status = req.query.status as string | undefined;
    const where: any = { employeeId: req.user!.employeeId };
    if (status) where.status = status;

    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { comments: true } } },
    });
    res.json({ success: true, data: tickets });
  } catch (err) { next(err); }
});

// List all tickets (HR/Admin)
router.get('/all', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string | undefined;
    const skip = (page - 1) * limit;

    const where: any = { organizationId: req.user!.organizationId };
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { comments: true } } },
      }),
      prisma.ticket.count({ where }),
    ]);

    res.json({
      success: true,
      data: tickets,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    });
  } catch (err) { next(err); }
});

// Create ticket
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.employeeId) {
      res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } });
      return;
    }
    const data = ticketSchema.parse(req.body);
    const ticketCode = await generateTicketCode(req.user!.organizationId);
    const ticket = await prisma.ticket.create({
      data: {
        ...data,
        ticketCode,
        employeeId: req.user!.employeeId,
        status: 'OPEN',
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: ticket, message: `Ticket ${ticketCode} created` });
  } catch (err) { next(err); }
});

// Get ticket detail
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
});

// Update ticket status (HR/Admin)
router.patch('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, assignedTo, resolution } = req.body;
    const data: any = {};
    if (status) data.status = status;
    if (assignedTo) data.assignedTo = assignedTo;
    if (resolution) data.resolution = resolution;
    if (status === 'RESOLVED') data.resolvedAt = new Date();

    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: ticket, message: `Ticket ${status?.toLowerCase() || 'updated'}` });
  } catch (err) { next(err); }
});

// Add comment
router.post('/:id/comment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, isInternal } = req.body;
    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: req.params.id,
        authorId: req.user!.userId,
        content,
        isInternal: isInternal || false,
      },
    });
    res.status(201).json({ success: true, data: comment });
  } catch (err) { next(err); }
});

export { router as helpdeskRouter };
