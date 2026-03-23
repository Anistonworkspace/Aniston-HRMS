import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { dashboardController } from './dashboard.controller.js';

const router = Router();
router.use(authenticate);

router.get('/stats', (req, res, next) =>
  dashboardController.getStats(req, res, next)
);

export { router as dashboardRouter };
