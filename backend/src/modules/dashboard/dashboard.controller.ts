import { Request, Response, NextFunction } from 'express';
import { dashboardService } from './dashboard.service.js';

export class DashboardController {
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }

  async getSuperAdminStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getSuperAdminStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }

  async getHRStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await dashboardService.getHRStats(req.user!.organizationId, req.user!.userId, req.user!.role);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await dashboardService.getSummary(req.user!.organizationId, req.user!.role);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async getPendingApprovals(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit } = req.query as any;
      const data = await dashboardService.getPendingApprovals(req.user!.organizationId, {
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
}

export const dashboardController = new DashboardController();
