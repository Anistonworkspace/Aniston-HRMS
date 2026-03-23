import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, ConflictError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import type { CreateEmployeeInput, UpdateEmployeeInput, EmployeeQuery } from './employee.validation.js';

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
          select: { id: true, email: true, role: true, status: true, lastLoginAt: true },
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
}

export const employeeService = new EmployeeService();
