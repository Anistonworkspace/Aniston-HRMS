import { Request, Response, NextFunction } from 'express';
import { announcementService } from './announcement.service.js';
import { createAnnouncementSchema, updateAnnouncementSchema, createSocialPostSchema, createSocialCommentSchema } from './announcement.validation.js';

export class AnnouncementController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const announcements = await announcementService.list(req.user!.organizationId);
      res.json({ success: true, data: announcements });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createAnnouncementSchema.parse(req.body);
      const announcement = await announcementService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: announcement, message: 'Announcement published' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateAnnouncementSchema.parse(req.body);
      const announcement = await announcementService.update(req.params.id, data, req.user!.organizationId);
      res.json({ success: true, data: announcement });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await announcementService.delete(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Announcement deleted' });
    } catch (err) {
      next(err);
    }
  }

  // ==================
  // SOCIAL WALL
  // ==================

  async listSocialPosts(req: Request, res: Response, next: NextFunction) {
    try {
      const posts = await announcementService.listSocialPosts(req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: posts });
    } catch (err) {
      next(err);
    }
  }

  async createSocialPost(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createSocialPostSchema.parse(req.body);
      const post = await announcementService.createSocialPost(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: post });
    } catch (err) {
      next(err);
    }
  }

  async toggleLike(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await announcementService.toggleLike(req.params.id, req.user!.userId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async createComment(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createSocialCommentSchema.parse(req.body);
      const comment = await announcementService.createComment(req.params.id, req.user!.userId, data);
      res.status(201).json({ success: true, data: comment });
    } catch (err) {
      next(err);
    }
  }

  async deleteSocialPost(req: Request, res: Response, next: NextFunction) {
    try {
      await announcementService.deleteSocialPost(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: null, message: 'Post deleted' });
    } catch (err) {
      next(err);
    }
  }

  async deleteComment(req: Request, res: Response, next: NextFunction) {
    try {
      await announcementService.deleteComment(req.params.commentId as string, req.params.id);
      res.json({ success: true, data: null, message: 'Comment deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const announcementController = new AnnouncementController();
