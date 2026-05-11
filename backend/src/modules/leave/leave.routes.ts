import { Router } from 'express';
import { z } from 'zod';
import { leaveController } from './leave.controller.js';
import { authenticate, requirePermission, authorize, requireEmpPerm } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

// Reusable query schemas for inline route handlers
const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
const searchYearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  search: z.string().max(100).optional(),
});

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
router.get('/balances', requireEmpPerm('canViewLeaveBalance'), (req, res, next) => leaveController.getBalances(req, res, next));
router.get('/balances/:employeeId', requirePermission('leave', 'read'), (req, res, next) => leaveController.getBalances(req, res, next));
router.post('/apply', requireEmpPerm('canApplyLeaves'), (req, res, next) => leaveController.applyLeave(req, res, next));
router.post('/preview', requireEmpPerm('canApplyLeaves'), (req, res, next) => leaveController.previewLeave(req, res, next));
router.get('/my', requireEmpPerm('canViewLeaveBalance'), (req, res, next) => leaveController.getMyLeaves(req, res, next));

// Draft flow
router.post('/draft', requireEmpPerm('canApplyLeaves'), (req, res, next) => leaveController.saveDraft(req, res, next));
router.post('/:id/submit', requireEmpPerm('canApplyLeaves'), (req, res, next) => leaveController.submitDraft(req, res, next));

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

// Employee condition response (reply to APPROVED_WITH_CONDITION) — legacy single-field
router.post('/:id/condition-response', (req, res, next) => leaveController.submitConditionResponse(req, res, next));

// Condition thread message (HR or Employee)
router.post('/:id/condition-message', (req, res, next) => leaveController.postConditionMessage(req, res, next));

// HR resolves conditional leave (APPROVE or REJECT)
router.post('/:id/resolve-condition', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) => leaveController.resolveConditionalLeave(req, res, next));

// Audit & notifications
router.get('/:id/audit', (req, res, next) => leaveController.getLeaveAudit(req, res, next));
router.get('/:id/notifications',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.getNotificationLog(req, res, next)
);

// Cancel
router.delete('/:id', (req, res, next) => leaveController.cancelLeave(req, res, next));

