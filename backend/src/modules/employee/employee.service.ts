import bcrypt from 'bcryptjs';
import crypto, { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, ConflictError, BadRequestError, AppError } from '../../middleware/errorHandler.js';
import { storageService } from '../../services/storage.service.js';
import { enqueueEmail, enqueueNotification, payrollQueue } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { leavePolicyService } from '../leave/leave-policy.service.js';
import type { CreateEmployeeInput, UpdateEmployeeInput, EmployeeQuery, SubmitResignationInput, ApproveExitInput, InitiateTerminationInput, ExitQuery } from './employee.validation.js';

export class EmployeeService {
  async list(query: EmployeeQuery, organizationId: string) {
    const { page, limit, search, department, designation, role, status, workMode, onboardingStatus, managerId, officeLocationId, joiningDateFrom, joiningDateTo, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId,
      deletedAt: null,
      isSystemAccount: { not: true },
    };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    if (department) where.departmentId = department;
    if (designation) where.designationId = designation;
    if (status) where.status = status;
    if (workMode) where.workMode = workMode;
    if (managerId) where.managerId = managerId;
    if (officeLocationId) where.officeLocationId = officeLocationId;
    if (role) where.user = { role };
    if (onboardingStatus === 'complete') where.onboardingComplete = true;
    if (onboardingStatus === 'pending') where.onboardingComplete = false;
    if (joiningDateFrom || joiningDateTo) {
      where.joiningDate = {};
      if (joiningDateFrom) where.joiningDate.gte = new Date(joiningDateFrom);
      if (joiningDateTo) where.joiningDate.lte = new Date(joiningDateTo);
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          user: { select: { id: true, role: true, status: true, lastLoginAt: true } },
          manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true, deletedAt: true } },
          officeLocation: { select: { id: true, name: true } },
          shiftAssignments: {
            where: { endDate: null },
            take: 1,
            orderBy: { startDate: 'desc' as const },
            include: { shift: { select: { id: true, name: true, shiftType: true, startTime: true, endTime: true } } },
          },
          documentGate: { select: { kycStatus: true } },
        },
      }),
      prisma.employee.count({ where }),
    ]);

    // Bulk attendance check — one query for all employees on the current page
    const employeeIds = employees.map((e: any) => e.id);
    const todayAttendance = await prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        checkIn: { gte: startOfToday, lt: startOfTomorrow },
      },
      select: { employeeId: true },
    });
    const checkedInIds = new Set(todayAttendance.map((r: any) => r.employeeId));

    const enriched = employees.map((emp: any) => {
      const activeAssignment = emp.shiftAssignments?.[0];
      // Filter out soft-deleted manager from response
      const manager = (emp.manager && !emp.manager.deletedAt) ? emp.manager : null;

      // Decrypt sensitive fields (AES-256-GCM; fall back for legacy plaintext, null for unreadable ciphertext)
      let panNumber = emp.panNumber ?? null;
      if (panNumber) {
        try { panNumber = decrypt(panNumber); } catch {
          // Valid PAN looks like ABCDE1234F; anything else is unreadable ciphertext → null
          if (!/^[A-Z]{5}\d{4}[A-Z]$/i.test(panNumber)) panNumber = null;
        }
      }
      let bankAccountNumber = emp.bankAccountNumber ?? null;
      if (bankAccountNumber) {
        try { bankAccountNumber = decrypt(bankAccountNumber); } catch {
          // Valid legacy plaintext is digits-only 9-18 chars; anything else is ciphertext → null
          if (!/^\d{9,18}$/.test(bankAccountNumber)) bankAccountNumber = null;
        }
      }

      return {
        ...emp,
        panNumber,
        bankAccountNumber,
        manager,
        hasShift: !!activeAssignment,
        currentShift: activeAssignment?.shift || null,
        shiftAssignments: undefined,
        kycStatus: emp.documentGate?.kycStatus ?? null,
        documentGate: undefined,
        hasCheckedInToday: checkedInIds.has(emp.id),
      };
    });

    return {
      data: enriched,
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

  async getStats(organizationId: string) {
    const base = { organizationId, deletedAt: null, isSystemAccount: { not: true as const } };

    const results = await Promise.allSettled([
      prisma.employee.count({ where: base }),
      prisma.employee.count({ where: { ...base, status: 'ACTIVE' } }),
      prisma.employee.count({ where: { ...base, status: 'PROBATION' } }),
      prisma.employee.count({ where: { ...base, status: 'INACTIVE' } }),
      prisma.employee.count({ where: { ...base, status: 'ONBOARDING' } }),
      prisma.employee.count({ where: { ...base, status: 'NOTICE_PERIOD' } }),
      prisma.employee.count({ where: { ...base, status: 'TERMINATED' } }),
      prisma.employeeInvitation.count({ where: { organizationId, status: 'PENDING' } }),
    ]);
    const [total, active, probation, inactive, onboarding, noticePeriod, terminated, invited] = results.map(r => r.status === 'fulfilled' ? r.value : 0);
    return { total, active, probation, inactive, onboarding, noticePeriod, terminated, invited };
  }

  async getById(id: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        department: true,
        designation: true,
        manager: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, deletedAt: true },
        },
        officeLocation: true,
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
        user: {
          select: { id: true, email: true, role: true, status: true, lastLoginAt: true, microsoftId: true },
        },
        lifecycleEvents: {
          orderBy: { eventDate: 'desc' },
          take: 50,
        },
        shiftAssignments: {
          where: { endDate: null },
          take: 1,
          orderBy: { startDate: 'desc' as const },
          include: { shift: { select: { id: true, name: true, shiftType: true, startTime: true, endTime: true } } },
        },
        documentGate: {
          select: { kycStatus: true, reuploadDocTypes: true, documentRejectReasons: true },
        },
        leaveBalances: {
          where: { year: new Date().getFullYear() },
          include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true } } },
          orderBy: { createdAt: 'asc' as const },
        },
        leaveRequests: {
          where: {
            status: { in: ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] },
            startDate: { gte: new Date(new Date().getFullYear(), 0, 1) },
          },
          include: { leaveType: { select: { id: true, name: true, code: true } } },
          orderBy: { createdAt: 'desc' as const },
          take: 20,
        },
      },
    });

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    const activeAssignment = (employee as any).shiftAssignments?.[0];
    // Filter out soft-deleted manager from response
    const manager = (employee.manager && !(employee.manager as any).deletedAt) ? employee.manager : null;

    // Decrypt sensitive fields (stored as AES-256-GCM ciphertext; fall back for legacy plaintext, null for unreadable ciphertext)
    let panNumber = (employee as any).panNumber ?? null;
    if (panNumber) {
      try { panNumber = decrypt(panNumber); } catch {
        // Valid PAN looks like ABCDE1234F; anything else is unreadable ciphertext → null
        if (!/^[A-Z]{5}\d{4}[A-Z]$/i.test(panNumber)) panNumber = null;
      }
    }
    let bankAccountNumber = (employee as any).bankAccountNumber ?? null;
    if (bankAccountNumber) {
      try { bankAccountNumber = decrypt(bankAccountNumber); } catch {
        // Valid legacy plaintext is digits-only 9-18 chars; anything else is ciphertext → null
        if (!/^\d{9,18}$/.test(bankAccountNumber)) bankAccountNumber = null;
      }
    }

    return {
      ...employee,
      panNumber,
      bankAccountNumber,
      manager,
      hasShift: !!activeAssignment,
      currentShift: activeAssignment?.shift || null,
      shiftAssignments: undefined,
    };
  }

  async create(data: CreateEmployeeInput, organizationId: string, createdBy: string) {
    // Check for duplicate email
    const existing = await prisma.employee.findFirst({
      where: { email: data.email.toLowerCase(), organizationId, deletedAt: null },
    });
    if (existing) {
      throw new ConflictError('An employee with this email already exists');
    }

    // Require department for non-onboarding employees
    const createStatus = (data as any).status as string | undefined;
    if (createStatus && !['ONBOARDING', 'INTERN'].includes(createStatus) && !data.departmentId) {
      throw new BadRequestError('Department is required for active employees');
    }
    // If no status provided (defaults to ONBOARDING), department not required

    // Generate employee code
    const employeeCode = await this.generateEmployeeCode(organizationId);

    // Create user account
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    let result: Awaited<ReturnType<typeof prisma.$transaction<any>>>;
    try {
      result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: data.email.toLowerCase(),
            passwordHash,
            role: 'EMPLOYEE',
            status: 'ACTIVE',
            organizationId,
          },
        });

        const employee = await tx.employee.create({
          data: {
            employeeCode,
            userId: user.id,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email.toLowerCase(),
            phone: data.phone,
            personalEmail: data.personalEmail || null,
            dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
            gender: data.gender,
            bloodGroup: data.bloodGroup || null,
            maritalStatus: data.maritalStatus || null,
            departmentId: data.departmentId || null,
            designationId: data.designationId || null,
            workMode: data.workMode,
            officeLocationId: data.officeLocationId || null,
            managerId: data.managerId || null,
            joiningDate: new Date(data.joiningDate),
            probationEndDate: data.probationEndDate ? new Date(data.probationEndDate) : null,
            ctc: data.ctc || null,
            address: data.address || null,
            emergencyContact: (data.emergencyContact || null) as any,
            bankAccountNumber: (data as any).bankAccountNumber ? encrypt((data as any).bankAccountNumber) : null,
            bankName: (data as any).bankName || null,
            ifscCode: (data as any).ifscCode || null,
            accountHolderName: (data as any).accountHolderName || null,
            accountType: (data as any).accountType || null,
            panNumber: (data as any).panNumber ? encrypt((data as any).panNumber) : null,
            epfUan: (data as any).epfUan || null,
            epfMemberId: (data as any).epfMemberId || null,
            status: (createStatus as any) || 'ONBOARDING',
            organizationId,
          },
          include: {
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
          },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: createdBy,
            entity: 'Employee',
            entityId: employee.id,
            action: 'CREATE',
            newValue: { employeeCode, firstName: data.firstName, lastName: data.lastName, email: data.email },
            organizationId,
          },
        });

        return { employee, tempPassword };
      });
    } catch (err: any) {
      if (err instanceof ConflictError || err instanceof BadRequestError) throw err;
      logger.error(`[Employee] create() transaction failed: ${err.message}`);
      throw new AppError('Failed to create employee record. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    // Best-effort: seed LeaveBalance rows for each active leave type
    try {
      const leaveTypes = await prisma.leaveType.findMany({
        where: { organizationId, isActive: true, deletedAt: null },
        select: { id: true, defaultBalance: true },
      });
      if (leaveTypes.length > 0) {
        const currentYear = new Date().getFullYear();
        await prisma.leaveBalance.createMany({
          data: leaveTypes.map((lt) => ({
            employeeId: result.employee.id,
            leaveTypeId: lt.id,
            organizationId,
            year: currentYear,
            allocated: lt.defaultBalance,
          })),
          skipDuplicates: true,
        });
      }
    } catch (err: any) {
      logger.warn(`[Employee] create() leave balance seeding failed (non-blocking): ${err.message}`);
    }

    // Best-effort: auto-assign default shift to new employee
    try {
      const { shiftService } = await import('../shift/shift.service.js');
      await shiftService.autoAssignDefaultShift(organizationId, createdBy);
    } catch { /* non-blocking — shift assignment is not critical for employee creation */ }

    return result;
  }

  /**
   * Invite-only employee creation: HR enters just email, employee self-onboards
   */
  async inviteEmployee(email: string, organizationId: string, createdBy: string, firstName?: string, lastName?: string) {
    const normalizedEmail = email.toLowerCase();

    // Check duplicate
    const existing = await prisma.employee.findFirst({
      where: { email: normalizedEmail, organizationId, deletedAt: null },
    });
    if (existing) throw new ConflictError('An employee with this email already exists');

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) throw new ConflictError('A user account with this email already exists');

    const employeeCode = await this.generateEmployeeCode(organizationId);
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    let result: any;
    try {
      result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: 'EMPLOYEE',
            status: 'PENDING_VERIFICATION',
            organizationId,
          },
        });

        const employee = await tx.employee.create({
          data: {
            employeeCode,
            userId: user.id,
            firstName: firstName || normalizedEmail.split('@')[0],
            lastName: lastName || 'Pending',
            email: normalizedEmail,
            phone: '0000000000',
            gender: 'PREFER_NOT_TO_SAY',
            workMode: 'OFFICE',
            joiningDate: new Date(),
            status: 'ONBOARDING',
            organizationId,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: createdBy,
            entity: 'Employee',
            entityId: employee.id,
            action: 'CREATE',
            newValue: { employeeCode, email: normalizedEmail, type: 'INVITE' },
            organizationId,
          },
        });

        return { user, employee };
      });
    } catch (err: any) {
      if (err instanceof ConflictError || err instanceof BadRequestError) throw err;
      logger.error(`[Employee] inviteEmployee() transaction failed: ${err.message}`);
      throw new AppError('Failed to create invited employee record. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    // Generate onboarding token
    const token = randomBytes(32).toString('hex');
    await redis.setex(`onboarding:${token}`, 7 * 86400, JSON.stringify({
      employeeId: result.employee.id,
      email: normalizedEmail,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      currentStep: 1,
      stepData: {},
    }));

    const onboardingUrl = `/onboarding/${token}`;

    // Send invitation email — non-blocking: employee creation must not fail due to email queue issues
    enqueueEmail({
      to: normalizedEmail,
      subject: 'Welcome to Aniston Technologies — Complete Your Onboarding',
      template: 'onboarding-invite',
      context: {
        name: firstName || normalizedEmail.split('@')[0],
        link: `https://hr.anistonav.com${onboardingUrl}`,
      },
    }).catch((err) => logger.error(`[Employee] Failed to queue onboarding invite email to ${normalizedEmail}:`, err));

    return {
      employee: result.employee,
      employeeCode,
      onboardingUrl,
    };
  }

  async update(id: string, data: UpdateEmployeeInput, organizationId: string, updatedBy: string, callerRole?: string) {
    const existing = await prisma.employee.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundError('Employee');
    }

    // Field-level permission control
    // CTC: SUPER_ADMIN, ADMIN, HR only
    const CTC_ALLOWED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    // Status + org fields: SUPER_ADMIN, ADMIN, HR only
    const MANAGEMENT_ONLY_FIELDS = ['status', 'joiningDate', 'probationEndDate', 'officeLocationId', 'email'];
    // workMode is always stripped here — it is derived from ShiftAssignment and only shift.service.ts may write it
    delete (data as any)['workMode'];

    if (callerRole && !CTC_ALLOWED_ROLES.includes(callerRole)) {
      delete (data as any)['ctc'];
    }
    if (callerRole && !['SUPER_ADMIN', 'ADMIN', 'HR'].includes(callerRole)) {
      for (const field of MANAGEMENT_ONLY_FIELDS) {
        delete (data as any)[field];
      }
    }

    // EMPLOYEE/INTERN cannot directly update personal/bank/EPF fields — must use profile-edit-request flow
    // bankBranchName is intentionally excluded: employees may update it directly (one-time fill campaign)
    const APPROVAL_REQUIRED_FIELDS = [
      'firstName', 'lastName', 'dateOfBirth', 'gender', 'bloodGroup', 'maritalStatus',
      'phone', 'personalEmail', 'address', 'permanentAddress', 'emergencyContact',
      'bankAccountNumber', 'bankName', 'ifscCode', 'accountHolderName', 'accountType',
      'epfMemberId', 'epfUan', 'epfEnabled',
    ];
    if (callerRole && ['EMPLOYEE', 'INTERN'].includes(callerRole)) {
      for (const field of APPROVAL_REQUIRED_FIELDS) {
        delete (data as any)[field];
      }
    }

    // --- Manager validation (org chart integrity) ---
    if (data.managerId !== undefined) {
      if (data.managerId !== null) {
        // Cannot assign self as manager
        if (data.managerId === id) {
          throw new BadRequestError('An employee cannot be their own manager');
        }
        // Validate manager exists, same org, active, and not deleted
        const manager = await prisma.employee.findFirst({
          where: { id: data.managerId, organizationId, deletedAt: null },
        });
        if (!manager) {
          throw new BadRequestError('Manager not found or is not active in this organization');
        }
        // Circular reference detection — walk up the chain from the proposed manager
        const visited = new Set<string>();
        let currentId: string | null = data.managerId;
        while (currentId) {
          if (currentId === id) {
            throw new BadRequestError('Cannot assign this manager — it would create a circular reporting structure');
          }
          if (visited.has(currentId)) break; // already-existing cycle safeguard
          visited.add(currentId);
          const parent: { managerId: string | null } | null = await prisma.employee.findFirst({
            where: { id: currentId, organizationId, deletedAt: null },
            select: { managerId: true },
          });
          currentId = parent?.managerId || null;
        }
      }
    }

    // Check email uniqueness if changed
    if (data.email && data.email.toLowerCase() !== existing.email) {
      const duplicate = await prisma.employee.findFirst({
        where: { email: data.email.toLowerCase(), organizationId, deletedAt: null, id: { not: id } },
      });
      if (duplicate) {
        throw new ConflictError('An employee with this email already exists');
      }
    }

    // Prevent removing department from ACTIVE/PROBATION employees
    const targetStatus = data.status ?? existing.status;
    if (data.departmentId === null && !['ONBOARDING', 'TERMINATED', 'INTERN'].includes(targetStatus)) {
      throw new BadRequestError('Department cannot be removed from active employees');
    }

    // Enforce valid status transitions for non-management roles only.
    // HR, ADMIN, and SUPER_ADMIN can freely set any status.
    const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
    if (data.status && data.status !== existing.status && !MANAGEMENT_ROLES.includes(callerRole || '')) {
      const VALID_TRANSITIONS: Record<string, string[]> = {
        'ONBOARDING': ['PROBATION', 'ACTIVE', 'INTERN', 'INACTIVE'],
        'PROBATION': ['ACTIVE', 'INTERN', 'NOTICE_PERIOD', 'INACTIVE', 'TERMINATED'],
        'INTERN': ['PROBATION', 'ACTIVE', 'NOTICE_PERIOD', 'INACTIVE', 'TERMINATED'],
        'ACTIVE': ['NOTICE_PERIOD', 'INACTIVE', 'SUSPENDED'],
        'NOTICE_PERIOD': ['TERMINATED', 'ACTIVE'],
        'SUSPENDED': ['ACTIVE', 'TERMINATED'],
        'INACTIVE': ['ACTIVE', 'ONBOARDING'],
        'TERMINATED': ['ACTIVE'], // rehire
        'ABSCONDED': ['TERMINATED', 'ACTIVE'],
      };
      const allowed = VALID_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        throw new BadRequestError(`Cannot transition from ${existing.status} to ${data.status}. Allowed: ${allowed.join(', ')}`);
      }
    }

    // Extract shiftId and experienceLevel before building updateData
    const shiftId: string | null | undefined = (data as any).shiftId;
    const incomingExperienceLevel: string | undefined = (data as any).experienceLevel;
    const updateData: any = { ...data };
    delete updateData.shiftId; // never pass shiftId into employee.update
    if (data.email) updateData.email = data.email.toLowerCase();

    // Date fields: convert non-empty strings to Date objects; delete empty strings
    // because Prisma 6 rejects '' for DateTime fields (PrismaClientValidationError)
    if (data.dateOfBirth) updateData.dateOfBirth = new Date(data.dateOfBirth);
    else delete updateData.dateOfBirth;

    if (data.joiningDate) updateData.joiningDate = new Date(data.joiningDate);

    if (data.probationEndDate) updateData.probationEndDate = new Date(data.probationEndDate);
    else delete updateData.probationEndDate;

    // Validate IFSC format when it's being updated (Issue 10)
    if (updateData.ifscCode) {
      const ifscNorm = String(updateData.ifscCode).toUpperCase().trim();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscNorm)) {
        throw new BadRequestError('Invalid IFSC code. Format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)');
      }
      updateData.ifscCode = ifscNorm;
    }

    // Encrypt sensitive fields before writing to DB
    if (updateData.panNumber) updateData.panNumber = encrypt(updateData.panNumber);
    if (updateData.bankAccountNumber) updateData.bankAccountNumber = encrypt(updateData.bankAccountNumber);

    let employee: any;
    try {
      employee = await prisma.$transaction(async (tx) => {
        const updated = await tx.employee.update({
          where: { id },
          data: updateData,
          include: {
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, name: true } },
          },
        });

        // Update user email if changed
        if (data.email && existing.userId) {
          await tx.user.update({
            where: { id: existing.userId },
            data: { email: data.email.toLowerCase() },
          });
        }

        // CTC change → create SalaryHistory record
        if (data.ctc !== undefined && Number(existing.ctc) !== Number(data.ctc)) {
          await tx.salaryHistory.create({
            data: {
              employeeId: id,
              organizationId,
              previousCtc: existing.ctc ? Number(existing.ctc) : 0,
              ctc: Number(data.ctc),
              effectiveFrom: new Date(),
              changeType: 'REVISION',
              changedBy: updatedBy,
              reason: 'CTC updated via employee profile',
            },
          });
        }

        // Shift assignment: end current active assignment, create new one
        if (shiftId !== undefined) {
          if (shiftId) {
            // End any current active assignment
            await tx.shiftAssignment.updateMany({
              where: { employeeId: id, endDate: null },
              data: { endDate: new Date() },
            });
            // Create new assignment
            await tx.shiftAssignment.create({
              data: {
                employeeId: id,
                shiftId,
                startDate: new Date(),
                assignedBy: updatedBy,
              },
            });
          } else {
            // shiftId = null → remove shift assignment
            await tx.shiftAssignment.updateMany({
              where: { employeeId: id, endDate: null },
              data: { endDate: new Date() },
            });
          }
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: updatedBy,
            entity: 'Employee',
            entityId: id,
            action: 'UPDATE',
            oldValue: existing,
            newValue: updateData,
            organizationId,
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (err instanceof ConflictError || err instanceof BadRequestError || err instanceof NotFoundError) throw err;
      logger.error(`[Employee] update() transaction failed: ${err.message}`);
      throw new AppError('Failed to update employee record. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    // Sync experienceLevel change → OnboardingDocumentGate so onboarding wizard
    // immediately reflects the correct required documents (e.g. EXPERIENCED → employment proof required)
    if (incomingExperienceLevel && incomingExperienceLevel !== (existing as any).experienceLevel) {
      try {
        const { documentGateService } = await import('../onboarding/document-gate.service.js');
        const gate = await prisma.onboardingDocumentGate.findUnique({ where: { employeeId: id } });
        if (gate && gate.kycStatus !== 'VERIFIED') {
          const fresherOrExperienced = incomingExperienceLevel === 'EXPERIENCED' ? 'EXPERIENCED' : 'FRESHER';
          await documentGateService.saveKycConfig(
            id,
            (gate.uploadMode as string) || 'SEPARATE',
            fresherOrExperienced,
            (gate.highestQualification as string) || 'GRADUATION',
          );
        }
      } catch (err: any) {
        logger.warn(`[Employee] update() gate sync for experienceLevel change failed (non-blocking): ${err.message}`);
      }
    }

    // Auto-create lifecycle events on key field changes
    if (data.status && data.status !== existing.status) {
      await prisma.employeeEvent.create({
        data: {
          employeeId: id,
          eventType: 'STATUS_CHANGE',
          title: `Status changed from ${existing.status} to ${data.status}`,
          description: `Employee status updated by HR`,
          eventDate: new Date(),
          metadata: { oldStatus: existing.status, newStatus: data.status },
          createdBy: updatedBy,
        },
      });

      // On any status change that affects leave eligibility:
      // 1. Remove LeaveBalance rows for leave types that no longer apply to the new status
      //    (only if the balance is unused — preserve any used/pending days)
      // 2. Call the policy engine to create/update balances for the new status
      // 3. For PROBATION/INTERN → ACTIVE graduations, apply prorata ACTIVE allocation
      const LEAVE_ELIGIBLE_STATUSES = ['ACTIVE', 'PROBATION', 'INTERN'];
      const newStatus = data.status;
      const oldStatus = existing.status;

      if (LEAVE_ELIGIBLE_STATUSES.includes(newStatus) || LEAVE_ELIGIBLE_STATUSES.includes(oldStatus)) {
        try {
          const currentYear = new Date().getFullYear();
          const POLICY_MANAGED_AUDIENCES = ['ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE'];

          // Step A: Determine which leave types are NO LONGER applicable under new status
          if (LEAVE_ELIGIBLE_STATUSES.includes(oldStatus) && LEAVE_ELIGIBLE_STATUSES.includes(newStatus) && oldStatus !== newStatus) {
            const isNewTrainee = newStatus === 'PROBATION' || newStatus === 'INTERN';
            const isNewActive = newStatus === 'ACTIVE';

            // Find balances whose leave type audience conflicts with the new status
            const staleCandidates = await prisma.leaveBalance.findMany({
              where: { employeeId: id, year: currentYear, deletedAt: null },
              include: { leaveType: { select: { id: true, applicableTo: true, isActive: true } } },
            });

            for (const bal of staleCandidates) {
              const lt = bal.leaveType;
              if (!lt || !POLICY_MANAGED_AUDIENCES.includes(lt.applicableTo as string)) continue;

              const app = lt.applicableTo as string;
              const isApplicableUnderNew =
                app === 'ALL_ELIGIBLE' ||
                (app === 'ACTIVE_ONLY' && isNewActive) ||
                (app === 'TRAINEE_ONLY' && isNewTrainee);

              if (!isApplicableUnderNew) {
                const used = Number(bal.used);
                const pending = Number(bal.pending);
                if (used === 0 && pending === 0) {
                  // Safe to remove — no history for this employee on this type
                  await prisma.leaveBalance.delete({ where: { id: bal.id } });
                  logger.info(`[Employee] Removed stale ${lt.applicableTo} LeaveBalance for employee ${id} (status ${oldStatus}→${newStatus})`);
                } else {
                  // Has history — zero out the allocation instead of deleting
                  await (prisma.leaveBalance.update as any)({
                    where: { id: bal.id },
                    data: { policyAllocated: 0, allocated: used + pending },
                  });
                  logger.info(`[Employee] Zeroed stale ${lt.applicableTo} LeaveBalance (has ${used}u/${pending}p) for employee ${id}`);
                }
              }
            }
          }

          // Step B: Apply prorata graduation if moving from trainee → ACTIVE
          const isGraduation = (oldStatus === 'PROBATION' || oldStatus === 'INTERN') && newStatus === 'ACTIVE';
          if (isGraduation) {
            const graduation = await leavePolicyService.applyProbationGraduation(id, currentYear, updatedBy);
            if (graduation.adjusted.length > 0) {
              logger.info(`[Employee] Probation graduation prorata for ${id}: ${JSON.stringify(graduation.adjusted)}`);
            }
          }

          // Step C: Allocate new status leave types via policy engine
          if (LEAVE_ELIGIBLE_STATUSES.includes(newStatus)) {
            const result = await leavePolicyService.allocateForEmployee(id, currentYear, { triggeredBy: updatedBy });
            logger.info(`[Employee] Policy re-allocation after status change for ${id}: created=${result.created}, updated=${result.updated}, skipped=${result.skipped}`);
          }
        } catch (err: any) {
          logger.warn(`[Employee] Leave balance re-allocation on status change failed (non-blocking): ${err.message}`);
        }
      }
    }

    if (data.departmentId && data.departmentId !== existing.departmentId) {
      await prisma.employeeEvent.create({
        data: {
          employeeId: id,
          eventType: 'TRANSFER',
          title: 'Department changed',
          description: `Department updated by HR`,
          eventDate: new Date(),
          metadata: { oldDepartmentId: existing.departmentId, newDepartmentId: data.departmentId },
          createdBy: updatedBy,
        },
      });
    }

    if (data.designationId && data.designationId !== existing.designationId) {
      await prisma.employeeEvent.create({
        data: {
          employeeId: id,
          eventType: 'PROMOTION',
          title: 'Designation changed',
          description: `Designation updated by HR`,
          eventDate: new Date(),
          metadata: { oldDesignationId: existing.designationId, newDesignationId: data.designationId },
          createdBy: updatedBy,
        },
      });
    }

    if (data.joiningDate && new Date(data.joiningDate).getTime() !== new Date(existing.joiningDate).getTime()) {
      await prisma.employeeEvent.create({
        data: {
          employeeId: id,
          eventType: 'STATUS_CHANGE',
          title: 'Joining date updated',
          description: `Joining date changed from ${existing.joiningDate?.toLocaleDateString()} to ${new Date(data.joiningDate).toLocaleDateString()}`,
          eventDate: new Date(),
          metadata: { oldJoiningDate: existing.joiningDate, newJoiningDate: data.joiningDate },
          createdBy: updatedBy,
        },
      });
    }

    // Manager change lifecycle event (org chart audit trail)
    if (data.managerId !== undefined && data.managerId !== existing.managerId) {
      let oldManagerName = 'None';
      let newManagerName = 'None (Root)';
      if (existing.managerId) {
        const oldMgr = await prisma.employee.findFirst({ where: { id: existing.managerId }, select: { firstName: true, lastName: true } });
        if (oldMgr) oldManagerName = `${oldMgr.firstName} ${oldMgr.lastName}`;
      }
      if (data.managerId) {
        const newMgr = await prisma.employee.findFirst({ where: { id: data.managerId }, select: { firstName: true, lastName: true } });
        if (newMgr) newManagerName = `${newMgr.firstName} ${newMgr.lastName}`;
      }
      await prisma.employeeEvent.create({
        data: {
          employeeId: id,
          eventType: 'TRANSFER',
          title: 'Reporting manager changed',
          description: `Manager changed from ${oldManagerName} to ${newManagerName}`,
          eventDate: new Date(),
          metadata: { oldManagerId: existing.managerId, newManagerId: data.managerId, oldManagerName, newManagerName },
          createdBy: updatedBy,
        },
      });
    }

    return employee;
  }

  async changeRole(employeeId: string, role: string, organizationId: string, changedBy: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: { user: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (!employee.userId) throw new BadRequestError('Employee has no linked user account');

    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN', 'GUEST_INTERVIEWER'];
    if (!validRoles.includes(role)) throw new BadRequestError(`Invalid role: ${role}`);

    const oldRole = employee.user?.role;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: employee.userId! }, data: { role: role as any } });
        await tx.auditLog.create({
          data: {
            userId: changedBy,
            entity: 'User',
            entityId: employee.userId!,
            action: 'UPDATE',
            oldValue: { role: oldRole },
            newValue: { role },
            organizationId,
          },
        });
      });
    } catch (err: any) {
      if (err instanceof ConflictError || err instanceof BadRequestError || err instanceof NotFoundError) throw err;
      logger.error(`[Employee] changeRole() transaction failed: ${err.message}`);
      throw new AppError('Failed to update employee role. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    return { employeeId, userId: employee.userId, oldRole, newRole: role };
  }

  async updateJoiningDate(employeeId: string, joiningDate: string, organizationId: string, updatedBy: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
    });
    if (!employee) throw new NotFoundError('Employee');

    const parsedDate = new Date(joiningDate);
    if (isNaN(parsedDate.getTime())) throw new BadRequestError('Invalid date format for joiningDate');

    const oldDate = employee.joiningDate;
    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: { joiningDate: parsedDate },
    });

    await createAuditLog({
      userId: updatedBy, organizationId,
      entity: 'Employee', entityId: employeeId,
      action: 'UPDATE',
      oldValue: { joiningDate: oldDate },
      newValue: { joiningDate: parsedDate },
    });

    return { employeeId, joiningDate: updated.joiningDate, onboardingDate: updated.onboardingDate };
  }

  async softDelete(id: string, organizationId: string, deletedBy: string) {
    const existing = await prisma.employee.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { documents: { select: { id: true } } },
    });
    if (!existing) {
      throw new NotFoundError('Employee');
    }

    // Prevent deleting system accounts
    if ((existing as any).isSystemAccount) {
      throw new BadRequestError('System accounts cannot be deleted');
    }

    // Save info for audit log before deletion
    const auditData = {
      firstName: existing.firstName,
      lastName: existing.lastName,
      employeeCode: existing.employeeCode,
      email: existing.email,
      permanent: true,
    };

    // ── Phase 1: Best-effort cleanup (individual operations, NOT in a transaction) ──
    // CRITICAL: PostgreSQL error 25P02 ("current transaction is aborted") means that
    // once ANY statement inside a $transaction fails, ALL subsequent statements in that
    // transaction fail too — even if the first error was caught by try/catch.
    // Running each deleteMany as an independent Prisma call avoids this cascade failure.
    const docIds = existing.documents.map(d => d.id);

    const bestEffortDeletions: Array<{ name: string; fn: () => Promise<any> }> = [
      { name: 'DocumentOcrVerification', fn: () => prisma.documentOcrVerification.deleteMany({ where: { documentId: { in: docIds.length ? docIds : ['none'] } } }) },
      { name: 'Document', fn: () => prisma.document.deleteMany({ where: { employeeId: id } }) },
      { name: 'OnboardingDocumentGate', fn: () => prisma.onboardingDocumentGate.deleteMany({ where: { employeeId: id } }) },
      { name: 'LeaveBalance', fn: () => prisma.leaveBalance.deleteMany({ where: { employeeId: id } }) },
      { name: 'LeaveRequest', fn: () => prisma.leaveRequest.deleteMany({ where: { employeeId: id } }) },
      // Attendance — delete child records first (Break, AttendanceLog depend on AttendanceRecord)
      { name: 'AttendanceLog', fn: async () => {
        const attRecords = await prisma.attendanceRecord.findMany({ where: { employeeId: id }, select: { id: true } });
        const attIds = attRecords.map(r => r.id);
        if (attIds.length) {
          await prisma.attendanceLog.deleteMany({ where: { attendanceId: { in: attIds } } });
          await prisma.break.deleteMany({ where: { attendanceId: { in: attIds } } });
          await prisma.attendanceRegularization.deleteMany({ where: { attendanceId: { in: attIds } } });
        }
      }},
      { name: 'AttendanceRecord', fn: () => prisma.attendanceRecord.deleteMany({ where: { employeeId: id } }) },
      { name: 'GPSTrailPoint', fn: () => prisma.gPSTrailPoint.deleteMany({ where: { employeeId: id } }) },
      { name: 'ProjectSiteCheckIn', fn: () => prisma.projectSiteCheckIn.deleteMany({ where: { employeeId: id } }) },
      { name: 'ShiftAssignment', fn: () => prisma.shiftAssignment.deleteMany({ where: { employeeId: id } }) },
      { name: 'HybridSchedule', fn: () => prisma.hybridSchedule.deleteMany({ where: { employeeId: id } }) },
      { name: 'SalaryStructure', fn: () => prisma.salaryStructure.deleteMany({ where: { employeeId: id } }) },
      { name: 'PayrollRecord', fn: () => prisma.payrollRecord.deleteMany({ where: { employeeId: id } }) },
      { name: 'PerformanceReview', fn: () => prisma.performanceReview.deleteMany({ where: { employeeId: id } }) },
      { name: 'AssetAssignment', fn: () => prisma.assetAssignment.deleteMany({ where: { employeeId: id } }) },
      { name: 'Ticket', fn: () => prisma.ticket.deleteMany({ where: { employeeId: id } }) },
      { name: 'ActivityLog', fn: () => prisma.activityLog.deleteMany({ where: { employeeId: id } }) },
      { name: 'AgentScreenshot', fn: () => prisma.agentScreenshot.deleteMany({ where: { employeeId: id } }) },
      { name: 'ExitChecklist', fn: () => prisma.exitChecklist.deleteMany({ where: { employeeId: id } }) },
      { name: 'ExitAccessConfig', fn: () => prisma.exitAccessConfig.deleteMany({ where: { employeeId: id } }) },
      { name: 'InternProfile', fn: () => prisma.internProfile.deleteMany({ where: { employeeId: id } }) },
      { name: 'SalaryVisibilityRule', fn: () => prisma.salaryVisibilityRule.deleteMany({ where: { employeeId: id } }) },
      { name: 'PermissionOverride', fn: () => prisma.permissionOverride.deleteMany({ where: { employeeId: id } }) },
      { name: 'EmployeeEvent', fn: () => prisma.employeeEvent.deleteMany({ where: { employeeId: id } }) },
      { name: 'Goal', fn: () => prisma.goal.deleteMany({ where: { employeeId: id } }) },
      { name: 'PolicyAcknowledgment', fn: () => prisma.policyAcknowledgment.deleteMany({ where: { employeeId: id } }) },
      { name: 'EmployeeActivation', fn: () => prisma.employeeActivation.deleteMany({ where: { employeeId: id } }) },
      { name: 'SalaryHistory', fn: () => prisma.salaryHistory.deleteMany({ where: { employeeId: id } }) },
      // Null out deletion request FK references
      { name: 'EmployeeDeletionRequest(employeeId)', fn: async () => {
        const drModel = (prisma as any).employeeDeletionRequest;
        if (drModel) await drModel.updateMany({ where: { employeeId: id }, data: { employeeId: null } });
      }},
      // Mark invitations expired so re-invite starts fresh
      { name: 'EmployeeInvitation', fn: async () => {
        if (existing.email) {
          await prisma.employeeInvitation.updateMany({
            where: { email: existing.email, organizationId, status: 'ACCEPTED' },
            data: { status: 'EXPIRED' },
          });
        }
      }},
      // Unlink manager references from other employees
      { name: 'Employee(managerId)', fn: () => prisma.employee.updateMany({ where: { managerId: id }, data: { managerId: null } }) },
    ];

    if (existing.userId) {
      bestEffortDeletions.push(
        { name: 'AuditLog(user)', fn: () => prisma.auditLog.deleteMany({ where: { userId: existing.userId! } }) },
      );
    }

    for (const { name, fn } of bestEffortDeletions) {
      try { await fn(); } catch (e: any) {
        logger.warn(`Delete ${name} for employee ${id}: ${e.message?.slice(0, 80)}`);
      }
    }

    // ── Phase 2: Atomic soft-delete (small isolated transaction) ─────────────────
    // Only the two critical writes are here — no try-catch inside, no tables that
    // could cause 25P02 from earlier failures.
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
      if (existing.userId) {
        await tx.user.update({ where: { id: existing.userId }, data: { status: 'INACTIVE' } });
      }
    });

    // Audit log after transaction (use a separate call since the user is deleted)
    await prisma.auditLog.create({
      data: {
        userId: deletedBy,
        entity: 'Employee',
        entityId: id,
        action: 'DELETE',
        oldValue: auditData,
        organizationId,
      },
    });
  }

  private async generateEmployeeCode(organizationId: string): Promise<string> {
    const lastEmployee = await prisma.employee.findFirst({
      where: { organizationId },
      orderBy: { employeeCode: 'desc' },
      select: { employeeCode: true },
    });

    if (!lastEmployee) {
      return 'EMP-001';
    }

    const lastNum = parseInt(lastEmployee.employeeCode.replace('EMP-', ''), 10);
    return `EMP-${String(lastNum + 1).padStart(3, '0')}`;
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
    const bytes = crypto.randomBytes(12);
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(bytes[i] % chars.length);
    }
    return password;
  }

  // ==================
  // LIFECYCLE EVENTS
  // ==================

  async getLifecycleEvents(employeeId: string) {
    return prisma.employeeEvent.findMany({
      where: { employeeId },
      orderBy: { eventDate: 'desc' },
    });
  }

  async addLifecycleEvent(employeeId: string, data: { eventType: string; title: string; description?: string; eventDate: string; metadata?: any }, createdBy: string) {
    return prisma.employeeEvent.create({
      data: {
        employeeId,
        eventType: data.eventType,
        title: data.title,
        description: data.description || null,
        eventDate: new Date(data.eventDate),
        metadata: data.metadata || null,
        createdBy,
      },
    });
  }

  async deleteLifecycleEvent(eventId: string, organizationId: string) {
    const event = await prisma.employeeEvent.findFirst({
      where: { id: eventId, employee: { organizationId } },
    });
    if (!event) throw new NotFoundError('Lifecycle event');
    await prisma.employeeEvent.delete({ where: { id: eventId } });
  }

  // ==================
  // EXIT / OFFBOARDING
  // ==================

  async submitResignation(employeeId: string, data: SubmitResignationInput, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { department: true, user: true } });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.exitStatus && employee.exitStatus !== 'WITHDRAWN') {
      throw new ConflictError('An exit process is already in progress');
    }

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        resignationDate: new Date(),
        resignationReason: data.reason,
        lastWorkingDate: new Date(data.lastWorkingDate),
        exitType: 'RESIGNATION',
        exitStatus: 'PENDING',
        status: 'NOTICE_PERIOD',
      },
    });

    await prisma.employeeEvent.create({
      data: { employeeId, eventType: 'RESIGNATION', title: 'Resignation Submitted', description: data.reason, eventDate: new Date(), createdBy: employee.userId || employeeId },
    });

    // Email HR users — non-blocking: resignation must succeed even if email fails
    const hrUsers = await prisma.user.findMany({ where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, status: 'ACTIVE' }, select: { id: true, email: true } });
    const link = `https://hr.anistonav.com/exit-management`;
    for (const hr of hrUsers) {
      if (!hr.email) continue;
      enqueueEmail({ to: hr.email, subject: `Resignation: ${employee.firstName} ${employee.lastName}`, template: 'resignation-submitted', context: { name: `${employee.firstName} ${employee.lastName}`, employeeCode: employee.employeeCode, department: employee.department?.name, lastWorkingDate: new Date(data.lastWorkingDate).toLocaleDateString('en-IN'), reason: data.reason, link } })
        .catch((err) => logger.error(`[Resignation] Failed to queue email to ${hr.email}:`, err));
      enqueueNotification({ userId: hr.id, organizationId, title: 'New Resignation', message: `${employee.firstName} ${employee.lastName} has submitted their resignation`, type: 'exit', link: '/exit-management' })
        .catch((err) => logger.error(`[Resignation] Failed to queue notification for ${hr.id}:`, err));
    }

    return updated;
  }

  async getExitRequests(organizationId: string, query: ExitQuery) {
    const { page, limit, status, department } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId, exitStatus: { not: null }, deletedAt: null };
    if (status) where.exitStatus = status;
    if (department) where.departmentId = department;

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where, skip, take: limit, orderBy: { resignationDate: 'desc' },
        include: { department: true, designation: true },
      }),
      prisma.employee.count({ where }),
    ]);

    return {
      data: employees,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  async getExitDetails(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { department: true, designation: true, user: { select: { email: true, status: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Get assigned (unreturned) assets
    const assetAssignments = await prisma.assetAssignment.findMany({
      where: { employeeId },
      include: { asset: true },
      orderBy: { assignedAt: 'desc' },
    });

    const pendingAssets = assetAssignments.filter(a => !a.returnedAt);
    const returnedAssets = assetAssignments.filter(a => !!a.returnedAt);

    // Get lifecycle events
    const events = await prisma.employeeEvent.findMany({
      where: { employeeId },
      orderBy: { eventDate: 'desc' },
      take: 50,
    });

    return {
      employee,
      assets: { pending: pendingAssets, returned: returnedAssets, totalAssigned: assetAssignments.length, allReturned: pendingAssets.length === 0 },
      events,
    };
  }

  async approveExit(employeeId: string, approvedBy: string, data: ApproveExitInput, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { department: true } });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.exitStatus !== 'PENDING') throw new ConflictError('Exit request is not in PENDING status');

    // Check pending assets
    const pendingAssets = await prisma.assetAssignment.count({ where: { employeeId, returnedAt: null } });
    const exitStatus = pendingAssets > 0 ? 'NO_DUES_PENDING' : 'APPROVED';

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        exitStatus,
        exitApprovedBy: approvedBy,
        exitApprovedAt: new Date(),
        exitNotes: data.notes || employee.exitNotes,
        lastWorkingDate: data.lastWorkingDate ? new Date(data.lastWorkingDate) : employee.lastWorkingDate,
      },
    });

    await prisma.employeeEvent.create({
      data: { employeeId, eventType: 'EXIT_APPROVED', title: `Exit ${exitStatus === 'NO_DUES_PENDING' ? 'Approved (No-Dues Pending)' : 'Approved'}`, description: data.notes || 'Exit approved by HR', eventDate: new Date(), createdBy: approvedBy },
    });

    // Email employee — non-blocking
    if (employee.email) {
      enqueueEmail({ to: employee.email, subject: 'Your Resignation Has Been Approved', template: 'exit-approved', context: { name: employee.firstName, lastWorkingDate: (data.lastWorkingDate ? new Date(data.lastWorkingDate) : employee.lastWorkingDate)?.toLocaleDateString('en-IN') || '', notes: data.notes } })
        .catch((err) => logger.error(`[ExitApproval] Failed to queue email for employee ${employee.id}:`, err));
    }

    await createAuditLog({ userId: approvedBy, organizationId, entity: 'Employee', entityId: employeeId, action: 'EXIT_APPROVED', newValue: { exitStatus, lastWorkingDate: updated.lastWorkingDate } });

    // Auto-create exit checklist for asset clearance
    try {
      const { assetService } = await import('../asset/asset.service.js');
      await assetService.createExitChecklist(employeeId);
    } catch (e) {
      // Non-blocking: checklist creation failure shouldn't block exit approval
      logger.error('Failed to create exit checklist:', { error: e });
    }

    // GAP-006: Trigger Full & Final settlement on exit approval (non-blocking)
    setImmediate(() => {
      this._triggerFnFSettlement(employeeId, organizationId, approvedBy, updated.lastWorkingDate).catch(
        (err) => logger.warn('[ExitApproval] FnF trigger failed (non-blocking):', err),
      );
    });

    return updated;
  }

  /**
   * GAP-006: Full & Final settlement trigger on exit approval.
   * Creates a PayrollAdjustment record (type OTHER, component "Full & Final Settlement") for manual
   * processing, or enqueues a payroll job when no open run exists for the final month.
   * Non-blocking — caller wraps in setImmediate + .catch(). Exit approval is never
   * affected if this step fails.
   */
  private async _triggerFnFSettlement(
    employeeId: string,
    organizationId: string,
    approvedBy: string,
    lastWorkingDate: Date | null,
  ): Promise<void> {
    const now = new Date();
    const finalMonth = lastWorkingDate ? lastWorkingDate.getMonth() + 1 : now.getMonth() + 1;
    const finalYear = lastWorkingDate ? lastWorkingDate.getFullYear() : now.getFullYear();

    // Find or use an existing DRAFT payroll run for the final month, or create an ad-hoc record
    const existingRun = await prisma.payrollRun.findFirst({
      where: { organizationId, month: finalMonth, year: finalYear, status: { in: ['DRAFT', 'REVIEW'] } },
      select: { id: true },
    });

    if (existingRun) {
      // Attach a FnF adjustment to the existing run (type OTHER — no FINAL_SETTLEMENT enum value)
      await prisma.payrollAdjustment.create({
        data: {
          payrollRunId: existingRun.id,
          employeeId,
          type: 'OTHER',
          componentName: 'Full & Final Settlement',
          amount: 0, // HR will fill in the actual settlement amount
          isDeduction: false,
          reason: `Auto-generated FnF on exit approval (last working date: ${lastWorkingDate?.toLocaleDateString('en-IN') ?? 'TBD'})`,
          addedBy: 'system',
        },
      });

      logger.info(`[FnF] PayrollAdjustment FINAL_SETTLEMENT created for employee ${employeeId} on run ${existingRun.id}`);
    } else {
      // No open run — enqueue a payroll processing job so payroll team is notified
      await payrollQueue.add(
        'fnf-settlement',
        {
          employeeId,
          organizationId,
          month: finalMonth,
          year: finalYear,
          type: 'FINAL_SETTLEMENT',
          lastWorkingDate: lastWorkingDate?.toISOString() ?? null,
          triggeredBy: approvedBy,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      logger.info(`[FnF] Payroll job enqueued for employee ${employeeId} — month ${finalMonth}/${finalYear}`);
    }

    // Audit the FnF trigger
    await createAuditLog({
      userId: approvedBy,
      organizationId,
      entity: 'Employee',
      entityId: employeeId,
      action: 'FNF_TRIGGERED',
      newValue: {
        finalMonth,
        finalYear,
        lastWorkingDate: lastWorkingDate?.toISOString() ?? null,
        runId: existingRun?.id ?? null,
      },
    });

    logger.info(`[FnF] Settlement triggered for employee ${employeeId} (${finalMonth}/${finalYear})`);
  }

  async completeExit(employeeId: string, userId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    if (!['APPROVED', 'NO_DUES_PENDING'].includes(employee.exitStatus || '')) throw new ConflictError('Exit must be approved before completion');

    // Verify all assets returned
    const pendingAssets = await prisma.assetAssignment.count({ where: { employeeId, returnedAt: null } });
    if (pendingAssets > 0) throw new ConflictError(`Cannot complete exit: ${pendingAssets} asset(s) still pending return`);

    // Block on incomplete handover tasks
    const pendingTasks = await prisma.handoverTask.count({
      where: { checklist: { employeeId }, isCompleted: false },
    });
    if (pendingTasks > 0) throw new ConflictError(`Cannot complete exit: ${pendingTasks} handover task(s) still pending`);

    // H-1: block if IT offboarding checklist exists but is not complete
    const itChecklist = await prisma.iTOffboardingChecklist.findFirst({ where: { employeeId } });
    if (itChecklist && !itChecklist.completedAt) {
      throw new ConflictError('Cannot complete exit: IT offboarding checklist is not fully completed');
    }

    // Complete exit
    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: { exitStatus: 'COMPLETED', status: 'TERMINATED', deletedAt: new Date() },
    });

    // Check if exit access config exists — if so, keep user active for limited access
    const exitAccessConfig = await prisma.exitAccessConfig.findUnique({ where: { employeeId } });
    if (employee.userId) {
      if (exitAccessConfig?.isActive) {
        // Keep user active — they have limited access configured by HR
        logger.info(`[Exit] Employee ${employeeId} has exit access config — keeping user active with limited access`);
      } else {
        // No exit access config — fully deactivate
        await prisma.user.update({ where: { id: employee.userId }, data: { status: 'INACTIVE' } });
      }
    }

    await prisma.employeeEvent.create({
      data: { employeeId, eventType: 'EXIT_COMPLETED', title: 'Exit Process Completed', description: 'All no-dues cleared, employee separated', eventDate: new Date(), createdBy: userId },
    });

    // Email employee — non-blocking
    if (employee.email) {
      enqueueEmail({ to: employee.email, subject: 'Exit Process Complete — Aniston Technologies', template: 'exit-completed', context: { name: employee.firstName } })
        .catch((err) => logger.error(`[ExitComplete] Failed to queue email for employee ${employee.id}:`, err));
    }

    await createAuditLog({ userId, organizationId, entity: 'Employee', entityId: employeeId, action: 'EXIT_COMPLETED', newValue: { exitStatus: 'COMPLETED', status: 'TERMINATED' } });

    return updated;
  }

  async withdrawResignation(employeeId: string, userId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    if (!['PENDING', 'APPROVED', 'NO_DUES_PENDING'].includes(employee.exitStatus || '')) throw new ConflictError('Cannot withdraw — exit is already completed or not in progress');

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: { exitStatus: 'WITHDRAWN', status: 'ACTIVE', exitNotes: null },
    });

    await prisma.employeeEvent.create({
      data: { employeeId, eventType: 'RESIGNATION_WITHDRAWN', title: 'Resignation Withdrawn', description: 'Resignation has been withdrawn', eventDate: new Date(), createdBy: userId },
    });

    await createAuditLog({ userId, organizationId, entity: 'Employee', entityId: employeeId, action: 'RESIGNATION_WITHDRAWN', newValue: { exitStatus: 'WITHDRAWN' } });

    return updated;
  }

  // ==================
  // ACTIVATION INVITE
  // ==================

  async sendActivationInvite(employeeId: string, organizationId: string, sentBy: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: {
        user: { select: { id: true, microsoftId: true, status: true, lastLoginAt: true } },
        organization: { select: { name: true } },
      },
    });

    if (!employee) throw new NotFoundError('Employee');
    if (!employee.user) throw new BadRequestError('Employee has no linked user account');
    if (!employee.user.microsoftId) throw new BadRequestError('Employee is not Teams-synced (no Microsoft account linked)');
    if (employee.user.lastLoginAt) throw new BadRequestError('Employee has already logged in');
    if (employee.user.status === 'ACTIVE' && employee.user.lastLoginAt) throw new BadRequestError('Employee account is already active');

    // Invalidate any existing pending activations
    await prisma.employeeActivation.updateMany({
      where: { employeeId, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });

    // Generate activation token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    await prisma.employeeActivation.create({
      data: {
        employeeId,
        token,
        status: 'PENDING',
        expiresAt,
        organizationId,
      },
    });

    // Enqueue activation email
    const activationUrl = `https://hr.anistonav.com/activate/${token}`;
    await enqueueEmail({
      to: employee.email,
      subject: 'Activate your Aniston HRMS account',
      template: 'activation-invite',
      context: {
        name: employee.firstName,
        organizationName: employee.organization?.name || 'Aniston Technologies',
        link: activationUrl,
        expiresIn: '72 hours',
      },
    });

    // Audit log
    await createAuditLog({
      userId: sentBy,
      organizationId,
      entity: 'EmployeeActivation',
      entityId: employeeId,
      action: 'CREATE',
      newValue: { employeeId, email: employee.email, expiresAt },
    });

    return { message: `Activation invite sent to ${employee.email}`, token };
  }

  async validateActivationToken(token: string) {
    const activation = await prisma.employeeActivation.findUnique({
      where: { token },
    });

    if (!activation) {
      return { valid: false, reason: 'invalid' };
    }

    // Check expiry
    if (activation.expiresAt < new Date()) {
      await prisma.employeeActivation.update({
        where: { id: activation.id },
        data: { status: 'EXPIRED' },
      });
      return { valid: false, reason: 'expired' };
    }

    if (activation.status !== 'PENDING') {
      return { valid: false, reason: activation.status === 'ACTIVATED' ? 'already_activated' : 'expired' };
    }

    // Get employee + org info
    const employee = await prisma.employee.findUnique({
      where: { id: activation.employeeId },
      include: { organization: { select: { name: true } } },
    });

    return {
      valid: true,
      employeeId: activation.employeeId,
      organizationName: employee?.organization?.name || 'Aniston Technologies',
    };
  }

  async completeActivation(token: string) {
    const activation = await prisma.employeeActivation.findUnique({
      where: { token },
    });

    if (!activation) throw new NotFoundError('Activation token');
    if (activation.status !== 'PENDING') throw new BadRequestError('Activation token is no longer valid');
    if (activation.expiresAt < new Date()) {
      await prisma.employeeActivation.update({
        where: { id: activation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestError('Activation token has expired');
    }

    // Find the employee and their user
    const employee = await prisma.employee.findUnique({
      where: { id: activation.employeeId },
      include: { user: true },
    });

    if (!employee || !employee.userId) throw new NotFoundError('Employee');

    // Transaction: mark activation complete + update user
    await prisma.$transaction(async (tx) => {
      await tx.employeeActivation.update({
        where: { id: activation.id },
        data: { status: 'ACTIVATED', activatedAt: new Date() },
      });

      await tx.user.update({
        where: { id: employee.userId! },
        data: { status: 'ACTIVE', lastLoginAt: new Date() },
      });
    });

    return { message: 'Account activated successfully', employeeId: activation.employeeId };
  }

  async initiateTermination(employeeId: string, data: InitiateTerminationInput, userId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.exitStatus && !['WITHDRAWN'].includes(employee.exitStatus)) {
      throw new ConflictError('An exit process is already in progress');
    }

    const pendingAssets = await prisma.assetAssignment.count({ where: { employeeId, returnedAt: null } });
    const exitStatus = pendingAssets > 0 ? 'NO_DUES_PENDING' : 'APPROVED';

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        resignationDate: new Date(),
        resignationReason: data.reason,
        lastWorkingDate: new Date(data.lastWorkingDate),
        exitType: 'TERMINATION',
        exitStatus,
        exitApprovedBy: userId,
        exitApprovedAt: new Date(),
        exitNotes: data.notes,
        status: 'NOTICE_PERIOD',
      },
    });

    await prisma.employeeEvent.create({
      data: { employeeId, eventType: 'TERMINATION', title: 'Termination Initiated', description: data.reason, eventDate: new Date(), createdBy: userId },
    });

    await createAuditLog({ userId, organizationId, entity: 'Employee', entityId: employeeId, action: 'TERMINATION_INITIATED', newValue: { exitType: 'TERMINATION', exitStatus } });

    return updated;
  }

  async updateProfilePhoto(employeeId: string, photoUrl: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    // Delete old photo if it exists
    if ((employee as any).profilePhotoUrl) {
      await storageService.deleteFile((employee as any).profilePhotoUrl);
    }
    return prisma.employee.update({
      where: { id: employeeId },
      data: { profilePhotoUrl: photoUrl } as any,
    });
  }
}

export const employeeService = new EmployeeService();
