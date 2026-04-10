import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { EmployeeService } from '../employee/employee.service.js';
import type { CreateDeletionRequestInput, RejectDeletionRequestInput } from './employee-deletion.validation.js';

const employeeService = new EmployeeService();

export class EmployeeDeletionService {
  // Helper: get the deletion request Prisma model, or throw a clear error
  private getDeletionModel() {
    const model = (prisma as any).employeeDeletionRequest;
    if (!model) {
      logger.error('[EmployeeDeletionService] Prisma client missing employeeDeletionRequest — schema not synced. Run: prisma generate && prisma db push');
      throw new BadRequestError('Employee deletion feature is initializing. Please try again in a moment or contact support if the issue persists.');
    }
    return model;
  }

  // ─────────────────────────────────
  // HR: Create deletion request
  // ─────────────────────────────────
  async createRequest(
    employeeId: string,
    data: CreateDeletionRequestInput,
    requestedBy: { id: string; name: string; role: string },
    organizationId: string,
  ) {
    const deletionModel = this.getDeletionModel();

    // Verify employee exists and belongs to this org
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, isSystemAccount: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.isSystemAccount) throw new BadRequestError('System accounts cannot be deleted');

    // Block duplicate pending requests for same employee
    const existing = await deletionModel.findFirst({
      where: { employeeId, organizationId, status: 'PENDING' },
    });
    if (existing) throw new ConflictError('A deletion request for this employee is already pending');

    const request = await deletionModel.create({
      data: {
        organizationId,
        employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeCode: employee.employeeCode,
        employeeEmail: employee.email,
        requestedById: requestedBy.id,
        requestedByName: requestedBy.name,
        requestedByRole: requestedBy.role,
        reason: data.reason,
        notes: data.notes || null,
        status: 'PENDING',
      },
    });

    // Audit log
    await createAuditLog({
      userId: requestedBy.id,
      organizationId,
      entity: 'EmployeeDeletionRequest',
      entityId: request.id,
      action: 'CREATE',
      newValue: { employeeCode: employee.employeeCode, employeeName: request.employeeName, reason: data.reason },
    });

    // Notify Super Admins
    this.notifySuperAdmins(organizationId, employee, requestedBy.name).catch(e =>
      logger.warn('[DeletionRequest] Failed to notify super admins:', e.message),
    );

