import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { dashboardController } from './dashboard.controller.js';

const router = Router();
router.use(authenticate);

router.get('/stats', dashboardController.getStats);

export { router as dashboardRouter };
