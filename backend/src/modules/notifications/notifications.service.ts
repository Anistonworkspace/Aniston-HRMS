import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';

export class NotificationsService {
  async list(userId: string, organizationId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId, organizationId } }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: notifications,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async unreadCount(userId: string, organizationId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, organizationId, isRead: false },
    });
  }

  async markRead(id: string, userId: string, organizationId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id, userId, organizationId },
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    return prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string, organizationId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, organizationId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }
}

export const notificationsService = new NotificationsService();
