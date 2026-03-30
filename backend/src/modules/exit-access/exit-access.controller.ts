import { Request, Response, NextFunction } from 'express';
import { exitAccessService } from './exit-access.service.js';
import { upsertExitAccessSchema } from './exit-access.validation.js';

export class ExitAccessController {
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.params.employeeId as string;
      const config = await exitAccessService.getConfig(employeeId);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  }

  async upsertConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.params.employeeId as string;
      const data = upsertExitAccessSchema.parse(req.body);
      const config = await exitAccessService.upsertConfig(
        employeeId,
        req.user!.organizationId,
        data,
        req.user!.userId
      );
      res.json({ success: true, data: config, message: 'Exit access config saved' });
    } catch (err) {
      next(err);
    }
  }

  async revokeAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.params.employeeId as string;
      await exitAccessService.revokeAccess(
        employeeId,
        req.user!.userId,
        req.user!.organizationId
      );
      res.json({ success: true, data: null, message: 'Exit access revoked' });
    } catch (err) {
      next(err);
    }
  }

  async getMyAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await exitAccessService.getMyExitAccess(req.user!.employeeId!);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  }
}

export const exitAccessController = new ExitAccessController();
