import { Router } from 'express';
import { employeeDeletionController } from './employee-deletion.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// HR creates a deletion request for an employee
// POST /api/employee-deletion-requests/:employeeId
router.post(
  '/:employeeId',
  requirePermission('employee', 'manage'), // HR+ only
  (req, res, next) => employeeDeletionController.createRequest(req, res, next),
);

// Super Admin lists all deletion requests
// GET /api/employee-deletion-requests
router.get(
  '/',
  requirePermission('settings', 'manage'), // SUPER_ADMIN only
  (req, res, next) => employeeDeletionController.listRequests(req, res, next),
);

// Super Admin views single request
// GET /api/employee-deletion-requests/:id
router.get(
  '/request/:id',
  requirePermission('settings', 'manage'),
  (req, res, next) => employeeDeletionController.getRequest(req, res, next),
);

// Super Admin approves → triggers permanent delete
// POST /api/employee-deletion-requests/request/:id/approve
router.post(
  '/request/:id/approve',
  requirePermission('settings', 'manage'),
  (req, res, next) => employeeDeletionController.approveRequest(req, res, next),
);

// Super Admin rejects
// POST /api/employee-deletion-requests/request/:id/reject
router.post(
  '/request/:id/reject',
  requirePermission('settings', 'manage'),
  (req, res, next) => employeeDeletionController.rejectRequest(req, res, next),
);

export { router as employeeDeletionRouter };
