import { Request, Response, NextFunction } from 'express';
import { leaveService } from './leave.service.js';
import { applyLeaveSchema, leaveActionSchema, leaveQuerySchema, createLeaveTypeSchema, updateLeaveTypeSchema, previewLeaveSchema, saveDraftSchema, submitDraftSchema, updateHandoverSchema } from './leave.validation.js';
import { prisma } from '../../lib/prisma.js';
import { Role } from '@aniston/shared';

// Roles that are system/admin accounts — cannot apply, save draft, or submit leave
const SYSTEM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'GUEST_INTERVIEWER'];
const SYSTEM_ROLE_ERROR = { code: 'SYSTEM_ACCOUNT_RESTRICTED', message: 'System accounts cannot apply employee leave. Only employee accounts can submit leave requests.' };

export class LeaveController {
  async getLeaveTypes(req: Request, res: Response, next: NextFunction) {
    try {
      const types = await leaveService.getLeaveTypes(req.user!.organizationId);
      res.json({ success: true, data: types });
    } catch (err) { next(err); }
  }

  async getBalances(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.params.employeeId || req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const year = req.query.year ? Number(req.query.year) : undefined;
      const balances = await leaveService.getBalances(employeeId, year, req.user!.organizationId);
      res.json({ success: true, data: balances });
    } catch (err) { next(err); }
  }

  async applyLeave(req: Request, res: Response, next: NextFunction) {
    try {
      if (SYSTEM_ROLES.includes(req.user!.role)) {
        res.status(403).json({ success: false, data: null, error: SYSTEM_ROLE_ERROR });
        return;
      }
      const data = applyLeaveSchema.parse(req.body);
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const request = await leaveService.applyLeave(req.user!.employeeId, data);
      res.status(201).json({ success: true, data: request, message: 'Leave request submitted' });
    } catch (err) { next(err); }
  }

  async getMyLeaves(req: Request, res: Response, next: NextFunction) {
    try {
      const query = leaveQuerySchema.parse(req.query);
      const result = await leaveService.getLeaveRequests(query, req.user!.employeeId!);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getAllLeaves(req: Request, res: Response, next: NextFunction) {
    try {
      const query = leaveQuerySchema.parse(req.query);
      const result = await leaveService.getLeaveRequests(query, undefined, req.user!.organizationId, true);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getPendingApprovals(req: Request, res: Response, next: NextFunction) {
    try {
      const query = leaveQuerySchema.parse(req.query);
      const isOrgAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
      // HR/Admin don't need employeeId — they see all org leaves
      if (!isOrgAdmin && !req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const result = await leaveService.getPendingApprovals(
        req.user!.employeeId || '',
        req.user!.organizationId,
        query,
        req.user!.role
      );
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async handleLeaveAction(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { action, remarks, conditionNote } = leaveActionSchema.parse(req.body);
      const result = await leaveService.handleLeaveAction(id, action, req.user!.userId, remarks, req.user!.organizationId, conditionNote);
      res.json({ success: true, data: result, message: `Leave ${action.toLowerCase().replace(/_/g, ' ')}` });
    } catch (err) { next(err); }
  }

  async cancelLeave(req: Request, res: Response, next: NextFunction) {
    try {
      // employeeId may be null for SUPER_ADMIN — service handles privileged cancel by org scope
      const result = await leaveService.cancelLeave(req.params.id, req.user!.employeeId ?? '', req.user!.role, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Leave cancelled' });
    } catch (err) { next(err); }
  }

  async createLeaveType(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createLeaveTypeSchema.parse(req.body);
      const result = await leaveService.createLeaveType(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: result, message: 'Leave type created' });
    } catch (err) { next(err); }
  }

  async updateLeaveType(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateLeaveTypeSchema.parse(req.body);
      const result = await leaveService.updateLeaveType(req.params.id, data, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Leave type updated' });
    } catch (err) { next(err); }
  }

  async deleteLeaveType(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await leaveService.deleteLeaveType(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Leave type deactivated' });
    } catch (err) { next(err); }
  }

  async previewLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const data = previewLeaveSchema.parse(req.body);
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const preview = await leaveService.previewLeave(req.user!.employeeId, data);
      res.json({ success: true, data: preview });
    } catch (err) { next(err); }
  }

  async getHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const holidays = await leaveService.getHolidays(req.user!.organizationId, year);
      res.json({ success: true, data: holidays });
    } catch (err) { next(err); }
  }

  // ── Draft Flow ──

  async saveDraft(req: Request, res: Response, next: NextFunction) {
    try {
      if (SYSTEM_ROLES.includes(req.user!.role)) {
        res.status(403).json({ success: false, data: null, error: SYSTEM_ROLE_ERROR });
        return;
      }
      const data = saveDraftSchema.parse(req.body);
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const draft = await leaveService.saveAsDraft(req.user!.employeeId, data);
      res.status(201).json({ success: true, data: draft, message: 'Draft saved' });
    } catch (err) { next(err); }
  }

  async submitDraft(req: Request, res: Response, next: NextFunction) {
    try {
      if (SYSTEM_ROLES.includes(req.user!.role)) {
        res.status(403).json({ success: false, data: null, error: SYSTEM_ROLE_ERROR });
        return;
      }
      const { acknowledgements } = submitDraftSchema.parse(req.body);
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const result = await leaveService.submitDraft(req.params.id, req.user!.employeeId, acknowledgements);
      res.json({ success: true, data: result, message: 'Leave request submitted' });
    } catch (err) { next(err); }
  }

  async getDraftsCount(req: Request, res: Response, next: NextFunction) {
    try {
      const count = await leaveService.getDraftsCount(req.user!.organizationId);
      res.json({ success: true, data: { count } });
    } catch (err) { next(err); }
  }

  // ── Detail & Review ──

  async getLeaveDetail(req: Request, res: Response, next: NextFunction) {
    try {
      // BUG-004: pass caller role + employeeId so the service can enforce ownership checks
      const detail = await leaveService.getLeaveDetail(
        req.params.id,
        req.user!.organizationId,
        req.user!.role,
        req.user!.employeeId ?? undefined,
      );
      res.json({ success: true, data: detail });
    } catch (err) { next(err); }
  }

  async getManagerReview(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await leaveService.getManagerReviewData(req.params.id, req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async getHrReview(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await leaveService.getHrReviewData(req.params.id, req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // ── Condition Response ──

  async postConditionMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { message, senderRole } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length < 2) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Message is required (min 2 chars)' } });
        return;
      }
      const role: 'HR' | 'EMPLOYEE' = senderRole || (req.user!.role === 'EMPLOYEE' || req.user!.role === 'INTERN' ? 'EMPLOYEE' : 'HR');
      const result = await leaveService.postConditionMessage(id, req.user!.userId, role, message, req.user!.organizationId);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async resolveConditionalLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { action, remarks } = req.body;
      if (!action || !['APPROVE', 'REJECT'].includes(action)) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'action must be APPROVE or REJECT' } });
        return;
      }
      const result = await leaveService.resolveConditionalLeave(id, req.user!.userId, action, remarks, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async submitConditionResponse(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const { response } = req.body;
      if (!response || typeof response !== 'string' || response.trim().length < 3) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Response is required (min 3 chars)' } });
        return;
      }
      const result = await leaveService.submitConditionResponse(req.params.id, req.user!.employeeId, req.user!.organizationId, response.trim());
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Handover ──

  async updateHandover(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateHandoverSchema.parse(req.body);
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const result = await leaveService.updateHandover(req.params.id, req.user!.employeeId, data);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Audit & Notifications ──

  async getLeaveAudit(req: Request, res: Response, next: NextFunction) {
    try {
      // Verify leave request belongs to caller's organization before exposing audit data
      const leaveRequest = await prisma.leaveRequest.findFirst({
        where: {
          id: req.params.id,
          employee: { organizationId: req.user!.organizationId },
        },
        select: { id: true },
      });
      if (!leaveRequest) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found' } });
        return;
      }
      const audits = await prisma.leaveTaskAudit.findMany({
        where: { leaveRequestId: req.params.id },
        orderBy: { auditedAt: 'desc' },
        take: 1,
        include: { items: { orderBy: { riskLevel: 'desc' }, take: 20 } },
      });
      res.json({ success: true, data: audits[0] || null });
    } catch (err) { next(err); }
  }

  async getNotificationLog(req: Request, res: Response, next: NextFunction) {
    try {
      const logs = await prisma.leaveNotificationLog.findMany({
        where: { leaveRequestId: req.params.id },
        orderBy: { sentAt: 'desc' },
      });
      res.json({ success: true, data: logs });
    } catch (err) { next(err); }
  }
}

export const leaveController = new LeaveController();
