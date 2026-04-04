import { Router } from 'express';
import { departmentController } from './department.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('department', 'read'), (req, res, next) =>
  departmentController.list(req, res, next)
);

router.post('/', requirePermission('department', 'create'), (req, res, next) =>
  departmentController.create(req, res, next)
);

router.patch('/:id', requirePermission('department', 'update'), (req, res, next) =>
  departmentController.update(req, res, next)
);

router.post('/:id/archive', requirePermission('department', 'update'), (req, res, next) =>
  departmentController.archive(req, res, next)
);

router.post('/:id/reactivate', requirePermission('department', 'update'), (req, res, next) =>
  departmentController.reactivate(req, res, next)
);

router.delete('/:id', requirePermission('department', 'delete'), (req, res, next) =>
  departmentController.delete(req, res, next)
);

export { router as departmentRouter };
