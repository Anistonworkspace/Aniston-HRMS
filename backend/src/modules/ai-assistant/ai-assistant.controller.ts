import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { aiAssistantService } from './ai-assistant.service.js';

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(4000, 'Message too long'),
  context: z.enum(['admin', 'hr-recruitment', 'hr-general']).default('admin'),
});

export class AiAssistantController {
  async chat(req: Request, res: Response, next: NextFunction) {
    try {
      const { message, context } = chatSchema.parse(req.body);
      const result = await aiAssistantService.chat(
        req.user!.organizationId,
        req.user!.userId,
        message,
        context
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async clearHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { context } = z.object({ context: z.string().default('admin') }).parse(req.body);
      await aiAssistantService.clearHistory(req.user!.userId, context);
      res.json({ success: true, message: 'Conversation cleared' });
    } catch (err) {
      next(err);
    }
  }
}

export const aiAssistantController = new AiAssistantController();
