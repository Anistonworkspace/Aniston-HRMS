import { prisma } from '../../lib/prisma.js';
import { emitToOrg } from '../../sockets/index.js';
import { NotFoundError, AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../lib/logger.js';
import type { CreateAnnouncementInput, UpdateAnnouncementInput, CreateSocialPostInput, CreateSocialCommentInput, ListAnnouncementsQuery, ListSocialPostsQuery } from './announcement.validation.js';

// Helper to look up user display info
const userSelect = { id: true, email: true, employee: { select: { firstName: true, lastName: true, avatar: true } } };

export class AnnouncementService {
  async list(organizationId: string, query: ListAnnouncementsQuery = { page: 1, limit: 20 }) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;
    const where = {
      organizationId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } },
      ],
    };

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.announcement.count({ where }),
    ]);

    // Enrich with author info
    const userIds = [...new Set(announcements.map(a => a.createdBy))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: userSelect })
      .catch((err: any) => { logger.warn('[Announcement] Failed to fetch authors:', err.message); return []; });
    const userMap = new Map(users.map(u => [u.id, u]));

    return {
      data: announcements.map(a => ({
        ...a,
        author: userMap.get(a.createdBy) || null,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async create(data: CreateAnnouncementInput, organizationId: string, userId: string) {
    const announcement = await prisma.announcement.create({
      data: {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        publishedAt: new Date(),
        createdBy: userId,
        organizationId,
      },
    });

    // Get author for response
    const author = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });

    emitToOrg(organizationId, 'announcement:new', { id: announcement.id, title: announcement.title });

    return { ...announcement, author };
  }

  async update(id: string, data: UpdateAnnouncementInput, organizationId: string) {
    const existing = await prisma.announcement.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Announcement');
    const announcement = await prisma.announcement.update({
      where: { id },
      data: { ...data, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined },
    });
    return announcement;
  }

  async delete(id: string, organizationId: string) {
    const existing = await prisma.announcement.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Announcement');
    await prisma.announcement.delete({ where: { id } });
  }

  // ==================
  // SOCIAL WALL
  // ==================

  async listSocialPosts(organizationId: string, userId: string, query: ListSocialPostsQuery = { page: 1, limit: 20 }) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;
    const where = { organizationId };

    const [posts, total] = await Promise.all([
      prisma.socialPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          comments: { orderBy: { createdAt: 'asc' }, take: 20 },
          likes: { where: { userId }, select: { id: true } },
          _count: { select: { comments: true, likes: true } },
        },
      }),
      prisma.socialPost.count({ where }),
    ]);

    // Enrich posts and comments with author info
    const authorIds = new Set<string>();
    posts.forEach(p => {
      authorIds.add(p.authorId);
      p.comments.forEach(c => authorIds.add(c.authorId));
    });
    const users = await prisma.user.findMany({ where: { id: { in: [...authorIds] } }, select: userSelect })
      .catch((err: any) => { logger.warn('[Announcement] Failed to fetch post authors:', err.message); return []; });
    const userMap = new Map(users.map(u => [u.id, u]));

    return {
      data: posts.map(p => ({
        ...p,
        author: userMap.get(p.authorId) || null,
        likedByMe: p.likes.length > 0,
        likes: undefined, // strip raw likes array
        comments: p.comments.map(c => ({
          ...c,
          author: userMap.get(c.authorId) || null,
        })),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async createSocialPost(data: CreateSocialPostInput, organizationId: string, userId: string) {
    const post = await prisma.socialPost.create({
      data: {
        authorId: userId,
        content: data.content,
        imageUrl: data.imageUrl || null,
        postType: data.postType || 'GENERAL',
        organizationId,
      },
    });

    const author = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });

    emitToOrg(organizationId, 'social:new_post', { id: post.id });

    return { ...post, author };
  }

  async toggleLike(postId: string, userId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.socialLike.findUnique({
          where: { postId_userId: { postId, userId } },
        });
        if (existing) {
          await tx.socialLike.delete({ where: { id: existing.id } });
          await tx.socialPost.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } });
          return { liked: false };
        } else {
          await tx.socialLike.create({ data: { postId, userId } });
          await tx.socialPost.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } });
          return { liked: true };
        }
      });
    } catch (err: any) {
      logger.error(`[Announcement] toggleLike() failed for post ${postId}: ${err.message}`);
      throw new AppError('Failed to update like. Please try again.', 500, 'TRANSACTION_FAILED');
    }
  }

  async createComment(postId: string, userId: string, data: CreateSocialCommentInput) {
    try {
      const [comment] = await prisma.$transaction(async (tx) => {
        const newComment = await tx.socialComment.create({
          data: { postId, authorId: userId, content: data.content },
        });
        await tx.socialPost.update({ where: { id: postId }, data: { commentsCount: { increment: 1 } } });
        return [newComment];
      });
      const author = await prisma.user.findUnique({ where: { id: userId }, select: userSelect })
        .catch(() => null);
      return { ...comment, author };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error(`[Announcement] createComment() failed for post ${postId}: ${err.message}`);
      throw new AppError('Failed to add comment. Please try again.', 500, 'TRANSACTION_FAILED');
    }
  }

  async deleteComment(commentId: string, postId: string) {
    await prisma.socialComment.delete({ where: { id: commentId } });
    await prisma.socialPost.update({ where: { id: postId }, data: { commentsCount: { decrement: 1 } } });
  }

  async deleteSocialPost(postId: string, organizationId: string) {
    const existing = await prisma.socialPost.findFirst({ where: { id: postId, organizationId } });
    if (!existing) throw new NotFoundError('Social post');
    await prisma.socialPost.delete({ where: { id: postId } });
  }
}

export const announcementService = new AnnouncementService();
