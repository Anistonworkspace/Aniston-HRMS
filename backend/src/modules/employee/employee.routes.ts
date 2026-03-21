import { Router } from 'express';
import { employeeController } from './employee.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.list(req, res, next)
);

router.get('/:id', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getById(req, res, next)
);

router.post('/', requirePermission('employee', 'create'), (req, res, next) =>
  employeeController.create(req, res, next)
);

router.patch('/:id', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.update(req, res, next)
);

router.delete('/:id', requirePermission('employee', 'delete'), (req, res, next) =>
  employeeController.delete(req, res, next)
);

export { router as employeeRouter };
