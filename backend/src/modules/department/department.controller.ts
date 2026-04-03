import { Request, Response, NextFunction } from 'express';
import { departmentService } from './department.service.js';
import { createDepartmentSchema, updateDepartmentSchema } from './department.validation.js';

export class DepartmentController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const departments = await departmentService.list(req.user!.organizationId);
      res.json({ success: true, data: departments });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDepartmentSchema.parse(req.body);
      const dept = await departmentService.create(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: dept, message: 'Department created' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateDepartmentSchema.parse(req.body);
      const dept = await departmentService.update(req.params.id, data, req.user!.organizationId);
      res.json({ success: true, data: dept, message: 'Department updated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await departmentService.softDelete(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Department deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const departmentController = new DepartmentController();
