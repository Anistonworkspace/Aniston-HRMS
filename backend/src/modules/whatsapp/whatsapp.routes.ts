import { Router } from 'express';
import { whatsAppController } from './whatsapp.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { uploadDocument } from '../../middleware/upload.middleware.js';

const router = Router();

router.use(authenticate);

// Admin + HR can initialize, refresh QR, and logout
router.post('/initialize', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.initialize(req, res, next)
);
router.post('/refresh-qr', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.refreshQr(req, res, next)
);
router.get('/qr', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getQrCode(req, res, next)
);
router.post('/logout', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.logout(req, res, next)
);

// HR+
router.get('/status', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getStatus(req, res, next)
);
router.post('/send', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.sendMessage(req, res, next)
);
router.post('/send-job-link', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.sendJobLink(req, res, next)
);
router.get('/messages', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getMessages(req, res, next)
);

// Chat endpoints for WhatsApp Web UI
router.get('/chats', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getChats(req, res, next)
);
router.get('/chats/:chatId/messages', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getChatMessages(req, res, next)
);

// NEW: Mark chat as read
router.post('/chats/:chatId/read', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.markAsRead(req, res, next)
);

// NEW: Search messages in a chat
router.get('/chats/:chatId/search', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.searchMessages(req, res, next)
);

// NEW: Download media on demand (lazy loading)
router.get('/media/:messageId', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.downloadMedia(req, res, next)
);

// NEW: Send media (image/document/video)
router.post('/send-media', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), uploadDocument.single('file'), (req, res, next) =>
  whatsAppController.sendMedia(req, res, next)
);

router.post('/send-to-number', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.sendToNumber(req, res, next)
);
router.get('/contacts', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getContacts(req, res, next)
);

export { router as whatsAppRouter };
