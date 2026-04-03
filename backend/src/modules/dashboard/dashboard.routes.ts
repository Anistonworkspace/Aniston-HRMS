import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { dashboardController } from './dashboard.controller.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Unified summary — auto-detects role and returns appropriate data
router.get('/summary', (req, res, next) =>
  dashboardController.getSummary(req, res, next)
);

// General stats (employee dashboard + backward compat)
router.get('/stats', (req, res, next) =>
  dashboardController.getStats(req, res, next)
);

// Super Admin analytics — SUPER_ADMIN and ADMIN only
router.get('/super-admin-stats', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  dashboardController.getSuperAdminStats(req, res, next)
);

// HR operations — SUPER_ADMIN, ADMIN, HR
router.get('/hr-stats', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  dashboardController.getHRStats(req, res, next)
);

// Pending approvals — SUPER_ADMIN, ADMIN, HR, MANAGER
router.get('/pending-approvals', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), (req, res, next) =>
  dashboardController.getPendingApprovals(req, res, next)
);

export { router as dashboardRouter };
