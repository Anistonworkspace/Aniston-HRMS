import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { validateConnection, getClientCredentialsToken, getOrganizationUsers } from '../../lib/microsoftGraph.js';
import { enqueueEmail } from '../../jobs/queues.js';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import type { UpdateOrganizationInput, CreateLocationInput, UpdateLocationInput, AuditLogQuery, TeamsConfigInput } from './settings.validation.js';

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

  async updateLocation(id: string, data: UpdateLocationInput, organizationId: string) {
    const existing = await prisma.officeLocation.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Office location');
    const location = await prisma.officeLocation.update({
      where: { id },
      data,
    });
    return location;
  }

  async deleteLocation(id: string, organizationId: string) {
    const existing = await prisma.officeLocation.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Office location');
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
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true, payrollEmail: true } });
    const settings = (org?.settings as any) || {};
    const email = settings.email || {};
    // Never expose secrets to frontend
    return {
      authMethod: email.authMethod || 'smtp',
      // SMTP fields
      host: email.host || '',
      port: email.port || 587,
      user: email.user || '',
      hasPassword: !!email.pass,
      fromAddress: email.fromAddress || '',
      fromName: email.fromName || '',
      emailDomain: email.emailDomain || '',
      // OAuth2 fields
      tenantId: email.tenantId || '',
      clientId: email.clientId || '',
      hasClientSecret: !!email.clientSecret,
      senderEmail: email.senderEmail || '',
      // Payroll
      payrollEmail: org?.payrollEmail || '',
      // Status
      configured: email.authMethod === 'oauth2'
        ? !!(email.tenantId && email.clientId && email.clientSecret && email.senderEmail)
        : !!(email.host && email.user && email.pass),
    };
  }

  async saveEmailConfig(organizationId: string, config: any, userId: string) {
    // Validate email config fields before saving
    const emailConfigSchema = z.object({
      authMethod: z.enum(['smtp', 'oauth2']).default('smtp'),
      host: z.string().optional().default(''),
      port: z.coerce.number().min(1).max(65535).optional().default(587),
      user: z.string().optional().default(''),
      pass: z.string().optional().default(''),
      fromAddress: z.string().email('Invalid "From" email address').optional().or(z.literal('')).default(''),
      fromName: z.string().max(100).optional().default(''),
      emailDomain: z.string().optional().default(''),
      tenantId: z.string().optional().default(''),
      clientId: z.string().optional().default(''),
      clientSecret: z.string().optional().default(''),
      senderEmail: z.string().email('Invalid sender email address').optional().or(z.literal('')).default(''),
    }).superRefine((data, ctx) => {
      if (data.authMethod === 'smtp') {
        if (data.host && !data.user) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SMTP username is required when host is provided', path: ['user'] });
        if (data.host && !data.pass) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SMTP password is required when host is provided', path: ['pass'] });
      } else if (data.authMethod === 'oauth2') {
        if (!data.tenantId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tenant ID is required for OAuth2', path: ['tenantId'] });
        if (!data.clientId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Client ID is required for OAuth2', path: ['clientId'] });
        if (!data.clientSecret) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Client Secret is required for OAuth2', path: ['clientSecret'] });
        if (!data.senderEmail) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Sender email is required for OAuth2', path: ['senderEmail'] });
      }
    });

    const parsed = emailConfigSchema.safeParse(config);
    if (!parsed.success) {
      const messages = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new BadRequestError(`Invalid email configuration: ${messages}`);
    }

    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const existingSettings = (org?.settings as any) || {};
    const existingEmail = existingSettings.email || {};

    const emailConfig: any = {
      authMethod: parsed.data.authMethod,
      // SMTP fields
      host: parsed.data.host || existingEmail.host || '',
      port: parsed.data.port || existingEmail.port || 587,
      user: parsed.data.user || existingEmail.user || '',
      pass: parsed.data.pass || existingEmail.pass || '',
      fromAddress: parsed.data.fromAddress || existingEmail.fromAddress || '',
      fromName: parsed.data.fromName || existingEmail.fromName || '',
      emailDomain: parsed.data.emailDomain || existingEmail.emailDomain || '',
      // OAuth2 fields
      tenantId: parsed.data.tenantId || existingEmail.tenantId || '',
      clientId: parsed.data.clientId || existingEmail.clientId || '',
      clientSecret: parsed.data.clientSecret || existingEmail.clientSecret || '',
      senderEmail: parsed.data.senderEmail || existingEmail.senderEmail || '',
    };

    // Also save payrollEmail if provided (stored on Organization model directly)
    const updateData: any = { settings: { ...existingSettings, email: emailConfig } };
    if (config.payrollEmail !== undefined) {
      updateData.payrollEmail = config.payrollEmail || null;
    }

    await prisma.organization.update({
      where: { id: organizationId },
      data: updateData,
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'EmailConfig',
      entityId: organizationId,
      action: 'UPDATE',
      newValue: { authMethod: emailConfig.authMethod, host: config.host, user: config.user, fromAddress: config.fromAddress, senderEmail: config.senderEmail, payrollEmail: config.payrollEmail },
    });

    return { success: true };
  }

  async testEmailConnection(organizationId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const email = settings.email;

    if (!email) {
      return { success: false, message: 'Email not configured. Please save settings first.' };
    }

    if (email.authMethod === 'oauth2') {
      // Test Microsoft 365 OAuth2 connection
      if (!email.tenantId || !email.clientId || !email.clientSecret) {
        return { success: false, message: 'OAuth2 config incomplete. Provide Tenant ID, Client ID, and Client Secret.' };
      }

      try {
        const tokenUrl = `https://login.microsoftonline.com/${email.tenantId}/oauth2/v2.0/token`;
        const body = new URLSearchParams({
          client_id: email.clientId,
          client_secret: email.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        });

        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error_description: 'Unknown error' }));
          return { success: false, message: `OAuth2 failed: ${err.error_description || err.error || 'Invalid credentials'}` };
        }

        return { success: true, message: `OAuth2 connection successful! Emails will be sent from ${email.senderEmail || email.fromAddress} via Microsoft 365.` };
      } catch (err: any) {
        return { success: false, message: `Connection failed: ${err.message}` };
      }
    }

    // Test SMTP connection
    if (!email.host || !email.user || !email.pass) {
      return { success: false, message: 'SMTP not configured. Please save settings first.' };
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
      return { success: true, message: 'SMTP connection successful! Server is reachable.' };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  async testAdminNotificationEmail(organizationId: string) {
    const org = await prisma.organization.findFirst({
      where: { id: organizationId },
      select: { adminNotificationEmail: true, name: true },
    });

    if (!org?.adminNotificationEmail) {
      return { success: false, message: 'Admin notification email is not configured. Please set it in Organization settings first.' };
    }

    try {
      await enqueueEmail({
        to: org.adminNotificationEmail,
        subject: `[Test] Admin Notification Email - ${org.name || 'Aniston HRMS'}`,
        template: 'generic',
        context: {
          title: 'Test Notification',
          message: `This is a test email to verify that the admin notification email (<strong>${org.adminNotificationEmail}</strong>) is correctly configured for <strong>${org.name || 'your organization'}</strong>.<br><br>If you received this email, the admin notification system is working properly.<br><br>— Aniston HRMS`,
        },
      });
      return { success: true, message: `Test email queued for delivery to ${org.adminNotificationEmail}` };
    } catch (err: any) {
      return { success: false, message: `Failed to queue test email: ${err.message}` };
    }
  }

  // ==================
  // TEAMS CONFIG
  // ==================

  async getTeamsConfig(organizationId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const teams = settings.microsoftTeams || {};
    return {
      tenantId: teams.tenantId || '',
      clientId: teams.clientId || '',
      hasClientSecret: !!teams.clientSecret,
      redirectUri: teams.redirectUri || `${env.API_URL}/api/auth/microsoft/callback`,
      ssoEnabled: !!teams.ssoEnabled,
      configured: !!(teams.tenantId && teams.clientId && teams.clientSecret),
      connectionVerified: !!teams.connectionVerified,
      connectionVerifiedAt: teams.connectionVerifiedAt || null,
    };
  }

  async saveTeamsConfig(organizationId: string, config: TeamsConfigInput, userId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const existingSettings = (org?.settings as any) || {};
    const existingTeams = existingSettings.microsoftTeams || {};

    const teamsConfig: any = {
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret ? encrypt(config.clientSecret) : existingTeams.clientSecret || '',
      redirectUri: config.redirectUri || existingTeams.redirectUri || '',
      ssoEnabled: config.ssoEnabled,
      connectionVerified: existingTeams.connectionVerified || false,
      connectionVerifiedAt: existingTeams.connectionVerifiedAt || null,
    };

    await prisma.organization.update({
      where: { id: organizationId },
      data: { settings: { ...existingSettings, microsoftTeams: teamsConfig } },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'TeamsConfig',
      entityId: organizationId,
      action: 'UPDATE',
      newValue: { tenantId: config.tenantId, clientId: config.clientId, ssoEnabled: config.ssoEnabled },
    });

    return { success: true };
  }

  async testTeamsConnection(organizationId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const teams = settings.microsoftTeams;

    if (!teams?.tenantId || !teams?.clientId || !teams?.clientSecret) {
      return { success: false, message: 'Microsoft Teams not configured. Please save your Azure AD credentials first.' };
    }

    try {
      const clientSecret = decrypt(teams.clientSecret);
      const result = await validateConnection(teams.tenantId, teams.clientId, clientSecret);

      // Persist connection verification status
      const updatedTeams = {
        ...teams,
        connectionVerified: result.success,
        connectionVerifiedAt: result.success ? new Date().toISOString() : null,
      };
      await prisma.organization.update({
        where: { id: organizationId },
        data: { settings: { ...settings, microsoftTeams: updatedTeams } },
      });

      return result;
    } catch (err: any) {
      // Mark as not verified on error
      const updatedTeams = { ...teams, connectionVerified: false, connectionVerifiedAt: null };
      await prisma.organization.update({
        where: { id: organizationId },
        data: { settings: { ...settings, microsoftTeams: updatedTeams } },
      });
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  async syncEmployeesFromTeams(organizationId: string, userId: string) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const settings = (org?.settings as any) || {};
    const teams = settings.microsoftTeams;

    if (!teams?.tenantId || !teams?.clientId || !teams?.clientSecret) {
      throw new Error('Microsoft Teams not configured. Please save your Azure AD credentials first.');
    }

    const clientSecret = decrypt(teams.clientSecret);
    const accessToken = await getClientCredentialsToken(teams.tenantId, teams.clientId, clientSecret);
    const azureUsers = await getOrganizationUsers(accessToken);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Get existing employee count for code generation
    const existingCount = await prisma.employee.count({ where: { organizationId } });
    let nextCode = existingCount + 1;

    for (const azUser of azureUsers) {
      const email = (azUser.mail || azUser.userPrincipalName || '').toLowerCase();
      if (!email || email.includes('#EXT#')) { skipped++; continue; } // Skip external/guest users

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { microsoftId: azUser.id }] },
      });
      if (existingUser) { skipped++; continue; }

      try {
        // Split displayName into first/last
        const parts = (azUser.displayName || email.split('@')[0]).split(' ');
        const firstName = parts[0] || 'Unknown';
        const lastName = parts.slice(1).join(' ') || '';

        // Generate employee code
        const employeeCode = `EMP-${String(nextCode).padStart(3, '0')}`;
        nextCode++;

        // Generate temp password
        const tempPassword = await bcrypt.hash(`Welcome@${new Date().getFullYear()}`, 12);

        // Find matching department if Azure AD has one
        let departmentId: string | null = null;
        if (azUser.department) {
          const dept = await prisma.department.findFirst({
            where: { name: { equals: azUser.department, mode: 'insensitive' }, organizationId },
          });
          departmentId = dept?.id || null;
        }

        // Create user + employee in transaction
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email,
              passwordHash: tempPassword,
              role: 'EMPLOYEE',
              status: 'ACTIVE',
              microsoftId: azUser.id,
              authProvider: 'microsoft',
              organizationId,
            },
          });

          await tx.employee.create({
            data: {
              employeeCode,
              userId: user.id,
              firstName,
              lastName,
              email,
              phone: '',
              gender: 'PREFER_NOT_TO_SAY',
              departmentId,
              workMode: 'OFFICE',
              joiningDate: new Date(),
              status: 'ACTIVE',
              organizationId,
            },
          });
        });

        imported++;
      } catch (err: any) {
        errors.push(`${email}: ${err.message}`);
      }
    }

    // Audit log
    await createAuditLog({
      userId,
      organizationId,
      entity: 'TeamsSync',
      entityId: organizationId,
      action: 'CREATE',
      newValue: { imported, skipped, errors: errors.length },
    });

    return { imported, skipped, total: azureUsers.length, errors };
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
