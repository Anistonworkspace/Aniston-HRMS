import { prisma } from '../../lib/prisma.js';
import { emitToOrg } from '../../sockets/index.js';
import type { CreateAnnouncementInput, UpdateAnnouncementInput, CreateSocialPostInput, CreateSocialCommentInput } from './announcement.validation.js';

// Helper to look up user display info
const userSelect = { id: true, email: true, employee: { select: { firstName: true, lastName: true, avatar: true } } };

export class AnnouncementService {
  async list(organizationId: string) {
    const announcements = await prisma.announcement.findMany({
      where: {
        organizationId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Enrich with author info
    const userIds = [...new Set(announcements.map(a => a.createdBy))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: userSelect });
    const userMap = new Map(users.map(u => [u.id, u]));

    return announcements.map(a => ({
      ...a,
      author: userMap.get(a.createdBy) || null,
    }));
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

  async update(id: string, data: UpdateAnnouncementInput) {
    const announcement = await prisma.announcement.update({
      where: { id },
      data: { ...data, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined },
    });
    return announcement;
  }

  async delete(id: string) {
    await prisma.announcement.delete({ where: { id } });
  }

  // ==================
  // SOCIAL WALL
  // ==================

  async listSocialPosts(organizationId: string, userId: string) {
    const posts = await prisma.socialPost.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        comments: { orderBy: { createdAt: 'asc' }, take: 20 },
        likes: { where: { userId }, select: { id: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    // Enrich posts and comments with author info
    const authorIds = new Set<string>();
    posts.forEach(p => {
      authorIds.add(p.authorId);
      p.comments.forEach(c => authorIds.add(c.authorId));
    });
    const users = await prisma.user.findMany({ where: { id: { in: [...authorIds] } }, select: userSelect });
    const userMap = new Map(users.map(u => [u.id, u]));

    return posts.map(p => ({
      ...p,
      author: userMap.get(p.authorId) || null,
      likedByMe: p.likes.length > 0,
      likes: undefined, // strip raw likes array
      comments: p.comments.map(c => ({
        ...c,
        author: userMap.get(c.authorId) || null,
      })),
    }));
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
    const existing = await prisma.socialLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) {
      await prisma.socialLike.delete({ where: { id: existing.id } });
      await prisma.socialPost.update({ where: { id: postId }, data: { likesCount: { decrement: 1 } } });
      return { liked: false };
    } else {
      await prisma.socialLike.create({ data: { postId, userId } });
      await prisma.socialPost.update({ where: { id: postId }, data: { likesCount: { increment: 1 } } });
      return { liked: true };
    }
  }

  async createComment(postId: string, userId: string, data: CreateSocialCommentInput) {
    const comment = await prisma.socialComment.create({
      data: { postId, authorId: userId, content: data.content },
    });
    await prisma.socialPost.update({ where: { id: postId }, data: { commentsCount: { increment: 1 } } });

    const author = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });

    return { ...comment, author };
  }

  async deleteComment(commentId: string, postId: string) {
    await prisma.socialComment.delete({ where: { id: commentId } });
    await prisma.socialPost.update({ where: { id: postId }, data: { commentsCount: { decrement: 1 } } });
  }

  async deleteSocialPost(postId: string) {
    await prisma.socialPost.delete({ where: { id: postId } });
  }
}

export const announcementService = new AnnouncementService();
