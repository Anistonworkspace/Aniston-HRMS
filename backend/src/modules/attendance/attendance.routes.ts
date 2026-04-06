import { Router } from 'express';
import { attendanceController } from './attendance.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Employee routes
router.post('/clock-in', (req, res, next) => attendanceController.clockIn(req, res, next));
router.post('/clock-out', (req, res, next) => attendanceController.clockOut(req, res, next));
router.get('/today', (req, res, next) => attendanceController.getTodayStatus(req, res, next));
router.get('/my', (req, res, next) => attendanceController.getMyAttendance(req, res, next));

// Break management
router.post('/break/start', (req, res, next) => attendanceController.startBreak(req, res, next));
router.post('/break/end', (req, res, next) => attendanceController.endBreak(req, res, next));

// Activity pulse (hybrid/WFH session tracking)
router.post('/activity-pulse', (req, res, next) => attendanceController.recordActivityPulse(req, res, next));

// GPS trail (field sales)
router.post('/gps-trail', (req, res, next) => attendanceController.storeGPSTrail(req, res, next));
router.get('/gps-trail/:employeeId/:date', requirePermission('attendance', 'read'), (req, res, next) =>
  attendanceController.getGPSTrail(req, res, next)
);

// Regularization
router.post('/regularization', (req, res, next) => attendanceController.submitRegularization(req, res, next));
router.patch(
  '/regularization/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.handleRegularization(req, res, next)
);
// Pending regularizations (HR view)
router.get(
  '/regularizations/pending',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getPendingRegularizations(req, res, next)
);

// Hybrid schedule
router.get('/hybrid-schedule/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getHybridSchedule(req, res, next)
);
router.put('/hybrid-schedule/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.setHybridSchedule(req, res, next)
);

// HR/Admin — get attendance for a specific employee
router.get(
  '/employee/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getEmployeeAttendance(req, res, next)
);

// HR/Admin — mark attendance for an employee
router.post(
  '/mark',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.markAttendance(req, res, next)
);

// HR/Admin — attendance event logs for an employee on a date
router.get(
  '/logs/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getAttendanceLogs(req, res, next)
);

// HR/Admin — Export attendance as Excel
router.get(
  '/export',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const employeeId = req.query.employeeId as string;

      if (employeeId) {
        const { generateEmployeeAttendanceExcel } = await import('../../utils/attendanceExcelExporter.js');
        const buffer = await generateEmployeeAttendanceExcel(employeeId, month, year);
        const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'short' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-${employeeId}-${monthName}-${year}.xlsx"`);
        res.send(buffer);
      } else {
        const { generateMonthlyAttendanceExcel } = await import('../../utils/attendanceExcelExporter.js');
        const buffer = await generateMonthlyAttendanceExcel(req.user!.organizationId, month, year);
        const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'short' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-${monthName}-${year}.xlsx"`);
        res.send(buffer);
      }
    } catch (err) { next(err); }
  }
);

// Project site check-ins (standalone, separate from clock-in)
router.post('/project-site/check-in', (req, res, next) => attendanceController.projectSiteCheckIn(req, res, next));
router.get('/project-site/my', (req, res, next) => attendanceController.getMyProjectSiteCheckIns(req, res, next));

// Admin/HR view — all employees
router.get(
  '/all',
  requirePermission('attendance', 'read'),
  (req, res, next) => attendanceController.getAllAttendance(req, res, next)
);

// =====================================================================
// ENTERPRISE COMMAND CENTER ROUTES
// =====================================================================

// Command center KPI stats
router.get(
  '/command-center/stats',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getCommandCenterStats(req, res, next)
);

// Enhanced attendance list with enterprise filters
router.get(
  '/command-center/records',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getAllAttendanceEnhanced(req, res, next)
);

// Anomaly management
router.get(
  '/command-center/anomalies',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getAnomalies(req, res, next)
);
router.patch(
  '/command-center/anomalies/:id/resolve',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.resolveAnomaly(req, res, next)
);

// Live attendance board
router.get(
  '/command-center/live',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getLiveBoard(req, res, next)
);

// Anomaly detection trigger
router.post(
  '/command-center/detect-anomalies',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.detectAnomalies(req, res, next)
);

// Employee attendance detail (enriched)
router.get(
  '/command-center/employee/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getEmployeeAttendanceDetail(req, res, next)
);

export { router as attendanceRouter };
