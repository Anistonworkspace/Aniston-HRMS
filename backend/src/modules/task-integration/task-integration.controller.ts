import { Request, Response, NextFunction } from 'express';
import { taskIntegrationService } from './task-integration.service.js';

export class TaskIntegrationController {
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await taskIntegrationService.getConfig(req.user!.organizationId);
      res.json({ success: true, data: config });
    } catch (err) { next(err); }
  }

  async upsertConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const { provider, apiKey, baseUrl, workspaceId } = req.body;
      const config = await taskIntegrationService.upsertConfig(
        req.user!.organizationId,
        { provider, apiKey, baseUrl, workspaceId },
        req.user!.userId
      );
      res.json({ success: true, data: config, message: 'Task manager configured' });
    } catch (err) { next(err); }
  }

  async testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskIntegrationService.testConnection(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async auditTasksForLeave(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, leaveType } = req.body;
      const result = await taskIntegrationService.auditTasksForLeave(
        req.user!.organizationId,
        req.user!.employeeId!,
        new Date(startDate),
        new Date(endDate),
        leaveType
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const taskIntegrationController = new TaskIntegrationController();