// Draft count for HR nudge banner
router.get(
  '/drafts-count',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.getDraftsCount(req, res, next)
);

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
      const parsed = searchYearQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_QUERY', message: parsed.error.errors[0]?.message ?? 'Invalid query parameters' } });
      }
      const { prisma: db } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const year = parsed.data.year ?? new Date().getFullYear();
      const search = (parsed.data.search ?? '').toLowerCase();

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
          gender: true,
          status: true,
          joiningDate: true,
          user: { select: { role: true } },
          department: { select: { name: true } },
          designation: { select: { name: true } },
          leaveBalances: {
            where: { year },
            include: {
              leaveType: {
                select: {
                  id: true, name: true, code: true, isPaid: true,
                  gender: true, applicableTo: true, applicableToRole: true,
                  applicableToEmployeeIds: true, probationMonths: true, isActive: true,
                },
              },
            },
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
        _sum: { days: true, unpaidDays: true },
      });

      const leaveCountMap = new Map<string, { applied: number; approved: number; pending: number; totalDays: number; totalUnpaidDays: number }>();
      leaveCounts.forEach((lc) => {
        const existing = leaveCountMap.get(lc.employeeId) || { applied: 0, approved: 0, pending: 0, totalDays: 0, totalUnpaidDays: 0 };
        existing.applied += lc._count.id;
        existing.totalDays += Number(lc._sum.days || 0);
        if (lc.status === 'APPROVED') {
          existing.approved += lc._count.id;
          existing.totalUnpaidDays += Number((lc._sum as any).unpaidDays || 0);
        }
        if (lc.status === 'PENDING' || lc.status === 'MANAGER_APPROVED' || lc.status === 'APPROVED_WITH_CONDITION') existing.pending += lc._count.id;
        leaveCountMap.set(lc.employeeId, existing);
      });

      // Applicability filter — mirrors the policy-engine path in leave.service.ts getBalances()
      // so the table and the detail popup always agree on which leave types count.
      const POLICY_MANAGED_AUDIENCES_SET = new Set(['ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE']);
      const isLeaveApplicable = (lt: any, emp: any): boolean => {
        if (!lt.isActive) return false;
        if (lt.gender && lt.gender !== emp.gender) return false;

        const specificIds: string[] | null = lt.applicableToEmployeeIds
          ? (() => { try { return JSON.parse(lt.applicableToEmployeeIds); } catch { return null; } })()
          : null;
        if (specificIds && specificIds.length > 0) return specificIds.includes(emp.id);

        const userRole = emp.user?.role;
        if (lt.applicableToRole && lt.applicableToRole !== userRole) return false;

        const probationMonths = lt.probationMonths ?? 0;
        if (probationMonths > 0 && emp.joiningDate) {
          const joined = new Date(emp.joiningDate);
          const now = new Date();
          const monthsWorked = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
          if (monthsWorked < probationMonths) return false;
        }

        const app = lt.applicableTo as string;
        const status = emp.status as string;
        const isTrainee = status === 'PROBATION' || status === 'INTERN' || userRole === 'INTERN';
        const isActive = status === 'ACTIVE';
        const isEligible = isActive || isTrainee;

        // Policy-managed audience values — strict status match required
        if (POLICY_MANAGED_AUDIENCES_SET.has(app)) {
          if (app === 'ACTIVE_ONLY') return isActive;
          if (app === 'TRAINEE_ONLY') return isTrainee;
          if (app === 'ALL_ELIGIBLE') return isEligible;
        }

        // Legacy audience values — kept for backward compat but scoped to current status
        if (app === 'ALL') return isEligible;
        if (app === 'PROBATION') return status === 'PROBATION';
        if (app === 'ACTIVE' || app === 'CONFIRMED') return isActive;
        if (app === 'INTERN') return status === 'INTERN' || userRole === 'INTERN';
        // Non-eligible statuses never apply
        if (['NOTICE_PERIOD', 'ONBOARDING', 'SUSPENDED', 'INACTIVE', 'TERMINATED', 'ABSCONDED'].includes(app)) return false;
        return isEligible;
      };

      const data = employees.map((emp) => {
        const counts = leaveCountMap.get(emp.id) || { applied: 0, approved: 0, pending: 0, totalDays: 0 };
        // Only count balances for leave types that actually apply to this employee
        const applicableBalances = emp.leaveBalances.filter((b) => isLeaveApplicable(b.leaveType, emp));
        // Exclude unpaid (LWP) types from quota totals — they have no fixed allocation
        const paidApplicableBalances = applicableBalances.filter((b) => b.leaveType.isPaid);
        const totalAllocated = paidApplicableBalances.reduce((s, b) => s + Number(b.allocated) + Number(b.carriedForward), 0);
        const totalUsed = paidApplicableBalances.reduce((s, b) => s + Number(b.used), 0);
        const totalPending = paidApplicableBalances.reduce((s, b) => s + Number(b.pending), 0);
        const totalRemaining = totalAllocated - totalUsed - totalPending;
        // Breakdown aggregates — paid leave types only
        const totalPolicyAllocated = paidApplicableBalances.reduce((s, b) => s + Number((b as any).policyAllocated ?? b.allocated), 0);
        const totalManualAdjustment = paidApplicableBalances.reduce((s, b) => s + Number((b as any).manualAdjustment ?? 0), 0);
        const totalPreviousUsed = paidApplicableBalances.reduce((s, b) => s + Number((b as any).previousUsed ?? 0), 0);
        const hasManualAdjustments = totalManualAdjustment !== 0;
        const hasPreviousUsed = totalPreviousUsed > 0;
        return {
          id: emp.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          status: emp.status,
          userRole: emp.user?.role,
          department: emp.department?.name || '-',
          designation: emp.designation?.name || '-',
          totalAllocated,
          totalUsed,
          totalPending,
          totalRemaining,
          totalUnpaidDays: counts.totalUnpaidDays,
          totalPolicyAllocated,
          totalManualAdjustment,
          totalPreviousUsed,
          totalEffectiveAllocated: totalPolicyAllocated + totalManualAdjustment,
          hasManualAdjustments,
          hasPreviousUsed,
          balances: applicableBalances.map((b) => ({
            leaveTypeId: b.leaveTypeId,
            leaveTypeName: b.leaveType.name,
            leaveTypeCode: b.leaveType.code,
            isPaid: b.leaveType.isPaid,
            policyAllocated: Number((b as any).policyAllocated ?? b.allocated),
            manualAdjustment: Number((b as any).manualAdjustment ?? 0),
            previousUsed: Number((b as any).previousUsed ?? 0),
            effectiveAllocated: Number((b as any).policyAllocated ?? b.allocated) + Number((b as any).manualAdjustment ?? 0),
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
      const parsed = yearQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_QUERY', message: parsed.error.errors[0]?.message ?? 'Invalid query parameters' } });
      }
      const { prisma: db } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const { employeeId } = req.params;
      const year = parsed.data.year ?? new Date().getFullYear();

      const employee = await db.employee.findFirst({
        where: { id: employeeId, organizationId: orgId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          status: true,
          user: { select: { role: true } },
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

      const adjustments = await db.leaveAllocationLog.findMany({
        where: { employeeId, organizationId: orgId, year },
        include: { leaveType: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
      });

      // Resolve changedBy UUIDs → human-readable names in one batch query
      const adjChangedByIds = [...new Set(adjustments.map((a) => a.changedBy).filter(Boolean) as string[])];
      const adjChangedByUsers = adjChangedByIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: adjChangedByIds } },
            select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
          })
        : [];
      const adjChangedByMap = new Map<string, string>(
        (adjChangedByUsers as any[]).map((u) => [
          u.id,
          u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : (u.email || 'Unknown'),
        ])
      );

      const balances = employee.leaveBalances.map((b) => ({
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        leaveTypeCode: b.leaveType.code,
        isPaid: b.leaveType.isPaid,
        policyAllocated: Number((b as any).policyAllocated ?? b.allocated),
        manualAdjustment: Number((b as any).manualAdjustment ?? 0),
        previousUsed: Number((b as any).previousUsed ?? 0),
        effectiveAllocated: Number((b as any).policyAllocated ?? b.allocated) + Number((b as any).manualAdjustment ?? 0),
        allocated: Number(b.allocated),
        carriedForward: Number(b.carriedForward),
        used: Number(b.used),
        pending: Number(b.pending),
        remaining: Number(b.allocated) + Number(b.carriedForward) - Number(b.used) - Number(b.pending),
      }));

      // Exclude unpaid (LWP) types from quota totals — they have no fixed allocation
      const paidBalances = balances.filter((b) => b.isPaid);
      const totalAllocated = paidBalances.reduce((s, b) => s + b.allocated + b.carriedForward, 0);
      const totalUsed = paidBalances.reduce((s, b) => s + b.used, 0);
      const totalPending = paidBalances.reduce((s, b) => s + b.pending, 0);
      const totalRemaining = totalAllocated - totalUsed - totalPending;

      // Count total unpaid days from fully-approved requests only
      const totalUnpaidDays = requests
        .filter((r) => r.status === 'APPROVED')
        .reduce((s, r) => s + Number((r as any).unpaidDays ?? 0), 0);

      const summary = {
        totalAllocated,
        totalUsed,
        totalPending,
        totalRemaining,
        totalUnpaidDays,
        leavesApplied: requests.length,
        leavesApproved: requests.filter((r) => r.status === 'APPROVED').length,
        leavesPending: requests.filter((r) => ['PENDING', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'].includes(r.status)).length,
        leavesConditional: requests.filter((r) => r.status === 'APPROVED_WITH_CONDITION').length,
        leavesRejected: requests.filter((r) => r.status === 'REJECTED').length,
        leavesCancelled: requests.filter((r) => r.status === 'CANCELLED').length,
        totalApprovedDays: requests
          .filter((r) => r.status === 'APPROVED')
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
            status: employee.status,
            userRole: employee.user?.role,
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
          adjustments: adjustments.map((a) => ({
            id: a.id,
            leaveType: a.leaveType,
            year: a.year,
            allocationType: a.allocationType,
            days: a.days,
            previousDays: a.previousDays,
            reason: a.reason,
            changedBy: a.changedBy,
            changedByName: adjChangedByMap.get(a.changedBy ?? '') || 'System',
            calculationBasis: a.calculationBasis,
            createdAt: a.createdAt,
          })),
        },
      });
    } catch (err) { next(err); }
  }
);

// Leave policies CRUD
router.get('/policies', async (req, res, next) => {
  try {
    const { leavePolicyService } = await import('./leave-policy.service.js');
    const policy = await leavePolicyService.getOrCreateDefaultPolicy(req.user!.organizationId);
    // Return the full policy list (most orgs will have just one default)
    const { prisma } = await import('../../lib/prisma.js');
    const policies = await prisma.leavePolicy.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      include: {
        rules: { include: { leaveType: { select: { id: true, name: true, code: true } } }, orderBy: { leaveType: { name: 'asc' } } },
        _count: { select: { employees: true } },
      },
      orderBy: { isDefault: 'desc' },
    });
    res.json({ success: true, data: policies });
  } catch (err) { next(err); }
});

