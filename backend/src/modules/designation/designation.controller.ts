import { Request, Response, NextFunction } from 'express';
import { designationService } from './designation.service.js';
import { createDesignationSchema, updateDesignationSchema } from './designation.validation.js';

export class DesignationController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const designations = await designationService.list(req.user!.organizationId);
      res.json({ success: true, data: designations });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDesignationSchema.parse(req.body);
      const desig = await designationService.create(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: desig, message: 'Designation created' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateDesignationSchema.parse(req.body);
      const desig = await designationService.update(req.params.id, data);
      res.json({ success: true, data: desig, message: 'Designation updated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await designationService.softDelete(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Designation deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const designationController = new DesignationController();
