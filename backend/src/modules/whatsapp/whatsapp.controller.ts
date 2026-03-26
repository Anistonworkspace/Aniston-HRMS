import { Request, Response, NextFunction } from 'express';
import { whatsAppService } from './whatsapp.service.js';
import { sendMessageSchema, sendJobLinkSchema } from './whatsapp.validation.js';

export class WhatsAppController {
  async initialize(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.initialize(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await whatsAppService.getStatus(req.user!.organizationId);
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  }

  async getQrCode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.getQrCode(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const data = sendMessageSchema.parse(req.body);
      const msg = await whatsAppService.sendMessage(data, req.user!.organizationId);
      res.json({ success: true, data: msg, message: 'Message sent' });
    } catch (err) { next(err); }
  }

  async sendJobLink(req: Request, res: Response, next: NextFunction) {
    try {
      const data = sendJobLinkSchema.parse(req.body);
      const msg = await whatsAppService.sendJobLink(data, req.user!.organizationId);
      res.json({ success: true, data: msg, message: 'Job link sent' });
    } catch (err) { next(err); }
  }

  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const result = await whatsAppService.getMessages(req.user!.organizationId, page, limit);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.logout(req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const whatsAppController = new WhatsAppController();
