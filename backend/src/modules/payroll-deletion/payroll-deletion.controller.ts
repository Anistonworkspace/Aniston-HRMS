import { Request, Response, NextFunction } from 'express';
import { payrollDeletionService } from './payroll-deletion.service.js';

export class PayrollDeletionController {
  async createRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { payrollRunId, reason, notes } = req.body;
      if (!payrollRunId || !reason) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'payrollRunId and reason are required' },
        });
      }
      const result = await payrollDeletionService.createRequest(
        payrollRunId,
        req.user!.organizationId,
        req.user!.userId,
        reason,
        notes,
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async listRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.query as { status?: string };
      const data = await payrollDeletionService.listRequests(req.user!.organizationId, status);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async approveRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await payrollDeletionService.approveRequest(
        req.params.id,
        req.user!.organizationId,
        req.user!.userId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async rejectRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { rejectionReason } = req.body;
      const result = await payrollDeletionService.rejectRequest(
        req.params.id,
        req.user!.organizationId,
        req.user!.userId,
        rejectionReason,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async dismissRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await payrollDeletionService.dismissRequest(
        req.params.id,
        req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const payrollDeletionController = new PayrollDeletionController();
