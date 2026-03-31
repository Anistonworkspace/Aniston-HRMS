import { Request, Response, NextFunction } from 'express';
import { employeePermissionService } from './employee-permissions.service.js';
import { upsertPresetSchema, upsertOverrideSchema } from './employee-permissions.validation.js';

export class EmployeePermissionController {
  async getPresets(req: Request, res: Response, next: NextFunction) {
    try {
      const presets = await employeePermissionService.getPresets(req.user!.organizationId);
      res.json({ success: true, data: presets });
    } catch (err) {
      next(err);
    }
  }

  async upsertPreset(req: Request, res: Response, next: NextFunction) {
    try {
      const data = upsertPresetSchema.parse(req.body);
      const preset = await employeePermissionService.upsertPreset(
        req.user!.organizationId,
        data,
        req.user!.userId,
      );
      res.json({ success: true, data: preset });
    } catch (err) {
      next(err);
    }
  }

  async getOverride(req: Request, res: Response, next: NextFunction) {
    try {
      const override = await employeePermissionService.getOverride(req.params.employeeId);
      res.json({ success: true, data: override });
    } catch (err) {
      next(err);
    }
  }

  async upsertOverride(req: Request, res: Response, next: NextFunction) {
    try {
      const data = upsertOverrideSchema.parse(req.body);
      const override = await employeePermissionService.upsertOverride(
        req.params.employeeId,
        req.user!.organizationId,
        data,
        req.user!.userId,
      );
      res.json({ success: true, data: override });
    } catch (err) {
      next(err);
    }
  }

  async deleteOverride(req: Request, res: Response, next: NextFunction) {
    try {
      await employeePermissionService.deleteOverride(
        req.params.employeeId,
        req.user!.userId,
        req.user!.organizationId,
      );
      res.json({ success: true, data: { message: 'Permission override deleted' } });
    } catch (err) {
      next(err);
    }
  }

  async getMyPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const permissions = await employeePermissionService.getEffectivePermissions(
        req.user!.employeeId!,
        req.user!.role,
        req.user!.organizationId,
      );
      res.json({ success: true, data: permissions });
    } catch (err) {
      next(err);
    }
  }
}

export const employeePermissionController = new EmployeePermissionController();
