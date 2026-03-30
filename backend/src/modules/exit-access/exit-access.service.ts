import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import type { UpsertExitAccessInput } from './exit-access.validation.js';

export class ExitAccessService {
  async getConfig(employeeId: string) {
    const config = await prisma.exitAccessConfig.findUnique({
      where: { employeeId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            exitStatus: true,
            status: true,
          },
        },
      },
    });

    return config;
  }

  async upsertConfig(
    employeeId: string,
    organizationId: string,
    config: UpsertExitAccessInput,
    createdBy: string
  ) {
    // Verify employee exists and is in exit process
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundError('Employee');

    const data = {
      ...config,
      accessExpiresAt: config.accessExpiresAt ? new Date(config.accessExpiresAt) : null,
      isActive: true,
    };

    const result = await prisma.exitAccessConfig.upsert({
      where: { employeeId },
      create: {
        employeeId,
        organizationId,
        createdBy,
        ...data,
      },
      update: data,
    });

    // If employee is terminated, keep user ACTIVE so they can still log in with limited access
    if (employee.status === 'TERMINATED' && employee.userId) {
      await prisma.user.update({
        where: { id: employee.userId },
        data: { status: 'ACTIVE' },
      });
    }

    await createAuditLog({
      userId: createdBy,
      organizationId,
      entity: 'ExitAccessConfig',
      entityId: result.id,
      action: 'UPSERT',
      newValue: data,
    });

    return result;
  }

  async revokeAccess(employeeId: string, userId: string, organizationId: string) {
    const config = await prisma.exitAccessConfig.findUnique({ where: { employeeId } });
    if (!config) throw new NotFoundError('Exit access config');

    const result = await prisma.exitAccessConfig.update({
      where: { employeeId },
      data: { isActive: false },
    });

    // Deactivate user since access is revoked
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, status: true },
    });
    if (employee?.userId && employee.status === 'TERMINATED') {
      await prisma.user.update({
        where: { id: employee.userId },
        data: { status: 'INACTIVE' },
      });
    }

    await createAuditLog({
      userId,
      organizationId,
      entity: 'ExitAccessConfig',
      entityId: config.id,
      action: 'REVOKE',
      newValue: { isActive: false },
    });

    return result;
  }

  async getMyExitAccess(employeeId: string) {
    return prisma.exitAccessConfig.findUnique({
      where: { employeeId },
      select: {
        canViewDashboard: true,
        canViewPayslips: true,
        canDownloadPayslips: true,
        canViewAttendance: true,
        canMarkAttendance: true,
        canApplyLeave: true,
        canViewLeaveBalance: true,
        canViewDocuments: true,
        canDownloadDocuments: true,
        canViewHelpdesk: true,
        canCreateTicket: true,
        canViewAnnouncements: true,
        canViewProfile: true,
        accessExpiresAt: true,
        isActive: true,
      },
    });
  }
}

export const exitAccessService = new ExitAccessService();
