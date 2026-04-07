import { Request, Response, NextFunction } from 'express';
import { whatsAppService } from './whatsapp.service.js';
import { sendMessageSchema, sendJobLinkSchema, sendMediaSchema, sendToNumberSchema } from './whatsapp.validation.js';

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
      const msg = await whatsAppService.sendMessage(data, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: msg, message: 'Message sent' });
    } catch (err) { next(err); }
  }

  async sendJobLink(req: Request, res: Response, next: NextFunction) {
    try {
      const data = sendJobLinkSchema.parse(req.body);
      const msg = await whatsAppService.sendJobLink(data, req.user!.organizationId, req.user!.userId);
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
      const result = await whatsAppService.sendMedia(chatId, req.file.path, caption, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: 'Media sent' });
    } catch (err) { next(err); }
  }

  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
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
      const chatId = String(req.params.chatId);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const before = typeof req.query.before === 'string' ? req.query.before : undefined;
      const messages = await whatsAppService.getChatMessages(chatId, limit, before);
      res.json({ success: true, data: messages });
    } catch (err) { next(err); }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.markChatAsRead(String(req.params.chatId));
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async searchMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const chatId = String(req.params.chatId);
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      if (!query || query.length < 2) {
        res.status(400).json({ success: false, error: { message: 'Search query must be at least 2 characters' } });
        return;
      }
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const results = await whatsAppService.searchMessages(chatId, query, limit);
      res.json({ success: true, data: results });
    } catch (err) { next(err); }
  }

  async downloadMedia(req: Request, res: Response, next: NextFunction) {
    try {
      const messageId = String(req.params.messageId);
      const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : '';
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
      const { phone, message } = sendToNumberSchema.parse(req.body);
      const result = await whatsAppService.sendToNumber(phone, message, req.user!.organizationId, req.user!.userId);
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
      const result = await whatsAppService.refreshQr(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: 'QR refreshed — scan the new code' });
    } catch (err) { next(err); }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await whatsAppService.logout(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const whatsAppController = new WhatsAppController();
