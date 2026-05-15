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
      const shift = await shiftService.createShift(data, req.user!.organizationId, req.user!.userId);
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

  async getMyShiftHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = (req as any).user?.employeeId;
      if (!employeeId) {
        return res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked to this account.' } });
      }
      const history = await shiftService.getMyShiftHistory(employeeId);
      res.json({ success: true, data: history });
    } catch (err) { next(err); }
  }

  async getAllAssignments(req: Request, res: Response, next: NextFunction) {
    try {
      const assignments = await shiftService.getAllAssignments(req.user!.organizationId);
      res.json({ success: true, data: assignments });
    } catch (err) { next(err); }
  }

  async autoAssignDefault(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.autoAssignDefaultShift(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
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

  // Shift Change Requests
  async createShiftChangeRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, toShiftId, reason } = req.body;
      if (!toShiftId) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'toShiftId is required' } });
      // Employees submit for themselves; HR/Admin submit for any employee
      const targetEmployeeId = req.user!.role === 'EMPLOYEE' || req.user!.role === 'INTERN'
        ? req.user!.employeeId!
        : (employeeId || req.user!.employeeId!);
      const result = await shiftService.createShiftChangeRequest(
        targetEmployeeId, toShiftId, req.user!.userId, req.user!.role, req.user!.organizationId, reason,
      );
      res.status(201).json({ success: true, data: result, message: 'Shift change request submitted' });
    } catch (err) { next(err); }
  }

  async getShiftChangeRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.query as { status?: string };
      const requests = await shiftService.getShiftChangeRequests(req.user!.organizationId, status);
      res.json({ success: true, data: requests });
    } catch (err) { next(err); }
  }

  async getMyShiftChangeRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) return res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked.' } });
      const requests = await shiftService.getMyShiftChangeRequests(employeeId, req.user!.organizationId);
      res.json({ success: true, data: requests });
    } catch (err) { next(err); }
  }

  async reviewShiftChangeRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { action, reviewRemarks, effectiveDate } = req.body;
      if (!['APPROVED', 'REJECTED'].includes(action)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'action must be APPROVED or REJECTED' } });
      }
      const result = await shiftService.reviewShiftChangeRequest(
        req.params.id, action, req.user!.userId, req.user!.organizationId, reviewRemarks, effectiveDate,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // HR Action Restrictions
  async getHRRestrictions(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.getHRRestrictions(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async setHRRestrictions(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.setHRRestrictions(
        req.params.employeeId, req.user!.organizationId, req.body, req.user!.userId,
      );
      res.json({ success: true, data: result, message: 'HR action restrictions updated' });
    } catch (err) { next(err); }
  }

  async submitHomeLocationRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { latitude, longitude, accuracy, address } = req.body;
      const result = await shiftService.createHomeLocationRequest(
        req.user!.employeeId!, req.user!.organizationId, { latitude, longitude, accuracy, address },
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getHomeLocationRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.getHomeLocationRequests(
        req.user!.organizationId, req.query.status as string | undefined,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getMyHomeLocationRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await shiftService.getMyHomeLocationRequest(req.user!.employeeId!);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async reviewHomeLocationRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { action, reviewNotes, radiusMeters } = req.body;
      const result = await shiftService.reviewHomeLocationRequest(
        req.params.id, req.user!.organizationId, action, req.user!.userId, reviewNotes,
        radiusMeters ? Number(radiusMeters) : undefined,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const shiftController = new ShiftController();
