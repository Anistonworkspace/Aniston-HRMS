import { Router } from 'express';
import { announcementController } from './announcement.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// Announcements
router.get('/', requirePermission('announcement', 'read'), (req, res, next) =>
  announcementController.list(req, res, next)
);

router.post('/', requirePermission('announcement', 'create'), (req, res, next) =>
  announcementController.create(req, res, next)
);

router.patch('/:id', requirePermission('announcement', 'update'), (req, res, next) =>
  announcementController.update(req, res, next)
);

router.delete('/:id', requirePermission('announcement', 'delete'), (req, res, next) =>
  announcementController.delete(req, res, next)
);

// Social Wall
router.get('/social', requirePermission('social_wall', 'read'), (req, res, next) =>
  announcementController.listSocialPosts(req, res, next)
);

router.post('/social', requirePermission('social_wall', 'create'), (req, res, next) =>
  announcementController.createSocialPost(req, res, next)
);

router.post('/social/:id/like', requirePermission('social_wall', 'create'), (req, res, next) =>
  announcementController.toggleLike(req, res, next)
);

router.post('/social/:id/comment', requirePermission('social_wall', 'create'), (req, res, next) =>
  announcementController.createComment(req, res, next)
);

export { router as announcementRouter };
