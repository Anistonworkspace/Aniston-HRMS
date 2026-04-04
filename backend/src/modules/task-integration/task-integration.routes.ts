import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { taskIntegrationController } from './task-integration.controller.js';

const router = Router();
router.use(authenticate);

// Config management — ADMIN only
router.get('/config', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  taskIntegrationController.getConfig(req, res, next)
);
router.post('/config', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  taskIntegrationController.upsertConfig(req, res, next)
);
router.post('/config/test', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  taskIntegrationController.testConnection(req, res, next)
);

// Leave task audit — any authenticated employee
router.post('/audit-for-leave', (req, res, next) =>
  taskIntegrationController.auditTasksForLeave(req, res, next)
);

export { router as taskIntegrationRouter };
