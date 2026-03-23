import { Router } from 'express';
import { policyController } from './policy.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Policy categories (must be before /:id to avoid conflict)
router.get('/meta/categories', (req, res, next) =>
  policyController.getCategories(req, res, next)
);

router.get('/', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.list(req, res, next)
);

router.get('/:id', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.getById(req, res, next)
);

router.post('/', requirePermission('policy', 'create'), (req, res, next) =>
  policyController.create(req, res, next)
);

router.patch('/:id', requirePermission('policy', 'update'), (req, res, next) =>
  policyController.update(req, res, next)
);

router.post('/:id/acknowledge', requirePermission('policy', 'read'), (req, res, next) =>
  policyController.acknowledge(req, res, next)
);

export { router as policyRouter };
