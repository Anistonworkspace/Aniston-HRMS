import { Request, Response, NextFunction } from 'express';
import { employeeService } from './employee.service.js';
import { createEmployeeSchema, updateEmployeeSchema, employeeQuerySchema } from './employee.validation.js';

export class EmployeeController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = employeeQuerySchema.parse(req.query);
      const result = await employeeService.list(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const employee = await employeeService.getById(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: employee });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createEmployeeSchema.parse(req.body);
      const result = await employeeService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({
        success: true,
        data: result.employee,
        message: `Employee created. Temporary password: ${result.tempPassword}`,
      });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateEmployeeSchema.parse(req.body);
      const employee = await employeeService.update(
        req.params.id,
        data,
        req.user!.organizationId,
        req.user!.userId
      );
      res.json({ success: true, data: employee, message: 'Employee updated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await employeeService.softDelete(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: null, message: 'Employee deactivated' });
    } catch (err) {
      next(err);
    }
  }
}

export const employeeController = new EmployeeController();
