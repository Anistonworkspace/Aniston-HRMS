import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail, enqueueNotification } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { env } from '../../config/env.js';
import type { CreateEmployeeInput, UpdateEmployeeInput, EmployeeQuery, SubmitResignationInput, ApproveExitInput, InitiateTerminationInput, ExitQuery } from './employee.validation.js';

export class EmployeeService {
  async list(query: EmployeeQuery, organizationId: string) {
    const { page, limit, search, department, status, workMode, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId,
      deletedAt: null,
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
    if (status) where.status = status;
    if (workMode) where.workMode = workMode;

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          user: { select: { id: true, role: true, status: true } },
          manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      prisma.employee.count({ where }),
    ]);

    return {
      data: employees,
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
      },
    });

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    return employee;
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
        link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}${onboardingUrl}`,
      },
    });

    return {
      employee: result.employee,
      employeeCode,
      onboardingUrl,
    };
  }

  async update(id: string, data: UpdateEmployeeInput, organizationId: string, updatedBy: string) {
    const existing = await prisma.employee.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundError('Employee');
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
    });
    if (!existing) {
      throw new NotFoundError('Employee');
    }

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });

      if (existing.userId) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { status: 'INACTIVE' },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: deletedBy,
          entity: 'Employee',
          entityId: id,
          action: 'DELETE',
          oldValue: { firstName: existing.firstName, lastName: existing.lastName, employeeCode: existing.employeeCode },
          organizationId,
        },
      });
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
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
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

  async deleteLifecycleEvent(eventId: string) {
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
