import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { notificationsController } from './notifications.controller.js';

const router = Router();
router.use(authenticate);

// GET /api/notifications — list (paginated, newest first)
router.get('/', (req, res, next) => notificationsController.list(req, res, next));

// GET /api/notifications/unread-count — unread badge count
router.get('/unread-count', (req, res, next) => notificationsController.unreadCount(req, res, next));

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', (req, res, next) => notificationsController.markAllRead(req, res, next));

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', (req, res, next) => notificationsController.markRead(req, res, next));

export { router as notificationsRouter };
