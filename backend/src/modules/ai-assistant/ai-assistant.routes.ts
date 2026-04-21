import { Router } from 'express';
import { Role } from '@aniston/shared';
import { aiAssistantController } from './ai-assistant.controller.js';
import { aiAssistantService } from './ai-assistant.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

router.use(authenticate);

const aiRateLimit = rateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'rl:ai' });

// POST /api/ai-assistant/chat — SUPER_ADMIN, ADMIN, HR
router.post('/chat', aiRateLimit, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  aiAssistantController.chat(req, res, next)
);

// POST /api/ai-assistant/policy-qa — any authenticated user can ask about policies
router.post('/policy-qa', aiRateLimit, async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question) {
      res.status(400).json({ success: false, error: { message: 'Question is required' } });
      return;
    }
    const result = await aiAssistantService.chat(
      req.user!.organizationId,
      req.user!.userId,
      question,
      'policy'
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai-assistant/history — authenticated (any role that can access assistant)
router.get('/history', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  aiAssistantController.getHistory(req, res, next)
);

// POST /api/ai-assistant/clear — SUPER_ADMIN, ADMIN, HR
router.post('/clear', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), (req, res, next) =>
  aiAssistantController.clearHistory(req, res, next)
);

// POST /api/ai-assistant/train — SUPER_ADMIN only
router.post('/train', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  aiAssistantController.train(req, res, next)
);

// GET /api/ai-assistant/knowledge — SUPER_ADMIN, ADMIN
router.get('/knowledge', authorize(Role.SUPER_ADMIN, Role.ADMIN), (req, res, next) =>
  aiAssistantController.getKnowledge(req, res, next)
);

// DELETE /api/ai-assistant/knowledge/:id — SUPER_ADMIN only
router.delete('/knowledge/:id', authorize(Role.SUPER_ADMIN), (req, res, next) =>
  aiAssistantController.deleteKnowledge(req, res, next)
);

export { router as aiAssistantRouter };
