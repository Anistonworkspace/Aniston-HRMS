import { Router } from 'express';
import { crashReportController } from './crash-report.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

// POST /api/crash-reports — receive crash from APK (authenticated or anonymous with X-Native-App header)
router.post('/', (req, res, next) => crashReportController.create(req, res, next));

// Protected routes — HR/Admin only
router.use(authenticate);
router.get('/', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  crashReportController.list(req, res, next)
);
router.get('/stats', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  crashReportController.stats(req, res, next)
);
router.delete('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  crashReportController.remove(req, res, next)
);
router.delete('/', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  crashReportController.clearAll(req, res, next)
);

export { router as crashReportRouter };
