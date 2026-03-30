import { Router } from 'express';
import { agentController } from './agent.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { uploadImage } from '../../middleware/upload.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

// Public: agent pairing verification (no auth — agent uses pairing code)
router.post('/pair/verify', (req, res, next) => agentController.verifyPairCode(req, res, next));

router.use(authenticate);

// Authenticated: generate pairing code
router.post('/pair/generate', (req, res, next) => agentController.generatePairCode(req, res, next));

// Agent endpoints (employee sends data from desktop agent)
router.post('/heartbeat', (req, res, next) => agentController.submitHeartbeat(req, res, next));
router.post('/screenshot', uploadImage.single('screenshot'), (req, res, next) => agentController.uploadScreenshot(req, res, next));
router.get('/config', (req, res, next) => agentController.getConfig(req, res, next));
router.get('/status', (req, res, next) => agentController.getStatus(req, res, next));

// HR/Admin view endpoints
router.get(
  '/activity/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getActivityLogs(req, res, next)
);

router.get(
  '/screenshots/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => agentController.getScreenshots(req, res, next)
);

export { router as agentRouter };
