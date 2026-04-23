import { Router } from 'express';
import { performanceController } from './performance.controller.js';
import { authenticate, requirePermission, authorize, requireEmpPerm } from '../../middleware/auth.middleware.js';
import { performanceService } from './performance.service.js';
import { getLeavePerformanceSummary } from '../../utils/leavePerformance.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';
import { Role } from '@aniston/shared';

const router = Router();

router.use(authenticate);

const aiRateLimit = rateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'rl:ai' });

// AI Features (before parameterized routes)
router.post('/ai-suggest-goals/:employeeId', aiRateLimit, async (req, res, next) => {
  try {
    const result = await performanceService.suggestGoals(req.params.employeeId, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/ai-review-summary/:reviewId', aiRateLimit, async (req, res, next) => {
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

// Performance Summary — self (any authenticated employee)
router.get('/summary', requireEmpPerm('canViewPerformance'), async (req, res, next) => {
  try {
    const { prisma: db } = await import('../../lib/prisma.js');
    const employee = await db.employee.findFirst({
      where: { userId: req.user!.userId, organizationId: req.user!.organizationId },
    });
    if (!employee) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee profile not found' } });
    const summary = await performanceService.getEmployeePerformanceSummary(employee.id, req.user!.organizationId);
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
});

// Performance Summary — by employee ID (HR/Admin/Manager)
router.get('/summary/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  async (req, res, next) => {
    try {
      const summary = await performanceService.getEmployeePerformanceSummary(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: summary });
    } catch (err) { next(err); }
  }
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
