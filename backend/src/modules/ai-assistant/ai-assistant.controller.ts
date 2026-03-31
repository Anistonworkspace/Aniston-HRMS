import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { aiAssistantService } from './ai-assistant.service.js';

const chatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(4000, 'Message too long'),
  context: z.enum(['admin', 'hr-recruitment', 'hr-general', 'policy']).default('admin'),
});

const trainSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  content: z.string().min(1, 'Content is required').max(50000, 'Content too long'),
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

  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const context = (req.query.context as string) || 'admin';
      const history = await aiAssistantService.getHistory(req.user!.userId, context);
      res.json({ success: true, data: history });
    } catch (err) {
      next(err);
    }
  }

  async train(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, content } = trainSchema.parse(req.body);
      const doc = await aiAssistantService.addKnowledgeDoc(
        req.user!.organizationId,
        req.user!.userId,
        title,
        content
      );
      res.status(201).json({ success: true, data: doc });
    } catch (err) {
      next(err);
    }
  }

  async getKnowledge(req: Request, res: Response, next: NextFunction) {
    try {
      const docs = await aiAssistantService.getKnowledgeDocs(req.user!.organizationId);
      res.json({ success: true, data: docs });
    } catch (err) {
      next(err);
    }
  }

  async deleteKnowledge(req: Request, res: Response, next: NextFunction) {
    try {
      await aiAssistantService.deleteKnowledgeDoc(req.user!.organizationId, req.params.id);
      res.json({ success: true, message: 'Knowledge document deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const aiAssistantController = new AiAssistantController();
