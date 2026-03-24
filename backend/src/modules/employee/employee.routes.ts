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

router.post('/invite', requirePermission('employee', 'create'), (req, res, next) =>
  employeeController.invite(req, res, next)
);

router.patch('/:id', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.update(req, res, next)
);

router.delete('/:id', requirePermission('employee', 'delete'), (req, res, next) =>
  employeeController.delete(req, res, next)
);

// Lifecycle Events
router.get('/:id/events', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getLifecycleEvents(req, res, next)
);

router.post('/:id/events', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.addLifecycleEvent(req, res, next)
);

router.delete('/:id/events/:eventId', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.deleteLifecycleEvent(req, res, next)
);

export { router as employeeRouter };
