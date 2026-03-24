import { Request, Response, NextFunction } from 'express';
import { agentService } from './agent.service.js';
import { heartbeatSchema, screenshotMetadataSchema } from './agent.validation.js';

export class AgentController {
  async submitHeartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const { activities } = heartbeatSchema.parse(req.body);
      const result = await agentService.submitHeartbeat(
        req.user!.employeeId!,
        req.user!.organizationId,
        activities
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async uploadScreenshot(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
        return;
      }

      const metadata = screenshotMetadataSchema.parse(req.body);
      const imageUrl = `/uploads/${req.file.filename}`;

      const screenshot = await agentService.saveScreenshot(
        req.user!.employeeId!,
        req.user!.organizationId,
        imageUrl,
        metadata
      );
      res.status(201).json({ success: true, data: screenshot });
    } catch (err) { next(err); }
  }

  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await agentService.getConfig(req.user!.employeeId!);
      res.json({ success: true, data: config });
    } catch (err) { next(err); }
  }

  async getActivityLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      const result = await agentService.getActivityLogs(
        employeeId as string,
        date as string,
        req.user!.organizationId
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getScreenshots(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      const screenshots = await agentService.getScreenshots(
        employeeId as string,
        date as string,
        req.user!.organizationId
      );
      res.json({ success: true, data: screenshots });
    } catch (err) { next(err); }
  }

  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await agentService.getAgentStatus(req.user!.employeeId!);
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  }
}

export const agentController = new AgentController();
