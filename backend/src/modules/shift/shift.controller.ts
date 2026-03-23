import { Request, Response, NextFunction } from 'express';
import { shiftService } from './shift.service.js';
import {
  createShiftSchema, updateShiftSchema, assignShiftSchema,
  createLocationSchema, updateLocationSchema,
} from './shift.validation.js';

export class ShiftController {
  // Shifts
  async getShifts(req: Request, res: Response, next: NextFunction) {
    try {
      const shifts = await shiftService.getShifts(req.user!.organizationId);
      res.json({ success: true, data: shifts });
    } catch (err) { next(err); }
  }

  async createShift(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createShiftSchema.parse(req.body);
      const shift = await shiftService.createShift(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: shift, message: 'Shift created' });
    } catch (err) { next(err); }
  }

  async updateShift(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateShiftSchema.parse(req.body);
      const shift = await shiftService.updateShift(req.params.id as string, data, req.user!.organizationId);
      res.json({ success: true, data: shift, message: 'Shift updated' });
    } catch (err) { next(err); }
  }

  async deleteShift(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.deleteShift(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async assignShift(req: Request, res: Response, next: NextFunction) {
    try {
      const data = assignShiftSchema.parse(req.body);
      const assignment = await shiftService.assignShift(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: assignment, message: 'Shift assigned' });
    } catch (err) { next(err); }
  }

  async getEmployeeShift(req: Request, res: Response, next: NextFunction) {
    try {
      const assignment = await shiftService.getEmployeeShift(req.params.employeeId as string);
      res.json({ success: true, data: assignment });
    } catch (err) { next(err); }
  }

  // Office Locations
  async getLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const locations = await shiftService.getLocations(req.user!.organizationId);
      res.json({ success: true, data: locations });
    } catch (err) { next(err); }
  }

  async createLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createLocationSchema.parse(req.body);
      const location = await shiftService.createLocation(data, req.user!.organizationId);
      res.status(201).json({ success: true, data: location, message: 'Office location created' });
    } catch (err) { next(err); }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateLocationSchema.parse(req.body);
      const location = await shiftService.updateLocation(req.params.id as string, data, req.user!.organizationId);
      res.json({ success: true, data: location, message: 'Location updated' });
    } catch (err) { next(err); }
  }

  async deleteLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.deleteLocation(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const shiftController = new ShiftController();
