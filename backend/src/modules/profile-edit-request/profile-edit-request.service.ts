import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';

type Category = 'PERSONAL_DETAILS' | 'ADDRESS' | 'EMERGENCY_CONTACT' | 'BANK_DETAILS';

const CATEGORY_LABELS: Record<Category, string> = {
  PERSONAL_DETAILS: 'Personal Details',
  ADDRESS: 'Address',
  EMERGENCY_CONTACT: 'Emergency Contact',
  BANK_DETAILS: 'Bank Details',
};

const ALLOWED_FIELDS_BY_CATEGORY: Record<Category, string[]> = {
  PERSONAL_DETAILS: ['firstName', 'lastName', 'dateOfBirth', 'gender', 'bloodGroup', 'maritalStatus', 'phone', 'personalEmail'],
  ADDRESS: ['line1', 'line2', 'city', 'state', 'pincode', 'country'],
  EMERGENCY_CONTACT: ['name', 'relationship', 'phone', 'email'],
  BANK_DETAILS: ['accountHolderName', 'accountType', 'bankName', 'bankAccountNumber', 'ifscCode'],
};

export class ProfileEditRequestService {
  async create(employeeId: string, organizationId: string, category: Category, requestedData: any) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true, organizationId: true },
    });
    if (!employee) throw new NotFoundError('Employee');

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

    // Notify HR via email (non-blocking)
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { adminNotificationEmail: true, name: true },
    });
    const hrEmail = org?.adminNotificationEmail;
    if (hrEmail) {
      enqueueEmail({
        to: hrEmail,
        subject: `Profile Edit Request — ${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
        template: 'profile-edit-request-hr',
        context: {
          employeeName: `${employee.firstName} ${employee.lastName}`,
          employeeCode: employee.employeeCode,
          category: CATEGORY_LABELS[category],
          orgName: org?.name || '',
        },
      }).catch(() => {});
    }

    return request;
  }

  async listForEmployee(employeeId: string) {
    return prisma.profileEditRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
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

    // Email employee
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
    const sanitized: Record<string, any> = {};
    for (const key of allowed) {
      if (data[key] !== undefined) sanitized[key] = data[key];
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
        bankAccountNumber: sanitized.bankAccountNumber,
        ifscCode: sanitized.ifscCode,
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
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        firstName: true, lastName: true, dateOfBirth: true, gender: true, phone: true,
        address: true, emergencyContact: true,
        bankAccountNumber: true, bankName: true, ifscCode: true, accountHolderName: true,
        onboardingComplete: true,
        documents: { where: { deletedAt: null }, select: { type: true } },
      },
    });
    if (!emp) throw new NotFoundError('Employee');

    const REQUIRED_DOC_TYPES = [
      'AADHAAR', 'PAN', 'TENTH_CERTIFICATE', 'DEGREE_CERTIFICATE',
      'RESIDENCE_PROOF', 'PHOTO', 'BANK_STATEMENT', 'CANCELLED_CHEQUE',
    ];
    const uploadedDocTypes = emp.documents.map((d: any) => d.type);
    const missingDocs = REQUIRED_DOC_TYPES.filter(t => !uploadedDocTypes.includes(t));

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
