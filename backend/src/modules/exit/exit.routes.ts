import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { exitController } from './exit.controller.js';

const router = Router();
router.use(authenticate);

// ── Static segments FIRST (avoid :param capture conflicts) ────────────────────

// Employee self-service — get own exit status + assets + tasks
router.get(
  '/me',
  (req, res, next) => exitController.getMyExitStatus(req, res, next),
);

// Employee self-service — confirm returning an asset
router.post(
  '/me/confirm-return/:itemId',
  (req, res, next) => exitController.confirmAssetReturn(req, res, next),
);
router.delete(
  '/me/confirm-return/:itemId',
  (req, res, next) => exitController.undoAssetReturnConfirmation(req, res, next),
);

// Handover task update/delete — taskId is a UUID, won't collide with employeeId routes
router.patch(
  '/handover/:taskId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER, Role.EMPLOYEE),
  (req, res, next) => exitController.updateHandoverTask(req, res, next),
);
router.delete(
  '/handover/:taskId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.deleteHandoverTask(req, res, next),
);

// ── Dynamic :employeeId routes (HR-facing) ────────────────────────────────────

// Last Working Day
router.patch(
  '/:employeeId/last-working-day',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.setLastWorkingDay(req, res, next),
);

// Handover data (tasks + asset checklist items)
router.get(
  '/:employeeId/handover',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => exitController.getHandoverData(req, res, next),
);
router.post(
  '/:employeeId/handover',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.addHandoverTask(req, res, next),
);

// Full & Final
router.get(
  '/:employeeId/fnf',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.getFnFDetails(req, res, next),
);
router.post(
  '/:employeeId/fnf/experience-letter',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.generateExperienceLetter(req, res, next),
);

// IT Offboarding Checklist — specific sub-routes BEFORE generic /:employeeId/it-checklist
router.patch(
  '/:employeeId/it-checklist/notes',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.saveITNotes(req, res, next),
);
router.get(
  '/:employeeId/it-checklist',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.getITChecklist(req, res, next),
);
router.patch(
  '/:employeeId/it-checklist',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.updateITChecklist(req, res, next),
);

// Exit Interview
router.get(
  '/:employeeId/exit-interview',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.getExitInterview(req, res, next),
);
router.post(
  '/:employeeId/exit-interview',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => exitController.saveExitInterview(req, res, next),
);

export { router as exitRouter };
