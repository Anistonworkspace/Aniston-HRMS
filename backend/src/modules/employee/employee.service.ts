import bcrypt from 'bcryptjs';
import crypto, { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail, enqueueNotification } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
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
          manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          officeLocation: { select: { id: true, name: true } },
          shiftAssignments: {
            where: { endDate: null },
            take: 1,
            orderBy: { startDate: 'desc' as const },
            include: { shift: { select: { id: true, name: true, shiftType: true, startTime: true, endTime: true } } },
          },
        },
      }),
      prisma.employee.count({ where }),
    ]);

    const enriched = employees.map((emp: any) => {
      const activeAssignment = emp.shiftAssignments?.[0];
      return {
        ...emp,
        hasShift: !!activeAssignment,
        currentShift: activeAssignment?.shift || null,
        shiftAssignments: undefined, // remove raw assignments from response
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

    const [total, active, probation, inactive, onboarding, noticePeriod, terminated, invited] = await Promise.all([
      prisma.employee.count({ where: base }),
      prisma.employee.count({ where: { ...base, status: 'ACTIVE' } }),
      prisma.employee.count({ where: { ...base, status: 'PROBATION' } }),
      prisma.employee.count({ where: { ...base, status: 'INACTIVE' } }),
      prisma.employee.count({ where: { ...base, status: 'ONBOARDING' } }),
      prisma.employee.count({ where: { ...base, status: 'NOTICE_PERIOD' } }),
      prisma.employee.count({ where: { ...base, status: 'TERMINATED' } }),
      prisma.employeeInvitation.count({ where: { organizationId, status: 'PENDING' } }),
    ]);

    return { total, active, probation, inactive, onboarding, noticePeriod, terminated, invited };
  }

  async getById(id: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        department: true,
        designation: true,
        manager: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
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
      },
    });

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    const activeAssignment = (employee as any).shiftAssignments?.[0];
    return {
      ...employee,
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

    // Generate employee code
    const employeeCode = await this.generateEmployeeCode(organizationId);

    // Create user account
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
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
          emergencyContact: data.emergencyContact || null,
          status: 'ACTIVE',
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

    const result = await prisma.$transaction(async (tx) => {
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
          status: 'PROBATION',
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

    // Send invitation email
    await enqueueEmail({
      to: normalizedEmail,
      subject: 'Welcome to Aniston Technologies — Complete Your Onboarding',
      template: 'onboarding-invite',
      context: {
        name: firstName || normalizedEmail.split('@')[0],
        link: `${env.FRONTEND_URL}${onboardingUrl}`,
      },
    });

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

    // Field-level permission control — restrict sensitive fields to SUPER_ADMIN only
    const SUPER_ADMIN_ONLY_FIELDS = ['ctc', 'status'];
    const MANAGEMENT_ONLY_FIELDS = ['joiningDate', 'probationEndDate', 'workMode', 'officeLocationId'];

    if (callerRole && !['SUPER_ADMIN'].includes(callerRole)) {
      for (const field of SUPER_ADMIN_ONLY_FIELDS) {
        delete (data as any)[field];
      }
    }
    if (callerRole && !['SUPER_ADMIN', 'ADMIN', 'HR'].includes(callerRole)) {
      for (const field of MANAGEMENT_ONLY_FIELDS) {
        delete (data as any)[field];
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

    // Enforce valid status transitions
    if (data.status && data.status !== existing.status) {
      const VALID_TRANSITIONS: Record<string, string[]> = {
        'ONBOARDING': ['PROBATION', 'ACTIVE', 'INACTIVE'],
        'PROBATION': ['ACTIVE', 'NOTICE_PERIOD', 'INACTIVE', 'TERMINATED'],
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

    const updateData: any = { ...data };
    if (data.email) updateData.email = data.email.toLowerCase();
    if (data.dateOfBirth) updateData.dateOfBirth = new Date(data.dateOfBirth);
    if (data.joiningDate) updateData.joiningDate = new Date(data.joiningDate);
    if (data.probationEndDate) updateData.probationEndDate = new Date(data.probationEndDate);

    const employee = await prisma.$transaction(async (tx) => {
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

    return employee;
  }

  async changeRole(employeeId: string, role: string, organizationId: string, changedBy: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: { user: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (!employee.userId) throw new BadRequestError('Employee has no linked user account');

    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
    if (!validRoles.includes(role)) throw new BadRequestError(`Invalid role: ${role}`);

    const oldRole = employee.user?.role;
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

    return { employeeId, userId: employee.userId, oldRole, newRole: role };
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

    await prisma.$transaction(async (tx) => {
      const docIds = existing.documents.map(d => d.id);

      // Delete all dependent records — order matters for FK constraints
      // Each deleteMany is wrapped in try-catch so missing tables don't break the flow
      const deletions: Array<{ name: string; fn: () => Promise<any> }> = [
        // OCR verifications (depends on documents)
        { name: 'DocumentOcrVerification', fn: () => tx.documentOcrVerification.deleteMany({ where: { documentId: { in: docIds.length ? docIds : ['none'] } } }) },
        // Documents
        { name: 'Document', fn: () => tx.document.deleteMany({ where: { employeeId: id } }) },
        // KYC / Onboarding
        { name: 'OnboardingDocumentGate', fn: () => tx.onboardingDocumentGate.deleteMany({ where: { employeeId: id } }) },
        // Leave
        { name: 'LeaveBalance', fn: () => tx.leaveBalance.deleteMany({ where: { employeeId: id } }) },
        { name: 'LeaveRequest', fn: () => tx.leaveRequest.deleteMany({ where: { employeeId: id } }) },
        // Attendance — delete child records first (Break, AttendanceLog, Regularization depend on AttendanceRecord)
        { name: 'AttendanceLog', fn: async () => {
          const attRecords = await tx.attendanceRecord.findMany({ where: { employeeId: id }, select: { id: true } });
          const attIds = attRecords.map(r => r.id);
          if (attIds.length) {
            await tx.attendanceLog.deleteMany({ where: { attendanceId: { in: attIds } } });
            await tx.break.deleteMany({ where: { attendanceId: { in: attIds } } });
            await tx.attendanceRegularization.deleteMany({ where: { attendanceId: { in: attIds } } });
          }
        }},
        { name: 'AttendanceRecord', fn: () => tx.attendanceRecord.deleteMany({ where: { employeeId: id } }) },
        { name: 'GPSTrailPoint', fn: () => tx.gPSTrailPoint.deleteMany({ where: { employeeId: id } }) },
        { name: 'ProjectSiteCheckIn', fn: () => tx.projectSiteCheckIn.deleteMany({ where: { employeeId: id } }) },
        // Shifts
        { name: 'ShiftAssignment', fn: () => tx.shiftAssignment.deleteMany({ where: { employeeId: id } }) },
        { name: 'HybridSchedule', fn: () => tx.hybridSchedule.deleteMany({ where: { employeeId: id } }) },
        // Payroll
        { name: 'SalaryStructure', fn: () => tx.salaryStructure.deleteMany({ where: { employeeId: id } }) },
        { name: 'PayrollRecord', fn: () => tx.payrollRecord.deleteMany({ where: { employeeId: id } }) },
        // Performance
        { name: 'PerformanceGoal', fn: () => tx.performanceGoal.deleteMany({ where: { employeeId: id } }) },
        { name: 'PerformanceReview', fn: () => tx.performanceReview.deleteMany({ where: { employeeId: id } }) },
        // Assets
        { name: 'AssetAssignment', fn: () => tx.assetAssignment.deleteMany({ where: { employeeId: id } }) },
        // Helpdesk
        { name: 'Ticket', fn: () => tx.ticket.deleteMany({ where: { employeeId: id } }) },
        // Activity / Agent
        { name: 'ActivityLog', fn: () => tx.activityLog.deleteMany({ where: { employeeId: id } }) },
        { name: 'AgentScreenshot', fn: () => tx.agentScreenshot.deleteMany({ where: { employeeId: id } }) },
        // Exit
        { name: 'ExitChecklist', fn: () => tx.exitChecklist.deleteMany({ where: { employeeId: id } }) },
        { name: 'ExitAccessConfig', fn: () => tx.exitAccessConfig.deleteMany({ where: { employeeId: id } }) },
        // Intern
        { name: 'InternProfile', fn: () => tx.internProfile.deleteMany({ where: { employeeId: id } }) },
        // Permissions / Visibility
        { name: 'SalaryVisibilityRule', fn: () => tx.salaryVisibilityRule.deleteMany({ where: { employeeId: id } }) },
        { name: 'PermissionOverride', fn: () => tx.permissionOverride.deleteMany({ where: { employeeId: id } }) },
        // Lifecycle events
        { name: 'EmployeeEvent', fn: () => tx.employeeEvent.deleteMany({ where: { employeeId: id } }) },
        // Goals & Policy
        { name: 'Goal', fn: () => tx.goal.deleteMany({ where: { employeeId: id } }) },
        { name: 'PolicyAcknowledgment', fn: () => tx.policyAcknowledgment.deleteMany({ where: { employeeId: id } }) },
        // Activation tokens
        { name: 'EmployeeActivation', fn: () => tx.employeeActivation.deleteMany({ where: { employeeId: id } }) },
        // Salary history
        { name: 'SalaryHistory', fn: () => tx.salaryHistory.deleteMany({ where: { employeeId: id } }) },
      ];

      // User-related deletions
      if (existing.userId) {
        deletions.push(
          { name: 'AuditLog(user)', fn: () => tx.auditLog.deleteMany({ where: { userId: existing.userId! } }) },
          { name: 'Notification', fn: () => tx.notification.deleteMany({ where: { userId: existing.userId! } }) },
          { name: 'RefreshToken', fn: () => tx.refreshToken.deleteMany({ where: { userId: existing.userId! } }) },
        );
      }

      for (const { name, fn } of deletions) {
        try { await fn(); } catch (e: any) {
          // Log but don't block — some tables may not exist or have no matching records
          logger.warn(`Delete ${name} for employee ${id}: ${e.message?.slice(0, 80)}`);
        }
      }

      // Mark invitations as expired so re-invite starts fresh
      if (existing.email) {
        await tx.employeeInvitation.updateMany({
          where: { email: existing.email, organizationId, status: 'ACCEPTED' },
          data: { status: 'EXPIRED' },
        });
      }

      // Unlink manager references from other employees
      await tx.employee.updateMany({
        where: { managerId: id },
        data: { managerId: null },
      });

      // Soft-delete employee record (preserve for audit trail)
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });

      // Deactivate user account (preserve for audit trail)
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

    // Email HR users
    const hrUsers = await prisma.user.findMany({ where: { organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, status: 'ACTIVE' }, select: { email: true } });
    const link = `${env.FRONTEND_URL}/exit-management`;
    for (const hr of hrUsers) {
      await enqueueEmail({ to: hr.email, subject: `Resignation: ${employee.firstName} ${employee.lastName}`, template: 'resignation-submitted', context: { name: `${employee.firstName} ${employee.lastName}`, employeeCode: employee.employeeCode, department: employee.department?.name, lastWorkingDate: new Date(data.lastWorkingDate).toLocaleDateString('en-IN'), reason: data.reason, link } });
      const hrUser = await prisma.user.findUnique({ where: { email: hr.email }, select: { id: true } });
      if (hrUser) {
        await enqueueNotification({ userId: hrUser.id, organizationId, title: 'New Resignation', message: `${employee.firstName} ${employee.lastName} has submitted their resignation`, type: 'exit', link: '/exit-management' });
      }
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

    // Email employee
    await enqueueEmail({ to: employee.email, subject: 'Your Resignation Has Been Approved', template: 'exit-approved', context: { name: employee.firstName, lastWorkingDate: (data.lastWorkingDate ? new Date(data.lastWorkingDate) : employee.lastWorkingDate)?.toLocaleDateString('en-IN') || '', notes: data.notes } });

    await createAuditLog({ userId: approvedBy, organizationId, entity: 'Employee', entityId: employeeId, action: 'EXIT_APPROVED', newValue: { exitStatus, lastWorkingDate: updated.lastWorkingDate } });

    // Auto-create exit checklist for asset clearance
    try {
      const { assetService } = await import('../asset/asset.service.js');
      await assetService.createExitChecklist(employeeId);
    } catch (e) {
      // Non-blocking: checklist creation failure shouldn't block exit approval
      console.error('Failed to create exit checklist:', e);
    }

    return updated;
  }

  async completeExit(employeeId: string, userId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    if (!['APPROVED', 'NO_DUES_PENDING'].includes(employee.exitStatus || '')) throw new ConflictError('Exit must be approved before completion');

    // Verify all assets returned
    const pendingAssets = await prisma.assetAssignment.count({ where: { employeeId, returnedAt: null } });
    if (pendingAssets > 0) throw new ConflictError(`Cannot complete exit: ${pendingAssets} asset(s) still pending return`);

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
        console.log(`[Exit] Employee ${employeeId} has exit access config — keeping user active with limited access`);
      } else {
        // No exit access config — fully deactivate
        await prisma.user.update({ where: { id: employee.userId }, data: { status: 'INACTIVE' } });
      }
    }

    await prisma.employeeEvent.create({
      data: { employeeId, eventType: 'EXIT_COMPLETED', title: 'Exit Process Completed', description: 'All no-dues cleared, employee separated', eventDate: new Date(), createdBy: userId },
    });

    // Email employee
    await enqueueEmail({ to: employee.email, subject: 'Exit Process Complete — Aniston Technologies', template: 'exit-completed', context: { name: employee.firstName } });

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
    const activationUrl = `${env.FRONTEND_URL}/activate/${token}`;
    await enqueueEmail({
      to: employee.email,
      subject: 'Activate your Aniston HRMS account',
      template: 'activation-invite',
      context: {
        name: employee.firstName,
        organizationName: employee.organization.name,
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
}

export const employeeService = new EmployeeService();
