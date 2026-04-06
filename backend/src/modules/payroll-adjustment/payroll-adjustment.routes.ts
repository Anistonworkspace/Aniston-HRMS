import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { payrollAdjustmentController } from './payroll-adjustment.controller.js';

const router = Router();
router.use(authenticate);

// List adjustments for a payroll run
router.get('/run/:runId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollAdjustmentController.listByRun(req, res, next)
);

// List adjustments for an employee
router.get('/employee/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollAdjustmentController.listByEmployee(req, res, next)
);

// Create single adjustment
router.post('/',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollAdjustmentController.create(req, res, next)
);

// Bulk create adjustments
router.post('/bulk',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollAdjustmentController.bulkCreate(req, res, next)
);

// Approve/reject adjustment
router.patch('/:id/approve',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  (req, res, next) => payrollAdjustmentController.approve(req, res, next)
);

// Delete adjustment
router.delete('/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollAdjustmentController.delete(req, res, next)
);

export { router as payrollAdjustmentRouter };
