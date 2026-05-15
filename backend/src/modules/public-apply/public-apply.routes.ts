import { Router } from 'express';
import { publicApplyController } from './public-apply.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';
import { uploadResume } from '../../middleware/upload.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// Rate limiter for public job application submissions:
// max 3 applications per IP per hour — prevents bot spam and AI MCQ cost abuse.
const applyRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyPrefix: 'rl:public-apply',
  failClosed: false, // fail open so Redis outage doesn't block legitimate applicants
});

// Rate limiter for application status tracking — 60 checks/hour per IP
const trackRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyPrefix: 'rl:track-app',
  failClosed: false,
});

// Public endpoints (no auth)
router.get('/form/:token', (req, res, next) =>
  publicApplyController.getJobForm(req, res, next)
);
router.post('/form/:token/apply', applyRateLimiter, uploadResume.single('resume'), (req, res, next) =>
  publicApplyController.submitApplication(req, res, next)
);
router.get('/track/:uid', trackRateLimiter, (req, res, next) =>
  publicApplyController.trackApplication(req, res, next)
);

// Protected endpoints (Auth Required)
router.use(authenticate);

// Interview tasks for current user (any authenticated user)
router.get('/interview-tasks', (req, res, next) =>
  publicApplyController.getInterviewTasks(req, res, next)
);

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
router.post('/applications/:id/rounds', requirePermission('recruitment', 'update'), (req, res, next) =>
  publicApplyController.createRound(req, res, next)
);
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
