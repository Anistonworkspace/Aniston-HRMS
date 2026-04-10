import type { Request, Response, NextFunction } from 'express';
import { employeeDeletionService } from './employee-deletion.service.js';
import { createDeletionRequestSchema, rejectDeletionRequestSchema } from './employee-deletion.validation.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import { prisma } from '../../lib/prisma.js';

export const employeeDeletionController = {
  // HR: POST /api/employee-deletion-requests — create request
  async createRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createDeletionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: parsed.error.errors[0].message } });
        return;
      }

      const employeeId = req.params.employeeId as string;
      const user = req.user!;

      // Look up requestor's employee record for name
      const requestorEmployee = await prisma.employee.findFirst({
        where: { userId: user.userId, organizationId: user.organizationId },
        select: { firstName: true, lastName: true },
      });
      const requestorName = requestorEmployee
        ? `${requestorEmployee.firstName} ${requestorEmployee.lastName}`
        : user.userId;

      const result = await employeeDeletionService.createRequest(
        employeeId,
        parsed.data,
        { id: user.userId, name: requestorName, role: user.role },
        user.organizationId,
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  // Super Admin: GET /api/employee-deletion-requests — list
  async listRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, status } = req.query as any;
      const result = await employeeDeletionService.listRequests(req.user!.organizationId, {
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 20,
        status: status || undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  // Super Admin: GET /api/employee-deletion-requests/:id — single request
  async getRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await employeeDeletionService.getRequest(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  },

  // Super Admin: POST /api/employee-deletion-requests/:id/approve
  async approveRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const requestorEmployee = await prisma.employee.findFirst({
        where: { userId: user.userId, organizationId: user.organizationId },
        select: { firstName: true, lastName: true },
      });
      const reviewerName = requestorEmployee
        ? `${requestorEmployee.firstName} ${requestorEmployee.lastName}`
        : 'Super Admin';

      const result = await employeeDeletionService.approveRequest(
        req.params.id as string,
        { id: user.userId, name: reviewerName },
        user.organizationId,
      );
      res.json({ success: true, data: result, message: 'Employee permanently deleted and request approved.' });
    } catch (err) { next(err); }
  },

  // Super Admin: POST /api/employee-deletion-requests/:id/reject
  async rejectRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = rejectDeletionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: parsed.error.errors[0].message } });
        return;
      }
      const user = req.user!;
      const requestorEmployee = await prisma.employee.findFirst({
        where: { userId: user.userId, organizationId: user.organizationId },
        select: { firstName: true, lastName: true },
      });
      const reviewerName = requestorEmployee
        ? `${requestorEmployee.firstName} ${requestorEmployee.lastName}`
        : 'Super Admin';

      const result = await employeeDeletionService.rejectRequest(
        req.params.id as string,
        { id: user.userId, name: reviewerName },
        user.organizationId,
        parsed.data,
      );
      res.json({ success: true, data: result, message: 'Deletion request rejected. Employee record remains active.' });
    } catch (err) { next(err); }
  },

  // Super Admin: DELETE /api/employees/:employeeId/permanent — direct delete
  async directDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const { reason } = req.body;
      if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'A reason is required for direct deletion' } });
        return;
      }

      const user = req.user!;
      const requestorEmployee = await prisma.employee.findFirst({
        where: { userId: user.userId, organizationId: user.organizationId },
        select: { firstName: true, lastName: true },
      });
      const deleterName = requestorEmployee
        ? `${requestorEmployee.firstName} ${requestorEmployee.lastName}`
        : 'Super Admin';

      const result = await employeeDeletionService.directDelete(
        req.params.employeeId as string,
        { id: user.userId, name: deleterName },
        user.organizationId,
        reason.trim(),
      );
      res.json({ success: true, data: result, message: `Employee ${result.employeeCode} permanently deleted.` });
    } catch (err) { next(err); }
  },
};
