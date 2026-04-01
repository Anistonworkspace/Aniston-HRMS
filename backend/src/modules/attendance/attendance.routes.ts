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

// Admin/HR view — all employees
router.get(
  '/all',
  requirePermission('attendance', 'read'),
  (req, res, next) => attendanceController.getAllAttendance(req, res, next)
);

export { router as attendanceRouter };
