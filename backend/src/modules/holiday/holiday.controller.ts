import { Request, Response, NextFunction } from 'express';
import { holidayService } from './holiday.service.js';
import { createHolidaySchema, updateHolidaySchema, holidayQuerySchema } from './holiday.validation.js';

export class HolidayController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = holidayQuerySchema.parse(req.query);
      const holidays = await holidayService.list(req.user!.organizationId, query);
      res.json({ success: true, data: holidays });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createHolidaySchema.parse(req.body);
      const holiday = await holidayService.create(req.user!.organizationId, data);
      res.status(201).json({ success: true, data: holiday, message: 'Holiday created' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateHolidaySchema.parse(req.body);
      const holiday = await holidayService.update(req.params.id, req.user!.organizationId, data);
      res.json({ success: true, data: holiday, message: 'Holiday updated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await holidayService.delete(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: null, message: result.message });
    } catch (err) {
      next(err);
    }
  }
}

export const holidayController = new HolidayController();
