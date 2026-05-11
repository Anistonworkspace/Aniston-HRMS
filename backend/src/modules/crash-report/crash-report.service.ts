import { prisma } from '../../lib/prisma.js';

export const crashReportService = {
  async create(data: {
    type: string;
    message: string;
    stack?: string;
    context?: string;
    appVersion?: string;
    platform?: string;
    osVersion?: string;
    device?: string;
    employeeId?: string;
    organizationId: string;
    ipAddress?: string;
  }) {
    return prisma.crashReport.create({ data });
  },

  async list(organizationId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const where = { organizationId };
    const [items, total] = await Promise.all([
      prisma.crashReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        },
      }),
      prisma.crashReport.count({ where }),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  async stats(organizationId: string) {
    const [total, byType, last24h, last7d] = await Promise.all([
      prisma.crashReport.count({ where: { organizationId } }),
      prisma.crashReport.groupBy({
        by: ['type'],
        where: { organizationId },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.crashReport.count({
        where: {
          organizationId,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.crashReport.count({
        where: {
          organizationId,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);
    return { total, byType, last24h, last7d };
  },

  async remove(id: string, organizationId: string) {
    return prisma.crashReport.delete({ where: { id, organizationId } });
  },

  async clearAll(organizationId: string) {
    return prisma.crashReport.deleteMany({ where: { organizationId } });
  },
};
