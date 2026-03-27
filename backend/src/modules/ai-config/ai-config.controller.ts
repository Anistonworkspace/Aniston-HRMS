import { Request, Response, NextFunction } from 'express';
import { aiConfigService } from './ai-config.service.js';
import { upsertAiConfigSchema } from './ai-config.validation.js';

export class AiConfigController {
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await aiConfigService.getConfig(req.user!.organizationId);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  }

  async upsertConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const data = upsertAiConfigSchema.parse(req.body);
      await aiConfigService.upsertConfig(req.user!.organizationId, data, req.user!.userId);
      res.json({ success: true, message: 'AI configuration saved' });
    } catch (err) {
      next(err);
    }
  }

  async testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await aiConfigService.testConnection(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const aiConfigController = new AiConfigController();
