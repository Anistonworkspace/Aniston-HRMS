import { Router } from 'express';
import { performanceController } from './performance.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

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

export { router as performanceRouter };
