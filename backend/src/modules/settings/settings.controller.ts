import { Request, Response, NextFunction } from 'express';
import { settingsService } from './settings.service.js';
import { updateOrganizationSchema, createLocationSchema, updateLocationSchema, auditLogQuerySchema } from './settings.validation.js';

export class SettingsController {
  async getOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      const org = await settingsService.getOrganization(req.user!.organizationId);
      res.json({ success: true, data: org });
    } catch (err) {
      next(err);
    }
  }

  async updateOrganization(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateOrganizationSchema.parse(req.body);
      const org = await settingsService.updateOrganization(req.user!.organizationId, data);
      res.json({ success: true, data: org, message: 'Organization updated' });
    } catch (err) {
      next(err);
    }
  }

  async listLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const locations = await settingsService.listLocations(req.user!.organizationId);
      res.json({ success: true, data: locations });
    } catch (err) {
      next(err);
    }
  }

  async createLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createLocationSchema.parse(req.body);
      const location = await settingsService.createLocation(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: location, message: 'Location added' });
    } catch (err) {
      next(err);
    }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateLocationSchema.parse(req.body);
      const location = await settingsService.updateLocation(req.params.id, data);
      res.json({ success: true, data: location });
    } catch (err) {
      next(err);
    }
  }

  async deleteLocation(req: Request, res: Response, next: NextFunction) {
    try {
      await settingsService.deleteLocation(req.params.id);
      res.json({ success: true, data: null, message: 'Location deleted' });
    } catch (err) {
      next(err);
    }
  }

  async listAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const query = auditLogQuerySchema.parse(req.query);
      const result = await settingsService.listAuditLogs(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getSystemInfo(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = settingsService.getSystemInfo();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export const settingsController = new SettingsController();
