import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail, enqueueNotification } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { computeRequiredDocs, IDENTITY_PROOF_TYPES, EMPLOYMENT_PROOF_TYPES } from '../onboarding/document-gate.service.js';

type Category = 'PERSONAL_DETAILS' | 'ADDRESS' | 'EMERGENCY_CONTACT' | 'BANK_DETAILS' | 'EPF_DETAILS';

const CATEGORY_LABELS: Record<Category, string> = {
  PERSONAL_DETAILS: 'Personal Details',
  ADDRESS: 'Address',
  EMERGENCY_CONTACT: 'Emergency Contact',
  BANK_DETAILS: 'Bank Details',
  EPF_DETAILS: 'EPF Details',
};

const ALLOWED_FIELDS_BY_CATEGORY: Record<Category, string[]> = {
  PERSONAL_DETAILS: ['firstName', 'lastName', 'dateOfBirth', 'gender', 'bloodGroup', 'maritalStatus', 'phone', 'personalEmail'],
  ADDRESS: ['line1', 'line2', 'city', 'state', 'pincode', 'country'],
  EMERGENCY_CONTACT: ['name', 'relationship', 'phone', 'email'],
  BANK_DETAILS: ['accountHolderName', 'accountType', 'bankName', 'bankAccountNumber', 'ifscCode'],
  EPF_DETAILS: ['epfMemberId', 'epfUan'],
};

export class ProfileEditRequestService {
  async create(employeeId: string, organizationId: string, category: Category, requestedData: any) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, organizationId: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Block if profile is incomplete — employee must complete onboarding first
    const profileStatus = await this.getProfileCompletion(employeeId);
    const fieldsComplete = profileStatus.sections.personalDetails && profileStatus.sections.address &&
      profileStatus.sections.emergencyContact && profileStatus.sections.bankDetails;
    if (!fieldsComplete) {
      throw new BadRequestError(
        'Your profile is incomplete. Please complete your profile through the onboarding flow before submitting edit requests.'
      );
    }

    // Block if a PENDING or APPROVED (unapplied) request already exists for this category
    const existing = await prisma.profileEditRequest.findFirst({
      where: {
        employeeId,
        category: category as any,
        status: { in: ['PENDING', 'APPROVED'] as any[] },
      },
    });
    if (existing) {
      throw new ConflictError(`A ${CATEGORY_LABELS[category]} edit request is already pending or approved.`);
    }

    // Whitelist fields per category
    const allowed = ALLOWED_FIELDS_BY_CATEGORY[category];
    const sanitized: Record<string, any> = {};
    for (const key of allowed) {
      if (requestedData[key] !== undefined) sanitized[key] = requestedData[key];
    }

    const request = await prisma.profileEditRequest.create({
      data: {
        employeeId,
        organizationId,
        category: category as any,
        requestedData: sanitized,
        status: 'PENDING',
      },
    });

