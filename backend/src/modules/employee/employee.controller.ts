import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
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

  async invite(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, firstName, lastName } = z.object({
        email: z.string().email(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
      }).parse(req.body);
      const result = await employeeService.inviteEmployee(
        email, req.user!.organizationId, req.user!.userId, firstName, lastName
      );
      res.status(201).json({
        success: true,
        data: result,
        message: `Invitation sent to ${email}`,
      });
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

  // Lifecycle Events
  async getLifecycleEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await employeeService.getLifecycleEvents(req.params.id as string);
      res.json({ success: true, data: events });
    } catch (err) {
      next(err);
    }
  }

  async addLifecycleEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        eventType: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        eventDate: z.string().min(1),
        metadata: z.any().optional(),
      }).parse(req.body);
      const event = await employeeService.addLifecycleEvent(req.params.id as string, data, req.user!.userId);
      res.status(201).json({ success: true, data: event, message: 'Event added' });
    } catch (err) {
      next(err);
    }
  }

  async deleteLifecycleEvent(req: Request, res: Response, next: NextFunction) {
    try {
      await employeeService.deleteLifecycleEvent(req.params.eventId as string);
      res.json({ success: true, data: null, message: 'Event deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const employeeController = new EmployeeController();
