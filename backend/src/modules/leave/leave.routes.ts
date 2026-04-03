import { Router } from 'express';
import { leaveController } from './leave.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Leave types & holidays
router.get('/types', (req, res, next) => leaveController.getLeaveTypes(req, res, next));
router.post(
  '/types',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.createLeaveType(req, res, next)
);
router.patch(
  '/types/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.updateLeaveType(req, res, next)
);
router.delete(
  '/types/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => leaveController.deleteLeaveType(req, res, next)
);
router.get('/holidays', (req, res, next) => leaveController.getHolidays(req, res, next));

// My leave
router.get('/balances', (req, res, next) => leaveController.getBalances(req, res, next));
router.get('/balances/:employeeId', requirePermission('leave', 'read'), (req, res, next) => leaveController.getBalances(req, res, next));
router.post('/apply', (req, res, next) => leaveController.applyLeave(req, res, next));
router.post('/preview', (req, res, next) => leaveController.previewLeave(req, res, next));
router.get('/my', (req, res, next) => leaveController.getMyLeaves(req, res, next));
router.delete('/:id', (req, res, next) => leaveController.cancelLeave(req, res, next));

// Approvals
router.get(
  '/approvals',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => leaveController.getPendingApprovals(req, res, next)
);
router.patch(
  '/:id/action',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => leaveController.handleLeaveAction(req, res, next)
);

// Admin view
router.get(
  '/all',
  requirePermission('leave', 'read'),
  (req, res, next) => leaveController.getAllLeaves(req, res, next)
);

export { router as leaveRouter };
