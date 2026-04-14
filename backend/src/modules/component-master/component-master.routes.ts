import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { componentMasterController } from './component-master.controller.js';

const router = Router();
router.use(authenticate);

// List all components (any authenticated HR/Admin)
router.get('/',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.list(req, res, next)
);

// Specific POST routes MUST come before generic /:id routes to avoid Express matching 'reorder'/'seed' as an :id param
// Reorder components
router.post('/reorder',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.reorder(req, res, next)
);

// Seed default components
router.post('/seed',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  (req, res, next) => componentMasterController.seedDefaults(req, res, next)
);

// Create component
router.post('/',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.create(req, res, next)
);

// Get single component
router.get('/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.getById(req, res, next)
);

// Update component
router.patch('/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.update(req, res, next)
);

// Toggle active/inactive
router.patch('/:id/toggle',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.toggleActive(req, res, next)
);

// Delete component (soft)
router.delete('/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => componentMasterController.delete(req, res, next)
);

export { router as componentMasterRouter };
