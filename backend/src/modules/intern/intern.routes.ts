import { Router } from 'express';
import { internController } from './intern.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Profile CRUD (HR+ can manage)
router.get('/:employeeId/profile', requirePermission('employee', 'read'), (req, res, next) =>
  internController.getProfile(req, res, next)
);

router.post('/:employeeId/profile', requirePermission('employee', 'manage'), (req, res, next) =>
  internController.createProfile(req, res, next)
);

router.patch('/:employeeId/profile', requirePermission('employee', 'manage'), (req, res, next) =>
  internController.updateProfile(req, res, next)
);

// Achievement Letters
router.get('/:employeeId/achievement-letters', requirePermission('employee', 'read'), (req, res, next) =>
  internController.getAchievementLetters(req, res, next)
);

router.post('/:employeeId/achievement-letters', requirePermission('employee', 'manage'), (req, res, next) =>
  internController.issueAchievementLetter(req, res, next)
);

router.get('/:employeeId/achievement-letters/:letterId/pdf', requirePermission('employee', 'read'), (req, res, next) =>
  internController.downloadAchievementLetterPdf(req, res, next)
);

export { router as internRouter };
