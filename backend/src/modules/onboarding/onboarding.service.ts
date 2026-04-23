import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { emitToOrg } from '../../sockets/index.js';
import { logger } from '../../lib/logger.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

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
        link: `https://hr.anistonav.com/onboarding/${token}`,
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
      await prisma.employee.update({
        where: { id: data.employeeId },
        data: {
          bankAccountNumber: stepData.bankAccountNumber ? encrypt(stepData.bankAccountNumber) : undefined,
          bankName: stepData.bankName || undefined,
          ifscCode: stepData.ifscCode || undefined,
          accountHolderName: stepData.accountHolderName || undefined,
          accountType: stepData.accountType || undefined,
        },
      });
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
    const employee = await prisma.employee.update({
      where: { id: data.employeeId },
      data: { onboardingComplete: true },
      select: { id: true, status: true, organizationId: true, firstName: true },
    });

    // Clean up token
    await deleteToken(token);

    // GAP-002: Auto-promote from ONBOARDING → PROBATION (non-blocking)
    setImmediate(() => {
      this._autoPromoteOnboardingComplete(employee.id, employee.organizationId, employee.status).catch(
        (err) => logger.warn('[Onboarding] Auto-promote (token flow) failed:', err),
      );
    });

    return { completed: true, message: 'Onboarding complete! Your HR team will assign your employment status shortly.' };
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
   * Returns full employee data so the frontend can pre-fill forms.
   */
  async getMyOnboardingStatus(employeeId: string) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        documents: { where: { deletedAt: null }, select: { type: true, status: true, id: true, name: true } },
        user: { select: { mfaEnabled: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    const org = await prisma.organization.findUnique({
      where: { id: employee.organizationId },
      select: { name: true, logo: true },
    });

    const IDENTITY_DOC_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
    const qualification = (employee as any).qualification as string | null;
    const requiredEduDocs = (() => {
      if (employee.workMode === 'PROJECT_SITE') return [];
      switch (qualification) {
        case '12th Pass': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE'];
        case 'Diploma': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'Graduation': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'Post Graduation': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        case 'PhD': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        default: return ['TENTH_CERTIFICATE'];
      }
    })();
    const REQUIRED_NON_IDENTITY_DOCS = employee.workMode === 'PROJECT_SITE'
      ? ['PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE']
      : [...requiredEduDocs, 'PAN', 'RESIDENCE_PROOF', 'PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE'];
    const uploadedDocTypes = (employee.documents as any[]).map((d: any) => d.type);
    const hasIdentityProof = uploadedDocTypes.some((t: string) => IDENTITY_DOC_TYPES.includes(t));
    const missingRequiredDocs = [
      ...REQUIRED_NON_IDENTITY_DOCS.filter(t => !uploadedDocTypes.includes(t)),
      ...(!hasIdentityProof ? ['IDENTITY_PROOF'] : []),
    ];

    const addr = employee.address as any;
    const permAddr = (employee as any).permanentAddress as any;
    const ec = employee.emergencyContact as any;

    const isSiteEmployee = employee.workMode === 'PROJECT_SITE';
    const sections = {
      password: true,
      // Site employees skip MFA (auto-pass); office employees must enable it
      mfa: isSiteEmployee ? true : !!(employee.user as any)?.mfaEnabled,
      personalDetails: !!(
        employee.firstName && employee.lastName &&
        employee.dateOfBirth && employee.gender &&
        employee.phone && employee.phone !== '0000000000' &&
        addr?.line1 && addr?.city && addr?.state && addr?.pincode &&
        permAddr?.line1 && permAddr?.city && permAddr?.state && permAddr?.pincode &&
        (isSiteEmployee || !!qualification)
      ),
      emergencyContact: !!(ec?.name && ec?.relationship && ec?.phone),
      bankDetails: !!(employee.bankAccountNumber && employee.bankName && employee.ifscCode && employee.accountHolderName),
      documents: missingRequiredDocs.length === 0,
    };

    let resumeStep = 1;
    if (sections.password) resumeStep = 2;
    if (sections.mfa) resumeStep = 3;
    if (sections.personalDetails) resumeStep = 4;
    if (sections.emergencyContact) resumeStep = 5;
    if (sections.bankDetails) resumeStep = 6;
    if (sections.documents) resumeStep = 7;

    return {
      employeeId: employee.id,
      workMode: employee.workMode,
      qualification: qualification || '',
      joiningDate: employee.joiningDate ? employee.joiningDate.toISOString().split('T')[0] : '',
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      personalEmail: employee.personalEmail,
      phone: employee.phone !== '0000000000' ? employee.phone : '',
      dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.toISOString().split('T')[0] : '',
      gender: employee.gender,
      bloodGroup: employee.bloodGroup || '',
      maritalStatus: employee.maritalStatus || '',
      currentAddress: employee.address || {},
      permanentAddress: (employee as any).permanentAddress || {},
      emergencyContact: employee.emergencyContact || {},
      bankAccountNumber: (() => {
        const raw = employee.bankAccountNumber || '';
        if (!raw) return '';
        try { return decrypt(raw); } catch { return raw; /* legacy plaintext */ }
      })(),
      bankName: employee.bankName || '',
      ifscCode: employee.ifscCode || '',
      accountHolderName: employee.accountHolderName || '',
      accountType: employee.accountType || 'SAVINGS',
      onboardingComplete: employee.onboardingComplete,
      organization: org,
      sections,
      resumeStep,
      missingRequiredDocs,
      uploadedDocTypes,
    };
  }

  /**
   * Save onboarding data for the currently logged-in employee (authenticated).
   * New 7-step flow:
   *   1=Set Password  2=MFA (skip/enable)  3=Personal Details
   *   4=Emergency Contact  5=Bank Details  6=Documents (no-op, uploads handled separately)  7=Complete
   */
  async saveMyOnboardingStep(employeeId: string, step: number, stepData: any) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: { select: { id: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Step 1: Set Password
    if (step === 1 && stepData.password) {
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.default.hash(stepData.password, 12);
      if (employee.userId) {
        await prisma.user.update({
          where: { id: employee.userId },
          data: { passwordHash, status: 'ACTIVE' },
        });
      }
    }

    // Step 1: also save workMode if provided
    if (step === 1 && stepData.workMode && ['OFFICE', 'PROJECT_SITE'].includes(stepData.workMode)) {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { workMode: stepData.workMode },
      });
    }

    // Step 2: MFA — skip does nothing; enable is handled by existing /auth/mfa endpoints
    // Nothing to save here

    // Step 3: Personal Details — both addresses required for all employee types
    if (step === 3) {
      const curr = stepData.currentAddress;
      const perm = stepData.permanentAddress;
      const baseValid = stepData.firstName && stepData.lastName && stepData.dateOfBirth && stepData.gender && stepData.phone;
      const currValid = curr?.line1 && curr?.city && curr?.state && curr?.pincode;
      const permValid = perm?.line1 && perm?.city && perm?.state && perm?.pincode;
      if (!baseValid || !currValid || !permValid) {
        throw new BadRequestError('Name, DOB, gender, phone, current address, and permanent address are all required');
      }
      await prisma.employee.update({
        where: { id: employeeId },
        data: {
          firstName: stepData.firstName,
          lastName: stepData.lastName,
          dateOfBirth: new Date(stepData.dateOfBirth),
          gender: stepData.gender,
          bloodGroup: stepData.bloodGroup || null,
          maritalStatus: stepData.maritalStatus || null,
          phone: stepData.phone,
          personalEmail: stepData.personalEmail || null,
          address: stepData.currentAddress,
          permanentAddress: stepData.permanentAddress,
          qualification: stepData.qualification || null,
          joiningDate: stepData.joiningDate ? new Date(stepData.joiningDate) : undefined,
        },
      });
    }

    // Step 4: Emergency Contact
    if (step === 4) {
      if (!stepData.name || !stepData.relationship || !stepData.phone) {
        throw new BadRequestError('Contact name, relationship, and phone are required');
      }
      await prisma.employee.update({
        where: { id: employeeId },
        data: {
          emergencyContact: {
            name: stepData.name,
            relationship: stepData.relationship,
            phone: stepData.phone,
            email: stepData.email || null,
          },
        },
      });
    }

    // Step 5: Bank Details
    if (step === 5) {
      if (!stepData.bankAccountNumber || !stepData.bankName || !stepData.ifscCode || !stepData.accountHolderName) {
        throw new BadRequestError('All bank detail fields are required');
      }
      await prisma.employee.update({
        where: { id: employeeId },
        data: {
          bankAccountNumber: encrypt(stepData.bankAccountNumber),
          bankName: stepData.bankName,
          ifscCode: stepData.ifscCode,
          accountHolderName: stepData.accountHolderName,
          accountType: stepData.accountType || 'SAVINGS',
        },
      });
    }

    // Step 6: Documents — uploads handled via /api/documents; no server-side step save needed

    return { saved: true, step };
  }

  /**
   * Complete authenticated onboarding — validates all required fields then marks complete.
   */
  async completeMyOnboarding(employeeId: string) {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        documents: { where: { deletedAt: null }, select: { type: true } },
        user: { select: { id: true, mfaEnabled: true } },
      },
    });
    if (!emp) throw new NotFoundError('Employee');

    // Office employees must have MFA enabled before completing onboarding
    if (emp.workMode !== 'PROJECT_SITE') {
      if (!(emp.user as any)?.mfaEnabled) {
        throw new BadRequestError('Two-Factor Authentication (MFA) is required for office employees. Please enable MFA in Step 2 before completing onboarding.');
      }
    }

    // Validate required employee-filled fields
    const addr = emp.address as any;
    const permAddr = (emp as any).permanentAddress as any;
    const ec = emp.emergencyContact as any;
    const qualification = (emp as any).qualification as string | null;
    if (!emp.firstName || !emp.lastName || !emp.dateOfBirth || !emp.gender || !emp.phone || emp.phone === '0000000000') {
      throw new BadRequestError('Personal details (name, date of birth, gender, phone) are required before completing onboarding');
    }
    if (emp.workMode !== 'PROJECT_SITE' && !qualification) {
      throw new BadRequestError('Highest qualification is required for office employees before completing onboarding');
    }
    if (!addr?.line1 || !addr?.city || !addr?.state || !addr?.pincode) {
      throw new BadRequestError('Current address is required before completing onboarding');
    }
    if (!permAddr?.line1 || !permAddr?.city || !permAddr?.state || !permAddr?.pincode) {
      throw new BadRequestError('Permanent address is required before completing onboarding');
    }
    if (!ec?.name || !ec?.relationship || !ec?.phone) {
      throw new BadRequestError('Emergency contact is required before completing onboarding');
    }
    if (!emp.bankAccountNumber || !emp.bankName || !emp.ifscCode || !emp.accountHolderName) {
      throw new BadRequestError('Bank details are required before completing onboarding');
    }
    const IDENTITY_DOC_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
    const requiredEduDocs = (() => {
      if (emp.workMode === 'PROJECT_SITE') return [];
      switch (qualification) {
        case '12th Pass': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE'];
        case 'Diploma': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'Graduation': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'Post Graduation': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        case 'PhD': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        default: return ['TENTH_CERTIFICATE'];
      }
    })();
    const REQUIRED_NON_IDENTITY_DOCS = emp.workMode === 'PROJECT_SITE'
      ? ['PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE']
      : [...requiredEduDocs, 'PAN', 'RESIDENCE_PROOF', 'PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE'];
    const uploaded = (emp.documents as any[]).map((d: any) => d.type);
    const missing = REQUIRED_NON_IDENTITY_DOCS.filter(t => !uploaded.includes(t));
    const hasIdentityProof = uploaded.some((t: string) => IDENTITY_DOC_TYPES.includes(t));
    if (missing.length > 0 || !hasIdentityProof) {
      const missingList = [
        ...missing,
        ...(!hasIdentityProof ? ['an identity proof (Aadhaar / Passport / DL / Voter ID)'] : []),
      ];
      throw new BadRequestError(`Please upload all required documents before completing onboarding. Missing: ${missingList.join(', ')}`);
    }

    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: { onboardingComplete: true },
      select: { id: true, status: true, organizationId: true },
    });

    // GAP-002: Auto-promote from ONBOARDING → PROBATION (non-blocking)
    setImmediate(() => {
      this._autoPromoteOnboardingComplete(employee.id, employee.organizationId, employee.status).catch(
        (err) => logger.warn('[Onboarding] Auto-promote (auth flow) failed:', err),
      );
    });

    return { completed: true, message: 'Onboarding complete! Your HR team will assign your employment status shortly.' };
  }

  /**
   * GAP-002: Auto-promotes employee from ONBOARDING to PROBATION after onboarding completes.
   * Non-blocking — caller wraps in setImmediate + .catch(). Onboarding success is never
   * affected if this step fails.
   */
  private async _autoPromoteOnboardingComplete(
    employeeId: string,
    organizationId: string,
    currentStatus: string,
  ): Promise<void> {
    // Only promote if still in ONBOARDING state (guard against duplicate calls)
    if (currentStatus !== 'ONBOARDING') {
      logger.info(`[Onboarding] Employee ${employeeId} is already ${currentStatus} — skipping auto-promote`);
      return;
    }

    const targetStatus = 'PROBATION';

    await prisma.employee.update({
      where: { id: employeeId },
      data: { status: targetStatus as any },
    });

    // Emit socket event for real-time UI update
    emitToOrg(organizationId, 'employee:status-changed', {
      employeeId,
      oldStatus: 'ONBOARDING',
      newStatus: targetStatus,
      reason: 'onboarding_completed',
    });

    // Audit log
    await createAuditLog({
      userId: 'system',
      organizationId,
      entity: 'Employee',
      entityId: employeeId,
      action: 'STATUS_CHANGED',
      newValue: { oldStatus: 'ONBOARDING', newStatus: targetStatus, trigger: 'onboarding_completed' },
    });

    logger.info(`[Onboarding] Employee ${employeeId} auto-promoted ONBOARDING → ${targetStatus}`);
  }
}

export const onboardingService = new OnboardingService();
