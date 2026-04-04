import { Router } from 'express';
import { employeeController } from './employee.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.list(req, res, next)
);

router.get('/stats', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.stats(req, res, next)
);

// Exit / Offboarding (must be before /:id to avoid param capture)
router.get('/exit-requests', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.getExitRequests(req, res, next)
);

router.post('/invite', requirePermission('employee', 'create'), (req, res, next) =>
  employeeController.invite(req, res, next)
);

// HR: Bulk send app download / attendance instruction emails
router.post('/send-bulk-email', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.sendBulkEmail(req, res, next)
);

router.post('/me/resign', (req, res, next) =>
  employeeController.submitResignation(req, res, next)
);

// Direct employee creation disabled — use invitation flow instead:
// POST /api/invitations → employee accepts → User + Employee created automatically
// router.post('/', requirePermission('employee', 'create'), (req, res, next) =>
//   employeeController.create(req, res, next)
// );

router.get('/:id', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getById(req, res, next)
);

router.patch('/:id', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.update(req, res, next)
);

router.patch('/:id/role', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.changeRole(req, res, next)
);

router.delete('/:id', requirePermission('employee', 'delete'), (req, res, next) =>
  employeeController.delete(req, res, next)
);

// Exit detail & actions
router.get('/:id/exit-details', requirePermission('employee', 'read'), (req, res, next) =>
  employeeController.getExitDetails(req, res, next)
);

router.post('/:id/approve-exit', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.approveExit(req, res, next)
);

router.post('/:id/complete-exit', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.completeExit(req, res, next)
);

router.post('/:id/withdraw-resignation', requirePermission('employee', 'update'), (req, res, next) =>
  employeeController.withdrawResignation(req, res, next)
);

router.post('/:id/terminate', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.initiateTermination(req, res, next)
);

// Activation Invite
router.post('/:id/send-activation-invite', requirePermission('employee', 'manage'), (req, res, next) =>
  employeeController.sendActivationInvite(req, res, next)
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
