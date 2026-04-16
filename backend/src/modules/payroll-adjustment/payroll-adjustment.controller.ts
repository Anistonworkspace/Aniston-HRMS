import { Request, Response, NextFunction } from 'express';
import { payrollAdjustmentService } from './payroll-adjustment.service.js';
import { createAdjustmentSchema, bulkCreateAdjustmentSchema, approveAdjustmentSchema } from './payroll-adjustment.validation.js';

export class PayrollAdjustmentController {
  async listByRun(req: Request, res: Response, next: NextFunction) {
    try {
      const adjustments = await payrollAdjustmentService.listByRun(req.params.runId as string, req.user!.organizationId);
      res.json({ success: true, data: adjustments });
    } catch (err) { next(err); }
  }

  async listByEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const runId = req.query.runId as string | undefined;
      const adjustments = await payrollAdjustmentService.listByEmployee(req.params.employeeId as string, runId);
      res.json({ success: true, data: adjustments });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createAdjustmentSchema.parse(req.body);
      const adjustment = await payrollAdjustmentService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: adjustment, message: 'Adjustment created' });
    } catch (err) { next(err); }
  }

  async bulkCreate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = bulkCreateAdjustmentSchema.parse(req.body);
      const result = await payrollAdjustmentService.bulkCreate(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: result, message: `${result.created} adjustments created` });
    } catch (err) { next(err); }
  }

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = approveAdjustmentSchema.parse(req.body);
      const adjustment = await payrollAdjustmentService.approve(req.params.id as string, status, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: adjustment, message: `Adjustment ${status.toLowerCase()}` });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await payrollAdjustmentService.delete(req.params.id as string, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, message: 'Adjustment deleted' });
    } catch (err) { next(err); }
  }

  async listEmployeesForRun(req: Request, res: Response, next: NextFunction) {
    try {
      const employees = await payrollAdjustmentService.listEmployeesForRun(req.params.runId as string, req.user!.organizationId);
      res.json({ success: true, data: employees });
    } catch (err) { next(err); }
  }
}

export const payrollAdjustmentController = new PayrollAdjustmentController();
