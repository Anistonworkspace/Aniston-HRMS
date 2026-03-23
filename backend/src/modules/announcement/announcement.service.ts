import { prisma } from '../../lib/prisma.js';
import type { CreateAnnouncementInput, UpdateAnnouncementInput, CreateSocialPostInput, CreateSocialCommentInput } from './announcement.validation.js';

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
    return announcements;
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
    return announcement;
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

  async listSocialPosts(organizationId: string) {
    const posts = await prisma.socialPost.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        comments: { orderBy: { createdAt: 'asc' }, take: 5 },
        _count: { select: { comments: true, likes: true } },
      },
    });
    return posts;
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
    return post;
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
    return comment;
  }
}

export const announcementService = new AnnouncementService();
