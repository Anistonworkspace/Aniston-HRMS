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
    const types = await prisma.leaveType.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
    });
    // Deserialize applicableToEmployeeIds JSON string → array for the client
    return types.map((t) => ({
      ...t,
      applicableToEmployeeIds: (t as any).applicableToEmployeeIds
        ? (() => { try { return JSON.parse((t as any).applicableToEmployeeIds); } catch { return []; } })()
        : [],
    }));
  }

  /**
   * Create a new leave type
   */
  async createLeaveType(data: CreateLeaveTypeInput, organizationId: string) {
    const { applicableToEmployeeIds, ...rest } = data as any;
    return prisma.leaveType.create({
      data: {
        ...rest,
        organizationId,
        applicableToEmployeeIds: applicableToEmployeeIds?.length
          ? JSON.stringify(applicableToEmployeeIds)
          : null,
      },
    });
  }

  /**
   * Update an existing leave type
   */
  async updateLeaveType(id: string, data: UpdateLeaveTypeInput, organizationId: string) {
    const existing = await prisma.leaveType.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Leave type');

    const { applicableToEmployeeIds, ...rest } = data as any;
    const updateData: any = { ...rest };
    if (applicableToEmployeeIds !== undefined) {
      updateData.applicableToEmployeeIds = applicableToEmployeeIds?.length
        ? JSON.stringify(applicableToEmployeeIds)
        : null;
    }

    return prisma.leaveType.update({
      where: { id },
      data: updateData,
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
      select: { organizationId: true, gender: true, status: true, joiningDate: true, user: { select: { role: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');

    const userRole = employee.user?.role;

    // Get only active leave types
    const allLeaveTypes = await prisma.leaveType.findMany({
      where: { organizationId: employee.organizationId, isActive: true },
    });

    // Filter by applicability and gender — all rules driven by leave type settings
    const leaveTypes = allLeaveTypes.filter((lt) => {
      // Gender check — skip if leave type is gender-specific and doesn't match
      if (lt.gender && lt.gender !== employee.gender) return false;

      // Specific employee restriction — overrides ALL status/role filters
      const specificIds: string[] | null = (lt as any).applicableToEmployeeIds
        ? (() => { try { return JSON.parse((lt as any).applicableToEmployeeIds); } catch { return null; } })()
        : null;
      if (specificIds && specificIds.length > 0) {
        return specificIds.includes(employeeId);
      }

      // Role check — if applicableToRole is set, only that role can see this leave
      if ((lt as any).applicableToRole && (lt as any).applicableToRole !== userRole) return false;

      // Min Service Months — HR-configured tenure gate (default 0 = no gate)
      const probationMonths = (lt as any).probationMonths ?? 0;
      if (probationMonths > 0 && (employee as any).joiningDate) {
        const joined = new Date((employee as any).joiningDate);
        const now = new Date();
        const monthsWorked = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
        if (monthsWorked < probationMonths) return false;
      }

      // Applicability check (status-based) — driven entirely by HR settings
      const app = lt.applicableTo;
      if (app === 'ALL') return true;
      if (app === 'PROBATION') return employee.status === 'PROBATION';
      if (app === 'ACTIVE' || app === 'CONFIRMED') return employee.status === 'ACTIVE'; // CONFIRMED kept for backward compat
      if (app === 'NOTICE_PERIOD') return employee.status === 'NOTICE_PERIOD';
      if (app === 'ONBOARDING') return employee.status === 'ONBOARDING';
      if (app === 'INTERN') return employee.status === 'INTERN' || userRole === 'INTERN';
      if (app === 'SUSPENDED') return employee.status === 'SUSPENDED';
      if (app === 'INACTIVE') return employee.status === 'INACTIVE';
      if (app === 'TERMINATED') return employee.status === 'TERMINATED';
      if (app === 'ABSCONDED') return employee.status === 'ABSCONDED';
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
      select: { organizationId: true, firstName: true, lastName: true, gender: true, joiningDate: true, status: true, user: { select: { role: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');

    const leaveType = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
    if (!leaveType) throw new NotFoundError('Leave type');
    if (!leaveType.isActive) throw new BadRequestError('This leave type is currently inactive');

    // Fetch org working days once — used in multiple checks below
    const workingDays = await this.getWorkingDays(employee.organizationId);

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDateOnly = new Date(startDate);
    startDateOnly.setHours(0, 0, 0, 0);

    if (endDate < startDate) {
      throw new BadRequestError('End date must be after start date');
    }

    // Validate half-day is on a working day
    if (data.isHalfDay && !workingDays.has(startDate.getDay())) {
      throw new BadRequestError('Cannot apply half-day leave on a non-working day. Please select a working day.');
    }

    // Calculate business days (pass pre-fetched working days to avoid double DB call)
    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId, workingDays);

    if (days <= 0) {
      throw new BadRequestError('Selected dates have no working days. Non-working days cannot be taken as leave.');
    }

    // Validate halfDaySession
    if (data.isHalfDay && data.halfDaySession && !['FIRST_HALF', 'SECOND_HALF'].includes(data.halfDaySession)) {
      throw new BadRequestError('Invalid halfDaySession. Must be FIRST_HALF or SECOND_HALF.');
    }

    // ===== POLICY ENFORCEMENT =====

    // 1. Min days check
    if (leaveType.minDays && Number(leaveType.minDays) > 0.5 && days < Number(leaveType.minDays)) {
      throw new BadRequestError(`${leaveType.name} requires a minimum of ${Number(leaveType.minDays)} day(s) per application.`);
    }

    // 2. Max days check (max consecutive days per single application)
    if (leaveType.maxDays && days > Number(leaveType.maxDays)) {
      throw new BadRequestError(`Maximum ${Number(leaveType.maxDays)} consecutive day(s) allowed for ${leaveType.name}.`);
    }

    // 3. Past date check — controlled by allowPastDates setting per leave type
    if (!(leaveType as any).allowPastDates && startDateOnly.getTime() < today.getTime()) {
      throw new BadRequestError(`${leaveType.name} does not allow backdated applications. Please contact HR if this is an emergency.`);
    }

    // 4. Same-day check — controlled entirely by allowSameDay setting per leave type
    if (!leaveType.allowSameDay && startDateOnly.getTime() === today.getTime()) {
      throw new BadRequestError(`${leaveType.name} does not allow same-day applications. Please apply in advance or contact HR to enable same-day leave for this type.`);
    }

    // 5. Notice days check — controlled entirely by noticeDays setting per leave type
    if (leaveType.noticeDays && leaveType.noticeDays > 0) {
      const diffMs = startDateOnly.getTime() - today.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < leaveType.noticeDays) {
        throw new BadRequestError(`${leaveType.name} requires at least ${leaveType.noticeDays} day(s) advance notice. Your leave starts in ${diffDays} day(s).`);
      }
    }

    // 6. Max advance booking days check
    const maxAdvanceDays = (leaveType as any).maxAdvanceDays;
    if (maxAdvanceDays && maxAdvanceDays > 0) {
      const diffMs = startDateOnly.getTime() - today.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays > maxAdvanceDays) {
        throw new BadRequestError(`${leaveType.name} can only be applied up to ${maxAdvanceDays} day(s) in advance. Your leave starts in ${diffDays} day(s).`);
      }
    }

    // 7. Max per month check
    if (leaveType.maxPerMonth && leaveType.maxPerMonth > 0) {
      const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      const monthCount = await prisma.leaveRequest.count({
        where: {
          employeeId,
          leaveTypeId: data.leaveTypeId,
          // Count only active approvals — not pending/rejected. A rejected request should
          // not consume the monthly quota, allowing the employee to re-apply.
          status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
          startDate: { gte: monthStart, lte: monthEnd },
        },
      });
      if (monthCount >= leaveType.maxPerMonth) {
        throw new BadRequestError(`You can apply for ${leaveType.name} a maximum of ${leaveType.maxPerMonth} time(s) per month. You have already used your monthly quota.`);
      }
    }

    // 8. Gender restriction
    if (leaveType.gender && employee.gender !== leaveType.gender) {
      throw new BadRequestError(`${leaveType.name} is available for ${leaveType.gender.toLowerCase()} employees only.`);
    }

    // 9. Specific employee restriction check — overrides status/role filters
    const empUserRole = employee.user?.role;
    const specificEmpIds: string[] | null = (leaveType as any).applicableToEmployeeIds
      ? (() => { try { return JSON.parse((leaveType as any).applicableToEmployeeIds); } catch { return null; } })()
      : null;
    if (specificEmpIds && specificEmpIds.length > 0) {
      if (!specificEmpIds.includes(employeeId)) {
        throw new BadRequestError(`${leaveType.name} is restricted to specific employees only. You are not eligible for this leave type. Contact HR if you believe this is an error.`);
      }
    } else {
      // 9b. Applicability check (status-based) — driven entirely by leave type settings
      if (leaveType.applicableTo !== 'ALL') {
        const app = leaveType.applicableTo;
        const status = employee.status;

        const allowed = (() => {
          if (app === 'PROBATION') return status === 'PROBATION';
          if (app === 'ACTIVE' || app === 'CONFIRMED') return status === 'ACTIVE';
          if (app === 'NOTICE_PERIOD') return status === 'NOTICE_PERIOD';
          if (app === 'ONBOARDING') return status === 'ONBOARDING';
          if (app === 'INTERN') return status === 'INTERN' || empUserRole === 'INTERN';
          if (app === 'SUSPENDED') return status === 'SUSPENDED';
          if (app === 'INACTIVE') return status === 'INACTIVE';
          if (app === 'TERMINATED') return status === 'TERMINATED';
          if (app === 'ABSCONDED') return status === 'ABSCONDED';
          return true;
        })();

        if (!allowed) {
          const labels: Record<string, string> = {
            PROBATION: 'employees in probation period',
            ACTIVE: 'active/full-time employees',
            CONFIRMED: 'active/full-time employees',
            NOTICE_PERIOD: 'employees serving notice period',
            ONBOARDING: 'employees in onboarding',
            INTERN: 'interns',
            SUSPENDED: 'suspended employees',
            INACTIVE: 'inactive employees',
            TERMINATED: 'terminated employees',
            ABSCONDED: 'absconded employees',
          };
          throw new BadRequestError(`${leaveType.name} is available for ${labels[app] || app} only. Your current status does not qualify. Contact HR to check your eligibility.`);
        }
      }

      // 10. Role restriction check — if HR restricted this leave to a specific role
      const roleRestriction = (leaveType as any).applicableToRole;
      if (roleRestriction && roleRestriction !== empUserRole) {
        const roleLabels: Record<string, string> = {
          EMPLOYEE: 'Employees', MANAGER: 'Managers', HR: 'HR team', ADMIN: 'Administrators', INTERN: 'Interns',
        };
        throw new BadRequestError(`${leaveType.name} is restricted to ${roleLabels[roleRestriction] || roleRestriction} only. Your role does not qualify.`);
      }
    }

    // 10b. Min Service Months — HR-configured tenure gate (default 0 = no gate)
    const probMonths = (leaveType as any).probationMonths ?? 0;
    if (probMonths > 0 && employee.joiningDate) {
      const joined = new Date(employee.joiningDate);
      const now = new Date();
      const monthsWorked = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
      if (monthsWorked < probMonths) {
        throw new BadRequestError(`${leaveType.name} requires ${probMonths} month(s) of service. You have completed ${monthsWorked} month(s). Please contact HR if you need an exception.`);
      }
    }

    // 11. Weekend adjacent check (sandwich rule)
    if (!leaveType.allowWeekendAdjacent) {
      const dayBefore = new Date(startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(endDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const beforeIsOff = !workingDays.has(dayBefore.getDay());
      const afterIsOff = !workingDays.has(dayAfter.getDay());
      if (beforeIsOff && afterIsOff) {
        throw new BadRequestError(`${leaveType.name} cannot be taken adjacent to a non-working day (sandwich rule applies).`);
      }
    }

    // 12. Leave policy acknowledgment check
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
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: data.leaveTypeId, year } },
    });

    if (leaveType.isPaid) {
      if (!balance) {
        throw new BadRequestError(`No ${leaveType.name} balance allocated for this year. Please contact HR.`);
      }
      const available = Number(balance.allocated) + Number(balance.carriedForward) - Number(balance.used) - Number(balance.pending);
      if (days > available) {
        throw new BadRequestError(`Insufficient ${leaveType.name} balance. Available: ${available} day(s), Requested: ${days} day(s). You may apply for Leave Without Pay (LWP) instead.`);
      }
    }

    // Determine final status — auto-approve if requiresApproval=false
    const autoApprove = leaveType.requiresApproval === false;
    const finalStatus = autoApprove ? 'APPROVED' : 'PENDING';

    // Create leave request — overlap check is INSIDE the transaction to prevent
    // TOCTOU race where two concurrent applications for the same dates both pass (G-02).
    const request = await prisma.$transaction(async (tx) => {
      // G-02: Re-check overlap inside the transaction to close the TOCTOU race window
      const overlapping = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: { in: ['DRAFT', 'PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] },
          OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }],
        },
      });
      if (overlapping) {
        throw new BadRequestError('You already have a leave request for these dates. Cancel the existing request first or choose different dates.');
      }
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
          status: finalStatus,
        },
        include: { leaveType: { select: { name: true, code: true } } },
      });

      if (balance) {
        if (autoApprove) {
          // Auto-approved — deduct from used directly
          await tx.leaveBalance.update({ where: { id: balance.id }, data: { used: { increment: days } } });

          // Create ON_LEAVE attendance records
          const orgHolidays = await tx.holiday.findMany({
            where: { organizationId: employee.organizationId, date: { gte: startDate, lte: endDate }, type: { in: ['PUBLIC', 'CUSTOM'] } },
            select: { date: true },
          });
          const holidayDateSet = new Set(orgHolidays.map(h => new Date(h.date).toISOString().split('T')[0]));
          const cur = new Date(startDate);
          while (cur <= endDate) {
            if (workingDays.has(cur.getDay()) && !holidayDateSet.has(cur.toISOString().split('T')[0])) {
              const dateOnly = new Date(cur);
              dateOnly.setHours(0, 0, 0, 0);
              await tx.attendanceRecord.upsert({
                where: { employeeId_date: { employeeId, date: dateOnly } },
                update: { status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${leaveRequest.leaveType?.name}` },
                create: { employeeId, date: dateOnly, status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${leaveRequest.leaveType?.name}`, workMode: 'OFFICE' },
              });
            }
            cur.setDate(cur.getDate() + 1);
          }
        } else {
          // Normal flow — increment pending
          await tx.leaveBalance.update({ where: { id: balance.id }, data: { pending: { increment: days } } });
        }
      }

      return leaveRequest;
    });

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

    // Fetch org working days once — used for both day calculation and warnings
    const previewWorkingDays = await this.getWorkingDays(employee.organizationId);

    // Calculate days using org working days
    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId, previewWorkingDays);

    // Get holidays in range for warnings
    const holidaysInRange = await prisma.holiday.findMany({
      where: {
        organizationId: employee.organizationId,
        date: { gte: startDate, lte: endDate },
        type: { in: ['PUBLIC', 'CUSTOM'] },
      },
      select: { name: true, date: true },
    });

    // Find non-working days in range (respects org working days, not just Sundays)
    const nonWorkingDaysInRange: string[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      if (!previewWorkingDays.has(current.getDay())) {
        nonWorkingDaysInRange.push(current.toISOString().split('T')[0]);
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
    if (nonWorkingDaysInRange.length > 0) {
      warnings.push(`${nonWorkingDaysInRange.length} non-working day(s) in range (excluded from leave count).`);
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
      nonWorkingDaysExcluded: nonWorkingDaysInRange.length,
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
      select: { organizationId: true, firstName: true, lastName: true, managerId: true, status: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Block draft save for non-active statuses
    const BLOCKED_STATUSES: Record<string, string> = {
      SUSPENDED: 'Your account is currently suspended. Contact HR before applying for leave.',
      INACTIVE: 'Your employment is marked as inactive. Please contact HR.',
      TERMINATED: 'Terminated employees cannot apply for leave.',
      ABSCONDED: 'Your employment status prevents leave applications. Please contact HR.',
    };
    if (BLOCKED_STATUSES[employee.status]) {
      throw new BadRequestError(BLOCKED_STATUSES[employee.status]);
    }

    const leaveType = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
    if (!leaveType) throw new NotFoundError('Leave type');
    if (!leaveType.isActive) throw new BadRequestError('This leave type is currently inactive');

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (endDate < startDate) throw new BadRequestError('End date must be after start date');

    // Fetch working days for validation
    const workingDays = await this.getWorkingDays(employee.organizationId);

    // Half-day on non-working day check
    if (data.isHalfDay && !workingDays.has(startDate.getDay())) {
      throw new BadRequestError('Cannot apply half-day leave on a non-working day. Please select a working day.');
    }

    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId, workingDays);

    if (days <= 0) {
      throw new BadRequestError('Selected dates have no working days. Non-working days cannot be taken as leave.');
    }

    // Check for overlapping drafts/leaves
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['DRAFT', 'PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] },
        OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }],
      },
    });
    if (overlapping) {
      throw new BadRequestError('You already have a leave request for these dates. Cancel the existing request first or choose different dates.');
    }

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
      include: {
        leaveType: {
          select: {
            id: true, name: true, code: true, isPaid: true, noticeDays: true,
            maxDays: true, minDays: true, maxPerMonth: true, allowSameDay: true,
            allowWeekendAdjacent: true, gender: true, applicableTo: true,
            probationMonths: true, isActive: true, requiresApproval: true,
            applicableToRole: true, allowPastDates: true, maxAdvanceDays: true,
            applicableToEmployeeIds: true,
          } as any,
        },
      },
    });
    if (!request) throw new NotFoundError('Draft leave request');

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        organizationId: true, firstName: true, lastName: true, gender: true,
        joiningDate: true, status: true, managerId: true, email: true,
        user: { select: { role: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee');

    // 1. Blocked status check
    const BLOCKED_STATUSES: Record<string, string> = {
      SUSPENDED: 'Your account is currently suspended. Contact HR to resolve your employment status before applying for leave.',
      INACTIVE: 'Your employment is marked as inactive. Please contact HR.',
      TERMINATED: 'Terminated employees cannot apply for leave.',
      ABSCONDED: 'Your employment status prevents leave applications. Please contact HR.',
    };
    if (BLOCKED_STATUSES[employee.status]) {
      throw new BadRequestError(BLOCKED_STATUSES[employee.status]);
    }

    if (!request.reason || request.reason.length < 5) {
      throw new BadRequestError('Reason must be at least 5 characters before submitting');
    }

    const leaveType = request.leaveType! as any;

    // 2. Leave type still active?
    if (!leaveType.isActive) {
      throw new BadRequestError('This leave type has been deactivated. Please contact HR.');
    }

    const startDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDateOnly = new Date(startDate);
    startDateOnly.setHours(0, 0, 0, 0);

    // Fetch working days
    const workingDays = await this.getWorkingDays(employee.organizationId);

    // 3. Half-day on non-working day
    if (request.isHalfDay && !workingDays.has(startDate.getDay())) {
      throw new BadRequestError('Cannot apply half-day leave on a non-working day. Please select a working day.');
    }

    // 4. Days = 0 check
    const days = Number(request.days);
    if (days <= 0) {
      throw new BadRequestError('Selected dates have no working days. Non-working days cannot be taken as leave.');
    }

    // Validate halfDaySession
    if (request.isHalfDay && request.halfDaySession && !['FIRST_HALF', 'SECOND_HALF'].includes(request.halfDaySession)) {
      throw new BadRequestError('Invalid halfDaySession. Must be FIRST_HALF or SECOND_HALF.');
    }

    // ===== FULL POLICY ENFORCEMENT =====

    // 5. Min days check
    if (leaveType.minDays && Number(leaveType.minDays) > 0.5 && days < Number(leaveType.minDays)) {
      throw new BadRequestError(`${leaveType.name} requires a minimum of ${Number(leaveType.minDays)} day(s) per application.`);
    }

    // 6. Max days check
    if (leaveType.maxDays && days > Number(leaveType.maxDays)) {
      throw new BadRequestError(`Maximum ${Number(leaveType.maxDays)} consecutive day(s) allowed for ${leaveType.name}.`);
    }

    // 7. Past date check
    if (!leaveType.allowPastDates && startDateOnly.getTime() < today.getTime()) {
      throw new BadRequestError(`${leaveType.name} does not allow backdated applications. Please contact HR if this is an emergency.`);
    }

    // 8. Same-day check
    if (!leaveType.allowSameDay && startDateOnly.getTime() === today.getTime()) {
      throw new BadRequestError(`${leaveType.name} does not allow same-day applications. Please apply in advance or contact HR.`);
    }

    // 9. Notice days check
    if (leaveType.noticeDays && leaveType.noticeDays > 0) {
      const diffDays = Math.floor((startDateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < leaveType.noticeDays) {
        throw new BadRequestError(`${leaveType.name} requires at least ${leaveType.noticeDays} day(s) advance notice. Your leave starts in ${diffDays} day(s).`);
      }
    }

    // 10. Max advance days check
    if (leaveType.maxAdvanceDays && leaveType.maxAdvanceDays > 0) {
      const diffDays = Math.floor((startDateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > leaveType.maxAdvanceDays) {
        throw new BadRequestError(`${leaveType.name} can only be applied up to ${leaveType.maxAdvanceDays} day(s) in advance.`);
      }
    }

    // 11. Max per month
    if (leaveType.maxPerMonth && leaveType.maxPerMonth > 0) {
      const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      const monthCount = await prisma.leaveRequest.count({
        where: { employeeId, leaveTypeId: leaveType.id, status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] }, startDate: { gte: monthStart, lte: monthEnd } },
      });
      if (monthCount >= leaveType.maxPerMonth) {
        throw new BadRequestError(`Monthly quota reached for ${leaveType.name}.`);
      }
    }

    // 12. Gender restriction
    if (leaveType.gender && employee.gender !== leaveType.gender) {
      throw new BadRequestError(`${leaveType.name} is available for ${leaveType.gender.toLowerCase()} employees only.`);
    }

    // 13. Specific employee restriction check — overrides status/role filters
    const empUserRole = employee.user?.role;
    const specificEmpIdsForDraft: string[] | null = (leaveType as any).applicableToEmployeeIds
      ? (() => { try { return JSON.parse((leaveType as any).applicableToEmployeeIds); } catch { return null; } })()
      : null;
    if (specificEmpIdsForDraft && specificEmpIdsForDraft.length > 0) {
      if (!specificEmpIdsForDraft.includes(employeeId)) {
        throw new BadRequestError(`${leaveType.name} is restricted to specific employees only. You are not eligible for this leave type. Contact HR if you believe this is an error.`);
      }
    } else {
      // 13b. Applicability (status-based) check
      if (leaveType.applicableTo !== 'ALL') {
        const app = leaveType.applicableTo;
        const status = employee.status;
        const allowed = (() => {
          if (app === 'PROBATION') return status === 'PROBATION';
          if (app === 'ACTIVE' || app === 'CONFIRMED') return status === 'ACTIVE';
          if (app === 'NOTICE_PERIOD') return status === 'NOTICE_PERIOD';
          if (app === 'ONBOARDING') return status === 'ONBOARDING';
          if (app === 'INTERN') return status === 'INTERN' || empUserRole === 'INTERN';
          if (app === 'SUSPENDED') return status === 'SUSPENDED';
          if (app === 'INACTIVE') return status === 'INACTIVE';
          if (app === 'TERMINATED') return status === 'TERMINATED';
          if (app === 'ABSCONDED') return status === 'ABSCONDED';
          return true;
        })();
        if (!allowed) {
          const labels: Record<string, string> = {
            PROBATION: 'employees in probation period',
            ACTIVE: 'active/full-time employees',
            CONFIRMED: 'active/full-time employees',
            NOTICE_PERIOD: 'employees serving notice period',
            ONBOARDING: 'employees in onboarding',
            INTERN: 'interns',
            SUSPENDED: 'suspended employees',
            INACTIVE: 'inactive employees',
            TERMINATED: 'terminated employees',
            ABSCONDED: 'absconded employees',
          };
          throw new BadRequestError(`${leaveType.name} is available for ${labels[app] || app} only. Your current status does not qualify.`);
        }
      }

      // 14. Role restriction check
      if (leaveType.applicableToRole && leaveType.applicableToRole !== empUserRole) {
        const roleLabels: Record<string, string> = {
          EMPLOYEE: 'Employees', MANAGER: 'Managers', HR: 'HR team', ADMIN: 'Administrators', INTERN: 'Interns',
        };
        throw new BadRequestError(`${leaveType.name} is restricted to ${roleLabels[leaveType.applicableToRole] || leaveType.applicableToRole} only. Your role does not qualify.`);
      }
    }

    // 14b. Min Service Months — HR-configured tenure gate (default 0 = no gate)
    const probMonthsDraft = (leaveType as any).probationMonths ?? 0;
    if (probMonthsDraft > 0 && employee.joiningDate) {
      const joined = new Date(employee.joiningDate);
      const now = new Date();
      const monthsWorked = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
      if (monthsWorked < probMonthsDraft) {
        throw new BadRequestError(`${leaveType.name} requires ${probMonthsDraft} month(s) of service. You have completed ${monthsWorked} month(s). Please contact HR if you need an exception.`);
      }
    }

    // 15. Weekend adjacent check
    if (!leaveType.allowWeekendAdjacent) {
      const dayBefore = new Date(startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(endDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      if (!workingDays.has(dayBefore.getDay()) && !workingDays.has(dayAfter.getDay())) {
        throw new BadRequestError(`${leaveType.name} cannot be taken adjacent to a non-working day (sandwich rule applies).`);
      }
    }

    // 16. Leave policy acknowledgment check
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

    // 17. Overlap check
    const overlapping = await prisma.leaveRequest.findFirst({
      where: { employeeId, id: { not: requestId }, status: { in: ['DRAFT', 'PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'] }, OR: [{ startDate: { lte: endDate }, endDate: { gte: startDate } }] },
    });
    if (overlapping) throw new BadRequestError('Overlapping leave request exists. Cancel the existing request first.');

    // 18. Balance check (full — including missing-record case)
    const year = startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: leaveType.id, year } },
    });
    if (leaveType.isPaid) {
      if (!balance) {
        throw new BadRequestError(`No ${leaveType.name} balance allocated for this year. Please contact HR.`);
      }
      const available = Number(balance.allocated) + Number(balance.carriedForward) - Number(balance.used) - Number(balance.pending);
      if (days > available) {
        throw new BadRequestError(`Insufficient ${leaveType.name} balance. Available: ${available}, Requested: ${days}`);
      }
    }

    // ===== RUN TASK AUDIT =====
    let auditResult: any = null;
    try {
      auditResult = await taskIntegrationService.auditTasksForLeave(
        employee.organizationId, employeeId, startDate, endDate, leaveType.code, employee.email
      );
      const taskConfig = await taskIntegrationService.getActiveConfig(employee.organizationId);
      await taskIntegrationService.persistAudit(requestId, auditResult, taskConfig?.provider);
    } catch (err: any) {
      logger.warn(`[LeaveSubmit] Task audit failed for ${requestId}: ${err.message}`);
      auditResult = { integrationStatus: 'ERROR', riskLevel: 'LOW', riskScore: 0, errorMessage: err.message };
    }

    // Determine final status — auto-approve if requiresApproval=false
    const autoApprove = leaveType.requiresApproval === false;
    const finalStatus = autoApprove ? 'APPROVED' : 'PENDING';

    // ===== TRANSITION DRAFT → PENDING (or APPROVED) =====
    const updated = await prisma.$transaction(async (tx) => {
      const noticeHours = Math.max(0, Math.round((startDate.getTime() - Date.now()) / (1000 * 60 * 60)));

      const result = await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: finalStatus,
          noticeHours,
          acknowledgements: acknowledgements || null,
          riskLevel: (auditResult?.riskLevel || 'LOW') as any,
          riskScore: auditResult?.riskScore || 0,
        },
        include: { leaveType: { select: { name: true, code: true } }, employee: { select: { firstName: true, lastName: true } } },
      });

      // Guard: paid leave with no balance record should fail even in auto-approve path
      if (autoApprove && leaveType.isPaid && !balance) {
        throw new BadRequestError(`No ${leaveType.name} balance allocated for this year. Please contact HR.`);
      }

      if (balance) {
        if (autoApprove) {
          await tx.leaveBalance.update({ where: { id: balance.id }, data: { used: { increment: days } } });
          // Create attendance records
          const orgHolidays = await tx.holiday.findMany({
            where: { organizationId: employee.organizationId, date: { gte: startDate, lte: endDate }, type: { in: ['PUBLIC', 'CUSTOM'] } },
            select: { date: true },
          });
          const holidayDateSet = new Set(orgHolidays.map(h => new Date(h.date).toISOString().split('T')[0]));
          const cur = new Date(startDate);
          while (cur <= endDate) {
            if (workingDays.has(cur.getDay()) && !holidayDateSet.has(cur.toISOString().split('T')[0])) {
              const dateOnly = new Date(cur);
              dateOnly.setHours(0, 0, 0, 0);
              await tx.attendanceRecord.upsert({
                where: { employeeId_date: { employeeId, date: dateOnly } },
                update: { status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${result.leaveType?.name}` },
                create: { employeeId, date: dateOnly, status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${result.leaveType?.name}`, workMode: 'OFFICE' },
              });
            }
            cur.setDate(cur.getDate() + 1);
          }
        } else {
          await tx.leaveBalance.update({ where: { id: balance.id }, data: { pending: { increment: days } } });
        }
      }

      return result;
    });

    emitToOrg(employee.organizationId, 'leave:applied', {
      employeeId, employeeName: `${employee.firstName} ${employee.lastName}`,
      leaveType: leaveType.name, days, startDate,
      riskLevel: auditResult?.riskLevel || 'LOW', riskScore: auditResult?.riskScore || 0,
    });
    invalidateDashboardCache(employee.organizationId).catch(() => {});

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
      // HR can revoke an already-approved leave by rejecting it
      'REJECTED': ['PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'],
    };

    // Only HR/Admin can reject an already-approved leave (managers cannot revoke)
    if (action === 'REJECTED' && (request.status === 'APPROVED' || request.status === 'APPROVED_WITH_CONDITION') && !isHRAdmin) {
      throw new BadRequestError('Only HR or Admin can revoke an already-approved leave request.');
    }

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
    const expectedCurrentStatus = request.status; // captured before transaction

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

      // G-01: Optimistic lock — include current status in the WHERE clause.
      // If a concurrent approval already changed the status, Prisma throws P2025
      // (record not found) which the error handler converts to 404, preventing
      // double balance deduction from two simultaneous approvals.
      let updatedRequest;
      try {
        updatedRequest = await tx.leaveRequest.update({
          where: { id: requestId, status: expectedCurrentStatus },
          data: updateData,
          include: {
            leaveType: { select: { name: true, code: true } },
            employee: { select: { firstName: true, lastName: true } },
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new BadRequestError('This leave request was already acted on by another approver. Please refresh and try again.');
        }
        throw err;
      }

      const year = new Date(request.startDate).getFullYear();
      const balance = await tx.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
      });

      if (balance) {
        if (finalStatus === 'APPROVED' || finalStatus === 'APPROVED_WITH_CONDITION') {
          // Guard: only decrement pending if it is actually ≥ requested days (prevents negative balance)
          const safePendingDecrement = Math.min(Number(balance.pending), Number(request.days));
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { used: { increment: Number(request.days) }, pending: { decrement: safePendingDecrement } },
          });

          // Create ON_LEAVE attendance records — use org working days (not hardcoded Sunday)
          const leaveStart = new Date(request.startDate);
          const leaveEnd = new Date(request.endDate);
          const orgHolidays = await tx.holiday.findMany({
            where: { organizationId: organizationId!, date: { gte: leaveStart, lte: leaveEnd }, type: { in: ['PUBLIC', 'CUSTOM'] } },
            select: { date: true },
          });
          const holidayDateSet = new Set(orgHolidays.map(h => new Date(h.date).toISOString().split('T')[0]));
          const approvalWorkingDays = await this.getWorkingDays(organizationId!);
          const current = new Date(leaveStart);
          while (current <= leaveEnd) {
            const dow = current.getDay();
            const dateStr = current.toISOString().split('T')[0];
            if (approvalWorkingDays.has(dow) && !holidayDateSet.has(dateStr)) {
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
          if (request.status === 'APPROVED' || request.status === 'APPROVED_WITH_CONDITION') {
            // Revoking an approved leave — reverse used balance and remove attendance records
            const safeUsedDecrement = Math.min(Number(balance.used), Number(request.days));
            await tx.leaveBalance.update({
              where: { id: balance.id },
              data: { used: { decrement: safeUsedDecrement } },
            });
            // Delete the ON_LEAVE attendance records created when the leave was approved
            await tx.attendanceRecord.deleteMany({
              where: {
                employeeId: request.employeeId,
                date: { gte: new Date(request.startDate), lte: new Date(request.endDate) },
                status: 'ON_LEAVE',
                source: 'MANUAL_HR',
              },
            });
          } else {
            // Standard rejection from PENDING/MANAGER_APPROVED — reverse pending balance
            const safePendingDecrement = Math.min(Number(balance.pending), Number(request.days));
            await tx.leaveBalance.update({
              where: { id: balance.id },
              data: { pending: { decrement: safePendingDecrement } },
            });
          }
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

    const cancellableStatuses = ['PENDING', 'DRAFT', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION'];
    if (!cancellableStatuses.includes(request.status)) {
      throw new BadRequestError('This leave request cannot be cancelled. Only pending, draft, or approved requests can be cancelled.');
    }

    // Prevent cancellation of past approved leaves (leave already started or ended)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leaveStart = new Date(request.startDate);
    leaveStart.setHours(0, 0, 0, 0);
    if (['APPROVED', 'APPROVED_WITH_CONDITION'].includes(request.status) && leaveStart <= today) {
      throw new BadRequestError('Cannot cancel an approved leave that has already started or passed. Please contact HR.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' },
      });

      const year = new Date(request.startDate).getFullYear();
      const balance = await tx.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: request.leaveTypeId, year } },
      });

      if (balance) {
        if (request.status === 'PENDING' || request.status === 'MANAGER_APPROVED') {
          // Reverse pending balance — guard against going below 0
          const safeDecrement = Math.min(Number(balance.pending), Number(request.days));
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { pending: { decrement: safeDecrement } },
          });
        } else if (request.status === 'APPROVED' || request.status === 'APPROVED_WITH_CONDITION') {
          // Reverse used balance (auto-approved or HR-approved) — guard against going below 0
          const safeDecrement = Math.min(Number(balance.used), Number(request.days));
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { used: { decrement: safeDecrement } },
          });

          // Remove ON_LEAVE attendance records that were created for this leave
          const leaveEnd = new Date(request.endDate);
          await tx.attendanceRecord.deleteMany({
            where: {
              employeeId,
              date: { gte: new Date(request.startDate), lte: leaveEnd },
              status: 'ON_LEAVE',
              source: 'MANUAL_HR',
            },
          });
        }
        // DRAFT: no balance was incremented, nothing to reverse
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
      // Fetch employee with full details for rich email context
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          firstName: true, lastName: true, email: true,
          managerId: true, userId: true, employeeCode: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
        },
      });
      if (!employee) return;

      // Fetch org for name + adminNotificationEmail
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, adminNotificationEmail: true },
      });

      const leaveTypeName = leaveRequest.leaveType?.name || 'Leave';
      const empName = `${employee.firstName} ${employee.lastName}`;
      const days = Number(leaveRequest.days);
      const dayLabel = `${days} day${days !== 1 ? 's' : ''}`;

      // Shared context used in all templates
      const baseContext = {
        employeeName: empName,
        employeeCode: employee.employeeCode || '',
        department: employee.department?.name || '',
        designation: employee.designation?.name || '',
        leaveType: leaveTypeName,
        startDate: new Date(leaveRequest.startDate).toISOString(),
        endDate: new Date(leaveRequest.endDate).toISOString(),
        days,
        reason: leaveRequest.reason || '',
        riskLevel: leaveRequest.riskLevel || 'LOW',
        riskScore: leaveRequest.riskScore || 0,
        status: leaveRequest.status,
        remarks: leaveRequest.approverRemarks || leaveRequest.managerRemarks || '',
        appUrl: 'https://hr.anistonav.com',
        orgName: org?.name || 'Aniston Technologies',
      };

      // Helper: enqueue email + socket + log
      const notify = async (
        userId: string,
        email: string | null,
        subject: string,
        template: string,
        context: Record<string, any>
      ) => {
        if (email) {
          await enqueueEmail({ to: email, subject, template, context }).catch((err) =>
            logger.error(`[LeaveNotify] email→${email}: ${err.message}`)
          );
        }
        await enqueueNotification({
          userId, organizationId,
          title: subject,
          message: `${empName} — ${leaveTypeName} (${new Date(leaveRequest.startDate).toLocaleDateString('en-IN')} to ${new Date(leaveRequest.endDate).toLocaleDateString('en-IN')})`,
          type: 'LEAVE', link: '/leaves',
        }).catch(() => {});
        await prisma.leaveNotificationLog.create({
          data: { leaveRequestId: leaveRequest.id, recipientId: userId, channel: 'BOTH', templateName: template, payload: context, organizationId },
        }).catch(() => {});
      };

      if (event === 'submitted') {
        const subject = `Leave Request: ${empName} — ${leaveTypeName} (${dayLabel})`;

        // 1. Notify manager (in-app + email)
        if (employee.managerId) {
          const manager = await prisma.employee.findUnique({
            where: { id: employee.managerId },
            select: { userId: true, email: true },
          });
          if (manager?.userId) {
            await notify(manager.userId, manager.email, subject, 'leave-submitted', baseContext);
          }
        }

        // 2. Notify active HR/Admin/SuperAdmin users (in-app + email)
        const hrUsers = await prisma.user.findMany({
          where: { organizationId, role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
          select: { id: true, email: true },
        });
        const hrEmailsSent = new Set<string>();
        for (const hr of hrUsers) {
          await notify(hr.id, hr.email, subject, 'leave-submitted', baseContext);
          if (hr.email) hrEmailsSent.add(hr.email);
        }

        // 3. Also send to org adminNotificationEmail if set and not already notified
        if (org?.adminNotificationEmail && !hrEmailsSent.has(org.adminNotificationEmail)) {
          await enqueueEmail({
            to: org.adminNotificationEmail,
            subject,
            template: 'leave-submitted',
            context: baseContext,
          }).catch((err) => logger.error(`[LeaveNotify] adminNotificationEmail: ${err.message}`));
        }

        // 4. Send confirmation to the employee (email only — they already see it in-app)
        if (employee.email) {
          const confirmSubject = `Leave Request Submitted — ${leaveTypeName} (${new Date(leaveRequest.startDate).toLocaleDateString('en-IN')} to ${new Date(leaveRequest.endDate).toLocaleDateString('en-IN')})`;
          await enqueueEmail({
            to: employee.email,
            subject: confirmSubject,
            template: 'leave-confirmation',
            context: baseContext,
          }).catch((err) => logger.error(`[LeaveNotify] employee confirmation: ${err.message}`));
        }

      } else if (event === 'approved' || event === 'rejected') {
        const subject = event === 'approved'
          ? `Leave Approved: ${leaveTypeName} (${dayLabel})`
          : `Leave Rejected: ${leaveTypeName}`;

        // Notify the employee
        if (employee.userId) {
          await notify(employee.userId, employee.email, subject, `leave-${event}`, baseContext);
        }

        // Notify backup with the correct template
        if (leaveRequest.backupEmployeeId) {
          const backup = await prisma.employee.findUnique({
            where: { id: leaveRequest.backupEmployeeId },
            select: { userId: true, email: true },
          });
          if (backup?.userId) {
            const backupSubject = `You've been assigned as backup for ${empName}'s leave`;
            await notify(backup.userId, backup.email, backupSubject, 'leave-backup-assigned', baseContext);
          }
        }
      }
    } catch (err: any) {
      logger.warn(`[LeaveNotifications] Error: ${err.message}`);
    }
  }

  /**
   * Get organisation working days as a Set<number> (0=Sun, 1=Mon, ..., 6=Sat)
   * Default: Mon–Sat (1,2,3,4,5,6)
   */
  private async getWorkingDays(organizationId: string): Promise<Set<number>> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workingDays: true } as any,
    });
    const raw = (org as any)?.workingDays || '1,2,3,4,5,6';
    return new Set(raw.split(',').map((d: string) => parseInt(d.trim(), 10)));
  }

  private async calculateBusinessDays(
    start: Date,
    end: Date,
    organizationId: string,
    workingDaySet?: Set<number>,
    leaveOptions?: { isHalfDay?: boolean; halfDaySession?: string | null },
  ): Promise<number> {
    const workingDays = workingDaySet ?? await this.getWorkingDays(organizationId);

    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId,
        date: { gte: start, lte: end },
        type: { in: ['PUBLIC', 'CUSTOM'] },
      },
      select: { date: true, isHalfDay: true, halfDaySession: true },
    });
    const fullDayHolidays = new Set<string>();
    // Map date string → holiday session (FIRST_HALF / SECOND_HALF / null)
    const halfDayHolidayMap = new Map<string, string | null>();
    holidays.forEach(h => {
      const dateStr = new Date(h.date).toISOString().split('T')[0];
      if (h.isHalfDay) halfDayHolidayMap.set(dateStr, (h as any).halfDaySession ?? null);
      else fullDayHolidays.add(dateStr);
    });

    const leaveIsHalfDay = leaveOptions?.isHalfDay ?? false;
    const leaveSession = leaveOptions?.halfDaySession ?? null;

    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      if (workingDays.has(dayOfWeek)) {
        if (fullDayHolidays.has(dateStr)) {
          // full holiday — skip entirely
        } else if (halfDayHolidayMap.has(dateStr)) {
          // Half-day holiday: apply session-aware exclusion
          const holidaySession = halfDayHolidayMap.get(dateStr) ?? null;
          if (!leaveIsHalfDay) {
            // Full-day leave on a half-day holiday: only 0.5 of the day is a working leave day
            days += 0.5;
          } else if (!holidaySession || holidaySession === leaveSession) {
            // Same session (or holiday has no session specified): leave overlaps with holiday — exclude 0.5
            days += 0;
          } else {
            // Different sessions: no overlap — the leave half-day is unaffected by the holiday
            days += 0.5;
          }
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
