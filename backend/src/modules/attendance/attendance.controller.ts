import { Request, Response, NextFunction } from 'express';
import { attendanceService } from './attendance.service.js';
import {
  clockInSchema,
  clockOutSchema,
  gpsTrailBatchSchema,
  regularizationSchema,
  attendanceQuerySchema,
  anomalyQuerySchema,
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
      res.json({ success: true, data: result.data, meta: result.meta, summary: result.summary });
    } catch (err) { next(err); }
  }

  async recordActivityPulse(req: Request, res: Response, next: NextFunction) {
    try {
      const { isActive = true, tabVisible = true } = req.body;
      const result = await attendanceService.recordActivityPulse(req.user!.employeeId!, { isActive, tabVisible });
      res.json({ success: true, data: result });
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
      // Pass organizationId for cross-org isolation and userId for audit log
      const result = await attendanceService.getGPSTrail(
        employeeId, date,
        req.user!.organizationId,
        req.user!.userId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async recordGPSConsent(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const { consentVersion = 'v1' } = req.body;
      const result = await attendanceService.recordGPSConsent(employeeId, req.user!.organizationId, consentVersion);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getGPSConsentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const result = await attendanceService.getGPSConsentStatus(employeeId, req.user!.organizationId);
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
        data.requestedCheckOut,
        data.date
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
      // Prevent HR/Admin/SuperAdmin from manually marking their own attendance record
      if (req.user!.employeeId && req.user!.employeeId === data.employeeId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You cannot manually mark your own attendance. Use the calendar to mark attendance for other employees.' },
        });
      }
      // HR cannot mark attendance for another HR/Admin/SuperAdmin — only Super Admin or Admin can do that
      if (req.user!.role === 'HR') {
        const { prisma } = await import('../../lib/prisma.js');
        const targetEmp = await prisma.employee.findUnique({
          where: { id: data.employeeId },
          select: { user: { select: { role: true } } },
        });
        const targetRole = targetEmp?.user?.role;
        if (targetRole && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(targetRole)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'HR accounts cannot manually mark attendance for other HR accounts. Only Super Admin or Admin can do this.' },
          });
        }
      }
      const record = await attendanceService.markAttendance(data, req.user!.userId, req.user!.organizationId, req.user!.role);
      res.status(201).json({ success: true, data: record, message: 'Attendance marked successfully' });
    } catch (err) { next(err); }
  }

  async handleRegularization(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { action, remarks, approvalType } = req.body;
      if (!['APPROVED', 'REJECTED', 'MANAGER_REVIEWED'].includes(action)) {
        res.status(400).json({ success: false, data: null, error: { code: 'INVALID_ACTION', message: 'Action must be APPROVED, REJECTED, or MANAGER_REVIEWED' } });
        return;
      }
      const result = await attendanceService.handleRegularization(id, action, req.user!.userId, remarks, req.user!.role, approvalType);
      res.json({ success: true, data: result, message: `Regularization ${action.toLowerCase()}` });
    } catch (err) { next(err); }
  }

  async getRegularizations(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, search, date, page, limit } = req.query as Record<string, string>;
      const result = await attendanceService.getRegularizations(req.user!.organizationId, {
        status,
        search,
        date,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 50,
      });
      res.json({ success: true, data: result.regs, meta: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages } });
    } catch (err) { next(err); }
  }

  async getPendingRegularizations(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const isHR = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
      const regs = await prisma.attendanceRegularization.findMany({
        where: {
          status: { in: isHR ? ['PENDING', 'MANAGER_REVIEWED'] : ['PENDING'] },
          attendance: { employee: { organizationId: req.user!.organizationId } },
        },
        include: {
          attendance: {
            include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json({ success: true, data: regs });
    } catch (err) { next(err); }
  }

  async getHybridSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const { hybridScheduleService } = await import('./hybrid-schedule.service.js');
      const schedule = await hybridScheduleService.getSchedule(req.params.employeeId);
      res.json({ success: true, data: schedule });
    } catch (err) { next(err); }
  }

  async setHybridSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const { hybridScheduleService } = await import('./hybrid-schedule.service.js');
      const { officeDays, wfhDays, notes } = req.body;
      const result = await hybridScheduleService.setSchedule(
        req.params.employeeId, { officeDays, wfhDays, notes },
        req.user!.organizationId, req.user!.userId, req.user!.role
      );
      res.json({ success: true, data: result, message: 'Hybrid schedule saved' });
    } catch (err) { next(err); }
  }

  async getAttendanceLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.params.employeeId as string;
      const date = req.params.date as string;
      const result = await attendanceService.getAttendanceLogsByDate(employeeId, date);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
  async projectSiteCheckIn(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const { siteName, siteAddress, notes, latitude, longitude, photoUrl } = req.body;
      if (!siteName) {
        res.status(400).json({ success: false, data: null, error: { code: 'VALIDATION', message: 'siteName is required' } });
        return;
      }
      const result = await attendanceService.projectSiteCheckIn(employeeId, {
        siteName, siteAddress, notes, latitude, longitude, checkInPhoto: photoUrl,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getMyProjectSiteCheckIns(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const date = req.query.date as string | undefined;
      const result = await attendanceService.getProjectSiteCheckIns(employeeId, date);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
  // =====================================================================
  // ENTERPRISE COMMAND CENTER ENDPOINTS
  // =====================================================================

  async getCommandCenterStats(req: Request, res: Response, next: NextFunction) {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const stats = await attendanceService.getCommandCenterStats(req.user!.organizationId, date);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }

  async getAllAttendanceEnhanced(req: Request, res: Response, next: NextFunction) {
    try {
      const query = attendanceQuerySchema.parse(req.query);
      const enhanced = {
        ...query,
        designation: req.query.designation as string,
        managerId: req.query.managerId as string,
        shiftType: req.query.shiftType as string,
        anomalyType: req.query.anomalyType as string,
        regularizationStatus: req.query.regularizationStatus as string,
        employeeType: req.query.employeeType as string,
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as string,
        isLate: req.query.isLate === 'true',
      };
      const result = await attendanceService.getAllAttendanceEnhanced(enhanced, req.user!.organizationId);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async getAnomalies(req: Request, res: Response, next: NextFunction) {
    try {
      const query = anomalyQuerySchema.parse(req.query);
      const result = await attendanceService.getAnomalies(req.user!.organizationId, query);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async resolveAnomaly(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { resolution, remarks } = req.body;
      const result = await attendanceService.resolveAnomaly(id, req.user!.organizationId, resolution, req.user!.userId, remarks);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getLiveBoard(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await attendanceService.getLiveBoard(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async detectAnomalies(req: Request, res: Response, next: NextFunction) {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const result = await attendanceService.detectAnomalies(req.user!.organizationId, date);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getEmployeeAttendanceDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, date } = req.params;
      const result = await attendanceService.getEmployeeAttendanceDetail(employeeId, date);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getGeoLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, employeeId, page, limit } = req.query as Record<string, string>;
      const result = await attendanceService.getGeoLocations(req.user!.organizationId, {
        startDate, endDate, employeeId,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 50,
      });
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async updateLocationVisitName(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { customName } = req.body;
      if (!customName || typeof customName !== 'string') {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'customName is required' } });
        return;
      }
      const result = await attendanceService.updateLocationVisitName(id, customName.trim(), req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async tagStop(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId;
      if (!employeeId) {
        res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const { lat, lng, name, timestamp } = req.body;
      if (!lat || !lng || !name || typeof name !== 'string') {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'lat, lng, and name are required' } });
        return;
      }
      const result = await attendanceService.tagStop(employeeId, req.user!.organizationId, {
        lat: Number(lat), lng: Number(lng), name: name.trim(), timestamp,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async importAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No Excel file uploaded' } });
        return;
      }
      const month = parseInt(req.body.month as string);
      const year = parseInt(req.body.year as string);
      if (!month || month < 1 || month > 12 || !year || year < 2000) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Valid month (1-12) and year are required' } });
        return;
      }
      const result = await attendanceService.importFromExcel(
        req.file.buffer,
        month,
        year,
        req.user!.organizationId,
        req.user!.userId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const attendanceController = new AttendanceController();
