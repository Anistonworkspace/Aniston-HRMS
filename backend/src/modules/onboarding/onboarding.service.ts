import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';

// We'll store onboarding tokens in a simple in-memory map for dev
// In production, use Redis or a database table
const onboardingTokens = new Map<string, { employeeId: string; email: string; expiresAt: Date; currentStep: number; stepData: Record<string, any> }>();

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

    onboardingTokens.set(token, {
      employeeId,
      email: employee.email,
      expiresAt,
      currentStep: 1,
      stepData: {},
    });

    // TODO: Send invite email
    console.log(`[DEV] Onboarding invite for ${employee.email}: /onboarding/${token}`);

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
    const data = onboardingTokens.get(token);
    if (!data) throw new BadRequestError('Invalid or expired onboarding token');
    if (new Date() > data.expiresAt) {
      onboardingTokens.delete(token);
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
    const data = onboardingTokens.get(token);
    if (!data) throw new BadRequestError('Invalid or expired onboarding token');
    if (new Date() > data.expiresAt) throw new BadRequestError('Token expired');

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
    onboardingTokens.set(token, data);

    return { currentStep: data.currentStep, saved: true };
  }

  /**
   * Complete onboarding (step 7 — review & submit)
   */
  async complete(token: string) {
    const data = onboardingTokens.get(token);
    if (!data) throw new BadRequestError('Invalid token');

    // Mark employee as fully onboarded
    await prisma.employee.update({
      where: { id: data.employeeId },
      data: { status: 'ACTIVE' },
    });

    // Clean up token
    onboardingTokens.delete(token);

    return { completed: true, message: 'Welcome to the team!' };
  }

  /**
   * Get all pending onboarding invites (for HR view)
   */
  async getPendingInvites(organizationId: string) {
    const invites: any[] = [];
    for (const [token, data] of onboardingTokens.entries()) {
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
          isExpired: new Date() > data.expiresAt,
        });
      }
    }
    return invites;
  }
}

export const onboardingService = new OnboardingService();
