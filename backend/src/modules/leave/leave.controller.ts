import { Request, Response, NextFunction } from 'express';
import { leaveService } from './leave.service.js';
import { applyLeaveSchema, leaveActionSchema, leaveQuerySchema, createLeaveTypeSchema, updateLeaveTypeSchema } from './leave.validation.js';
import { Role } from '@aniston/shared';

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
      const balances = await leaveService.getBalances(employeeId, year);
      res.json({ success: true, data: balances });
    } catch (err) { next(err); }
  }

  async applyLeave(req: Request, res: Response, next: NextFunction) {
    try {
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
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const result = await leaveService.getPendingApprovals(req.user!.employeeId, req.user!.organizationId, query, req.user!.role);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async handleLeaveAction(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { action, remarks } = leaveActionSchema.parse(req.body);
      const result = await leaveService.handleLeaveAction(id, action, req.user!.userId, remarks);
      res.json({ success: true, data: result, message: `Leave ${action.toLowerCase()}` });
    } catch (err) { next(err); }
  }

  async cancelLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await leaveService.cancelLeave(req.params.id, req.user!.employeeId!);
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
      const result = await leaveService.updateLeaveType(req.params.id, data);
      res.json({ success: true, data: result, message: 'Leave type updated' });
    } catch (err) { next(err); }
  }

  async deleteLeaveType(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await leaveService.deleteLeaveType(req.params.id);
      res.json({ success: true, data: result, message: 'Leave type deactivated' });
    } catch (err) { next(err); }
  }

  async getHolidays(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const holidays = await leaveService.getHolidays(req.user!.organizationId, year);
      res.json({ success: true, data: holidays });
    } catch (err) { next(err); }
  }
}

export const leaveController = new LeaveController();
