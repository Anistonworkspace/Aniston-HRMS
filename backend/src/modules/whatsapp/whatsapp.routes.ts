import { Router } from 'express';
import { Role } from '@aniston/shared';
import { whatsAppController } from './whatsapp.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';
import { uploadDocument } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

// Rate limiters for send operations (prevent WhatsApp account ban)
const sendLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'rl:wa:send' });
const bulkSendLimiter = rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'rl:wa:bulk' });

const WA_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR] as Role[];

// Admin + HR can initialize, refresh QR, and logout
router.post('/initialize', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.initialize(req, res, next)
);
router.post('/refresh-qr', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.refreshQr(req, res, next)
);
router.get('/qr', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getQrCode(req, res, next)
);
router.post('/logout', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.logout(req, res, next)
);

// HR+ with rate limiting on send operations
router.get('/status', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getStatus(req, res, next)
);
router.post('/send', authorize(...WA_ROLES), sendLimiter, (req, res, next) =>
  whatsAppController.sendMessage(req, res, next)
);
router.post('/send-job-link', authorize(...WA_ROLES), bulkSendLimiter, (req, res, next) =>
  whatsAppController.sendJobLink(req, res, next)
);
router.post('/send-to-number', authorize(...WA_ROLES), sendLimiter, (req, res, next) =>
  whatsAppController.sendToNumber(req, res, next)
);
router.post('/send-media', authorize(...WA_ROLES), sendLimiter, uploadDocument.single('file'), (req, res, next) =>
  whatsAppController.sendMedia(req, res, next)
);

// Read-only endpoints
router.get('/messages', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getMessages(req, res, next)
);
router.get('/chats', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getChats(req, res, next)
);
router.get('/chats/:chatId/messages', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getChatMessages(req, res, next)
);
router.post('/chats/:chatId/read', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.markAsRead(req, res, next)
);
router.get('/chats/:chatId/search', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.searchMessages(req, res, next)
);
router.get('/media/:messageId', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.downloadMedia(req, res, next)
);
router.get('/contacts', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getContacts(req, res, next)
);

export { router as whatsAppRouter };
