import { Router } from 'express';
import { settingsController } from './settings.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(requirePermission('settings', 'read'));

// Organization
router.get('/organization', (req, res, next) =>
  settingsController.getOrganization(req, res, next)
);

router.patch('/organization', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.updateOrganization(req, res, next)
);

// Office Locations
router.get('/locations', (req, res, next) =>
  settingsController.listLocations(req, res, next)
);

router.post('/locations', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.createLocation(req, res, next)
);

router.patch('/locations/:id', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.updateLocation(req, res, next)
);

router.delete('/locations/:id', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.deleteLocation(req, res, next)
);

// Audit Logs
router.get('/audit-logs', (req, res, next) =>
  settingsController.listAuditLogs(req, res, next)
);

// System Info
router.get('/system', (req, res, next) =>
  settingsController.getSystemInfo(req, res, next)
);

export { router as settingsRouter };
