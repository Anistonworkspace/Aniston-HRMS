import { Router } from 'express';
import { aiConfigController } from './ai-config.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

// GET  /api/settings/ai-config       — get active config (key masked)
router.get('/', (req, res, next) =>
  aiConfigController.getConfig(req, res, next)
);

// PUT  /api/settings/ai-config       — upsert config
router.put('/', (req, res, next) =>
  aiConfigController.upsertConfig(req, res, next)
);

// POST /api/settings/ai-config/test  — test connection
router.post('/test', (req, res, next) =>
  aiConfigController.testConnection(req, res, next)
);

export { router as aiConfigRouter };
