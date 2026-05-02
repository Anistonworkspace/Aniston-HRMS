import { Request, Response, NextFunction } from 'express';
import { taskIntegrationService } from './task-integration.service.js';
import { prisma } from '../../lib/prisma.js';

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
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        // Superadmin accounts without an employee record cannot audit tasks
        res.json({ success: true, data: { integrationStatus: 'NOT_CONFIGURED', totalOpenTasks: 0, overdueTasks: 0, dueWithinLeave: 0, criticalTasks: 0, blockedTasks: 0, noBackupTasks: 0, riskScore: 0, riskLevel: 'LOW', items: [], warnings: [] } });
        return;
      }

      // Fetch employee email for external system matching
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { user: { select: { email: true } } },
      });
      const employeeEmail = emp?.user?.email ?? undefined;

      const result = await taskIntegrationService.auditTasksForLeave(
        req.user!.organizationId,
        employeeId,
        new Date(startDate),
        new Date(endDate),
        leaveType,
        employeeEmail
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getHealthStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskIntegrationService.getHealthStatus(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const taskIntegrationController = new TaskIntegrationController();
