import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { holidayService } from './holiday.service.js';
import { createHolidaySchema, updateHolidaySchema, holidayQuerySchema, bulkHolidaysSchema } from './holiday.validation.js';

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
      const holiday = await holidayService.create(req.user!.organizationId, data, req.user!.userId);
      res.status(201).json({ success: true, data: holiday, message: 'Holiday created' });
    } catch (err) {
      next(err);
    }
  }

  async bulkCreate(req: Request, res: Response, next: NextFunction) {
    try {
      const { holidays } = bulkHolidaysSchema.parse(req.body);
      const result = await holidayService.bulkCreate(req.user!.organizationId, holidays, req.user!.userId);
      res.status(201).json({ success: true, data: result, message: `${result.created} holidays created, ${result.skipped} skipped` });
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

  async getSuggestions(req: Request, res: Response, next: NextFunction) {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const suggestions = holidayService.getIndianHolidaysSuggestions(year);
      res.json({ success: true, data: suggestions });
    } catch (err) {
      next(err);
    }
  }
}

export const holidayController = new HolidayController();
