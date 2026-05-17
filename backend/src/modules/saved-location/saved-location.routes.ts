import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { validateRequest } from '../../middleware/validate.middleware.js';
import { Role } from '@aniston/shared';
import * as ctrl from './saved-location.controller.js';
import {
  createSavedLocationSchema,
  updateSavedLocationSchema,
} from './saved-location.validation.js';

const router = Router();
router.use(authenticate);

const hrAuth = authorize(Role.HR, Role.ADMIN, Role.SUPER_ADMIN);
const hrOrManager = authorize(Role.HR, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER);

router.get('/', hrOrManager, ctrl.list);
router.post('/', hrAuth, validateRequest(createSavedLocationSchema), ctrl.create);
router.patch('/:id', hrAuth, validateRequest(updateSavedLocationSchema), ctrl.update);
router.delete('/:id', hrAuth, ctrl.remove);

// Promote a LocationVisit to a SavedLocation
router.post('/from-visit/:visitId', hrAuth, ctrl.promoteFromVisit);

export default router;
