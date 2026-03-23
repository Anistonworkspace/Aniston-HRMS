import { Request, Response, NextFunction } from 'express';
import { attendanceService } from './attendance.service.js';
import {
  clockInSchema,
  clockOutSchema,
  gpsTrailBatchSchema,
  regularizationSchema,
  attendanceQuerySchema,
  startBreakSchema,
  markAttendanceSchema,
} from './attendance.validation.js';

export class AttendanceController {
  async clockIn(req: Request, res: Response, next: NextFunction) {
    try {
      const data = clockInSchema.parse(req.body);
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const record = await attendanceService.clockIn(employeeId, data, req.user!.organizationId);
      res.status(201).json({ success: true, data: record, message: 'Clocked in successfully' });
    } catch (err) { next(err); }
  }

  async clockOut(req: Request, res: Response, next: NextFunction) {
    try {
      const data = clockOutSchema.parse(req.body);
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const record = await attendanceService.clockOut(employeeId, data);
      res.json({ success: true, data: record, message: 'Clocked out successfully' });
    } catch (err) { next(err); }
  }

  async getTodayStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const status = await attendanceService.getTodayStatus(employeeId);
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  }

  async getMyAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      // Default to current month
      const now = new Date();
      const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const result = await attendanceService.getMyAttendance(employeeId, start, end);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getAllAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const query = attendanceQuerySchema.parse(req.query);
      const result = await attendanceService.getAllAttendance(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async startBreak(req: Request, res: Response, next: NextFunction) {
    try {
      const data = startBreakSchema.parse(req.body);
      const breakRecord = await attendanceService.startBreak(req.user!.employeeId!, data.type);
      res.status(201).json({ success: true, data: breakRecord, message: 'Break started' });
    } catch (err) { next(err); }
  }

  async endBreak(req: Request, res: Response, next: NextFunction) {
    try {
      const breakRecord = await attendanceService.endBreak(req.user!.employeeId!);
      res.json({ success: true, data: breakRecord, message: 'Break ended' });
    } catch (err) { next(err); }
  }

  async storeGPSTrail(req: Request, res: Response, next: NextFunction) {
    try {
      const data = gpsTrailBatchSchema.parse(req.body);
      const result = await attendanceService.storeGPSTrail(req.user!.employeeId!, data);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getGPSTrail(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      const result = await attendanceService.getGPSTrail(employeeId, date);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async submitRegularization(req: Request, res: Response, next: NextFunction) {
    try {
      const data = regularizationSchema.parse(req.body);
      const result = await attendanceService.submitRegularization(
        req.user!.employeeId!,
        data.attendanceId,
        data.reason,
        data.requestedCheckIn,
        data.requestedCheckOut
      );
      res.status(201).json({ success: true, data: result, message: 'Regularization submitted' });
    } catch (err) { next(err); }
  }

  async getEmployeeAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId } = req.params;
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      // Default to current month
      const now = new Date();
      const start = startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const end = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

      const result = await attendanceService.getEmployeeAttendance(employeeId, start, end);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async markAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const data = markAttendanceSchema.parse(req.body);
      const record = await attendanceService.markAttendance(data, req.user!.userId);
      res.status(201).json({ success: true, data: record, message: 'Attendance marked successfully' });
    } catch (err) { next(err); }
  }

  async handleRegularization(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { action, remarks } = req.body;
      if (!['APPROVED', 'REJECTED'].includes(action)) {
        res.status(400).json({ success: false, data: null, error: { code: 'INVALID_ACTION', message: 'Action must be APPROVED or REJECTED' } });
        return;
      }
      const result = await attendanceService.handleRegularization(id, action, req.user!.userId, remarks);
      res.json({ success: true, data: result, message: `Regularization ${action.toLowerCase()}` });
    } catch (err) { next(err); }
  }
}

export const attendanceController = new AttendanceController();
