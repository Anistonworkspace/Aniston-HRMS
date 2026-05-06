import { Router } from 'express';
import { settingsController } from './settings.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

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

// Account Activity — SUPER_ADMIN and ADMIN only
router.get('/account-activity', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  settingsController.getAccountActivity(req, res, next)
);

router.delete('/account-activity', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  settingsController.deleteActivityLogs(req, res, next)
);

// Email Configuration
router.get('/email', requirePermission('settings', 'read'), (req, res, next) =>
  settingsController.getEmailConfig(req, res, next)
);

router.post('/email', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.saveEmailConfig(req, res, next)
);

router.post('/email/test', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.testEmailConnection(req, res, next)
);

router.post('/organization/test-admin-email', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.testAdminNotificationEmail(req, res, next)
);

// Microsoft Teams Configuration
router.get('/teams', requirePermission('settings', 'read'), (req, res, next) =>
  settingsController.getTeamsConfig(req, res, next)
);

router.post('/teams', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.saveTeamsConfig(req, res, next)
);

router.post('/teams/test', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.testTeamsConnection(req, res, next)
);

router.post('/teams/sync', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.syncTeamsEmployees(req, res, next)
);

// System Info
router.get('/system', (req, res, next) =>
  settingsController.getSystemInfo(req, res, next)
);

// Document Templates (experience doc fields for EXPERIENCED employees)
router.get('/document-templates', (req, res, next) =>
  settingsController.listDocumentTemplates(req, res, next)
);

router.post('/document-templates', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.upsertDocumentTemplate(req, res, next)
);

router.delete('/document-templates/:id', requirePermission('settings', 'update'), (req, res, next) =>
  settingsController.deleteDocumentTemplate(req, res, next)
);

export { router as settingsRouter };
