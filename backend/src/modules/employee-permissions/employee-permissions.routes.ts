import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { employeePermissionController } from './employee-permissions.controller.js';

const router = Router();

// Employee: get own effective permissions
router.get('/me', authenticate, (req, res, next) =>
  employeePermissionController.getMyPermissions(req, res, next),
);

// HR/Admin: manage presets
router.get('/presets', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  employeePermissionController.getPresets(req, res, next),
);
router.post('/presets', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  employeePermissionController.upsertPreset(req, res, next),
);

// HR/Admin: manage per-employee overrides
router.get('/overrides/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  employeePermissionController.getOverride(req, res, next),
);
router.post('/overrides/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  employeePermissionController.upsertOverride(req, res, next),
);
router.delete('/overrides/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  employeePermissionController.deleteOverride(req, res, next),
);

export { router as employeePermissionsRouter };