    return request;
  }

  // ─────────────────────────────────
  // Super Admin: List all requests
  // ─────────────────────────────────
  async listRequests(
    organizationId: string,
    query: { page?: number; limit?: number; status?: string },
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };
    if (query.status) where.status = query.status;

    const deletionModel = this.getDeletionModel();
    const [requests, total] = await Promise.all([
      deletionModel.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      deletionModel.count({ where }),
    ]);

    return {
      data: requests,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  // ─────────────────────────────────
  // Super Admin: Get single request
  // ─────────────────────────────────
  async getRequest(id: string, organizationId: string) {
    const request = await this.getDeletionModel().findFirst({
      where: { id, organizationId },
    });
    if (!request) throw new NotFoundError('Deletion request');
    return request;
  }

  // ─────────────────────────────────
  // Super Admin: Approve → permanently delete employee
  // ─────────────────────────────────
  async approveRequest(
    requestId: string,
    reviewedBy: { id: string; name: string },
    organizationId: string,
  ) {
    const deletionModel = this.getDeletionModel();
    const request = await deletionModel.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundError('Deletion request');
    if (request.status !== 'PENDING') {
      throw new BadRequestError(`Cannot approve a request with status "${request.status}"`);
    }

    // Employee might already be gone if manually deleted
    if (request.employeeId) {
      const employee = await prisma.employee.findFirst({
        where: { id: request.employeeId, organizationId, deletedAt: null },
      });
      if (!employee) throw new BadRequestError('Employee no longer exists or was already deleted');

      // Perform permanent removal via existing softDelete (deletes all related records)
      await employeeService.softDelete(request.employeeId, organizationId, reviewedBy.id);
    }

    // Mark request approved
    const updated = await deletionModel.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedById: reviewedBy.id,
        reviewedByName: reviewedBy.name,
        reviewedAt: new Date(),
        // Clear FK since employee is now deleted
        employeeId: null,
      },
    });

    await createAuditLog({
      userId: reviewedBy.id,
      organizationId,
      entity: 'EmployeeDeletionRequest',
      entityId: requestId,
      action: 'APPROVE',
      oldValue: { status: 'PENDING' },
      newValue: { status: 'APPROVED', employeeName: request.employeeName, employeeCode: request.employeeCode },
    });

    // Notify HR who made the request
    this.notifyRequestor(request, 'APPROVED', organizationId).catch(e =>
      logger.warn('[DeletionRequest] Failed to notify requestor:', e.message),
    );

    return updated;
  }

  // ─────────────────────────────────
  // Super Admin: Reject request
  // ─────────────────────────────────
  async rejectRequest(
    requestId: string,
    reviewedBy: { id: string; name: string },
    organizationId: string,
    data: RejectDeletionRequestInput,
  ) {
    const deletionModel = this.getDeletionModel();
    const request = await deletionModel.findFirst({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundError('Deletion request');
    if (request.status !== 'PENDING') {
      throw new BadRequestError(`Cannot reject a request with status "${request.status}"`);
    }

    const updated = await deletionModel.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewedById: reviewedBy.id,
        reviewedByName: reviewedBy.name,
        reviewedAt: new Date(),
        rejectionReason: data.rejectionReason || null,
      },
    });

    await createAuditLog({
      userId: reviewedBy.id,
      organizationId,
      entity: 'EmployeeDeletionRequest',
      entityId: requestId,
      action: 'REJECT',
      oldValue: { status: 'PENDING' },
      newValue: { status: 'REJECTED', rejectionReason: data.rejectionReason, employeeName: request.employeeName },
    });

    this.notifyRequestor(request, 'REJECTED', organizationId).catch(e =>
      logger.warn('[DeletionRequest] Failed to notify requestor:', e.message),
    );

    return updated;
  }

  // ─────────────────────────────────
  // Super Admin: Direct delete (no request needed)
  // ─────────────────────────────────
  async directDelete(
    employeeId: string,
    deletedBy: { id: string; name: string },
    organizationId: string,
    reason: string,
  ) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, isSystemAccount: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.isSystemAccount) throw new BadRequestError('System accounts cannot be deleted');

    // Cancel any pending deletion requests for this employee
    // Guard against Prisma client not having the model (schema not yet synced on server)
    const deletionRequestModel = (prisma as any).employeeDeletionRequest;
    if (deletionRequestModel) {
      try {
        await deletionRequestModel.updateMany({
          where: { employeeId, organizationId, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            reviewedById: deletedBy.id,
            reviewedByName: deletedBy.name,
            reviewedAt: new Date(),
            rejectionReason: 'Employee was directly deleted by Super Admin',
            employeeId: null,
          },
        });
      } catch (e: any) {
        logger.warn(`[DirectDelete] Could not cancel pending deletion requests for ${employeeId}: ${e.message}`);
      }
    } else {
      logger.warn('[DirectDelete] employeeDeletionRequest model not available on Prisma client — run prisma generate');
    }

    // Perform permanent removal
    await employeeService.softDelete(employeeId, organizationId, deletedBy.id);

    await createAuditLog({
      userId: deletedBy.id,
      organizationId,
      entity: 'Employee',
      entityId: employeeId,
      action: 'PERMANENT_DELETE',
      newValue: {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeCode: employee.employeeCode,
        email: employee.email,
        reason,
        deletedBy: deletedBy.name,
      },
    });

    return { deleted: true, employeeCode: employee.employeeCode, employeeName: `${employee.firstName} ${employee.lastName}` };
  }

  // ─────────────────────────────────
  // Private helpers
  // ─────────────────────────────────
  private async notifySuperAdmins(
    organizationId: string,
    employee: { firstName: string; lastName: string; employeeCode: string },
    requestedByName: string,
  ) {
    const superAdmins = await prisma.user.findMany({
      where: { organizationId, role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { id: true, email: true },
    });
    for (const admin of superAdmins) {
      if (!admin.email) continue;
      await enqueueEmail({
        to: admin.email,
        subject: `[Action Required] Employee Deletion Request — ${employee.employeeCode}`,
        template: 'generic',
        context: {
          title: 'Employee Deletion Request',
          body: `<b>${requestedByName}</b> has submitted a request to permanently delete employee <b>${employee.firstName} ${employee.lastName} (${employee.employeeCode})</b>.<br/><br/>Please review and approve or reject this request in Admin Settings → Deletion Requests. Your approval is required before any employee data is removed.`,
        },
      });
    }
  }

  private async notifyRequestor(
    request: any,
    outcome: 'APPROVED' | 'REJECTED',
    organizationId: string,
  ) {
    const requestor = await prisma.user.findFirst({
      where: { id: request.requestedById, organizationId },
      select: { id: true, email: true },
    });
    if (!requestor?.email) return;

    const statusText = outcome === 'APPROVED' ? 'Approved' : 'Rejected';
    const bodyLines = [
      `Your deletion request for <b>${request.employeeName} (${request.employeeCode})</b> has been <b>${statusText.toLowerCase()}</b> by a Super Admin.`,
      outcome === 'REJECTED' && request.rejectionReason ? `<br/><b>Reason:</b> ${request.rejectionReason}` : '',
      outcome === 'APPROVED'
        ? '<br/>The employee and all associated records have been permanently removed from the system.'
        : '<br/>The employee record remains active in the system.',
    ].filter(Boolean);

    await enqueueEmail({
      to: requestor.email,
      subject: `Deletion Request ${statusText} — ${request.employeeCode}`,
      template: 'generic',
      context: {
        title: `Deletion Request ${statusText}`,
        body: bodyLines.join(''),
      },
    });
  }
}

export const employeeDeletionService = new EmployeeDeletionService();
