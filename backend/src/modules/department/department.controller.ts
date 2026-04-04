import { Request, Response, NextFunction } from 'express';
import { departmentService } from './department.service.js';
import { createDepartmentSchema, updateDepartmentSchema, searchDepartmentSchema } from './department.validation.js';

export class DepartmentController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = searchDepartmentSchema.parse(req.query);
      const departments = await departmentService.list(req.user!.organizationId, query);
      res.json({ success: true, data: departments });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDepartmentSchema.parse(req.body);
      const dept = await departmentService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: dept, message: 'Department created' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateDepartmentSchema.parse(req.body);
      const dept = await departmentService.update(req.params.id, data, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: dept, message: 'Department updated' });
    } catch (err) {
      next(err);
    }
  }

  async archive(req: Request, res: Response, next: NextFunction) {
    try {
      const dept = await departmentService.archive(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: dept, message: 'Department archived' });
    } catch (err) {
      next(err);
    }
  }

  async reactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const dept = await departmentService.reactivate(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: dept, message: 'Department reactivated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await departmentService.softDelete(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: null, message: 'Department deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const departmentController = new DepartmentController();
