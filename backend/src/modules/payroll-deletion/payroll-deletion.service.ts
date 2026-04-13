import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export class PayrollDeletionService {
  /**
   * HR submits a deletion request for a payroll run
   */
  async createRequest(
    payrollRunId: string,
    organizationId: string,
    requestedById: string,
    reason: string,
    notes?: string,
  ) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: payrollRunId, organizationId },
    });
    if (!run) throw new NotFoundError('Payroll run');
    if (run.status === 'LOCKED') {
      throw new BadRequestError('Locked payroll runs cannot be deleted. Ask a Super Admin to unlock first.');
    }

    // Prevent duplicate pending requests
    const existing = await prisma.payrollDeletionRequest.findFirst({
      where: { payrollRunId, organizationId, status: 'PENDING' },
    });
    if (existing) throw new BadRequestError('A deletion request is already pending for this payroll run.');

    const runLabel = `${MONTH_NAMES[run.month - 1]} ${run.year}`;

    const request = await prisma.payrollDeletionRequest.create({
      data: {
        payrollRunId,
        organizationId,
        requestedById,
        reason,
        notes: notes || null,
        status: 'PENDING',
        runMonth: run.month,
        runYear: run.year,
        runLabel,
      },
    });

    // Get requestor info for email context
    const requestor = await prisma.user.findUnique({
      where: { id: requestedById },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    const requestorName = requestor?.employee
      ? `${requestor.employee.firstName} ${requestor.employee.lastName}`
      : requestor?.email || 'HR';

    // Notify all SuperAdmins
    const superAdmins = await prisma.user.findMany({
      where: { organizationId, role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { email: true },
    });
    for (const admin of superAdmins) {
      if (!admin.email) continue;
      await enqueueEmail({
        to: admin.email,
        subject: `[Action Required] Payroll Deletion Request — ${runLabel}`,
        template: 'payroll-deletion-request',
        context: {
          requestorName,
          runLabel,
          reason,
          notes: notes || '',
          reviewUrl: 'https://hr.anistonav.com/payroll',
        },
      });
    }

    return request;
  }

  /**
   * List all deletion requests (SuperAdmin only)
   */
  async listRequests(organizationId: string, status?: string) {
    const where: any = { organizationId };
    if (status) where.status = status;

    return prisma.payrollDeletionRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * SuperAdmin approves → delete the payroll run + all records
   */
  async approveRequest(requestId: string, organizationId: string, reviewedById: string) {
    const request = await prisma.payrollDeletionRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundError('Deletion request');
    if (request.status !== 'PENDING') throw new BadRequestError('This request has already been reviewed.');

    // Delete all payroll records first (FK), then the run
    if (request.payrollRunId) {
      await prisma.$transaction(async (tx) => {
        await tx.payrollRecord.deleteMany({ where: { payrollRunId: request.payrollRunId! } });
        await tx.payrollAdjustment.deleteMany({ where: { payrollRunId: request.payrollRunId! } });
        await tx.payrollRun.delete({ where: { id: request.payrollRunId! } });
      });
    }

    const updated = await prisma.payrollDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedById,
        reviewedAt: new Date(),
        payrollRunId: null, // run is deleted
      },
    });

    await this.notifyRequestor(request, 'APPROVED', organizationId);
    return updated;
  }

  /**
   * SuperAdmin rejects the deletion request
   */
  async rejectRequest(
    requestId: string,
    organizationId: string,
    reviewedById: string,
    rejectionReason?: string,
  ) {
    const request = await prisma.payrollDeletionRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundError('Deletion request');
    if (request.status !== 'PENDING') throw new BadRequestError('This request has already been reviewed.');

    const updated = await prisma.payrollDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewedById,
        reviewedAt: new Date(),
        rejectionReason: rejectionReason || null,
      },
    });

    await this.notifyRequestor(updated, 'REJECTED', organizationId);
    return updated;
  }

  /**
   * Dismiss a completed request
   */
  async dismissRequest(requestId: string, organizationId: string) {
    const request = await prisma.payrollDeletionRequest.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundError('Deletion request');
    if (request.status === 'PENDING') {
      throw new BadRequestError('Cannot dismiss a pending request — approve or reject it first.');
    }
    await prisma.payrollDeletionRequest.delete({ where: { id: requestId } });
    return { dismissed: true };
  }

  private async notifyRequestor(request: any, outcome: 'APPROVED' | 'REJECTED', organizationId: string) {
    const requestor = await prisma.user.findFirst({
      where: { id: request.requestedById, organizationId },
      select: { email: true, employee: { select: { firstName: true } } },
    });
    if (!requestor?.email) return;

    const firstName = requestor.employee?.firstName || 'there';
    const approved = outcome === 'APPROVED';

    await enqueueEmail({
      to: requestor.email,
      subject: `Payroll Deletion ${approved ? 'Approved' : 'Rejected'} — ${request.runLabel}`,
      template: 'payroll-deletion-reviewed',
      context: {
        firstName,
        runLabel: request.runLabel,
        outcome,
        rejectionReason: request.rejectionReason || '',
        appUrl: 'https://hr.anistonav.com/payroll',
      },
    });
  }
}

export const payrollDeletionService = new PayrollDeletionService();
