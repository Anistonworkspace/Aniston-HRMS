import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { assertHRActionAllowed } from '../../utils/hrRestrictions.js';

export class PayrollAdjustmentService {
  async listByRun(payrollRunId: string, organizationId: string) {
    const run = await prisma.payrollRun.findFirst({ where: { id: payrollRunId, organizationId } });
    if (!run) throw new NotFoundError('Payroll run');

    return prisma.payrollAdjustment.findMany({
      where: { payrollRunId },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * List active employees for a payroll run's org — used to populate the adjustment
   * employee dropdown when the run is still in DRAFT (no payroll records exist yet).
   */
  async listEmployeesForRun(payrollRunId: string, organizationId: string) {
    const run = await prisma.payrollRun.findFirst({ where: { id: payrollRunId, organizationId } });
    if (!run) throw new NotFoundError('Payroll run');

    return prisma.employee.findMany({
      where: {
        organizationId,
        status: { in: ['ACTIVE', 'PROBATION'] },
        deletedAt: null,
        isSystemAccount: { not: true },
      },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
      orderBy: { firstName: 'asc' },
    });
  }

  async listByEmployee(employeeId: string, payrollRunId?: string) {
    return prisma.payrollAdjustment.findMany({
      where: { employeeId, ...(payrollRunId ? { payrollRunId } : {}) },
      include: {
        payrollRun: { select: { month: true, year: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    payrollRunId: string; employeeId: string;
    type: string; componentName: string;
    amount: number; isDeduction: boolean; reason: string;
  }, organizationId: string, userId: string, userRole?: string) {
    if (userRole === 'HR') {
      await assertHRActionAllowed('HR', data.employeeId, 'canHRAddPayrollAdjustment');
    }

    // Verify run exists and is in DRAFT or REVIEW status
    const run = await prisma.payrollRun.findFirst({
      where: { id: data.payrollRunId, organizationId },
    });
    if (!run) throw new NotFoundError('Payroll run');
    if (!['DRAFT', 'REVIEW'].includes(run.status)) {
      throw new BadRequestError('Adjustments can only be added to DRAFT or REVIEW payroll runs');
    }

    // Verify employee exists in org
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId, deletedAt: null },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Resolve user name + self-benefit guard
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });

    // HR cannot add payroll adjustments to their own salary record (conflict of interest)
    if (userRole === 'HR' && user?.employee?.id && user.employee.id === data.employeeId) {
      throw new BadRequestError(
        'You cannot add a payroll adjustment to your own salary record. Please ask an Admin or Super Admin to perform this action.',
      );
    }
    const addedByName = user?.employee
      ? `${user.employee.firstName} ${user.employee.lastName}`
      : user?.email || 'Unknown';

    const adjustment = await prisma.payrollAdjustment.create({
      data: {
        payrollRunId: data.payrollRunId,
        employeeId: data.employeeId,
        type: data.type as any,
        componentName: data.componentName,
        amount: data.amount,
        isDeduction: data.isDeduction,
        reason: data.reason,
        addedBy: userId,
        addedByName,
        approvalStatus: 'PENDING',
      },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
    });

    await createAuditLog({
      userId, organizationId,
      entity: 'PayrollAdjustment', entityId: adjustment.id,
      action: 'CREATE',
      newValue: { type: data.type, amount: data.amount, employee: `${employee.firstName} ${employee.lastName}` },
    });

    return adjustment;
  }

  async bulkCreate(data: {
    payrollRunId: string;
    adjustments: Array<{
      employeeId: string; type: string; componentName: string;
      amount: number; isDeduction: boolean; reason: string;
    }>;
  }, organizationId: string, userId: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: data.payrollRunId, organizationId },
    });
    if (!run) throw new NotFoundError('Payroll run');
    if (!['DRAFT', 'REVIEW'].includes(run.status)) {
      throw new BadRequestError('Adjustments can only be added to DRAFT or REVIEW payroll runs');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    const addedByName = user?.employee
      ? `${user.employee.firstName} ${user.employee.lastName}`
      : user?.email || 'Unknown';

    const created = await prisma.$transaction(
      data.adjustments.map(adj =>
        prisma.payrollAdjustment.create({
          data: {
            payrollRunId: data.payrollRunId,
            employeeId: adj.employeeId,
            type: adj.type as any,
            componentName: adj.componentName,
            amount: adj.amount,
            isDeduction: adj.isDeduction,
            reason: adj.reason,
            addedBy: userId,
            addedByName,
            approvalStatus: 'PENDING',
          },
        })
      )
    );

    return { created: created.length };
  }

  async approve(id: string, status: 'APPROVED' | 'REJECTED', organizationId: string, userId: string) {
    const adjustment = await prisma.payrollAdjustment.findFirst({
      where: { id, payrollRun: { organizationId } },
      include: { payrollRun: true },
    });
    if (!adjustment) throw new NotFoundError('Adjustment');
    if (adjustment.approvalStatus !== 'PENDING') {
      throw new BadRequestError('Adjustment already processed');
    }

    const updated = await prisma.payrollAdjustment.update({
      where: { id },
      data: { approvalStatus: status as any, approvedBy: userId },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });

    await createAuditLog({
      userId, organizationId,
      entity: 'PayrollAdjustment', entityId: id,
      action: 'UPDATE',
      oldValue: { approvalStatus: 'PENDING' },
      newValue: { approvalStatus: status, approvedBy: userId },
    });

    return updated;
  }

  async delete(id: string, organizationId: string, userId: string) {
    const adjustment = await prisma.payrollAdjustment.findFirst({
      where: { id, payrollRun: { organizationId } },
      include: { payrollRun: true },
    });
    if (!adjustment) throw new NotFoundError('Adjustment');
    if (!['DRAFT', 'REVIEW'].includes(adjustment.payrollRun.status)) {
      throw new BadRequestError('Cannot delete adjustments from processed payroll runs');
    }

    await prisma.payrollAdjustment.delete({ where: { id } });

    await createAuditLog({
      userId, organizationId,
      entity: 'PayrollAdjustment', entityId: id,
      action: 'DELETE',
      oldValue: { type: adjustment.type, amount: Number(adjustment.amount) },
    });
  }
}

export const payrollAdjustmentService = new PayrollAdjustmentService();
