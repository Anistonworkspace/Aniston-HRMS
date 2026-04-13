import { Router } from 'express';
import { leaveController } from './leave.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Org-level leave settings (working days)
router.get('/org-settings', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma: db } = await import('../../lib/prisma.js');
    const org = await db.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { workingDays: true },
    });
    res.json({ success: true, data: { workingDays: (org as any)?.workingDays || '1,2,3,4,5,6' } });
  } catch (err) { next(err); }
});

router.patch('/org-settings', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma: db } = await import('../../lib/prisma.js');
    const { workingDays } = req.body;
    if (typeof workingDays !== 'string') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'workingDays must be a comma-separated string of day numbers (0=Sun..6=Sat)' } });
    }
    const days = workingDays.split(',').map((d: string) => parseInt(d.trim(), 10));
    if (days.some((d) => isNaN(d) || d < 0 || d > 6)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Each working day must be a number 0–6 (0=Sun, 1=Mon, ..., 6=Sat)' } });
    }
    await (db.organization as any).update({
      where: { id: req.user!.organizationId },
      data: { workingDays },
    });
    res.json({ success: true, data: { workingDays } });
  } catch (err) { next(err); }
});

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

// All employees' leave balances + applied leave summary (HR/Admin view)
router.get(
  '/employee-balances',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma: db } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
      const search = (req.query.search as string || '').toLowerCase();

      const employees = await db.employee.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          ...(search ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { employeeCode: { contains: search, mode: 'insensitive' } },
            ],
          } : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
          leaveBalances: {
            where: { year },
            include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true } } },
          },
        },
        orderBy: [{ department: { name: 'asc' } }, { firstName: 'asc' }],
      });

      // Leave request counts per employee for this year
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);
      const leaveCounts = await db.leaveRequest.groupBy({
        by: ['employeeId', 'status'],
        where: {
          employee: { organizationId: orgId },
          startDate: { gte: yearStart, lte: yearEnd },
        },
        _count: { id: true },
        _sum: { days: true },
      });

      const leaveCountMap = new Map<string, { applied: number; approved: number; pending: number; totalDays: number }>();
      leaveCounts.forEach((lc) => {
        const existing = leaveCountMap.get(lc.employeeId) || { applied: 0, approved: 0, pending: 0, totalDays: 0 };
        existing.applied += lc._count.id;
        existing.totalDays += Number(lc._sum.days || 0);
        if (lc.status === 'APPROVED' || lc.status === 'APPROVED_WITH_CONDITION') existing.approved += lc._count.id;
        if (lc.status === 'PENDING' || lc.status === 'MANAGER_APPROVED') existing.pending += lc._count.id;
        leaveCountMap.set(lc.employeeId, existing);
      });

      const data = employees.map((emp) => {
        const counts = leaveCountMap.get(emp.id) || { applied: 0, approved: 0, pending: 0, totalDays: 0 };
        const totalAllocated = emp.leaveBalances.reduce((s, b) => s + Number(b.allocated) + Number(b.carriedForward), 0);
        const totalUsed = emp.leaveBalances.reduce((s, b) => s + Number(b.used), 0);
        const totalPending = emp.leaveBalances.reduce((s, b) => s + Number(b.pending), 0);
        const totalRemaining = totalAllocated - totalUsed - totalPending;
        return {
          id: emp.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          department: emp.department?.name || '-',
          designation: emp.designation?.name || '-',
          totalAllocated,
          totalUsed,
          totalPending,
          totalRemaining,
          balances: emp.leaveBalances.map((b) => ({
            leaveTypeId: b.leaveTypeId,
            leaveTypeName: b.leaveType.name,
            leaveTypeCode: b.leaveType.code,
            isPaid: b.leaveType.isPaid,
            allocated: Number(b.allocated),
            carriedForward: Number(b.carriedForward),
            used: Number(b.used),
            pending: Number(b.pending),
            remaining: Number(b.allocated) + Number(b.carriedForward) - Number(b.used) - Number(b.pending),
          })),
          leavesApplied: counts.applied,
          leavesApproved: counts.approved,
          leavesPending: counts.pending,
          totalLeaveDays: counts.totalDays,
        };
      });

      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
);

// Single employee full leave overview (balances + all requests for year)
router.get(
  '/employee-overview/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma: db } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const { employeeId } = req.params;
      const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

      const employee = await db.employee.findFirst({
        where: { id: employeeId, organizationId: orgId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
          leaveBalances: {
            where: { year },
            include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true } } },
          },
        },
      });

      if (!employee) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59);

      const requests = await db.leaveRequest.findMany({
        where: {
          employeeId,
          employee: { organizationId: orgId },
          startDate: { gte: yearStart, lte: yearEnd },
        },
        include: {
          leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const balances = employee.leaveBalances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        leaveTypeCode: b.leaveType.code,
        isPaid: b.leaveType.isPaid,
        allocated: Number(b.allocated),
        carriedForward: Number(b.carriedForward),
        used: Number(b.used),
        pending: Number(b.pending),
        remaining: Number(b.allocated) + Number(b.carriedForward) - Number(b.used) - Number(b.pending),
      }));

      const totalAllocated = balances.reduce((s, b) => s + b.allocated + b.carriedForward, 0);
      const totalUsed = balances.reduce((s, b) => s + b.used, 0);
      const totalPending = balances.reduce((s, b) => s + b.pending, 0);
      const totalRemaining = totalAllocated - totalUsed - totalPending;

      const summary = {
        totalAllocated,
        totalUsed,
        totalPending,
        totalRemaining,
        leavesApplied: requests.length,
        leavesApproved: requests.filter((r) => r.status === 'APPROVED' || r.status === 'APPROVED_WITH_CONDITION').length,
        leavesPending: requests.filter((r) => r.status === 'PENDING' || r.status === 'MANAGER_APPROVED').length,
        leavesRejected: requests.filter((r) => r.status === 'REJECTED').length,
        leavesCancelled: requests.filter((r) => r.status === 'CANCELLED').length,
        totalApprovedDays: requests
          .filter((r) => r.status === 'APPROVED' || r.status === 'APPROVED_WITH_CONDITION')
          .reduce((s, r) => s + Number(r.days), 0),
      };

      res.json({
        success: true,
        data: {
          employee: {
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            employeeCode: employee.employeeCode,
            department: employee.department?.name || '-',
            designation: employee.designation?.name || '-',
          },
          year,
          summary,
          balances,
          requests: requests.map((r) => ({
            id: r.id,
            leaveType: r.leaveType,
            startDate: r.startDate,
            endDate: r.endDate,
            days: Number(r.days),
            isHalfDay: r.isHalfDay,
            halfDaySession: r.halfDaySession,
            reason: r.reason,
            status: r.status,
            approverRemarks: r.approverRemarks,
            managerRemarks: r.managerRemarks,
            createdAt: r.createdAt,
          })),
        },
      });
    } catch (err) { next(err); }
  }
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
