import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { dashboardController } from './dashboard.controller.js';

const router = Router();
router.use(authenticate);

// General stats (used by employee dashboard too)
router.get('/stats', (req, res, next) =>
  dashboardController.getStats(req, res, next)
);

// Super Admin analytics — SUPER_ADMIN and ADMIN only
router.get('/super-admin-stats', authorize('SUPER_ADMIN', 'ADMIN'), (req, res, next) =>
  dashboardController.getSuperAdminStats(req, res, next)
);

// HR operations — SUPER_ADMIN, ADMIN, HR
router.get('/hr-stats', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  dashboardController.getHRStats(req, res, next)
);

// Pending approvals — SUPER_ADMIN, ADMIN, HR, MANAGER
router.get('/pending-approvals', authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'), (req, res, next) =>
  dashboardController.getPendingApprovals(req, res, next)
);

export { router as dashboardRouter };