    // Notify HR via email + in-app (non-blocking)
    const [org, hrUsers] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { adminNotificationEmail: true, name: true },
      }),
      prisma.user.findMany({
        where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, status: 'ACTIVE' },
        select: { id: true, email: true },
      }),
    ]);
    const emailSubject = `Profile Edit Request — ${employee.firstName} ${employee.lastName} (${employee.employeeCode})`;
    const emailContext = {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      category: CATEGORY_LABELS[category],
      orgName: org?.name || '',
    };
    const hrEmailsSent = new Set<string>();
    for (const hr of hrUsers) {
      if (hr.email) {
        enqueueEmail({ to: hr.email, subject: emailSubject, template: 'profile-edit-request-hr', context: emailContext }).catch(() => {});
        hrEmailsSent.add(hr.email);
      }
      enqueueNotification({
        userId: hr.id,
        organizationId,
        type: 'PROFILE_EDIT_REQUEST',
        title: `Profile Edit Request — ${employee.firstName} ${employee.lastName}`,
        message: `${employee.firstName} ${employee.lastName} (${employee.employeeCode}) requested to update their ${CATEGORY_LABELS[category]}.`,
        link: `/employees/${employeeId}`,
      }).catch(() => {});
    }
    // Also email org adminNotificationEmail if not already covered
    if (org?.adminNotificationEmail && !hrEmailsSent.has(org.adminNotificationEmail)) {
      enqueueEmail({ to: org.adminNotificationEmail, subject: emailSubject, template: 'profile-edit-request-hr', context: emailContext }).catch(() => {});
    }

    return request;
  }

  async listForEmployee(employeeId: string, organizationId?: string) {
    const where: any = { employeeId };
    if (organizationId) where.organizationId = organizationId;
    return prisma.profileEditRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true },
        },
      },
    });
  }

  async listForOrg(organizationId: string, page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = { organizationId };
    if (status) where.status = status;
    else where.status = 'PENDING';

    const [data, total] = await Promise.all([
      prisma.profileEditRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true },
          },
        },
      }),
      prisma.profileEditRequest.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async review(requestId: string, organizationId: string, reviewerId: string, status: 'APPROVED' | 'REJECTED', hrNote?: string) {
    const request = await prisma.profileEditRequest.findFirst({
      where: { id: requestId, organizationId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true, personalEmail: true } },
      },
    });
    if (!request) throw new NotFoundError('Profile edit request');
    if (request.status !== 'PENDING') throw new BadRequestError('Request is no longer pending');

    // Block HR from approving if employee profile is incomplete
    if (status === 'APPROVED') {
      const profileStatus = await this.getProfileCompletion(request.employeeId);
      const fieldsComplete = profileStatus.sections.personalDetails && profileStatus.sections.address &&
        profileStatus.sections.emergencyContact && profileStatus.sections.bankDetails;
      if (!fieldsComplete) {
        throw new BadRequestError(
          `Cannot approve: ${request.employee.firstName} ${request.employee.lastName}'s profile is incomplete. ` +
          'Ask them to complete their profile through the onboarding flow first.'
        );
      }
    }

    const editWindowExpiresAt = status === 'APPROVED'
      ? new Date(Date.now() + 48 * 60 * 60 * 1000)
      : null;

    const updated = await prisma.profileEditRequest.update({
      where: { id: requestId },
      data: {
        status: status as any,
        hrNote: hrNote || null,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        editWindowExpiresAt,
      },
    });

    // Email + in-app notification to employee
    const emp = request.employee as any;
    const recipientEmail = emp.personalEmail || emp.email;
    if (recipientEmail) {
      enqueueEmail({
        to: recipientEmail,
        subject: `Profile Edit Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
        template: 'profile-edit-request-employee',
        context: {
          employeeName: `${emp.firstName} ${emp.lastName}`,
          category: CATEGORY_LABELS[request.category as Category],
          status,
          hrNote: hrNote || '',
          editWindowHours: 48,
        },
      }).catch(() => {});
    }
    // In-app notification to employee
    const empUser = await prisma.user.findFirst({
      where: { employee: { id: request.employeeId } },
      select: { id: true },
    });
    if (empUser) {
      enqueueNotification({
        userId: empUser.id,
        organizationId,
        type: 'PROFILE_EDIT_REVIEWED',
        title: `Profile Edit Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
        message: status === 'APPROVED'
          ? `Your ${CATEGORY_LABELS[request.category as Category]} edit request was approved. You have 48 hours to apply the changes.`
          : `Your ${CATEGORY_LABELS[request.category as Category]} edit request was rejected.${hrNote ? ' HR Note: ' + hrNote : ''}`,
        link: '/profile',
      }).catch(() => {});
    }

    await createAuditLog({
      userId: reviewerId,
      organizationId,
      entity: 'ProfileEditRequest',
      entityId: requestId,
      action: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      newValue: { status, hrNote },
    });

    return updated;
  }

  async applyApprovedEdit(requestId: string, employeeId: string, organizationId: string, data: any) {
    const request = await prisma.profileEditRequest.findFirst({
      where: { id: requestId, employeeId },
    });
    if (!request) throw new NotFoundError('Profile edit request');
    if (request.status !== 'APPROVED') throw new BadRequestError('Request is not approved');
    if (request.editWindowExpiresAt && new Date() > request.editWindowExpiresAt) {
      throw new BadRequestError('Edit window has expired. Please submit a new request.');
    }

    const category = request.category as Category;
    const allowed = ALLOWED_FIELDS_BY_CATEGORY[category];
    const storedData = (request.requestedData as Record<string, any>) || {};
    const sanitized: Record<string, any> = {};
    for (const key of allowed) {
      if (storedData[key] !== undefined) sanitized[key] = storedData[key];
    }

    let updateData: any = {};
    if (category === 'PERSONAL_DETAILS') {
      updateData = {
        firstName: sanitized.firstName,
        lastName: sanitized.lastName,
        dateOfBirth: sanitized.dateOfBirth ? new Date(sanitized.dateOfBirth) : undefined,
        gender: sanitized.gender,
        bloodGroup: sanitized.bloodGroup || null,
        maritalStatus: sanitized.maritalStatus || null,
        phone: sanitized.phone,
        personalEmail: sanitized.personalEmail || null,
      };
    } else if (category === 'ADDRESS') {
      updateData = { address: sanitized };
    } else if (category === 'EMERGENCY_CONTACT') {
      updateData = { emergencyContact: sanitized };
    } else if (category === 'BANK_DETAILS') {
      updateData = {
        accountHolderName: sanitized.accountHolderName,
        accountType: sanitized.accountType,
        bankName: sanitized.bankName,
        bankAccountNumber: sanitized.bankAccountNumber ? encrypt(sanitized.bankAccountNumber) : sanitized.bankAccountNumber,
        ifscCode: sanitized.ifscCode,
      };
    } else if (category === 'EPF_DETAILS') {
      updateData = {
        epfMemberId: sanitized.epfMemberId || null,
        epfUan: sanitized.epfUan || null,
        epfEnabled: !!(sanitized.epfMemberId || sanitized.epfUan),
      };
    }

    // Remove undefined values
    for (const k of Object.keys(updateData)) {
      if (updateData[k] === undefined) delete updateData[k];
    }

    await prisma.$transaction([
      prisma.employee.update({ where: { id: employeeId }, data: updateData }),
      prisma.profileEditRequest.update({
        where: { id: requestId },
        data: { status: 'APPLIED', editAppliedAt: new Date() },
      }),
    ]);

    await createAuditLog({
      userId: employeeId,
      organizationId,
      entity: 'Employee',
      entityId: employeeId,
      action: 'PROFILE_EDIT_APPLIED',
      newValue: { category, changes: sanitized },
    });

    return { applied: true };
  }

  /** Returns profile completion status for an employee (excludes HR-only fields) */
  async getProfileCompletion(employeeId: string) {
    const [emp, gate] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          firstName: true, lastName: true, dateOfBirth: true, gender: true, phone: true,
          address: true, emergencyContact: true,
          bankAccountNumber: true, bankName: true, ifscCode: true, accountHolderName: true,
          onboardingComplete: true,
          documents: { where: { deletedAt: null }, select: { type: true } },
        },
      }),
      prisma.onboardingDocumentGate.findUnique({ where: { employeeId } }),
    ]);
    if (!emp) throw new NotFoundError('Employee');

    const uploadedDocTypes = emp.documents.map((d: any) => d.type);
    let missingDocs: string[] = [];

    if (gate) {
      // Use the employee's gate config to dynamically compute required docs
      const fresher = gate.fresherOrExperienced || 'FRESHER';
      const qualification = gate.highestQualification || 'GRADUATION';
      const { requiredDocs, needsIdentityProof, needsEmploymentProof } = computeRequiredDocs(fresher, qualification);

      // Check specific required doc types (excluding PHOTO — handled separately via photoUrl)
      missingDocs = requiredDocs.filter(t => t !== 'PHOTO' && !uploadedDocTypes.includes(t));

      // Identity proof: at least one of the allowed types
      if (needsIdentityProof && !IDENTITY_PROOF_TYPES.some(t => uploadedDocTypes.includes(t))) {
        missingDocs.push('IDENTITY_PROOF');
      }

      // Employment proof for experienced hires
      if (needsEmploymentProof && !EMPLOYMENT_PROOF_TYPES.some(t => uploadedDocTypes.includes(t))) {
        missingDocs.push('EMPLOYMENT_PROOF');
      }

      // Photo: check both photoUrl on gate and uploaded doc types
      const hasPhoto = !!gate.photoUrl || uploadedDocTypes.includes('PHOTO');
      if (!hasPhoto) missingDocs.push('PHOTO');
    } else {
      // No gate configured yet — use minimal baseline
      const FALLBACK_REQUIRED = ['PAN', 'PHOTO', 'RESIDENCE_PROOF'];
      missingDocs = FALLBACK_REQUIRED.filter(t => !uploadedDocTypes.includes(t));
    }

    const addr = emp.address as any;
    const ec = emp.emergencyContact as any;

    const sections = {
      personalDetails: !!(emp.firstName && emp.lastName && emp.dateOfBirth && emp.gender &&
        emp.phone && emp.phone !== '0000000000'),
      address: !!(addr?.line1 && addr?.city && addr?.state && addr?.pincode),
      emergencyContact: !!(ec?.name && ec?.relationship && ec?.phone),
      bankDetails: !!(emp.bankAccountNumber && emp.bankName && emp.ifscCode && emp.accountHolderName),
      documents: missingDocs.length === 0,
    };

    const allComplete = Object.values(sections).every(Boolean);

    return {
      sections,
      missingDocs,
      allComplete,
      onboardingComplete: emp.onboardingComplete,
    };
  }
}

export const profileEditRequestService = new ProfileEditRequestService();
