import { Router } from 'express';
import { Role } from '@aniston/shared';
import { whatsAppController } from './whatsapp.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { rateLimiter } from '../../middleware/rateLimiter.js';
import { uploadDocument } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

// Rate limiters for send operations — keyed per org+user to prevent WhatsApp account bans
const sendLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const u = (req as any).user;
    // Never fall back to req.ip — behind a proxy all users share the same IP.
    // 'no-user' creates a single shared bucket for unauthenticated requests,
    // which is safe because authenticate() runs before this and will 401 first.
    return `rl:wa:send:${u?.organizationId || 'no-org'}:${u?.id || 'no-user'}`;
  },
});
const bulkSendLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyFn: (req) => {
    const u = (req as any).user;
    return `rl:wa:bulk:${u?.organizationId || 'no-org'}:${u?.id || 'no-user'}`;
  },
});
const readLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyFn: (req) => {
    const u = (req as any).user;
    return `rl:wa:read:${u?.organizationId || 'no-org'}:${u?.id || 'no-user'}`;
  },
});

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

// Status and chats
router.get('/status', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getStatus(req, res, next)
);

// Send operations (rate limited)
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

// Read-only chat endpoints (rate limited to prevent hammering WhatsApp session)
router.get('/messages', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.getMessages(req, res, next)
);
router.get('/chats', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.getChats(req, res, next)
);
router.get('/chats/:chatId/messages', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.getChatMessages(req, res, next)
);
router.post('/chats/:chatId/read', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.markAsRead(req, res, next)
);
router.get('/chats/:chatId/search', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.searchMessages(req, res, next)
);
router.get('/media/:messageId', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.downloadMedia(req, res, next)
);

// Live WhatsApp session contacts (from WhatsApp device)
router.get('/contacts', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.getContacts(req, res, next)
);

// Conversations (DB-backed)
router.get('/conversations', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.getConversations(req, res, next)
);
router.get('/resolve/:phone', authorize(...WA_ROLES), readLimiter, (req, res, next) =>
  whatsAppController.resolveChatByPhone(req, res, next)
);

// =====================================================================
// DB CONTACTS CRUD — application-layer contacts (not WhatsApp device contacts)
// =====================================================================
router.get('/db-contacts', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.getDbContacts(req, res, next)
);
router.post('/db-contacts', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.createContact(req, res, next)
);
router.patch('/db-contacts/:contactId', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.updateContact(req, res, next)
);
router.delete('/db-contacts/:contactId', authorize(...WA_ROLES), (req, res, next) =>
  whatsAppController.deleteContact(req, res, next)
);

export { router as whatsAppRouter };
