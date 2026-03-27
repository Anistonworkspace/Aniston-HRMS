import { Router } from 'express';
import { whatsAppController } from './whatsapp.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Admin only
router.post('/initialize', authorize('SUPER_ADMIN', 'ADMIN'), (req, res, next) =>
  whatsAppController.initialize(req, res, next)
);
router.get('/qr', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getQrCode(req, res, next)
);
router.post('/logout', authorize('SUPER_ADMIN', 'ADMIN'), (req, res, next) =>
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
router.post('/send-to-number', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.sendToNumber(req, res, next)
);
router.get('/contacts', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), (req, res, next) =>
  whatsAppController.getContacts(req, res, next)
);

export { router as whatsAppRouter };