router.post('/policies', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { name, description, isDefault, probationDurationMonths, internDurationMonths, maxPaidLeavesPerMonth, rules } = req.body;
    if (isDefault) {
      await prisma.leavePolicy.updateMany({
        where: { organizationId: req.user!.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const policy = await prisma.leavePolicy.create({
      data: {
        name, description, isDefault: !!isDefault,
        probationDurationMonths: probationDurationMonths ?? 3,
        internDurationMonths: internDurationMonths ?? 3,
        organizationId: req.user!.organizationId,
        rules: rules?.length ? {
          createMany: {
            data: rules.map((r: any) => ({
              leaveTypeId: r.leaveTypeId,
              employeeCategory: r.employeeCategory ?? 'ALL',
              yearlyDays: r.yearlyDays ?? r.daysAllowed ?? 0,
              monthlyDays: r.monthlyDays ?? 0,
              accrualType: r.accrualType ?? 'UPFRONT',
              isProrata: r.isProrata ?? false,
              daysAllowed: r.daysAllowed ?? r.yearlyDays ?? 0,
              isAllowed: r.isAllowed ?? true,
            })),
          },
        } : undefined,
      },
      include: { rules: { include: { leaveType: { select: { id: true, name: true, code: true } } } } },
    });
    // Workaround: Prisma v6 does not reliably set @default(0) Int fields via create().
    // Apply maxPaidLeavesPerMonth via a follow-up update so it is always persisted.
    const maxPaid = Number(maxPaidLeavesPerMonth ?? 0);
    if (maxPaid !== 0) {
      await prisma.leavePolicy.update({ where: { id: policy.id }, data: { maxPaidLeavesPerMonth: maxPaid } });
      (policy as any).maxPaidLeavesPerMonth = maxPaid;
    }
    res.status(201).json({ success: true, data: policy });
  } catch (err) { next(err); }
});

router.patch('/policies/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { name, description, isDefault, probationDurationMonths, internDurationMonths, maxPaidLeavesPerMonth, allowUnpaidLeave, rules } = req.body;
    if (isDefault) {
      await prisma.leavePolicy.updateMany({
        where: { organizationId: req.user!.organizationId, isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (probationDurationMonths !== undefined) updateData.probationDurationMonths = probationDurationMonths;
    if (internDurationMonths !== undefined) updateData.internDurationMonths = internDurationMonths;
    if (maxPaidLeavesPerMonth !== undefined) updateData.maxPaidLeavesPerMonth = maxPaidLeavesPerMonth;
    if (allowUnpaidLeave !== undefined) updateData.allowUnpaidLeave = allowUnpaidLeave;

    const policy = await prisma.leavePolicy.update({
      where: { id: req.params.id },
      data: updateData,
    });

    if (rules?.length) {
      // Upsert rules by (policyId, leaveTypeId, employeeCategory)
      await Promise.all(rules.map((r: any) =>
        prisma.leavePolicyRule.upsert({
          where: {
            policyId_leaveTypeId_employeeCategory: {
              policyId: req.params.id,
              leaveTypeId: r.leaveTypeId,
              employeeCategory: r.employeeCategory ?? 'ALL',
            },
          },
          update: {
            yearlyDays: r.yearlyDays ?? r.daysAllowed ?? 0,
            monthlyDays: r.monthlyDays ?? 0,
            accrualType: r.accrualType ?? 'UPFRONT',
            isProrata: r.isProrata ?? false,
            daysAllowed: r.daysAllowed ?? r.yearlyDays ?? 0,
            isAllowed: r.isAllowed ?? true,
          },
          create: {
            policyId: req.params.id,
            leaveTypeId: r.leaveTypeId,
            employeeCategory: r.employeeCategory ?? 'ALL',
            yearlyDays: r.yearlyDays ?? r.daysAllowed ?? 0,
            monthlyDays: r.monthlyDays ?? 0,
            accrualType: r.accrualType ?? 'UPFRONT',
            isProrata: r.isProrata ?? false,
            daysAllowed: r.daysAllowed ?? r.yearlyDays ?? 0,
            isAllowed: r.isAllowed ?? true,
          },
        })
      ));
    }

    const updated = await prisma.leavePolicy.findUnique({
      where: { id: req.params.id },
      include: { rules: { include: { leaveType: { select: { id: true, name: true, code: true } } } } },
    });

    // Fire-and-forget background recalculation after policy save
    const { leavePolicyService: lpSvc } = await import('./leave-policy.service.js');
    const orgId = req.user!.organizationId;
    const currentYear = new Date().getFullYear();
    prisma.employee.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true },
    }).then((emps) => {
      return Promise.allSettled(
        emps.map((e) => lpSvc.allocateForEmployee(e.id, currentYear, { force: true, triggeredBy: req.user!.userId }))
      );
    }).catch(() => {/* non-blocking */});

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.delete('/policies/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    await prisma.leavePolicy.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: 'Leave policy deactivated' });
  } catch (err) { next(err); }
});

// Recalculate leave allocations for all employees under a policy
router.post('/policies/:id/recalculate', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { leavePolicyService } = await import('./leave-policy.service.js');
    const { prisma } = await import('../../lib/prisma.js');
    const orgId = req.user!.organizationId;
    const year = req.body.year ?? new Date().getFullYear();

    // Verify policy belongs to org
    const policy = await prisma.leavePolicy.findFirst({ where: { id: req.params.id, organizationId: orgId } });
    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });

    // Get all active employees in the org
    const employees = await prisma.employee.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true },
    });

    let success = 0, failed = 0;
    for (const emp of employees) {
      try {
        await leavePolicyService.allocateForEmployee(emp.id, year, { force: true, triggeredBy: req.user!.userId });
        success++;
      } catch { failed++; }
    }

    res.json({ success: true, data: { processed: employees.length, success, failed, year } });
  } catch (err) { next(err); }
});

