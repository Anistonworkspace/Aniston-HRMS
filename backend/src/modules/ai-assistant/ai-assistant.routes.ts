import { Router } from 'express';
import { aiAssistantController } from './ai-assistant.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// POST /api/ai-assistant/chat — SUPER_ADMIN, ADMIN, HR
router.post('/chat', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  aiAssistantController.chat(req, res, next)
);

// GET /api/ai-assistant/history — authenticated (any role that can access assistant)
router.get('/history', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  aiAssistantController.getHistory(req, res, next)
);

// POST /api/ai-assistant/clear — SUPER_ADMIN, ADMIN, HR
router.post('/clear', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  aiAssistantController.clearHistory(req, res, next)
);

// POST /api/ai-assistant/train — SUPER_ADMIN only
router.post('/train', authorize('SUPER_ADMIN'), (req, res, next) =>
  aiAssistantController.train(req, res, next)
);

// GET /api/ai-assistant/knowledge — SUPER_ADMIN, ADMIN
router.get('/knowledge', authorize('SUPER_ADMIN', 'ADMIN'), (req, res, next) =>
  aiAssistantController.getKnowledge(req, res, next)
);

// DELETE /api/ai-assistant/knowledge/:id — SUPER_ADMIN only
router.delete('/knowledge/:id', authorize('SUPER_ADMIN'), (req, res, next) =>
  aiAssistantController.deleteKnowledge(req, res, next)
);

export { router as aiAssistantRouter };
