import { Router } from 'express';
import { publicApplyController } from './public-apply.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

// Public endpoints (no auth)
router.get('/form/:token', (req, res, next) =>
  publicApplyController.getJobForm(req, res, next)
);
router.post('/form/:token/apply', (req, res, next) =>
  publicApplyController.submitApplication(req, res, next)
);
router.get('/track/:uid', (req, res, next) =>
  publicApplyController.trackApplication(req, res, next)
);

// Protected endpoints (HR/Admin)
router.use(authenticate);
router.post('/:jobId/generate-questions', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.generateQuestions(req, res, next)
);
router.get('/applications', requirePermission('recruitment', 'read'), (req, res, next) =>
  publicApplyController.listApplications(req, res, next)
);
router.get('/applications/:id', requirePermission('recruitment', 'read'), (req, res, next) =>
  publicApplyController.getApplicationDetail(req, res, next)
);

// Interview scheduling (Phase 6)
router.post('/applications/:id/schedule-interview', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.scheduleInterview(req, res, next)
);
router.post('/applications/:id/schedule-preview', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.previewScheduleMessage(req, res, next)
);

// Interview rounds (Phase 7)
router.post('/rounds/:roundId/generate-questions', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.generateInterviewQuestions(req, res, next)
);
router.patch('/rounds/:roundId/score', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.scoreRound(req, res, next)
);
router.post('/applications/:id/finalize', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.finalizeCandidate(req, res, next)
);

export { router as publicApplyRouter };
