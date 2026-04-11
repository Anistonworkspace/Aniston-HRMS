import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { emitToOrg, emitToUser, invalidateDashboardCache } from '../../sockets/index.js';
import { taskIntegrationService } from '../task-integration/task-integration.service.js';
import { enqueueEmail, enqueueNotification } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import type { ApplyLeaveInput, LeaveQuery, CreateLeaveTypeInput, UpdateLeaveTypeInput, SaveDraftInput, SubmitDraftInput, UpdateHandoverInput } from './leave.validation.js';

export class LeaveService {
  /**
   * Get leave types for the organization
   */
  async getLeaveTypes(organizationId: string) {
    return prisma.leaveType.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a new leave type
   */
  async createLeaveType(data: CreateLeaveTypeInput, organizationId: string) {
    return prisma.leaveType.create({
      data: {
        ...data,
        organizationId,
      },
    });
  }

  /**
   * Update an existing leave type
   */
  async updateLeaveType(id: string, data: UpdateLeaveTypeInput, organizationId: string) {
    const existing = await prisma.leaveType.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Leave type');

    return prisma.leaveType.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete (soft-deactivate) a leave type
   */
  async deleteLeaveType(id: string, organizationId: string) {
    const existing = await prisma.leaveType.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Leave type');

    return prisma.leaveType.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Get leave balances for an employee (current year)
   */
  async getBalances(employeeId: string, year?: number) {
    const currentYear = year || new Date().getFullYear();

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, gender: true, status: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Get only active leave types
    const allLeaveTypes = await prisma.leaveType.findMany({
      where: { organizationId: employee.organizationId, isActive: true },
    });

    // Filter by applicability and gender
    const leaveTypes = allLeaveTypes.filter((lt) => {
      // Gender check — skip if leave type is gender-specific and doesn't match
      if (lt.gender && lt.gender !== employee.gender) return false;
      // Applicability check
      if (lt.applicableTo === 'PROBATION' && employee.status !== 'PROBATION') return false;
      if (lt.applicableTo === 'CONFIRMED' && employee.status === 'PROBATION') return false;
      return true;
    });

    // Batch fetch all existing balances in one query (fixes N+1)
    const existingBalances = await prisma.leaveBalance.findMany({
      where: {
        employeeId,
        leaveTypeId: { in: leaveTypes.map((lt) => lt.id) },
        year: currentYear,
      },
    });
    const balanceMap = new Map(existingBalances.map((b) => [b.leaveTypeId, b]));

    // Batch create any missing balances
    const missingTypes = leaveTypes.filter((lt) => !balanceMap.has(lt.id));
    if (missingTypes.length > 0) {
      await prisma.leaveBalance.createMany({
        data: missingTypes.map((lt) => ({
          employeeId,
          leaveTypeId: lt.id,
          year: currentYear,
          allocated: lt.defaultBalance,
          used: 0,
          pending: 0,
          carriedForward: 0,
        })),
        skipDuplicates: true,
      });
      // Re-fetch newly created balances
      const newBalances = await prisma.leaveBalance.findMany({
        where: {
          employeeId,
          leaveTypeId: { in: missingTypes.map((lt) => lt.id) },
          year: currentYear,
        },
      });
      newBalances.forEach((b) => balanceMap.set(b.leaveTypeId, b));
    }

    const balances = leaveTypes.map((lt) => {
      const balance = balanceMap.get(lt.id)!;
      return {
        ...balance,
        leaveType: {
          id: lt.id,
          name: lt.name,
          code: lt.code,
          isPaid: lt.isPaid,
        },
        remaining: Number(balance.allocated) + Number(balance.carriedForward) - Number(balance.used) - Number(balance.pending),
      };
    });

    return balances;
  }

  /**
   * Apply for leave
   */
  async applyLeave(employeeId: string, data: ApplyLeaveInput) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, firstName: true, lastName: true, gender: true, joiningDate: true, status: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const leaveType = await prisma.leaveType.findUnique({
      where: { id: data.leaveTypeId },
    });
    if (!leaveType) throw new NotFoundError('Leave type');
    if (!leaveType.isActive) throw new BadRequestError('This leave type is currently inactive');

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDateOnly = new Date(startDate);
    startDateOnly.setHours(0, 0, 0, 0);

    if (endDate < startDate) {
      throw new BadRequestError('End date must be after start date');
    }

    // Validate half-day is on a working day (Sunday = weekoff)
    if (data.isHalfDay && startDate.getDay() === 0) {
      throw new BadRequestError('Cannot apply half-day leave on a Sunday (non-working day). Please select a working day.');
    }

    // Calculate business days
    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId);

    if (days <= 0) {
      throw new BadRequestError('Selected dates have no working days. Sundays are non-working days and cannot be taken as leave.');
    }

    // ===== POLICY ENFORCEMENT =====

    // 1. Min days check
    if (leaveType.minDays && Number(leaveType.minDays) > 0.5 && days < Number(leaveType.minDays)) {
      throw new BadRequestError(`${leaveType.name} requires a minimum of ${Number(leaveType.minDays)} day(s) per application.`);
    }

    // 2. Max days check (max consecutive days per single application)
    if (leaveType.maxDays && days > Number(leaveType.maxDays)) {
      throw new BadRequestError(`Maximum ${Number(leaveType.maxDays)} consecutive day(s) allowed for ${leaveType.name}. For longer durations, please use Privilege Leave (PL).`);
    }

    // 3. Same-day check
    // SL, EL, CL are unplanned by nature — always exempt from advance notice
    const isUnplannedLeave = ['SL', 'EL', 'CL'].includes(leaveType.code ?? '');
    if (!isUnplannedLeave && !leaveType.allowSameDay && startDateOnly.getTime() === today.getTime()) {
      throw new BadRequestError(`${leaveType.name} must be applied in advance. Same-day applications are not permitted.`);
    }

    // 4. Notice days check (skipped for SL/EL/CL)
    if (!isUnplannedLeave && leaveType.noticeDays && leaveType.noticeDays > 0) {
      const diffMs = startDateOnly.getTime() - today.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < leaveType.noticeDays) {
        throw new BadRequestError(`${leaveType.name} requires at least ${leaveType.noticeDays} working day(s) advance notice.`);
      }
    }

    // 5. Max per month check (max number of leave requests per calendar month)
    if (leaveType.maxPerMonth && leaveType.maxPerMonth > 0) {
      const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      const monthCount = await prisma.leaveRequest.count({
        where: {
          employeeId,
          leaveTypeId: data.leaveTypeId,
          status: { in: ['PENDING', 'MANAGER_APPROVED', 'APPROVED'] },
          startDate: { gte: monthStart, lte: monthEnd },
        },
      });
      if (monthCount >= leaveType.maxPerMonth) {
        throw new BadRequestError(`You can apply for ${leaveType.name} a maximum of ${leaveType.maxPerMonth} time(s) per month. You have already used your monthly quota.`);
      }
    }

    // 6. Gender restriction
    if (leaveType.gender && employee.gender !== leaveType.gender) {
      throw new BadRequestError(`${leaveType.name} is available for ${leaveType.gender.toLowerCase()} employees only.`);
    }

    // 7. Probation / Confirmed check
    if (leaveType.applicableTo !== 'ALL' && employee.joiningDate) {
      const probationEnd = new Date(employee.joiningDate);
      probationEnd.setMonth(probationEnd.getMonth() + (leaveType.probationMonths || 3));
      const isInProbation = today < probationEnd;

      if (leaveType.applicableTo === 'CONFIRMED' && isInProbation) {
        throw new BadRequestError(`${leaveType.name} is available only after ${leaveType.probationMonths || 3} months of confirmed service.`);
      }
      if (leaveType.applicableTo === 'PROBATION' && !isInProbation) {
        throw new BadRequestError(`${leaveType.name} is only available during probation period.`);
      }
    }

    // 8. Weekend adjacent check (sandwich rule — Sunday only is weekend)
    if (!leaveType.allowWeekendAdjacent) {
      const dayBefore = new Date(startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(endDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const beforeDay = dayBefore.getDay();
      const afterDay = dayAfter.getDay();
      // Only Sunday (0) is weekend, Saturday (6) is a working day
      if (beforeDay === 0 || afterDay === 0) {
        throw new BadRequestError(`${leaveType.name} cannot be taken on days adjacent to a Sunday. The intervening day(s) will also be counted as leave (sandwich rule).`);
      }
    }

    // 9. Check leave policy acceptance
    const leavePolicy = await prisma.policy.findFirst({
      where: { organizationId: employee.organizationId, category: 'LEAVE', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (leavePolicy) {
      const acknowledged = await prisma.policyAcknowledgment.findUnique({
        where: { policyId_employeeId: { policyId: leavePolicy.id, employeeId } },
      });
      if (!acknowledged) {
        throw new BadRequestError('You must accept the Leave Policy before applying for leave. Go to Leave Management to review and accept the policy.');
      }
    }

    // ===== END POLICY ENFORCEMENT =====

    // Check balance
    const year = startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId,
          leaveTypeId: data.leaveTypeId,
          year,
        },
      },
    });

    if (balance) {
      const available = Number(balance.allocated) + Number(balance.carriedForward) - Number(balance.used) - Number(balance.pending);
      if (days > available && leaveType.isPaid) {
        throw new BadRequestError(`Insufficient ${leaveType.name} balance. Available: ${available} day(s), Requested: ${days} day(s). You may apply for Leave Without Pay (LWP) instead.`);
      }
    } else if (leaveType.isPaid) {
      // No balance row exists for this year — reject paid leave to prevent unlimited leave
      throw new BadRequestError(`No ${leaveType.name} balance allocated for this year. Please contact HR.`);
    }

    // Check for overlapping leaves
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] },
        OR: [
          { startDate: { lte: endDate }, endDate: { gte: startDate } },
        ],
      },
    });

    if (overlapping) {
      throw new BadRequestError('You already have a leave request for these dates. Cancel the existing request first or choose different dates.');
    }

    // Create leave request
    const request = await prisma.$transaction(async (tx) => {
      const leaveRequest = await tx.leaveRequest.create({
        data: {
          employeeId,
          leaveTypeId: data.leaveTypeId,
          startDate,
          endDate,
          days,
          isHalfDay: data.isHalfDay,
          halfDaySession: data.halfDaySession || null,
          reason: data.reason,
          attachmentUrl: data.attachmentUrl || null,
          status: 'PENDING',
        },
        include: {
          leaveType: { select: { name: true, code: true } },
        },
      });

      // Update pending balance
      if (balance) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { pending: { increment: days } },
        });
      }

      return leaveRequest;
    });

    // Emit real-time event for HR + invalidate dashboard cache
    emitToOrg(employee.organizationId, 'leave:applied', {
      employeeId, employeeName: `${employee.firstName} ${employee.lastName}`,
      leaveType: request.leaveType?.name, days: request.days, startDate: request.startDate,
    });
    invalidateDashboardCache(employee.organizationId).catch(() => {});

    return request;
  }

  /**
   * Get leave requests (my or team)
   */
  async getLeaveRequests(query: LeaveQuery, employeeId?: string, organizationId?: string, isAdmin?: boolean) {
    const { page, limit, status, year } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (!isAdmin && employeeId) {
      where.employeeId = employeeId;
    } else if (query.employeeId) {
      where.employeeId = query.employeeId;
    } else if (organizationId && isAdmin) {
      where.employee = { organizationId };
    }

    if (status) where.status = status;
    if (year) {
      where.startDate = {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31),
      };
    }

    const [requests, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          leaveType: { select: { name: true, code: true, isPaid: true } },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { name: true } },
              avatar: true,
            },
          },
        },
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return {
      data: requests,
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

  /**
   * Get pending approvals for a manager/HR
   */
  async getPendingApprovals(managerId: string, organizationId: string, query: LeaveQuery, role?: string) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const isOrgAdmin = role && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(role);

    let where: any;
    if (isOrgAdmin) {
      // HR/Admin/SuperAdmin see PENDING and MANAGER_APPROVED leaves (both need HR action)
      const orgEmployees = await prisma.employee.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true },
      });
      where = {
        employeeId: { in: orgEmployees.map((e) => e.id) },
        status: { in: ['PENDING', 'MANAGER_APPROVED'] },
      };
    } else {
      // Manager sees only direct reports' PENDING leaves
      const directReports = await prisma.employee.findMany({
        where: { managerId, organizationId, deletedAt: null },
        select: { id: true },
      });
      where = {
        employeeId: { in: directReports.map((r) => r.id) },
        status: 'PENDING',
      };
    }

    const [requests, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          leaveType: { select: { name: true, code: true } },
          employee: {
            select: {
              id: true, firstName: true, lastName: true, employeeCode: true,
              department: { select: { name: true } },
              avatar: true,
              // Leave history for approval context (Section 12)
              leaveRequests: {
                where: { status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] } },
                orderBy: { createdAt: 'desc' as const },
                take: 10,
                select: { id: true, startDate: true, endDate: true, days: true, status: true, leaveType: { select: { name: true, code: true } } },
              },
              leaveBalances: {
                select: { allocated: true, used: true, pending: true, carriedForward: true, leaveType: { select: { name: true, code: true } } },
              },
            },
          },
        },
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  /**
   * Get holidays
   */
  async getHolidays(organizationId: string, year?: number) {
    const currentYear = year || new Date().getFullYear();
    return prisma.holiday.findMany({
      where: {
        organizationId,
        date: {
          gte: new Date(currentYear, 0, 1),
          lte: new Date(currentYear, 11, 31),
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Preview leave duration (dry-run for real-time UI feedback)
   */
  async previewLeave(employeeId: string, data: { leaveTypeId: string; startDate: string; endDate: string; isHalfDay: boolean; halfDaySession?: string }) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const leaveType = await prisma.leaveType.findUnique({
      where: { id: data.leaveTypeId },
    });
    if (!leaveType) throw new NotFoundError('Leave type');

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    if (endDate < startDate) {
      throw new BadRequestError('End date must be after start date');
    }

    // Calculate days
    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId);

    // Get holidays in range for warnings
    const holidaysInRange = await prisma.holiday.findMany({
      where: {
        organizationId: employee.organizationId,
        date: { gte: startDate, lte: endDate },
        type: { in: ['PUBLIC', 'CUSTOM'] },
      },
      select: { name: true, date: true },
    });

    // Check for weekends (Sundays) in range
    const sundaysInRange: string[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      if (current.getDay() === 0) {
        sundaysInRange.push(current.toISOString().split('T')[0]);
      }
      current.setDate(current.getDate() + 1);
    }

    // Get balance
    const year = startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: data.leaveTypeId, year } },
    });

    const allocated = balance ? Number(balance.allocated) + Number(balance.carriedForward) : 0;
    const used = balance ? Number(balance.used) : 0;
    const pending = balance ? Number(balance.pending) : 0;
    const available = allocated - used - pending;
    const remainingAfter = available - days;

    // Build warnings
    const warnings: string[] = [];
    if (holidaysInRange.length > 0) {
      warnings.push(`${holidaysInRange.length} holiday(s) fall in this range: ${holidaysInRange.map(h => h.name).join(', ')}. These are excluded from leave count.`);
    }
    if (sundaysInRange.length > 0) {
      warnings.push(`${sundaysInRange.length} Sunday(s) in range (excluded from leave count).`);
    }
    if (leaveType.isPaid && days > available) {
      warnings.push(`Insufficient balance. Available: ${available} day(s), Requested: ${days} day(s).`);
    }

    return {
      days,
      leaveTypeName: leaveType.name,
      leaveTypeCode: leaveType.code,
      isPaid: leaveType.isPaid,
      balance: { allocated, used, pending, available, remainingAfter },
      holidays: holidaysInRange.map(h => ({ name: h.name, date: h.date })),
      sundaysExcluded: sundaysInRange.length,
      warnings,
    };
  }

  // =====================
  // DRAFT & SUBMIT FLOW
  // =====================

  /**
   * Save a leave request as draft (minimal validation)
   */
  async saveAsDraft(employeeId: string, data: SaveDraftInput) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, firstName: true, lastName: true, managerId: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const leaveType = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
    if (!leaveType) throw new NotFoundError('Leave type');

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (endDate < startDate) throw new BadRequestError('End date must be after start date');

    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId);
    const noticeHours = Math.max(0, Math.round((startDate.getTime() - Date.now()) / (1000 * 60 * 60)));

    const draft = await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: data.leaveTypeId,
        startDate,
        endDate,
        days,
        isHalfDay: data.isHalfDay,
        halfDaySession: data.halfDaySession || null,
        reason: data.reason || '',
        attachmentUrl: data.attachmentUrl || null,
        status: 'DRAFT',
        noticeHours,
      },
      include: { leaveType: { select: { name: true, code: true } } },
    });

    return draft;
  }

  /**
   * Submit a draft leave request (full policy enforcement + task audit)
   */
  async submitDraft(requestId: string, employeeId: string, acknowledgements?: any) {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId, status: 'DRAFT' },
      include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true, noticeDays: true, maxDays: true, minDays: true, maxPerMonth: true, allowSameDay: true, allowWeekendAdjacent: true, gender: true, applicableTo: true, probationMonths: true, isActive: true } } },
    });
    if (!request) throw new NotFoundError('Draft leave request');

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, firstName: true, lastName: true, gender: true, joiningDate: true, status: true, managerId: true, email: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    if (!request.reason || request.reason.length < 5) {
      throw new BadRequestError('Reason must be at least 5 characters before submitting');
    }

    const leaveType = request.leaveType!;
    const startDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDateOnly = new Date(startDate);
    startDateOnly.setHours(0, 0, 0, 0);

    // ===== RUN POLICY ENFORCEMENT =====
    // Same-day check (SL/EL/CL exempt)
    const isUnplannedLeave = ['SL', 'EL', 'CL'].includes(leaveType.code ?? '');
    if (!isUnplannedLeave && !leaveType.allowSameDay && startDateOnly.getTime() === today.getTime()) {
      throw new BadRequestError(`${leaveType.name} must be applied in advance.`);
    }
    // Notice days check (SL/EL/CL exempt)
    if (!isUnplannedLeave && leaveType.noticeDays && leaveType.noticeDays > 0) {
      const diffDays = Math.floor((startDateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < leaveType.noticeDays) {
        throw new BadRequestError(`${leaveType.name} requires at least ${leaveType.noticeDays} day(s) advance notice.`);
      }
    }
    // Max per month
    if (leaveType.maxPerMonth && leaveType.maxPerMonth > 0) {
      const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      const monthCount = await prisma.leaveRequest.count({
        where: { employeeId, leaveTypeId: leaveType.id, status: { in: ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] }, startDate: { gte: monthStart, lte: monthEnd } },
      });
      if (monthCount >= leaveType.maxPerMonth) {
        throw new BadRequestError(`Monthly quota reached for ${leaveType.name}.`);
      }
    }
    // Overlap check
    const overlapping = await prisma.leaveRequest.findFirst({
      where: { employeeId, id: { not: requestId }, status: { in: ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] }, OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }] },
    });
    if (overlapping) throw new BadRequestError('Overlapping leave request exists.');

    // Balance check
    const year = startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: leaveType.id, year } },
    });
    if (balance && leaveType.isPaid) {
      const available = Number(balance.allocated) + Number(balance.carriedForward) - Number(balance.used) - Number(balance.pending);
      if (Number(request.days) > available) {
        throw new BadRequestError(`Insufficient ${leaveType.name} balance. Available: ${available}, Requested: ${request.days}`);
      }
    }

    // ===== RUN TASK AUDIT =====
    let auditResult: any = null;
    try {
      auditResult = await taskIntegrationService.auditTasksForLeave(
        employee.organizationId, employeeId, startDate, endDate, leaveType.code, employee.email
      );
      // Persist audit to DB (pass provider for traceability)
      const taskConfig = await taskIntegrationService.getActiveConfig(employee.organizationId);
      await taskIntegrationService.persistAudit(requestId, auditResult, taskConfig?.provider);
    } catch (err: any) {
      logger.warn(`[LeaveSubmit] Task audit failed for ${requestId}: ${err.message}`);
      auditResult = { integrationStatus: 'ERROR', riskLevel: 'LOW', riskScore: 0, errorMessage: err.message };
    }

    // ===== LEAVE-TYPE-SPECIFIC HANDOVER RULES =====
    const riskLevel = auditResult?.riskLevel || 'LOW';
    const leaveCode = leaveType.code?.toUpperCase();

    if ((leaveCode === 'CL' || leaveCode === 'EL' || leaveCode === 'PL') &&
        (riskLevel === 'HIGH' || riskLevel === 'CRITICAL')) {
      const hasBackup = await prisma.leaveRequest.findUnique({ where: { id: requestId }, select: { backupEmployeeId: true } });
      if (!hasBackup?.backupEmployeeId) {
        throw new BadRequestError(`High-risk ${leaveType.name} requires a backup assignee. Please assign a backup in the handover section.`);
      }
    }

    // ===== TRANSITION DRAFT → PENDING =====
    const updated = await prisma.$transaction(async (tx) => {
      const noticeHours = Math.max(0, Math.round((startDate.getTime() - Date.now()) / (1000 * 60 * 60)));

      const result = await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: 'PENDING',
          noticeHours,
          acknowledgements: acknowledgements || null,
          riskLevel: riskLevel as any,
          riskScore: auditResult?.riskScore || 0,
        },
        include: { leaveType: { select: { name: true, code: true } }, employee: { select: { firstName: true, lastName: true } } },
      });

      // Update pending balance
      if (balance) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { pending: { increment: Number(request.days) } },
        });
      }

      return result;
    });

    // Emit real-time event
    emitToOrg(employee.organizationId, 'leave:applied', {
      employeeId, employeeName: `${employee.firstName} ${employee.lastName}`,
      leaveType: leaveType.name, days: Number(request.days), startDate,
      riskLevel, riskScore: auditResult?.riskScore || 0,
    });
    invalidateDashboardCache(employee.organizationId).catch(() => {});

    // Send notifications
    this.sendLeaveNotifications(updated, 'submitted', employee.organizationId, employeeId).catch((err) =>
      logger.warn(`[LeaveNotify] Failed: ${err.message}`)
    );

    return updated;
  }

  // =====================
  // DETAIL & REVIEW
  // =====================

  /**
   * Get full leave request detail with audit, handovers, and decisions
   */
  async getLeaveDetail(requestId: string) {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: {
        leaveType: { select: { name: true, code: true, isPaid: true } },
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true, email: true,
            managerId: true, avatar: true,
            department: { select: { name: true } },
          },
        },
        taskAudits: {
          orderBy: { auditedAt: 'desc' },
          take: 1,
          include: { items: { orderBy: { riskLevel: 'desc' }, take: 20 } },
        },
        handovers: true,
        approvalDecisions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundError('Leave request');
    return request;
  }

  /**
   * Get manager review data (leave detail + employee context)
   */
  async getManagerReviewData(requestId: string, organizationId: string) {
    const detail = await this.getLeaveDetail(requestId);

    // Recent leave history (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const recentLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: detail.employeeId,
        status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
        createdAt: { gte: sixMonthsAgo },
      },
      orderBy: { startDate: 'desc' },
      take: 10,
      include: { leaveType: { select: { name: true, code: true } } },
    });

    // Current balances
    const balances = await this.getBalances(detail.employeeId);

    return { ...detail, recentLeaves, balances };
  }

  /**
   * Get HR review data (leave detail + compliance checks)
   */
  async getHrReviewData(requestId: string, organizationId: string) {
    const detail = await this.getLeaveDetail(requestId);

    // Notice compliance
    const noticeMet = detail.noticeHours !== null ? detail.noticeHours >= 24 : null;

    // Short-notice pattern (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const shortNoticeCount = await prisma.leaveRequest.count({
      where: {
        employeeId: detail.employeeId,
        status: { in: ['PENDING', 'APPROVED', 'APPROVED_WITH_CONDITION', 'MANAGER_APPROVED'] },
        createdAt: { gte: ninetyDaysAgo },
        noticeHours: { not: null, lt: 24 },
      },
    });

    // Manager decision (from approval decisions)
    const managerDecision = detail.approvalDecisions.find(
      (d: any) => d.actorRole === 'MANAGER'
    ) || null;

    // Recent leave history
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const recentLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: detail.employeeId,
        status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
        createdAt: { gte: sixMonthsAgo },
      },
      orderBy: { startDate: 'desc' },
      take: 10,
      include: { leaveType: { select: { name: true, code: true } } },
    });

    const balances = await this.getBalances(detail.employeeId);

    return {
      ...detail,
      compliance: { noticeMet, shortNoticeCount, shortNoticeThreshold: 3 },
      managerDecision,
      recentLeaves,
      balances,
    };
  }

  // =====================
  // HANDOVER
  // =====================

  /**
   * Update handover/backup for a leave request
   */
  async updateHandover(requestId: string, employeeId: string, data: UpdateHandoverInput) {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId, status: { in: ['DRAFT', 'PENDING'] } },
    });
    if (!request) throw new NotFoundError('Leave request (must be in DRAFT or PENDING status)');

    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { organizationId: true } });

    // Validate backup employee only if one was provided
    if (data.backupEmployeeId) {
      const backup = await prisma.employee.findUnique({ where: { id: data.backupEmployeeId }, select: { id: true } });
      if (!backup) throw new NotFoundError('Backup employee');
      if (data.backupEmployeeId === employeeId) throw new BadRequestError('Cannot assign yourself as backup');
    }

    await prisma.$transaction(async (tx) => {
      // Update leave request
      await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          backupEmployeeId: data.backupEmployeeId || null,
          handoverNotes: data.handoverNotes || null,
        },
      });

      // Remove old handovers for this request
      await tx.leaveHandover.deleteMany({ where: { leaveRequestId: requestId } });

      // Create new handover records (only if backup provided)
      if (data.backupEmployeeId && data.taskHandovers?.length) {
        await tx.leaveHandover.createMany({
          data: data.taskHandovers.map((h) => ({
            leaveRequestId: requestId,
            backupEmployeeId: h.backupEmployeeId,
            taskExternalId: h.taskExternalId || null,
            taskTitle: h.taskTitle || null,
            handoverNote: h.handoverNote,
            organizationId: employee!.organizationId,
          })),
        });
      }
    });

    return { success: true, message: 'Handover updated' };
  }

  // =====================
  // ENHANCED APPROVAL
  // =====================

  /**
   * Override handleLeaveAction to support APPROVED_WITH_CONDITION + audit trail
   */
  async handleLeaveAction(requestId: string, action: string, approvedBy: string, remarks?: string, organizationId?: string, conditionNote?: string) {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { select: { managerId: true, userId: true, organizationId: true, firstName: true, lastName: true } } },
    });
    if (!request) throw new NotFoundError('Leave request');

    // ── Org boundary check ──
    if (organizationId && request.employee?.organizationId !== organizationId) {
      throw new BadRequestError('Unauthorized: this leave request does not belong to your organization');
    }

    // ── Role-based permission enforcement ──
    const approverUser = await prisma.user.findUnique({ where: { id: approvedBy }, select: { role: true } });
    const approverRole = approverUser?.role;

    const isHRAdmin = approverRole && ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(approverRole);
    const isManager = approverRole === 'MANAGER';

    if (isManager) {
      // Managers can ONLY do MANAGER_APPROVED (first-step) or REJECTED on PENDING requests
      if (action !== 'MANAGER_APPROVED' && action !== 'REJECTED') {
        throw new BadRequestError('Managers can only perform first-step approval or rejection');
      }
      if (request.status !== 'PENDING') {
        throw new BadRequestError('Managers can only act on PENDING requests');
      }
    } else if (!isHRAdmin) {
      throw new BadRequestError('You do not have permission to perform leave actions');
    }

    // Valid state transitions
    const validFromStates: Record<string, string[]> = {
      'MANAGER_APPROVED': ['PENDING'],
      'APPROVED': ['PENDING', 'MANAGER_APPROVED'],
      'APPROVED_WITH_CONDITION': ['PENDING', 'MANAGER_APPROVED'],
      'REJECTED': ['PENDING', 'MANAGER_APPROVED'],
    };

    if (!validFromStates[action]?.includes(request.status)) {
      throw new BadRequestError(`Cannot ${action.toLowerCase().replace(/_/g, ' ')} a ${request.status} request`);
    }

    // Require remarks for high-risk approvals
    if ((action === 'APPROVED' || action === 'APPROVED_WITH_CONDITION') &&
        (request.riskLevel === 'HIGH' || request.riskLevel === 'CRITICAL') &&
        !remarks) {
      throw new BadRequestError('Remarks required when approving a high-risk leave request');
    }

    // Require condition note for APPROVED_WITH_CONDITION
    if (action === 'APPROVED_WITH_CONDITION' && !conditionNote) {
      throw new BadRequestError('Condition note required for conditional approval');
    }

    const finalStatus = action;

    const updated = await prisma.$transaction(async (tx) => {
      const updateData: any = {
        status: finalStatus,
        approverRemarks: remarks || null,
      };

      if (finalStatus === 'MANAGER_APPROVED') {
        updateData.managerApprovedAt = new Date();
        updateData.managerRemarks = remarks || null;
      } else {
        updateData.approvedBy = approvedBy;
      }

      const updatedRequest = await tx.leaveRequest.update({
        where: { id: requestId },
        data: updateData,
        include: {
          leaveType: { select: { name: true, code: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
      });

      const year = new Date(request.startDate).getFullYear();
      const balance = await tx.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
      });

      if (balance) {
        if (finalStatus === 'APPROVED' || finalStatus === 'APPROVED_WITH_CONDITION') {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { used: { increment: Number(request.days) }, pending: { decrement: Number(request.days) } },
          });

          // Create ON_LEAVE attendance records
          const leaveStart = new Date(request.startDate);
          const leaveEnd = new Date(request.endDate);
          const orgHolidays = await tx.holiday.findMany({
            where: { organizationId: organizationId!, date: { gte: leaveStart, lte: leaveEnd }, type: { in: ['PUBLIC', 'CUSTOM'] } },
            select: { date: true },
          });
          const holidayDateSet = new Set(orgHolidays.map(h => new Date(h.date).toISOString().split('T')[0]));
          const current = new Date(leaveStart);
          while (current <= leaveEnd) {
            const dow = current.getDay();
            const dateStr = current.toISOString().split('T')[0];
            if (dow !== 0 && !holidayDateSet.has(dateStr)) {
              const dateOnly = new Date(current);
              dateOnly.setHours(0, 0, 0, 0);
              await tx.attendanceRecord.upsert({
                where: { employeeId_date: { employeeId: request.employeeId, date: dateOnly } },
                update: { status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${updatedRequest.leaveType?.name}` },
                create: { employeeId: request.employeeId, date: dateOnly, status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${updatedRequest.leaveType?.name}`, workMode: 'OFFICE' },
              });
            }
            current.setDate(current.getDate() + 1);
          }
        } else if (finalStatus === 'REJECTED') {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { pending: { decrement: Number(request.days) } },
          });
        }
      }

      // Create approval decision record
      const approverUser = await tx.user.findUnique({ where: { id: approvedBy }, select: { role: true } });
      await tx.leaveApprovalDecision.create({
        data: {
          leaveRequestId: requestId,
          actorId: approvedBy,
          actorRole: approverUser?.role || 'UNKNOWN',
          action: finalStatus,
          comment: remarks || null,
          conditionNote: conditionNote || null,
          riskLevelAtTime: request.riskLevel as any || null,
          organizationId: organizationId!,
        },
      });

      return updatedRequest;
    });

    // Audit log
    if (organizationId) {
      await createAuditLog({
        userId: approvedBy,
        organizationId,
        entity: 'LeaveRequest',
        entityId: requestId,
        action: finalStatus === 'REJECTED' ? 'REJECT' : 'APPROVE',
        oldValue: { status: request.status, riskLevel: request.riskLevel },
        newValue: { status: finalStatus, remarks, conditionNote, riskLevel: request.riskLevel },
      });
    }

    // Real-time notification
    if (request.employee?.userId) {
      emitToUser(request.employee.userId, 'leave:actioned', {
        requestId, action: finalStatus, leaveType: updated.leaveType?.name, remarks, conditionNote,
      });
    }
    if (request.employee?.organizationId) {
      invalidateDashboardCache(request.employee.organizationId).catch(() => {});
    }

    // Send notifications
    const eventName = finalStatus === 'REJECTED' ? 'rejected' : 'approved';
    this.sendLeaveNotifications(updated, eventName, organizationId || request.employee?.organizationId || '', request.employeeId).catch((err) =>
      logger.warn(`[LeaveNotify] Failed: ${err.message}`)
    );

    return updated;
  }

  /**
   * Cancel a leave request (employee) — also allow DRAFT cancellation
   */
  async cancelLeave(requestId: string, employeeId: string) {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId },
    });
    if (!request) throw new NotFoundError('Leave request');
    if (!['PENDING', 'DRAFT'].includes(request.status)) {
      throw new BadRequestError('Only pending or draft requests can be cancelled');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' },
      });

      // Only decrement pending balance if it was in PENDING status (not DRAFT)
      if (request.status === 'PENDING') {
        const year = new Date(request.startDate).getFullYear();
        const balance = await tx.leaveBalance.findUnique({
          where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: request.leaveTypeId, year } },
        });
        if (balance) {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { pending: { decrement: Number(request.days) } },
          });
        }
      }

      return cancelled;
    });

    return updated;
  }

  // =====================
  // NOTIFICATIONS
  // =====================

  /**
   * Send leave notifications to relevant recipients
   */
  private async sendLeaveNotifications(
    leaveRequest: any,
    event: string,
    organizationId: string,
    employeeId: string
  ) {
    try {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true, email: true, managerId: true, userId: true },
      });
      if (!employee) return;

      const recipients: Array<{ userId: string; email: string; role: string }> = [];

      if (event === 'submitted') {
        // Notify manager
        if (employee.managerId) {
          const manager = await prisma.employee.findUnique({
            where: { id: employee.managerId },
            select: { userId: true, email: true },
          });
          if (manager?.userId) recipients.push({ userId: manager.userId, email: manager.email, role: 'MANAGER' });
        }
        // Notify HR users
        const hrUsers = await prisma.user.findMany({
          where: { organizationId, role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] }, isActive: true },
          select: { id: true, email: true },
          take: 5,
        });
        hrUsers.forEach(u => recipients.push({ userId: u.id, email: u.email, role: 'HR' }));
      } else if (event === 'approved' || event === 'rejected') {
        // Notify the employee
        if (employee.userId) {
          recipients.push({ userId: employee.userId, email: employee.email, role: 'EMPLOYEE' });
        }
        // Notify backup if assigned
        if (leaveRequest.backupEmployeeId) {
          const backup = await prisma.employee.findUnique({
            where: { id: leaveRequest.backupEmployeeId },
            select: { userId: true, email: true },
          });
          if (backup?.userId) recipients.push({ userId: backup.userId, email: backup.email, role: 'BACKUP' });
        }
      }

      const leaveTypeName = leaveRequest.leaveType?.name || 'Leave';
      const empName = `${employee.firstName} ${employee.lastName}`;

      for (const recipient of recipients) {
        const templateName = `leave-${event}`;
        const subject = event === 'submitted'
          ? `Leave Request: ${empName} — ${leaveTypeName} (${leaveRequest.days} days)`
          : event === 'approved'
          ? `Leave Approved: ${leaveTypeName} (${leaveRequest.days} days)`
          : `Leave Rejected: ${leaveTypeName}`;

        const context = {
          employeeName: empName,
          leaveType: leaveTypeName,
          startDate: new Date(leaveRequest.startDate).toISOString(),
          endDate: new Date(leaveRequest.endDate).toISOString(),
          days: Number(leaveRequest.days),
          reason: leaveRequest.reason,
          riskLevel: leaveRequest.riskLevel || 'LOW',
          riskScore: leaveRequest.riskScore || 0,
          status: leaveRequest.status,
          remarks: leaveRequest.approverRemarks || '',
          appUrl: env.FRONTEND_URL,
        };

        // Enqueue email — skip if recipient has no email address
        if (!recipient.email) {
          logger.warn(`[LeaveNotifications] Skipping email for recipient userId=${recipient.userId}: no email address`);
        } else {
          await enqueueEmail({ to: recipient.email, subject, template: templateName, context }).catch((err) =>
            logger.error(`[LeaveNotifications] Failed to enqueue email to ${recipient.email}:`, err)
          );
        }

        // Socket notification
        await enqueueNotification({
          userId: recipient.userId,
          organizationId,
          title: subject,
          message: `${empName} — ${leaveTypeName} (${new Date(leaveRequest.startDate).toLocaleDateString('en-IN')} to ${new Date(leaveRequest.endDate).toLocaleDateString('en-IN')})`,
          type: 'LEAVE',
          link: '/leaves',
        }).catch((err) =>
          logger.error(`[LeaveNotifications] Failed to enqueue notification for ${recipient.userId}:`, err)
        );

        // Log notification
        await prisma.leaveNotificationLog.create({
          data: {
            leaveRequestId: leaveRequest.id,
            recipientId: recipient.userId,
            channel: 'BOTH',
            templateName,
            payload: context,
            organizationId,
          },
        }).catch((err) =>
          logger.error(`[LeaveNotifications] Failed to log notification:`, err)
        );
      }
    } catch (err: any) {
      logger.warn(`[LeaveNotifications] Error: ${err.message}`);
    }
  }

  /**
   * Calculate business days between two dates (excludes Sundays and org holidays)
   */
  private async calculateBusinessDays(start: Date, end: Date, organizationId: string): Promise<number> {
    // Fetch org holidays in range for exclusion
    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId,
        date: { gte: start, lte: end },
        type: { in: ['PUBLIC', 'CUSTOM'] }, // Only mandatory holidays excluded
      },
      select: { date: true, isHalfDay: true },
    });
    const fullDayHolidays = new Set<string>();
    const halfDayHolidays = new Set<string>();
    holidays.forEach(h => {
      const dateStr = new Date(h.date).toISOString().split('T')[0];
      if (h.isHalfDay) {
        halfDayHolidays.add(dateStr);
      } else {
        fullDayHolidays.add(dateStr);
      }
    });

    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      if (dayOfWeek !== 0) { // Exclude Sundays
        if (fullDayHolidays.has(dateStr)) {
          // Full-day holiday — exclude entirely
        } else if (halfDayHolidays.has(dateStr)) {
          // Half-day holiday — only count 0.5 working day
          days += 0.5;
        } else {
          days++;
        }
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }
}

export const leaveService = new LeaveService();
