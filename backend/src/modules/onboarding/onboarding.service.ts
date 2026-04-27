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
        documents: { where: { deletedAt: null }, select: { type: true, status: true, id: true, name: true, rejectionReason: true } },
        user: { select: { mfa: { select: { isEnabled: true } } } },
        documentGate: { select: { kycStatus: true, reuploadDocTypes: true, documentRejectReasons: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    const org = await prisma.organization.findUnique({
      where: { id: employee.organizationId },
      select: { name: true, logo: true },
    });

    // Fetch the invitation that created this employee to get experienceLevel + experienceDocFields
    const invitation = await prisma.employeeInvitation.findFirst({
      where: { employeeId: employee.id },
      select: { experienceLevel: true, experienceDocFields: true },
    });
    const experienceLevel = (employee as any).experienceLevel || invitation?.experienceLevel || 'FRESHER';
    const rawExpDocFields = (invitation?.experienceDocFields as any[]) || [];
    // If EXPERIENCED but no custom doc fields configured (e.g. HR edited after invite), fall back to defaults
    const experienceDocFields = experienceLevel === 'EXPERIENCED' && rawExpDocFields.length === 0
      ? [
          { key: 'EXPERIENCE_LETTER', label: 'Experience Letter', required: true },
          { key: 'OFFER_LETTER_DOC', label: 'Offer / Appointment Letter', required: false },
        ]
      : rawExpDocFields;

    const IDENTITY_DOC_TYPES = ['AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID'];
    const qualification = (employee as any).qualification as string | null;
    const addressSameAsPermanent = (employee as any).addressSameAsPermanent as boolean | null;

    // Education docs — keyed on new enum values (TENTH→TWELFTH→GRADUATION etc.)
    const requiredEduDocs = (() => {
      if (employee.workMode === 'PROJECT_SITE') return [];
      switch (qualification) {
        case 'TWELFTH': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE'];
        case 'DIPLOMA': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'GRADUATION': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'POST_GRADUATION': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        case 'PHD': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        default: return ['TENTH_CERTIFICATE']; // TENTH or unknown
      }
    })();

    // Residence proof: one doc if addresses same, two if different
    const residenceDocs = addressSameAsPermanent === false
      ? ['RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF']
      : ['RESIDENCE_PROOF'];

    // Experience docs for EXPERIENCED employees (custom HR-configured fields)
    const experienceDocs = experienceLevel === 'EXPERIENCED'
      ? experienceDocFields.filter((f: any) => f.required !== false).map((f: any) => f.key)
      : [];

    const REQUIRED_NON_IDENTITY_DOCS = employee.workMode === 'PROJECT_SITE'
      ? ['PHOTO']
      : [...requiredEduDocs, 'PAN', ...residenceDocs, 'PHOTO', ...experienceDocs];

    // Rejected docs: show as "need re-upload" — exclude from uploadedDocTypes so they count as missing
    const rejectedDocs = (employee.documents as any[])
      .filter((d: any) => d.status === 'REJECTED')
      .map((d: any) => ({ type: d.type, name: d.name, rejectionReason: d.rejectionReason || null }));
    const rejectedTypes = new Set(rejectedDocs.map((d: any) => d.type));

    // Only count non-rejected docs as "uploaded"
    const uploadedDocTypes = (employee.documents as any[])
      .filter((d: any) => d.status !== 'REJECTED')
      .map((d: any) => d.type);

    const hasIdentityProof = uploadedDocTypes.some((t: string) => IDENTITY_DOC_TYPES.includes(t)) &&
      !Array.from(rejectedTypes).some(t => IDENTITY_DOC_TYPES.includes(t as string));
    const missingRequiredDocs = [
      ...REQUIRED_NON_IDENTITY_DOCS.filter(t => !uploadedDocTypes.includes(t) || rejectedTypes.has(t)),
      ...(!hasIdentityProof ? ['IDENTITY_PROOF'] : []),
    ];

    const addr = employee.address as any;
    const permAddr = (employee as any).permanentAddress as any;
    const ec = employee.emergencyContact as any;

    const isSiteEmployee = employee.workMode === 'PROJECT_SITE';

    // Permanent address only required when addresses differ
    const permAddrRequired = addressSameAsPermanent === false;
    const permAddrValid = permAddrRequired
      ? !!(permAddr?.line1 && permAddr?.city && permAddr?.state && permAddr?.pincode)
      : true;

    const sections = {
      password: true,
      // Site employees skip MFA (auto-pass); office employees must enable it
      mfa: isSiteEmployee ? true : !!(employee.user as any)?.mfa?.isEnabled,
      personalDetails: !!(
        employee.firstName && employee.lastName &&
        employee.dateOfBirth && employee.gender &&
        employee.phone && employee.phone !== '0000000000' &&
        addr?.line1 && addr?.city && addr?.state && addr?.pincode &&
        addressSameAsPermanent !== null &&
        permAddrValid &&
        (isSiteEmployee || !!qualification)
      ),
      emergencyContact: !!(ec?.name && ec?.relationship && ec?.phone),
      bankDetails: !!(employee.bankAccountNumber && employee.bankName && employee.ifscCode && employee.accountHolderName),
      documents: missingRequiredDocs.length === 0,
    };

    // Step numbering: 1=MFA (optional), 2=Personal, 3=Emergency, 4=Bank, 5=Documents, 6=Review
    // MFA is optional — always advance past step 1 so it never blocks other steps
    let resumeStep = 2;
    if (sections.personalDetails) resumeStep = 3;
    if (sections.emergencyContact) resumeStep = 4;
    if (sections.bankDetails) resumeStep = 5;
    if (sections.documents) resumeStep = 6;

    const gate = employee.documentGate as any;

    return {
      employeeId: employee.id,
      workMode: employee.workMode,
      experienceLevel,
      experienceDocFields,
      addressSameAsPermanent: addressSameAsPermanent ?? null,
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
        try { return decrypt(raw); } catch { return raw; }
      })(),
      bankName: employee.bankName || '',
      ifscCode: employee.ifscCode || '',
      accountHolderName: employee.accountHolderName || '',
      accountType: employee.accountType || 'SAVINGS',
      epfMemberId: employee.epfMemberId || '',
      epfEnabled: (employee as any).epfEnabled ?? false,
      onboardingComplete: employee.onboardingComplete,
      kycStatus: gate?.kycStatus ?? 'PENDING',
      // Re-upload context — populated when kycStatus=REUPLOAD_REQUIRED
      reuploadDocTypes: gate?.reuploadDocTypes ?? [],
      documentRejectReasons: gate?.documentRejectReasons ?? {},
      organization: org,
      sections,
      resumeStep,
      missingRequiredDocs,
      uploadedDocTypes,
      rejectedDocs,
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

    // Step 1: MFA — enable/skip handled by /auth/mfa endpoints; nothing to persist here

    // Step 2: Personal Details
    if (step === 2) {
      const curr = stepData.currentAddress;
      const sameAddress = stepData.addressSameAsPermanent === true;
      const baseValid = stepData.firstName && stepData.lastName && stepData.dateOfBirth && stepData.gender && stepData.phone;
      const currValid = curr?.line1 && curr?.city && curr?.state && curr?.pincode;
      // Permanent address only required when employee says addresses differ
      const perm = stepData.permanentAddress;
      const permValid = sameAddress || (perm?.line1 && perm?.city && perm?.state && perm?.pincode);
      if (!baseValid || !currValid || !permValid) {
        throw new BadRequestError('Name, DOB, gender, phone, current address are required; permanent address is required when different from current');
      }
      const parsedDob = new Date(stepData.dateOfBirth);
      if (isNaN(parsedDob.getTime())) {
        throw new BadRequestError('Invalid date of birth. Please use YYYY-MM-DD format.');
      }
      const phoneDigits = String(stepData.phone).replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 12) {
        throw new BadRequestError('Phone number must be 10 to 12 digits.');
      }
      await prisma.employee.update({
        where: { id: employeeId },
        data: {
          firstName: stepData.firstName,
          lastName: stepData.lastName,
          dateOfBirth: parsedDob,
          gender: stepData.gender,
          bloodGroup: stepData.bloodGroup || null,
          maritalStatus: stepData.maritalStatus || null,
          phone: stepData.phone,
          personalEmail: stepData.personalEmail || null,
          address: stepData.currentAddress,
          permanentAddress: sameAddress ? stepData.currentAddress : (stepData.permanentAddress || null),
          addressSameAsPermanent: sameAddress,
          qualification: stepData.qualification || null,
          // joiningDate is HR-set via invitation — employees cannot change it during onboarding
        },
      });
    }

    // Step 3: Emergency Contact
    if (step === 3) {
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

    // Step 4: Bank Details
    if (step === 4) {
      if (!stepData.bankAccountNumber || !stepData.bankName || !stepData.ifscCode || !stepData.accountHolderName) {
        throw new BadRequestError('All bank detail fields are required');
      }
      const ifscNorm = String(stepData.ifscCode).toUpperCase().trim();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscNorm)) {
        throw new BadRequestError('Invalid IFSC code. Format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)');
      }
      await prisma.employee.update({
        where: { id: employeeId },
        data: {
          bankAccountNumber: encrypt(stepData.bankAccountNumber),
          bankName: stepData.bankName,
          ifscCode: ifscNorm,
          accountHolderName: stepData.accountHolderName,
          accountType: stepData.accountType || 'SAVINGS',
          // EPF — employee opts in by providing their UAN/member ID from a previous employer
          // If not provided, epfEnabled stays false → no EPF deducted in payroll
          epfMemberId: stepData.epfMemberId || null,
          epfEnabled: !!stepData.epfMemberId,
        },
      });
    }

    // Step 5: Documents — uploads handled via /api/documents; no server-side step save needed

    return { saved: true, step };
  }

  /**
   * Complete authenticated onboarding — validates all required fields then marks complete.
   */
  async completeMyOnboarding(employeeId: string) {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        documents: { where: { deletedAt: null, status: { not: 'REJECTED' } }, select: { type: true } },
        user: { select: { id: true, mfa: { select: { isEnabled: true } } } },
      },
    });
    if (!emp) throw new NotFoundError('Employee');

    // MFA is optional — employees can set it up after onboarding from their Profile page

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
    const addressSame = (emp as any).addressSameAsPermanent as boolean | null;
    if (addressSame === null || addressSame === undefined) {
      throw new BadRequestError('Please indicate whether your permanent address is the same as your current address');
    }
    if (addressSame === false && (!permAddr?.line1 || !permAddr?.city || !permAddr?.state || !permAddr?.pincode)) {
      throw new BadRequestError('Permanent address is required when it differs from current address');
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
        case 'TWELFTH': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE'];
        case 'DIPLOMA': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'GRADUATION': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE'];
        case 'POST_GRADUATION': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        case 'PHD': return ['TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE', 'DEGREE_CERTIFICATE', 'POST_GRADUATION_CERTIFICATE'];
        default: return ['TENTH_CERTIFICATE'];
      }
    })();
    const addressSameAsPermanent = (emp as any).addressSameAsPermanent as boolean | null;
    const residenceDocs = addressSameAsPermanent === false
      ? ['RESIDENCE_PROOF', 'PERMANENT_RESIDENCE_PROOF']
      : ['RESIDENCE_PROOF'];
    // Fetch experience doc fields from invitation
    const inv = await prisma.employeeInvitation.findFirst({
      where: { employeeId },
      select: { experienceDocFields: true },
    });
    const rawInvExpDocFields = (inv?.experienceDocFields as any[]) || [];
    const empExpLevel = (emp as any).experienceLevel as string | null;
    // Fall back to default employment docs if EXPERIENCED but no fields configured
    const experienceDocFields = empExpLevel === 'EXPERIENCED' && rawInvExpDocFields.length === 0
      ? [
          { key: 'EXPERIENCE_LETTER', label: 'Experience Letter', required: true },
          { key: 'OFFER_LETTER_DOC', label: 'Offer / Appointment Letter', required: false },
        ]
      : rawInvExpDocFields;
    const experienceDocs = empExpLevel === 'EXPERIENCED'
      ? experienceDocFields.filter((f: any) => f.required !== false).map((f: any) => f.key)
      : [];
    const REQUIRED_NON_IDENTITY_DOCS = emp.workMode === 'PROJECT_SITE'
      ? ['PHOTO']
      : [...requiredEduDocs, 'PAN', ...residenceDocs, 'PHOTO', ...experienceDocs];
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

    // Send onboarding-completed email to admin (non-blocking)
    setImmediate(async () => {
      try {
        const [fullEmp, org] = await Promise.all([
          prisma.employee.findUnique({
            where: { id: employeeId },
            select: {
              firstName: true, lastName: true, employeeCode: true, phone: true,
              joiningDate: true, workMode: true, avatar: true,
              designation: { select: { name: true } },
              department: { select: { name: true } },
            },
          }),
          prisma.organization.findUnique({
            where: { id: employee.organizationId },
            select: { name: true, adminNotificationEmail: true },
          }),
        ]);

        if (!org?.adminNotificationEmail || !fullEmp) return;

        await enqueueEmail({
          to: org.adminNotificationEmail,
          subject: `New Employee Onboarding Complete — ${fullEmp.firstName} ${fullEmp.lastName} (${fullEmp.employeeCode || ''})`,
          template: 'onboarding-completed',
          context: {
            employeeName: `${fullEmp.firstName} ${fullEmp.lastName}`,
            employeeCode: fullEmp.employeeCode || '',
            designation: (fullEmp as any).designation?.name || '',
            department: (fullEmp as any).department?.name || '',
            phone: fullEmp.phone || '',
            joiningDate: fullEmp.joiningDate,
            workMode: fullEmp.workMode || 'OFFICE',
            photoUrl: fullEmp.avatar || '',
            orgName: org.name,
            hrmsUrl: `https://hr.anistonav.com/employees/${employeeId}`,
          },
        });
      } catch (err) {
        logger.warn('[Onboarding] Failed to send admin notification email:', err);
      }
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
