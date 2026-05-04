import { Request, Response, NextFunction } from 'express';
import { crashReportService } from './crash-report.service.js';

export const crashReportController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        type, message, stack, context,
        appVersion, platform, osVersion, device, employeeId,
      } = req.body;

      // Accept from authenticated users OR from native app (X-Native-App header)
      const isNativeApp = req.headers['x-native-app'] === 'true';
      const organizationId = (req as any).user?.organizationId;

      if (!type || !message) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'type and message are required' } });
      }

      const report = await crashReportService.create({
        type,
        message: String(message).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 10000) : undefined,
        context: context ? String(context).slice(0, 500) : undefined,
        appVersion: appVersion || '1.2.0',
        platform: platform || 'android',
        osVersion,
        device,
        employeeId: employeeId || (req as any).user?.employeeId || undefined,
        organizationId: organizationId || 'unknown',
        ipAddress: req.ip,
      });

      return res.status(201).json({ success: true, data: { id: report.id } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = (req as any).user!.organizationId;
      const page  = parseInt(String(req.query.page  || '1'));
      const limit = parseInt(String(req.query.limit || '50'));
      const data = await crashReportService.list(organizationId, page, limit);
      return res.json({ success: true, data: data.items, meta: { page: data.page, limit: data.limit, total: data.total, totalPages: data.totalPages } });
    } catch (err) {
      next(err);
    }
  },

  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = (req as any).user!.organizationId;
      const data = await crashReportService.stats(organizationId);
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = (req as any).user!.organizationId;
      await crashReportService.remove(req.params.id, organizationId);
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async clearAll(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = (req as any).user!.organizationId;
      const { count } = await crashReportService.clearAll(organizationId);
      return res.json({ success: true, data: { deleted: count } });
    } catch (err) {
      next(err);
    }
  },
};
