import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { shiftController } from './shift.controller.js';

const router = Router();
router.use(authenticate);

const superAdminAuth = authorize(Role.SUPER_ADMIN, Role.ADMIN);
const hrAuth = authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR);
const allStaff = authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER, Role.EMPLOYEE, Role.INTERN);

// Shifts CRUD
router.get('/shifts', hrAuth, (req, res, next) => shiftController.getShifts(req, res, next));
router.post('/shifts', hrAuth, (req, res, next) => shiftController.createShift(req, res, next));
router.patch('/shifts/:id', hrAuth, (req, res, next) => shiftController.updateShift(req, res, next));
router.delete('/shifts/:id', hrAuth, (req, res, next) => shiftController.deleteShift(req, res, next));

// Shift assignments — direct assign restricted to SUPER_ADMIN/ADMIN only (HR must use change request)
router.get('/shifts/my-history', (req, res, next) => shiftController.getMyShiftHistory(req, res, next));
router.get('/shifts/assignments', hrAuth, (req, res, next) => shiftController.getAllAssignments(req, res, next));
router.post('/shifts/assign', superAdminAuth, (req, res, next) => shiftController.assignShift(req, res, next));
router.post('/shifts/auto-assign', superAdminAuth, (req, res, next) => shiftController.autoAssignDefault(req, res, next));
router.get('/shifts/employee/:employeeId', (req, res, next) => {
  const requester = (req as any).user;
  const isHrOrAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(requester?.role);
  const isSelf = requester?.employeeId === req.params.employeeId;
  if (!isHrOrAdmin && !isSelf) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } });
  }
  shiftController.getEmployeeShift(req, res, next);
});

// Shift Change Requests
router.post('/shifts/change-request', allStaff, (req, res, next) => shiftController.createShiftChangeRequest(req, res, next));
router.get('/shifts/change-requests', hrAuth, (req, res, next) => shiftController.getShiftChangeRequests(req, res, next));
router.get('/shifts/my-change-requests', allStaff, (req, res, next) => shiftController.getMyShiftChangeRequests(req, res, next));
router.patch('/shifts/change-request/:id', superAdminAuth, (req, res, next) => shiftController.reviewShiftChangeRequest(req, res, next));

// HR Action Restrictions (SuperAdmin only)
router.get('/shifts/hr-restrictions/:employeeId', superAdminAuth, (req, res, next) => shiftController.getHRRestrictions(req, res, next));
router.post('/shifts/hr-restrictions/:employeeId', superAdminAuth, (req, res, next) => shiftController.setHRRestrictions(req, res, next));

// Office Locations + Geofence CRUD
router.get('/locations', hrAuth, (req, res, next) => shiftController.getLocations(req, res, next));
router.post('/locations', hrAuth, (req, res, next) => shiftController.createLocation(req, res, next));
router.patch('/locations/:id', hrAuth, (req, res, next) => shiftController.updateLocation(req, res, next));
router.delete('/locations/:id', hrAuth, (req, res, next) => shiftController.deleteLocation(req, res, next));

export { router as shiftRouter };
