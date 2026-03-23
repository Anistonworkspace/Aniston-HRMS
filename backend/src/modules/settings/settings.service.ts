import { prisma } from '../../lib/prisma.js';
import type { UpdateOrganizationInput, CreateLocationInput, UpdateLocationInput, AuditLogQuery } from './settings.validation.js';

export class SettingsService {
  async getOrganization(organizationId: string) {
    const org = await prisma.organization.findFirst({
      where: { id: organizationId },
      include: {
        officeLocations: true,
        _count: {
          select: { employees: true, departments: true, designations: true },
        },
      },
    });
    return org;
  }

  async updateOrganization(organizationId: string, data: UpdateOrganizationInput) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data,
    });
    return org;
  }

  async listLocations(organizationId: string) {
    const locations = await prisma.officeLocation.findMany({
      where: { organizationId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    });
    return locations;
  }

  async createLocation(data: CreateLocationInput, organizationId: string) {
    const location = await prisma.officeLocation.create({
      data: { ...data, organizationId },
    });
    return location;
  }

  async updateLocation(id: string, data: UpdateLocationInput) {
    const location = await prisma.officeLocation.update({
      where: { id },
      data,
    });
    return location;
  }

  async deleteLocation(id: string) {
    await prisma.officeLocation.delete({ where: { id } });
  }

  async listAuditLogs(query: AuditLogQuery, organizationId: string) {
    const { page, limit, entity } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };
    if (entity) where.entity = entity;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
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

  getSystemInfo() {
    return {
      version: '1.0.0',
      nodeVersion: process.version,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      platform: process.platform,
    };
  }
}

export const settingsService = new SettingsService();
