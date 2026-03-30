import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { exitAccessController } from './exit-access.controller.js';

const router = Router();

// Employee: Get own exit access config
router.get('/me', authenticate,
  (req, res, next) => exitAccessController.getMyAccess(req, res, next)
);

// HR+: Get exit access config for an employee
router.get('/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitAccessController.getConfig(req, res, next)
);

// HR+: Create or update exit access config
router.post('/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitAccessController.upsertConfig(req, res, next)
);

// HR+: Revoke exit access
router.delete('/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitAccessController.revokeAccess(req, res, next)
);

export { router as exitAccessRouter };
