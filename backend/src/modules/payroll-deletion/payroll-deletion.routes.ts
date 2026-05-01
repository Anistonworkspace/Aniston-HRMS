import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { payrollDeletionController } from './payroll-deletion.controller.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// HR requests deletion of a payroll run
// POST /api/payroll-deletion-requests
router.post('/', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  payrollDeletionController.createRequest(req, res, next));

// SuperAdmin lists all payroll deletion requests
// GET /api/payroll-deletion-requests
router.get('/', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  payrollDeletionController.listRequests(req, res, next));

// SuperAdmin approves → deletes payroll run
// POST /api/payroll-deletion-requests/:id/approve
router.post('/:id/approve', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  payrollDeletionController.approveRequest(req, res, next));

// SuperAdmin rejects
// POST /api/payroll-deletion-requests/:id/reject
router.post('/:id/reject', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  payrollDeletionController.rejectRequest(req, res, next));

// SuperAdmin dismisses completed request
// DELETE /api/payroll-deletion-requests/:id
router.delete('/:id', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  payrollDeletionController.dismissRequest(req, res, next));

export { router as payrollDeletionRouter };
