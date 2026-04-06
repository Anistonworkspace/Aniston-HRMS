import { Router } from 'express';
import { performanceController } from './performance.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { performanceService } from './performance.service.js';
import { getLeavePerformanceSummary } from '../../utils/leavePerformance.js';
import { Role } from '@aniston/shared';

const router = Router();

router.use(authenticate);

// AI Features (before parameterized routes)
router.post('/ai-suggest-goals/:employeeId', authenticate, async (req, res, next) => {
  try {
    const result = await performanceService.suggestGoals(req.params.employeeId, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/ai-review-summary/:reviewId', authenticate, async (req, res, next) => {
  try {
    const result = await performanceService.generateReviewSummary(req.params.reviewId, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Review Cycles
router.get('/cycles', requirePermission('performance', 'read'), (req, res, next) =>
  performanceController.listCycles(req, res, next)
);

router.post('/cycles', requirePermission('performance', 'create'), (req, res, next) =>
  performanceController.createCycle(req, res, next)
);

router.patch('/cycles/:id', requirePermission('performance', 'update'), (req, res, next) =>
  performanceController.updateCycle(req, res, next)
);

// Goals
router.get('/goals', requirePermission('performance', 'read'), (req, res, next) =>
  performanceController.listGoals(req, res, next)
);

router.post('/goals', requirePermission('performance', 'create'), (req, res, next) =>
  performanceController.createGoal(req, res, next)
);

router.patch('/goals/:id', requirePermission('performance', 'update'), (req, res, next) =>
  performanceController.updateGoal(req, res, next)
);

// Reviews
router.get('/reviews', requirePermission('performance', 'read'), (req, res, next) =>
  performanceController.listReviews(req, res, next)
);

router.post('/reviews', requirePermission('performance', 'create'), (req, res, next) =>
  performanceController.createReview(req, res, next)
);

router.patch('/reviews/:id', requirePermission('performance', 'update'), (req, res, next) =>
  performanceController.updateReview(req, res, next)
);

// Leave Performance Score
router.get('/leave-score/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  async (req, res, next) => {
    try {
      const { employeeId } = req.params;
      const months = Number(req.query.months) || 6;
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - months);
      const summary = await getLeavePerformanceSummary(employeeId, { start, end });
      res.json({ success: true, data: summary });
    } catch (err) { next(err); }
  }
);

export { router as performanceRouter };
