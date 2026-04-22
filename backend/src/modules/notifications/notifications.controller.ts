import { Request, Response, NextFunction } from 'express';
import { notificationsService } from './notifications.service.js';

export class NotificationsController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const result = await notificationsService.list(
        req.user!.userId,
        req.user!.organizationId,
        page,
        limit,
      );
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const count = await notificationsService.unreadCount(
        req.user!.userId,
        req.user!.organizationId,
      );
      res.json({ success: true, data: { count } });
    } catch (err) {
      next(err);
    }
  }

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const notification = await notificationsService.markRead(
        req.params.id,
        req.user!.userId,
        req.user!.organizationId,
      );
      res.json({ success: true, data: notification });
    } catch (err) {
      next(err);
    }
  }

  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationsService.markAllRead(
        req.user!.userId,
        req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const notificationsController = new NotificationsController();
