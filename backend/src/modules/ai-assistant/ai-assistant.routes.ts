import { Router } from 'express';
import { aiAssistantController } from './ai-assistant.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'HR'));

// POST /api/ai-assistant/chat
router.post('/chat', (req, res, next) =>
  aiAssistantController.chat(req, res, next)
);

// POST /api/ai-assistant/clear
router.post('/clear', (req, res, next) =>
  aiAssistantController.clearHistory(req, res, next)
);

export { router as aiAssistantRouter };
