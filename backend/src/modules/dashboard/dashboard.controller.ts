import { Request, Response, NextFunction } from 'express';
import { dashboardService } from './dashboard.service.js';

export class DashboardController {
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }
}

export const dashboardController = new DashboardController();
