import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { shiftController } from './shift.controller.js';

const router = Router();
router.use(authenticate);

const hrAuth = authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR);

// Shifts CRUD
router.get('/shifts', hrAuth, (req, res, next) => shiftController.getShifts(req, res, next));
router.post('/shifts', hrAuth, (req, res, next) => shiftController.createShift(req, res, next));
router.patch('/shifts/:id', hrAuth, (req, res, next) => shiftController.updateShift(req, res, next));
router.delete('/shifts/:id', hrAuth, (req, res, next) => shiftController.deleteShift(req, res, next));

// Shift assignments
router.get('/shifts/assignments', hrAuth, (req, res, next) => shiftController.getAllAssignments(req, res, next));
router.post('/shifts/assign', hrAuth, (req, res, next) => shiftController.assignShift(req, res, next));
router.post('/shifts/auto-assign', hrAuth, (req, res, next) => shiftController.autoAssignDefault(req, res, next));
router.get('/shifts/employee/:employeeId', (req, res, next) => shiftController.getEmployeeShift(req, res, next));

// Office Locations + Geofence CRUD
router.get('/locations', hrAuth, (req, res, next) => shiftController.getLocations(req, res, next));
router.post('/locations', hrAuth, (req, res, next) => shiftController.createLocation(req, res, next));
router.patch('/locations/:id', hrAuth, (req, res, next) => shiftController.updateLocation(req, res, next));
router.delete('/locations/:id', hrAuth, (req, res, next) => shiftController.deleteLocation(req, res, next));

export { router as shiftRouter };
