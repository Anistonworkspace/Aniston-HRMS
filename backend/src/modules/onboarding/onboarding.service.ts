import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';

const TOKEN_PREFIX = 'onboarding:';
const TOKEN_TTL = 7 * 86400; // 7 days in seconds

interface OnboardingTokenData {
  employeeId: string;
  email: string;
  expiresAt: string;
  currentStep: number;
  stepData: Record<string, any>;
}

async function getTokenData(token: string): Promise<OnboardingTokenData | null> {
  const raw = await redis.get(TOKEN_PREFIX + token);
  return raw ? JSON.parse(raw) : null;
}

async function setTokenData(token: string, data: OnboardingTokenData): Promise<void> {
  await redis.setex(TOKEN_PREFIX + token, TOKEN_TTL, JSON.stringify(data));
}

async function deleteToken(token: string): Promise<void> {
  await redis.del(TOKEN_PREFIX + token);
}

export class OnboardingService {
  /**
   * HR initiates onboarding — generate invite token and send email
   */
  async createInvite(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) throw new NotFoundError('Employee');

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48); // 48 hour expiry

    await setTokenData(token, {
      employeeId,
      email: employee.email,
      expiresAt: expiresAt.toISOString(),
      currentStep: 1,
      stepData: {},
    });

    // Send onboarding invite email
    await enqueueEmail({
      to: employee.email,
      subject: 'Welcome to Aniston Technologies — Complete Your Onboarding',
      template: 'onboarding-invite',
      context: {
        name: employee.firstName,
        link: `${process.env.FRONTEND_URL || 'https://hr.anistonav.com'}/onboarding/${token}`,
      },
    });

    return {
      token,
      expiresAt,
      inviteUrl: `/onboarding/${token}`,
      email: employee.email,
    };
  }

  /**
   * Get onboarding status by token (public — no auth required)
   */
  async getStatus(token: string) {
    const data = await getTokenData(token);
    if (!data) throw new BadRequestError('Invalid or expired onboarding token');
    if (new Date() > new Date(data.expiresAt)) {
      await deleteToken(token);
      throw new BadRequestError('Onboarding token has expired');
    }

    const employee = await prisma.employee.findUnique({
      where: { id: data.employeeId },
      select: { firstName: true, lastName: true, email: true, organizationId: true },
    });

    const org = employee ? await prisma.organization.findUnique({
      where: { id: employee.organizationId },
      select: { name: true, logo: true },
    }) : null;

    return {
      currentStep: data.currentStep,
      totalSteps: 7,
      stepData: data.stepData,
      employee: employee ? { firstName: employee.firstName, lastName: employee.lastName, email: employee.email } : null,
      organization: org,
    };
  }

  /**
   * Save a step's data (public — token-based auth)
   */
  async saveStep(token: string, step: number, stepData: any) {
    const data = await getTokenData(token);
    if (!data) throw new BadRequestError('Invalid or expired onboarding token');
    if (new Date() > new Date(data.expiresAt)) throw new BadRequestError('Token expired');

    // Step 1: Set password
    if (step === 1 && stepData.password) {
      const passwordHash = await bcrypt.hash(stepData.password, 12);
      const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
      if (employee?.userId) {
        await prisma.user.update({
          where: { id: employee.userId },
          data: { passwordHash, status: 'ACTIVE' },
        });
      }
      stepData.password = '[SET]'; // Don't store actual password
    }

    // Step 2: Personal details
    if (step === 2) {
      await prisma.employee.update({
        where: { id: data.employeeId },
        data: {
          firstName: stepData.firstName || undefined,
          lastName: stepData.lastName || undefined,
          dateOfBirth: stepData.dateOfBirth ? new Date(stepData.dateOfBirth) : undefined,
          gender: stepData.gender || undefined,
          bloodGroup: stepData.bloodGroup || undefined,
          maritalStatus: stepData.maritalStatus || undefined,
          phone: stepData.phone || undefined,
          personalEmail: stepData.personalEmail || undefined,
          address: stepData.address || undefined,
        },
      });
    }

    // Step 3: Documents — handled via file upload separately

    // Step 4: Photo & signature
    if (step === 4) {
      if (stepData.avatar) {
        await prisma.employee.update({
          where: { id: data.employeeId },
          data: { avatar: stepData.avatar },
        });
      }
    }

    // Step 5: Bank details
    if (step === 5) {
      // Store as employee metadata — extend schema or use JSON field later
      data.stepData[`step${step}`] = stepData;
    }

    // Step 6: Emergency contact
    if (step === 6) {
      await prisma.employee.update({
        where: { id: data.employeeId },
        data: { emergencyContact: stepData },
      });
    }

    // Update progress
    data.stepData[`step${step}`] = { ...stepData, completedAt: new Date().toISOString() };
    data.currentStep = Math.max(data.currentStep, step + 1);
    await setTokenData(token, data);

    return { currentStep: data.currentStep, saved: true };
  }

  /**
   * Complete onboarding (step 7 — review & submit)
   */
  async complete(token: string) {
    const data = await getTokenData(token);
    if (!data) throw new BadRequestError('Invalid token');

    // Mark employee as fully onboarded
    await prisma.employee.update({
      where: { id: data.employeeId },
      data: { status: 'ACTIVE', onboardingComplete: true },
    });

    // Clean up token
    await deleteToken(token);

    return { completed: true, message: 'Welcome to the team!' };
  }

  /**
   * Get all pending onboarding invites (for HR view)
   */
  async getPendingInvites(organizationId: string) {
    const invites: any[] = [];

    // Scan Redis for all onboarding tokens
    let cursor = '0';
    const allKeys: string[] = [];
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', TOKEN_PREFIX + '*', 'COUNT', 100);
      cursor = nextCursor;
      allKeys.push(...keys);
    } while (cursor !== '0');

    for (const key of allKeys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const data: OnboardingTokenData = JSON.parse(raw);
      const token = key.replace(TOKEN_PREFIX, '');

      const employee = await prisma.employee.findFirst({
        where: { id: data.employeeId, organizationId },
        select: { firstName: true, lastName: true, email: true, employeeCode: true },
      });
      if (employee) {
        invites.push({
          token: token.substring(0, 8) + '...',
          employee,
          currentStep: data.currentStep,
          expiresAt: data.expiresAt,
          isExpired: new Date() > new Date(data.expiresAt),
        });
      }
    }
    return invites;
  }

  // =====================
  // AUTHENTICATED ONBOARDING (post-login flow)
  // =====================

  /**
   * Get onboarding status for the currently logged-in employee.
   * Used by the post-login onboarding gate.
   */
  async getMyOnboardingStatus(employeeId: string) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundError('Employee');

    const org = await prisma.organization.findUnique({
      where: { id: employee.organizationId },
      select: { name: true, logo: true },
    });

    const documentCount = await prisma.document.count({
      where: { employeeId },
    });

    return {
      employeeId: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      onboardingComplete: employee.onboardingComplete,
      organization: org,
      sections: {
        personalDetails: !!(employee.dateOfBirth && employee.gender !== 'PREFER_NOT_TO_SAY' && employee.address),
        documents: documentCount > 0,
        photo: !!employee.avatar,
        bankDetails: false,
        emergencyContact: !!employee.emergencyContact,
      },
    };
  }

  /**
   * Save onboarding data for the currently logged-in employee (authenticated).
   * Same logic as saveStep but uses employeeId from JWT instead of Redis token.
   */
  async saveMyOnboardingStep(employeeId: string, step: number, stepData: any) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundError('Employee');

    // Step: Personal details
    if (step === 2) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: {
          firstName: stepData.firstName || undefined,
          lastName: stepData.lastName || undefined,
          dateOfBirth: stepData.dateOfBirth ? new Date(stepData.dateOfBirth) : undefined,
          gender: stepData.gender || undefined,
          bloodGroup: stepData.bloodGroup || undefined,
          maritalStatus: stepData.maritalStatus || undefined,
          phone: stepData.phone || undefined,
          personalEmail: stepData.personalEmail || undefined,
          address: stepData.address || undefined,
        },
      });
    }

    // Step: Photo & signature
    if (step === 4 && stepData.avatar) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { avatar: stepData.avatar },
      });
    }

    // Step: Emergency contact
    if (step === 6) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { emergencyContact: stepData },
      });
    }

    return { saved: true };
  }

  /**
   * Complete authenticated onboarding — marks the employee as fully onboarded.
   */
  async completeMyOnboarding(employeeId: string) {
    await prisma.employee.update({
      where: { id: employeeId },
      data: { onboardingComplete: true, status: 'ACTIVE' },
    });

    return { completed: true, message: 'Welcome to the team!' };
  }
}

export const onboardingService = new OnboardingService();
