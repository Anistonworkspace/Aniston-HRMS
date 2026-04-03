import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { whatsAppService } from './whatsapp.service.js';
import { sendMessageSchema, sendJobLinkSchema, sendMediaSchema } from './whatsapp.validation.js';

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

  async sendMedia(req: Request, res: Response, next: NextFunction) {
    try {
      const { chatId, caption } = sendMediaSchema.parse(req.body);
      if (!req.file) {
        res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
        return;
      }
      const result = await whatsAppService.sendMedia(chatId, req.file.path, caption, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Media sent' });
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

  async getChats(req: Request, res: Response, next: NextFunction) {
    try {
      const chats = await whatsAppService.getChats(req.user!.organizationId);
      res.json({ success: true, data: chats });
    } catch (err) { next(err); }
  }

  async getChatMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = Number(req.query.limit) || 50;
      const before = req.query.before as string | undefined;
      const messages = await whatsAppService.getChatMessages(req.params.chatId, limit, before);
      res.json({ success: true, data: messages });
    } catch (err) { next(err); }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.markChatAsRead(req.params.chatId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async searchMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      if (!query || query.length < 2) {
        res.status(400).json({ success: false, error: { message: 'Search query must be at least 2 characters' } });
        return;
      }
      const limit = Number(req.query.limit) || 50;
      const results = await whatsAppService.searchMessages(req.params.chatId, query, limit);
      res.json({ success: true, data: results });
    } catch (err) { next(err); }
  }

  async downloadMedia(req: Request, res: Response, next: NextFunction) {
    try {
      const { messageId } = req.params;
      const chatId = req.query.chatId as string;
      if (!chatId) {
        res.status(400).json({ success: false, error: { message: 'chatId query param required' } });
        return;
      }
      const result = await whatsAppService.downloadMedia(messageId, chatId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async sendToNumber(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, message } = z.object({
        phone: z.string().min(10).max(20),
        message: z.string().min(1).max(4096),
      }).parse(req.body);
      const result = await whatsAppService.sendToNumber(phone, message, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getContacts(req: Request, res: Response, next: NextFunction) {
    try {
      const contacts = await whatsAppService.getContacts(req.user!.organizationId);
      res.json({ success: true, data: contacts });
    } catch (err) { next(err); }
  }

  async refreshQr(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.refreshQr(req.user!.organizationId);
      res.json({ success: true, data: result, message: 'QR refreshed — scan the new code' });
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
