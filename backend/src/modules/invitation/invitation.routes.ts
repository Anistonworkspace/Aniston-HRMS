import { Router } from 'express';
import { invitationController } from './invitation.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

// Public endpoints (token-based auth)
router.get('/validate/:token', (req, res, next) =>
  invitationController.validate(req, res, next)
);

router.patch('/complete/:token', (req, res, next) =>
  invitationController.complete(req, res, next)
);

// Protected endpoints (HR/Admin)
router.use(authenticate);

router.post('/', requirePermission('employee', 'create'), (req, res, next) =>
  invitationController.create(req, res, next)
);

router.get('/', requirePermission('employee', 'read'), (req, res, next) =>
  invitationController.list(req, res, next)
);

router.post('/:id/resend', requirePermission('employee', 'create'), (req, res, next) =>
  invitationController.resend(req, res, next)
);

export { router as invitationRouter };
