import { Router } from 'express';
import { designationController } from './designation.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('designation', 'read'), (req, res, next) =>
  designationController.list(req, res, next)
);

router.post('/', requirePermission('designation', 'create'), (req, res, next) =>
  designationController.create(req, res, next)
);

router.patch('/:id', requirePermission('designation', 'update'), (req, res, next) =>
  designationController.update(req, res, next)
);

router.post('/:id/archive', requirePermission('designation', 'update'), (req, res, next) =>
  designationController.archive(req, res, next)
);

router.post('/:id/reactivate', requirePermission('designation', 'update'), (req, res, next) =>
  designationController.reactivate(req, res, next)
);

router.delete('/:id', requirePermission('designation', 'delete'), (req, res, next) =>
  designationController.delete(req, res, next)
);

export { router as designationRouter };
