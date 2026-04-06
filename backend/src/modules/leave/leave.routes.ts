import { Router } from 'express';
import { leaveController } from './leave.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Leave types & holidays
router.get('/types', (req, res, next) => leaveController.getLeaveTypes(req, res, next));
router.post(
  '/types',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.createLeaveType(req, res, next)
);
router.patch(
  '/types/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.updateLeaveType(req, res, next)
);
router.delete(
  '/types/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.deleteLeaveType(req, res, next)
);
router.get('/holidays', (req, res, next) => leaveController.getHolidays(req, res, next));

// My leave
router.get('/balances', (req, res, next) => leaveController.getBalances(req, res, next));
router.get('/balances/:employeeId', requirePermission('leave', 'read'), (req, res, next) => leaveController.getBalances(req, res, next));
router.post('/apply', (req, res, next) => leaveController.applyLeave(req, res, next));
router.post('/preview', (req, res, next) => leaveController.previewLeave(req, res, next));
router.get('/my', (req, res, next) => leaveController.getMyLeaves(req, res, next));

// Draft flow
router.post('/draft', (req, res, next) => leaveController.saveDraft(req, res, next));
router.post('/:id/submit', (req, res, next) => leaveController.submitDraft(req, res, next));

// Detail & review (must be before generic /:id routes)
router.get('/:id/detail', (req, res, next) => leaveController.getLeaveDetail(req, res, next));
router.get('/:id/manager-review',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => leaveController.getManagerReview(req, res, next)
);
router.get('/:id/hr-review',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.getHrReview(req, res, next)
);

// Handover
router.patch('/:id/handover', (req, res, next) => leaveController.updateHandover(req, res, next));

// Audit & notifications
router.get('/:id/audit', (req, res, next) => leaveController.getLeaveAudit(req, res, next));
router.get('/:id/notifications',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.getNotificationLog(req, res, next)
);

// Cancel
router.delete('/:id', (req, res, next) => leaveController.cancelLeave(req, res, next));

// Approvals
router.get(
  '/approvals',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => leaveController.getPendingApprovals(req, res, next)
);
router.patch(
  '/:id/action',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => leaveController.handleLeaveAction(req, res, next)
);

// Admin view
router.get(
  '/all',
  requirePermission('leave', 'read'),
  (req, res, next) => leaveController.getAllLeaves(req, res, next)
);

// Leave policies CRUD
router.get('/policies', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const policies = await prisma.leavePolicy.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      include: { rules: { include: { leaveType: { select: { id: true, name: true, code: true } } } }, _count: { select: { employees: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: policies });
  } catch (err) { next(err); }
});

router.post('/policies', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { name, description, isDefault, rules } = req.body;
    if (isDefault) {
      await prisma.leavePolicy.updateMany({
        where: { organizationId: req.user!.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const policy = await prisma.leavePolicy.create({
      data: {
        name, description, isDefault: !!isDefault,
        organizationId: req.user!.organizationId,
        rules: rules?.length ? { createMany: { data: rules.map((r: any) => ({ leaveTypeId: r.leaveTypeId, daysAllowed: r.daysAllowed, isAllowed: r.isAllowed ?? true })) } } : undefined,
      },
      include: { rules: { include: { leaveType: { select: { id: true, name: true, code: true } } } } },
    });
    res.status(201).json({ success: true, data: policy });
  } catch (err) { next(err); }
});

router.patch('/policies/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { name, description, isDefault, rules } = req.body;
    if (isDefault) {
      await prisma.leavePolicy.updateMany({
        where: { organizationId: req.user!.organizationId, isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }
    const policy = await prisma.leavePolicy.update({
      where: { id: req.params.id },
      data: { name, description, isDefault },
    });
    if (rules?.length) {
      await prisma.leavePolicyRule.deleteMany({ where: { policyId: req.params.id } });
      await prisma.leavePolicyRule.createMany({
        data: rules.map((r: any) => ({ policyId: req.params.id, leaveTypeId: r.leaveTypeId, daysAllowed: r.daysAllowed, isAllowed: r.isAllowed ?? true })),
      });
    }
    res.json({ success: true, data: policy });
  } catch (err) { next(err); }
});

router.delete('/policies/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    await prisma.leavePolicy.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Leave policy deactivated' });
  } catch (err) { next(err); }
});

export { router as leaveRouter };