// Acknowledge a leave policy (employee must accept before applying leave)
router.post('/policies/:id/acknowledge', async (req, res, next) => {
  try {
    const { prisma: db } = await import('../../lib/prisma.js');
    const employeeId = req.user!.employeeId;
    if (!employeeId) {
      return res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked to your account.' } });
    }
    const policyId = req.params.id;
    // Verify policy belongs to org
    const policy = await db.policy.findFirst({
      where: { id: policyId, organizationId: req.user!.organizationId, isActive: true },
    });
    if (!policy) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found.' } });
    }
    const acknowledgment = await db.policyAcknowledgment.upsert({
      where: { policyId_employeeId: { policyId, employeeId } },
      update: { acknowledgedAt: new Date() },
      create: { policyId, employeeId, acknowledgedAt: new Date() },
    });
    res.json({ success: true, data: acknowledgment });
  } catch (err) { next(err); }
});

// DEPRECATED — Direct balance set. Use POST /leaves/adjustments/:employeeId instead.
// This route remains for backward compatibility (policy recalculate + internal HR tools).
// New code must not call this route. It will be removed in a future release.
router.patch(
  '/balance/:employeeId/:leaveTypeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma: db } = await import('../../lib/prisma.js');
      const { enqueueNotification, enqueueEmail } = await import('../../jobs/queues.js');
      const { employeeId, leaveTypeId } = req.params;
      // Signal deprecation to any API clients that inspect headers
      res.setHeader('Deprecation', 'true');
      res.setHeader('X-Deprecated-Use', 'POST /leaves/adjustments/:employeeId');
      const { allocated, reason } = req.body;
      const year = Number(req.body.year) || new Date().getFullYear();

      if (typeof allocated !== 'number' || allocated < 0) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'allocated must be a non-negative number' } });
      }

      // Verify employee belongs to org
      const employee = await db.employee.findFirst({
        where: { id: employeeId, organizationId: req.user!.organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, user: { select: { id: true, email: true } } },
      });
      if (!employee) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const leaveType = await db.leaveType.findFirst({
        where: { id: leaveTypeId, organizationId: req.user!.organizationId },
        select: { id: true, name: true },
      });
      if (!leaveType) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave type not found' } });
      }

      const existingBalance = await (db.leaveBalance.findUnique as any)({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
        select: { allocated: true, manualAdjustment: true },
      });
      // Preserve existing manualAdjustment — this route sets the policy baseline only
      const existingManualAdj = Number(existingBalance?.manualAdjustment ?? 0);

      const balance = await (db.leaveBalance.upsert as any)({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
        // SAFE: only policyAllocated is set; manualAdjustment is intentionally preserved
        update: { policyAllocated: allocated, allocated: allocated + existingManualAdj },
        create: { employeeId, leaveTypeId, year, policyAllocated: allocated, manualAdjustment: 0, previousUsed: 0, allocated, used: 0, pending: 0, carriedForward: 0 },
      });

      await db.leaveAllocationLog.create({
        data: {
          employeeId,
          leaveTypeId,
          year,
          allocationType: 'MANUAL_ADJUSTMENT',
          days: allocated,
          previousDays: existingBalance ? Number(existingBalance.allocated) : null,
          reason: reason ? String(reason).trim() : null,
          changedBy: req.user!.userId,
          organizationId: req.user!.organizationId,
          calculationBasis: { adjustmentType: 'BALANCE_SET', field: 'allocated' },
        },
      });

      // Notify the employee — in-app, email, and real-time socket
      if (employee.user?.id) {
        await enqueueNotification({
          userId: employee.user.id,
          organizationId: req.user!.organizationId,
          type: 'LEAVE_BALANCE_ADJUSTED',
          title: `Leave Balance Updated — ${leaveType.name}`,
          message: `Your ${leaveType.name} balance for ${year} has been updated to ${allocated} day${allocated !== 1 ? 's' : ''} by HR${reason ? ': ' + reason : '.'}`,
          link: '/leaves',
        }).catch(() => {});

        // Real-time socket — employee's personal room
        const { emitToUser } = await import('../../sockets/index.js');
        emitToUser(employee.user.id, 'leave:balance-adjusted', {
          leaveTypeName: leaveType.name,
          allocated,
          year,
          reason: reason || null,
        });
      }
      if (employee.user?.email) {
        await enqueueEmail({
          to: employee.user.email,
          subject: `Leave Balance Updated — ${leaveType.name} (${year})`,
          template: 'leave-balance-adjusted',
          context: {
            employeeName: `${employee.firstName} ${employee.lastName}`,
            leaveTypeName: leaveType.name,
            allocated,
            year,
            reason: reason || '',
            appUrl: 'https://hr.anistonav.com/leaves',
          },
        }).catch(() => {});
      }

      res.json({ success: true, data: balance, message: `${leaveType.name} balance updated to ${allocated} days` });
    } catch (err) { next(err); }
  }
);

