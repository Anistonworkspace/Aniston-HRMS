import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { generateEmployeeCode } from '../../utils/employeeCode.js';
import { whatsAppService } from '../whatsapp/whatsapp.service.js';
import { logger } from '../../lib/logger.js';
import type { CreateInvitationInput } from './invitation.validation.js';

/**
 * InvitationService — token-based employee invitation flow.
 *
 * Lifecycle:
 * 1. HR/Admin calls `createInvitation` → generates a UUID token, stores `EmployeeInvitation`
 *    with PENDING status and 72-hour expiry, sends an email via BullMQ.
 * 2. Candidate opens `/onboarding/invite/:token` → `validateToken` is called to check
 *    validity and return org info.
 * 3. Candidate sets password → `completeInvitation` creates `User` + `Employee`
 *    in a Prisma transaction, marks invitation ACCEPTED.
 * 4. User is redirected to /login → after login, onboarding gate redirects to
 *    the self-onboarding wizard until profile is complete.
 */
export class InvitationService {
  /**
   * Create a new employee invitation and send the invite email.
   */
  async createInvitation(input: CreateInvitationInput, organizationId: string, invitedBy: string) {
    const { email, mobileNumber, role, departmentId, designationId } = input;

    // Check for existing pending invitation
    if (email) {
      const existing = await prisma.employeeInvitation.findFirst({
        where: { organizationId, email, status: 'PENDING' },
      });
      if (existing) {
        throw new BadRequestError('A pending invitation already exists for this email');
      }

      // Check if employee already exists
      const existingEmployee = await prisma.employee.findFirst({
        where: { email: email.toLowerCase(), organizationId, deletedAt: null },
      });
      if (existingEmployee) {
        throw new BadRequestError('An employee with this email already exists');
      }
    }

    // Validate department and designation if provided
    if (departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: departmentId, organizationId, deletedAt: null },
      });
      if (!dept) throw new BadRequestError('Department not found');
    }
    if (designationId) {
      const desig = await prisma.designation.findFirst({
        where: { id: designationId, organizationId, deletedAt: null },
      });
      if (!desig) throw new BadRequestError('Designation not found');
    }

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    const invitation = await prisma.employeeInvitation.create({
      data: {
        organizationId,
        email: email?.toLowerCase() || null,
        mobileNumber: mobileNumber || null,
        role: role || 'EMPLOYEE',
        departmentId: departmentId || null,
        designationId: designationId || null,
        invitedBy,
        expiresAt,
      },
    });

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, logo: true },
    });

    // Fetch inviter details for the email
    const inviter = await prisma.user.findUnique({
      where: { id: invitedBy },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    const inviterName = inviter?.employee
      ? `${inviter.employee.firstName} ${inviter.employee.lastName}`
      : inviter?.email || 'HR Team';

    const inviteUrl = `https://hr.anistonav.com/onboarding/invite/${invitation.inviteToken}`;
    const downloadUrl = `https://hr.anistonav.com/download`;

    // Send email invitation
    if (email) {
      await enqueueEmail({
        to: email,
        subject: `You're invited to join ${org?.name || 'Aniston HRMS'}`,
        template: 'employee-invite',
        context: {
          orgName: org?.name || 'Aniston Technologies',
          inviteUrl,
          downloadUrl,
          expiresAt: expiresAt.toISOString(),
          inviterName,
          role: role || 'EMPLOYEE',
        },
      });
    }

    // Send WhatsApp invitation (best-effort)
    if (invitation.mobileNumber) {
      try {
        await whatsAppService.sendMessage({
          to: invitation.mobileNumber,
          message: `Hi! You're invited to join ${org?.name || 'Aniston HRMS'} on Aniston HRMS.\n\nClick here to accept: ${inviteUrl}\n\nThis link expires in 72 hours.`,
        }, organizationId);
      } catch (err) {
        logger.error('Failed to send WhatsApp invite:', err);
      }
    }

    // Audit log
    await createAuditLog({
      userId: invitedBy,
      organizationId,
      entity: 'EmployeeInvitation',
      entityId: invitation.id,
      action: 'CREATE',
      newValue: { email, mobileNumber, role, departmentId, designationId },
    });

    return {
      id: invitation.id,
      inviteToken: invitation.inviteToken,
      inviteUrl,
      email,
      mobileNumber,
      role,
      expiresAt,
      status: invitation.status,
    };
  }

  /**
   * Validate an invitation token — public endpoint, no auth required.
   */
  async validateToken(token: string) {
    const invitation = await prisma.employeeInvitation.findUnique({
      where: { inviteToken: token },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    if (invitation.status === 'ACCEPTED') {
      return { valid: false, reason: 'already_accepted', status: 'ACCEPTED' };
    }

    if (invitation.status === 'EXPIRED' || new Date() > invitation.expiresAt) {
      if (invitation.status !== 'EXPIRED') {
        await prisma.employeeInvitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' },
        });
      }
      return { valid: false, reason: 'expired', status: 'EXPIRED' };
    }

    const org = await prisma.organization.findUnique({
      where: { id: invitation.organizationId },
      select: { name: true, logo: true },
    });

    return {
      valid: true,
      status: 'PENDING',
      email: invitation.email,
      mobileNumber: invitation.mobileNumber,
      role: invitation.role,
      organization: org,
    };
  }

  /**
   * Complete an invitation — create User + Employee, redirect user to login.
   *
   * After completion, user logs in normally → ProtectedRoute detects
   * onboardingComplete=false → redirects to onboarding wizard.
   */
  async completeInvitation(token: string, data: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
  }) {
    const invitation = await prisma.employeeInvitation.findUnique({
      where: { inviteToken: token },
    });

    if (!invitation) throw new NotFoundError('Invitation not found');
    if (invitation.status !== 'PENDING') throw new BadRequestError('Invitation is no longer valid');
    if (new Date() > invitation.expiresAt) throw new BadRequestError('Invitation has expired');

    const normalizedEmail = data.email.toLowerCase();

    // Check for existing user
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const assignedRole = (invitation.role as any) || 'EMPLOYEE';

    let result: { user: any; employee: any };

    if (existingUser) {
      // If user is ACTIVE with an active employee — block (real duplicate)
      if (existingUser.status === 'ACTIVE') {
        const activeEmployee = await prisma.employee.findFirst({
          where: { userId: existingUser.id, deletedAt: null },
        });
        if (activeEmployee) {
          throw new BadRequestError('A user with this email already exists');
        }
      }

      // Reactivate previously deleted user — update password, reset status
      // First unlink userId from any soft-deleted employee records (userId is unique)
      const employeeCode = await generateEmployeeCode(invitation.organizationId);

      result = await prisma.$transaction(async (tx) => {
        await tx.employee.updateMany({
          where: { userId: existingUser.id, deletedAt: { not: null } },
          data: { userId: null },
        });

        const user = await tx.user.update({
          where: { id: existingUser.id },
          data: {
            passwordHash,
            role: assignedRole,
            status: 'ACTIVE',
          },
        });

        const employee = await tx.employee.create({
          data: {
            employeeCode,
            userId: user.id,
            firstName: data.firstName,
            lastName: data.lastName,
            email: normalizedEmail,
            phone: data.phone || '0000000000',
            gender: 'PREFER_NOT_TO_SAY',
            workMode: 'OFFICE',
            joiningDate: new Date(),
            status: 'PROBATION',
            onboardingComplete: false,
            organizationId: invitation.organizationId,
            departmentId: invitation.departmentId || undefined,
            designationId: invitation.designationId || undefined,
          },
        });

        await tx.employeeInvitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), employeeId: employee.id },
        });

        return { user, employee };
      });
    } else {
      // Brand new user — create from scratch
      const employeeCode = await generateEmployeeCode(invitation.organizationId);

      result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: assignedRole,
            status: 'ACTIVE',
            organizationId: invitation.organizationId,
          },
        });

        const employee = await tx.employee.create({
          data: {
            employeeCode,
            userId: user.id,
            firstName: data.firstName,
            lastName: data.lastName,
            email: normalizedEmail,
            phone: data.phone || '0000000000',
            gender: 'PREFER_NOT_TO_SAY',
            workMode: 'OFFICE',
            joiningDate: new Date(),
            status: 'PROBATION',
            onboardingComplete: false,
            organizationId: invitation.organizationId,
            departmentId: invitation.departmentId || undefined,
            designationId: invitation.designationId || undefined,
          },
        });

        await tx.employeeInvitation.update({
          where: { id: invitation.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), employeeId: employee.id },
        });

        return { user, employee };
      });
    }

    // Audit log
    await createAuditLog({
      userId: result.user.id,
      organizationId: invitation.organizationId,
      entity: 'Employee',
      entityId: result.employee.id,
      action: 'CREATE',
      newValue: {
        employeeCode: result.employee.employeeCode,
        email: normalizedEmail,
        role: assignedRole,
        source: existingUser ? 'invitation-reactivated' : 'invitation',
      },
    });

    // Auto-login: generate tokens so frontend can skip the login page
    const { authService } = await import('../auth/auth.service.js');
    const userWithEmployee = await prisma.user.findUnique({
      where: { id: result.user.id },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, avatar: true,
            status: true, workMode: true, onboardingComplete: true,
            documentGate: { select: { kycStatus: true } },
          },
        },
      },
    });

    const accessToken = authService.generateAccessToken(userWithEmployee);
    const refreshToken = await authService.generateRefreshToken(result.user.id);

    const kycCompleted = userWithEmployee?.employee?.documentGate?.kycStatus === 'VERIFIED';

    return {
      employeeId: result.employee.id,
      employeeCode: result.employee.employeeCode,
      accessToken,
      refreshToken,
      user: {
        id: result.user.id,
        email: normalizedEmail,
        role: assignedRole,
        employeeId: result.employee.id,
        firstName: data.firstName,
        lastName: data.lastName,
        avatar: null,
        organizationId: invitation.organizationId,
        workMode: 'OFFICE',
        kycCompleted,
        onboardingComplete: false,
        featurePermissions: null,
        exitAccess: null,
      },
    };
  }

  /**
   * Create bulk invitations from a list of emails — used for migration / mass onboarding.
   */
  async createBulkInvitations(
    emails: string[],
    organizationId: string,
    invitedBy: string,
    options?: { role?: string; departmentId?: string; designationId?: string }
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const inviter = await prisma.user.findUnique({
      where: { id: invitedBy },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    const inviterName = inviter?.employee
      ? `${inviter.employee.firstName} ${inviter.employee.lastName}`
      : inviter?.email || 'HR Team';

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    let sentCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const rawEmail of emails) {
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        skippedCount++;
        continue;
      }

      try {
        // Check for existing pending invitation
        const existing = await prisma.employeeInvitation.findFirst({
          where: { organizationId, email, status: 'PENDING' },
        });
        if (existing) {
          skippedCount++;
          errors.push(`${email}: already has pending invitation`);
          continue;
        }

        // Check if employee already exists
        const existingEmployee = await prisma.employee.findFirst({
          where: { email, organizationId, deletedAt: null },
        });
        if (existingEmployee) {
          skippedCount++;
          errors.push(`${email}: employee already exists`);
          continue;
        }

        const invitation = await prisma.employeeInvitation.create({
          data: {
            organizationId,
            email,
            role: options?.role || 'EMPLOYEE',
            departmentId: options?.departmentId || null,
            designationId: options?.designationId || null,
            invitedBy,
            expiresAt,
          },
        });

        const inviteUrl = `https://hr.anistonav.com/onboarding/invite/${invitation.inviteToken}`;
        const downloadUrl = `https://hr.anistonav.com/download`;

        await enqueueEmail({
          to: email,
          subject: `You're invited to join ${org?.name || 'Aniston HRMS'}`,
          template: 'employee-invite',
          context: {
            orgName: org?.name || 'Aniston Technologies',
            inviteUrl,
            downloadUrl,
            expiresAt: expiresAt.toISOString(),
            inviterName,
            role: options?.role || 'EMPLOYEE',
          },
        });

        sentCount++;
      } catch (err: any) {
        skippedCount++;
        errors.push(`${email}: ${err.message}`);
      }
    }

    // Audit log
    await createAuditLog({
      userId: invitedBy,
      organizationId,
      entity: 'EmployeeInvitation',
      entityId: 'bulk',
      action: 'CREATE',
      newValue: { totalEmails: emails.length, sentCount, skippedCount, source: 'bulk' },
    });

    return { sentCount, skippedCount, totalRequested: emails.length, errors };
  }

  /**
   * List all invitations for an organization with pagination.
   */
  async listInvitations(organizationId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { organizationId };

    const [invitations, total] = await Promise.all([
      prisma.employeeInvitation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.employeeInvitation.count({ where }),
    ]);

    // Fetch inviter names
    const inviterIds = [...new Set(invitations.map(i => i.invitedBy))];
    const inviters = await prisma.user.findMany({
      where: { id: { in: inviterIds } },
      select: { id: true, email: true },
    });
    const inviterMap = Object.fromEntries(inviters.map(u => [u.id, u.email]));

    const data = invitations.map(inv => ({
      ...inv,
      invitedByEmail: inviterMap[inv.invitedBy] || 'Unknown',
      isExpired: inv.status === 'PENDING' && new Date() > inv.expiresAt,
    }));

    return {
      data,
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

  /**
   * Resend an invitation by regenerating the token and extending the expiry.
   */
  async resendInvitation(invitationId: string, organizationId: string, userId: string) {
    const invitation = await prisma.employeeInvitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!invitation) throw new NotFoundError('Invitation not found');
    if (invitation.status === 'ACCEPTED') throw new BadRequestError('Invitation already accepted');

    const newExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const updated = await prisma.employeeInvitation.update({
      where: { id: invitationId },
      data: {
        status: 'PENDING',
        expiresAt: newExpiresAt,
        inviteToken: crypto.randomUUID(),
      },
    });

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const inviteUrl = `https://hr.anistonav.com/onboarding/invite/${updated.inviteToken}`;
    const downloadUrl = `https://hr.anistonav.com/download`;

    if (invitation.email) {
      await enqueueEmail({
        to: invitation.email,
        subject: `Reminder: You're invited to join ${org?.name || 'Aniston HRMS'}`,
        template: 'employee-invite',
        context: {
          orgName: org?.name || 'Aniston Technologies',
          inviteUrl,
          downloadUrl,
          expiresAt: newExpiresAt.toISOString(),
          inviterName: 'HR Team',
          role: invitation.role || 'EMPLOYEE',
        },
      });
    }

    if (invitation.mobileNumber) {
      try {
        await whatsAppService.sendMessage({
          to: invitation.mobileNumber,
          message: `Hi! Reminder: You're invited to join ${org?.name || 'Aniston HRMS'} on Aniston HRMS.\n\nClick here to accept: ${inviteUrl}\n\nThis link expires in 72 hours.`,
        }, organizationId);
      } catch (err) {
        logger.error('Failed to send WhatsApp invite on resend:', err);
      }
    }

    return { success: true, inviteUrl, expiresAt: newExpiresAt };
  }

  /**
   * Delete an invitation (only if not yet accepted).
   */
  async deleteInvitation(invitationId: string, organizationId: string, userId: string) {
    const invitation = await prisma.employeeInvitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!invitation) throw new NotFoundError('Invitation not found');
    if (invitation.status === 'ACCEPTED') throw new BadRequestError('Cannot delete an accepted invitation');

    await prisma.employeeInvitation.delete({
      where: { id: invitationId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'EmployeeInvitation',
      entityId: invitationId,
      action: 'DELETE',
      oldValue: { email: invitation.email, mobileNumber: invitation.mobileNumber },
    });

    return { success: true };
  }
}

export const invitationService = new InvitationService();
