import { prisma } from '../../lib/prisma.js';
import { createAuditLog } from '../../utils/auditLogger.js';
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

  async updateOrganization(organizationId: string, data: UpdateOrganizationInput, userId?: string) {
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data,
    });

    if (userId) {
      await createAuditLog({
        userId,
        organizationId,
        entity: 'Organization',
        entityId: organizationId,
        action: 'UPDATE',
        newValue: data,
      });
    }

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

  // ==================
  // EMAIL CONFIG
  // ==================

  async getEmailConfig(organizationId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const email = settings.email || {};
    // Never expose password to frontend
    return {
      host: email.host || '',
      port: email.port || 587,
      user: email.user || '',
      hasPassword: !!email.pass,
      fromAddress: email.fromAddress || '',
      fromName: email.fromName || '',
      configured: !!(email.host && email.user && email.pass),
    };
  }

  async saveEmailConfig(organizationId: string, config: { host: string; port: number; user: string; pass?: string; fromAddress: string; fromName: string }, userId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const existingSettings = (org?.settings as any) || {};
    const existingEmail = existingSettings.email || {};

    const emailConfig: any = {
      host: config.host,
      port: config.port,
      user: config.user,
      pass: config.pass || existingEmail.pass || '',
      fromAddress: config.fromAddress,
      fromName: config.fromName,
    };

    await prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...existingSettings, email: emailConfig } },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'EmailConfig',
      entityId: organizationId,
      action: 'UPDATE',
      newValue: { host: config.host, port: config.port, user: config.user, fromAddress: config.fromAddress },
    });

    return { success: true };
  }

  async testEmailConnection(organizationId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const email = settings.email;

    if (!email?.host || !email?.user || !email?.pass) {
      return { success: false, message: 'Email not configured. Please save SMTP settings first.' };
    }

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: email.host,
        port: email.port || 587,
        secure: email.port === 465,
        auth: { user: email.user, pass: email.pass },
      });
      await transporter.verify();
      return { success: true, message: 'Connection successful! SMTP server is reachable.' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err.message}` };
    }
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
