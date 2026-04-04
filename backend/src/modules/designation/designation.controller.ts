import { Request, Response, NextFunction } from 'express';
import { designationService } from './designation.service.js';
import { createDesignationSchema, updateDesignationSchema, searchDesignationSchema } from './designation.validation.js';

export class DesignationController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = searchDesignationSchema.parse(req.query);
      const designations = await designationService.list(req.user!.organizationId, query);
      res.json({ success: true, data: designations });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDesignationSchema.parse(req.body);
      const desig = await designationService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: desig, message: 'Designation created' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateDesignationSchema.parse(req.body);
      const desig = await designationService.update(req.params.id, data, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: desig, message: 'Designation updated' });
    } catch (err) {
      next(err);
    }
  }

  async archive(req: Request, res: Response, next: NextFunction) {
    try {
      const desig = await designationService.archive(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: desig, message: 'Designation archived' });
    } catch (err) {
      next(err);
    }
  }

  async reactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const desig = await designationService.reactivate(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: desig, message: 'Designation reactivated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await designationService.softDelete(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: null, message: 'Designation deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const designationController = new DesignationController();
