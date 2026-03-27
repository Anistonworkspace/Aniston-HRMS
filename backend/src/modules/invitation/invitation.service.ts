import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { generateEmployeeCode } from '../../utils/employeeCode.js';
import type { CreateInvitationInput } from './invitation.validation.js';

const ONBOARDING_PREFIX = 'onboarding:';
const ONBOARDING_TTL = 7 * 86400; // 7 days

/**
 * InvitationService — token-based employee invitation flow.
 *
 * Lifecycle:
 * 1. HR/Admin calls `createInvitation` → generates a UUID token, stores `EmployeeInvitation`
 *    with PENDING status and 72-hour expiry, sends an email via BullMQ.
 * 2. Candidate opens `/onboarding/invite/:token` → `validateToken` is called to check
 *    validity and return org info.
 * 3. Candidate submits their details → `completeInvitation` creates `User` + `Employee`
 *    in a Prisma transaction, marks invitation ACCEPTED, and issues a 7-day onboarding
 *    token in Redis for the self-onboarding wizard.
 *
 * Never instantiate directly — use the exported singleton `invitationService`.
 */
export class InvitationService {
  /**
   * Create a new employee invitation and send the invite email.
   *
   * - Rejects if a PENDING invitation already exists for the same email in this org.
   * - Rejects if an active employee record already exists for the email.
   * - Enqueues an `employee-invite` email template via BullMQ.
   * - Writes an audit log entry.
   *
   * @param input - Validated invite payload (`email` and/or `mobileNumber`).
   * @param organizationId - The org context.
   * @param invitedBy - User ID of the HR/Admin creating the invitation.
   * @returns Created invitation with `inviteToken` and `inviteUrl`.
   * @throws `BadRequestError` if a duplicate pending invite or existing employee is found.
   */
  async createInvitation(input: CreateInvitationInput, organizationId: string, invitedBy: string) {
    const { email, mobileNumber } = input;

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

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    const invitation = await prisma.employeeInvitation.create({
      data: {
        organizationId,
        email: email?.toLowerCase() || null,
        mobileNumber: mobileNumber || null,
        invitedBy,
        expiresAt,
      },
    });

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/onboarding/invite/${invitation.inviteToken}`;

    // Send email invitation
    if (email) {
      await enqueueEmail({
        to: email,
        subject: `You're invited to join ${org?.name || 'Aniston HRMS'}`,
        template: 'employee-invite',
        context: {
          orgName: org?.name || 'Aniston Technologies',
          inviteUrl,
          expiresAt: expiresAt.toISOString(),
        },
      });
    }

    // Audit log
    await createAuditLog({
      userId: invitedBy,
      organizationId,
      entity: 'EmployeeInvitation',
      entityId: invitation.id,
      action: 'CREATE',
      newValue: { email, mobileNumber },
    });

    return {
      id: invitation.id,
      inviteToken: invitation.inviteToken,
      inviteUrl,
      email,
      mobileNumber,
      expiresAt,
      status: invitation.status,
    };
  }

  /**
   * Validate an invitation token — public endpoint, no auth required.
   *
   * Auto-expires `PENDING` invitations that have passed their `expiresAt` timestamp.
   *
   * @param token - The UUID invite token from the email link.
   * @returns `{ valid: true, status, email, mobileNumber, organization }` if usable,
   *          or `{ valid: false, reason: 'already_accepted' | 'expired', status }`.
   * @throws `NotFoundError` if the token does not exist.
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
      // Mark as expired if not already
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
      organization: org,
    };
  }

  /**
   * Complete an invitation — create `User` + `Employee` records and start onboarding.
   *
   * Operations performed inside a single Prisma transaction:
   * 1. Create `User` with role `EMPLOYEE`, status `PENDING_VERIFICATION`.
   * 2. Create `Employee` with auto-generated employee code (`EMP-NNN`).
   * 3. Mark `EmployeeInvitation` as `ACCEPTED`.
   *
   * After the transaction, a 7-day onboarding session token is written to Redis
   * so the candidate can proceed through the self-onboarding wizard.
   *
   * @param token - The UUID invite token from the accept page URL.
   * @param data - Candidate-provided personal details and password.
   * @returns `{ employeeId, employeeCode, onboardingToken, onboardingUrl }`.
   * @throws `NotFoundError` if the token is not found.
   * @throws `BadRequestError` if the invitation is not PENDING, is expired, or the email is taken.
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

    // Check duplicate user
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) throw new BadRequestError('A user with this email already exists');

    const passwordHash = await bcrypt.hash(data.password, 12);
    const employeeCode = await generateEmployeeCode(invitation.organizationId);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: 'EMPLOYEE',
          status: 'PENDING_VERIFICATION',
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
          organizationId: invitation.organizationId,
        },
      });

      // Mark invitation as accepted
      await tx.employeeInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), employeeId: employee.id },
      });

      return { user, employee };
    });

    // Generate onboarding token for the 7-step wizard
    const onboardingToken = randomBytes(32).toString('hex');
    await redis.setex(`${ONBOARDING_PREFIX}${onboardingToken}`, ONBOARDING_TTL, JSON.stringify({
      employeeId: result.employee.id,
      email: normalizedEmail,
      expiresAt: new Date(Date.now() + ONBOARDING_TTL * 1000).toISOString(),
      currentStep: 1,
      stepData: {},
    }));

    return {
      employeeId: result.employee.id,
      employeeCode,
      onboardingToken,
      onboardingUrl: `/onboarding/${onboardingToken}`,
    };
  }

  /**
   * List all invitations for an organization with pagination.
   *
   * Denormalizes inviter email and computes a live `isExpired` flag for PENDING
   * invitations that have passed `expiresAt` but have not been updated in the DB yet.
   *
   * @param organizationId - The org context.
   * @param page - Page number (1-indexed, default 1).
   * @param limit - Items per page (default 20).
   * @returns `{ data, meta }` envelope compatible with the standard pagination format.
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
   * Resend an invitation by regenerating the token and extending the expiry by 72 hours.
   *
   * Works for both PENDING and EXPIRED invitations. Will not resend if already ACCEPTED.
   * Sends a reminder email via BullMQ with the new invite URL.
   *
   * @param invitationId - The `EmployeeInvitation` record ID.
   * @param organizationId - The org context (used for ownership check).
   * @param userId - ID of the user performing the resend (for authorization context).
   * @returns `{ success: true, inviteUrl, expiresAt }`.
   * @throws `NotFoundError` if the invitation is not found in this org.
   * @throws `BadRequestError` if the invitation has already been accepted.
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

    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/onboarding/invite/${updated.inviteToken}`;

    if (invitation.email) {
      await enqueueEmail({
        to: invitation.email,
        subject: `Reminder: You're invited to join ${org?.name || 'Aniston HRMS'}`,
        template: 'employee-invite',
        context: {
          orgName: org?.name || 'Aniston Technologies',
          inviteUrl,
          expiresAt: newExpiresAt.toISOString(),
        },
      });
    }

    return { success: true, inviteUrl, expiresAt: newExpiresAt };
  }

}

export const invitationService = new InvitationService();