// GET /adjustments/:employeeId — full adjustment/audit log for an employee
router.get(
  '/adjustments/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma: db } = await import('../../lib/prisma.js');
      const { employeeId } = req.params;
      const year = req.query.year ? Number(req.query.year) : undefined;

      const employee = await db.employee.findFirst({
        where: { id: employeeId, organizationId: req.user!.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!employee) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const logs = await db.leaveAllocationLog.findMany({
        where: {
          employeeId,
          organizationId: req.user!.organizationId,
          ...(year ? { year } : {}),
        },
        include: { leaveType: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
      });

      // Resolve changedBy UUIDs → human-readable names in one batch query
      const changedByIds = [...new Set(logs.map((l) => l.changedBy).filter(Boolean) as string[])];
      const changedByUsers = changedByIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: changedByIds } },
            select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
          })
        : [];
      const changedByMap = new Map<string, string>(
        (changedByUsers as any[]).map((u) => [
          u.id,
          u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : (u.email || 'Unknown'),
        ])
      );

      res.json({
        success: true,
        data: logs.map((l) => ({
          ...l,
          changedByName: changedByMap.get(l.changedBy ?? '') || 'System',
        })),
      });
    } catch (err) { next(err); }
  }
);

// POST /adjustments/:employeeId — create a manual leave adjustment (PREVIOUS_USED or BALANCE_CORRECTION)
router.post(
  '/adjustments/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma: db } = await import('../../lib/prisma.js');
      const { employeeId } = req.params;
      const { adjustmentType, leaveTypeId, year: yearInput, days, reason, effectiveDate } = req.body;
      const year = Number(yearInput) || new Date().getFullYear();

      if (!['PREVIOUS_USED', 'BALANCE_CORRECTION'].includes(adjustmentType)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'adjustmentType must be PREVIOUS_USED or BALANCE_CORRECTION' } });
      }
      if (typeof days !== 'number' || days === 0) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'days must be a non-zero number' } });
      }
      if (adjustmentType === 'PREVIOUS_USED' && days < 0) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'days must be positive for PREVIOUS_USED' } });
      }
      // BALANCE_CORRECTION allows both positive (add days) and negative (deduct days)
      if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'reason is required (min 3 chars)' } });
      }
      if (!leaveTypeId) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'leaveTypeId is required' } });
      }

      const employee = await db.employee.findFirst({
        where: { id: employeeId, organizationId: req.user!.organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, user: { select: { role: true } } },
      });
      if (!employee) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      // HR cannot adjust balances for HR, Admin, or their own account — only SUPER_ADMIN/ADMIN can do that
      const requesterRole = req.user!.role;
      const targetRole = employee.user?.role;
      const HR_PROTECTED_ROLES = ['HR', 'ADMIN', 'SUPER_ADMIN'];
      if (requesterRole === 'HR' && (targetRole && HR_PROTECTED_ROLES.includes(targetRole))) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `HR cannot adjust leave balances for ${targetRole} accounts. Only Super Admin or Admin can perform this action.`,
          },
        });
      }

      const leaveType = await db.leaveType.findFirst({
        where: { id: leaveTypeId, organizationId: req.user!.organizationId },
        select: { id: true, name: true },
      });
      if (!leaveType) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave type not found' } });
      }

      const existing = await db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      });

      // ── Negative balance guard ───────────────────────────────────────────────
      // Pre-validate that the adjustment won't make remaining < 0.
      // Backend is the single source of truth — frontend shows a warning but this
      // is the definitive gate.
      const _policyAlloc = existing ? Number((existing as any).policyAllocated ?? existing.allocated) : 0;
      const _manualAdj   = existing ? Number((existing as any).manualAdjustment ?? 0) : 0;
      const _effectiveAlloc = _policyAlloc + _manualAdj;
      const _cf      = existing ? Number(existing.carriedForward) : 0;
      const _used    = existing ? Number(existing.used) : 0;
      const _pending = existing ? Number(existing.pending) : 0;
      const _remaining = _effectiveAlloc + _cf - _used - _pending;

      if (adjustmentType === 'PREVIOUS_USED') {
        const remainingAfter = _remaining - days;
        if (remainingAfter < 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INSUFFICIENT_BALANCE',
              message: `Previous used (${days}d) exceeds available balance. Current remaining: ${_remaining}d, would become ${remainingAfter}d. Add a Balance Correction first, or use Leave Without Pay.`,
            },
          });
        }
      }

      if (adjustmentType === 'BALANCE_CORRECTION' && days < 0) {
        const newEffectiveAlloc = Math.max(0, _policyAlloc + _manualAdj + days);
        const remainingAfter = newEffectiveAlloc + _cf - _used - _pending;
        if (remainingAfter < 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INSUFFICIENT_BALANCE',
              message: `Balance correction of ${days}d would result in negative remaining balance (${remainingAfter}d). Reduce the correction amount, or first record used leaves via Previous Used.`,
            },
          });
        }
      }
      // ── End negative balance guard ────────────────────────────────────────────

      let balance;
      if (adjustmentType === 'PREVIOUS_USED') {
        const prevPreviousUsed = existing ? Number((existing as any).previousUsed ?? 0) : 0;
        balance = await (db.leaveBalance.upsert as any)({
          where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
          update: {
            used: { increment: days },
            previousUsed: { increment: days },
          },
          create: {
            employeeId, leaveTypeId, year,
            policyAllocated: 0, manualAdjustment: 0, previousUsed: days,
            allocated: 0, used: days, pending: 0, carriedForward: 0,
          },
        });

        const log = await db.leaveAllocationLog.create({
          data: {
            employeeId,
            leaveTypeId,
            year,
            allocationType: 'MANUAL_ADJUSTMENT',
            days,
            previousDays: prevPreviousUsed,
            reason: reason.trim(),
            changedBy: req.user!.userId,
            organizationId: req.user!.organizationId,
            calculationBasis: { adjustmentType, field: 'used', effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10) },
          },
          include: { leaveType: { select: { id: true, name: true, code: true } } },
        });

        return res.status(201).json({ success: true, data: { log, balance } });
      } else {
        // BALANCE_CORRECTION: apply delta to manualAdjustment; keep policyAllocated intact
        const prevManualAdj = existing ? Number((existing as any).manualAdjustment ?? 0) : 0;
        const prevPolicyAlloc = existing ? Number((existing as any).policyAllocated ?? existing.allocated) : 0;
        const newManualAdj = prevManualAdj + days;
        const newAllocated = Math.max(0, prevPolicyAlloc + newManualAdj);
        balance = await (db.leaveBalance.upsert as any)({
          where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
          update: {
            manualAdjustment: newManualAdj,
            allocated: newAllocated,
          },
          create: {
            employeeId, leaveTypeId, year,
            policyAllocated: 0, manualAdjustment: days,
            allocated: Math.max(0, days), used: 0, pending: 0, carriedForward: 0, previousUsed: 0,
          },
        });

        const log = await db.leaveAllocationLog.create({
          data: {
            employeeId,
            leaveTypeId,
            year,
            allocationType: 'MANUAL_ADJUSTMENT',
            days,
            previousDays: prevManualAdj,
            reason: reason.trim(),
            changedBy: req.user!.userId,
            organizationId: req.user!.organizationId,
            calculationBasis: { adjustmentType, field: 'allocated', effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10) },
          },
          include: { leaveType: { select: { id: true, name: true, code: true } } },
        });

        return res.status(201).json({ success: true, data: { log, balance } });
      }
    } catch (err) { next(err); }
  }
);

// Per-employee recalculate: refreshes leave balances for a single employee using the current policy
router.post(
  '/recalculate-employee/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { leavePolicyService } = await import('./leave-policy.service.js');
      const { prisma: db } = await import('../../lib/prisma.js');
      const orgId = req.user!.organizationId;
      const { employeeId } = req.params;
      const year = req.body.year ?? new Date().getFullYear();

      const employee = await db.employee.findFirst({
        where: { id: employeeId, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });
      if (!employee) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
      }

      const result = await leavePolicyService.allocateForEmployee(employeeId, year, { force: true, triggeredBy: req.user!.userId });
      res.json({ success: true, data: { ...result, year, employeeId } });
    } catch (err) { next(err); }
  }
);

export { router as leaveRouter };
