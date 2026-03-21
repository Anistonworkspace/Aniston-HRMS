import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

const announcementSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(5),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  targetDepartments: z.array(z.string()).default([]),
  targetRoles: z.array(z.string()).default([]),
  expiresAt: z.string().optional(),
});

// List announcements
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const announcements = await prisma.announcement.findMany({
      where: {
        organizationId: req.user!.organizationId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: announcements });
  } catch (err) { next(err); }
});

// Create announcement
router.post('/', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = announcementSchema.parse(req.body);
    const announcement = await prisma.announcement.create({
      data: {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        publishedAt: new Date(),
        createdBy: req.user!.userId,
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: announcement, message: 'Announcement published' });
  } catch (err) { next(err); }
});

// Update
router.patch('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = announcementSchema.partial().parse(req.body);
    const announcement = await prisma.announcement.update({
      where: { id: req.params.id },
      data: { ...data, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined },
    });
    res.json({ success: true, data: announcement });
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: null, message: 'Announcement deleted' });
  } catch (err) { next(err); }
});

// ==================
// SOCIAL WALL
// ==================

router.get('/social', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const posts = await prisma.socialPost.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        comments: { orderBy: { createdAt: 'asc' }, take: 5 },
        _count: { select: { comments: true, likes: true } },
      },
    });
    res.json({ success: true, data: posts });
  } catch (err) { next(err); }
});

router.post('/social', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, imageUrl, postType } = req.body;
    const post = await prisma.socialPost.create({
      data: {
        authorId: req.user!.userId,
        content,
        imageUrl: imageUrl || null,
        postType: postType || 'GENERAL',
        organizationId: req.user!.organizationId,
      },
    });
    res.status(201).json({ success: true, data: post });
  } catch (err) { next(err); }
});

router.post('/social/:id/like', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.socialLike.findUnique({
      where: { postId_userId: { postId: req.params.id, userId: req.user!.userId } },
    });
    if (existing) {
      await prisma.socialLike.delete({ where: { id: existing.id } });
      await prisma.socialPost.update({ where: { id: req.params.id }, data: { likesCount: { decrement: 1 } } });
      res.json({ success: true, data: { liked: false } });
    } else {
      await prisma.socialLike.create({ data: { postId: req.params.id, userId: req.user!.userId } });
      await prisma.socialPost.update({ where: { id: req.params.id }, data: { likesCount: { increment: 1 } } });
      res.json({ success: true, data: { liked: true } });
    }
  } catch (err) { next(err); }
});

router.post('/social/:id/comment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    const comment = await prisma.socialComment.create({
      data: { postId: req.params.id, authorId: req.user!.userId, content },
    });
    await prisma.socialPost.update({ where: { id: req.params.id }, data: { commentsCount: { increment: 1 } } });
    res.status(201).json({ success: true, data: comment });
  } catch (err) { next(err); }
});

export { router as announcementRouter };
