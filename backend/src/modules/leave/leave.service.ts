import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { emitToOrg, emitToUser } from '../../sockets/index.js';
import type { ApplyLeaveInput, LeaveQuery, CreateLeaveTypeInput, UpdateLeaveTypeInput } from './leave.validation.js';

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
  async updateLeaveType(id: string, data: UpdateLeaveTypeInput) {
    const existing = await prisma.leaveType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Leave type');

    return prisma.leaveType.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete (soft-deactivate) a leave type
   */
  async deleteLeaveType(id: string) {
    const existing = await prisma.leaveType.findUnique({ where: { id } });
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

    // Get or create balances
    const balances = await Promise.all(
      leaveTypes.map(async (lt) => {
        let balance = await prisma.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId,
              leaveTypeId: lt.id,
              year: currentYear,
            },
          },
        });

        if (!balance) {
          // Auto-create balance for the year
          balance = await prisma.leaveBalance.create({
            data: {
              employeeId,
              leaveTypeId: lt.id,
              year: currentYear,
              allocated: lt.defaultBalance,
              used: 0,
              pending: 0,
              carriedForward: 0,
            },
          });
        }

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
      })
    );

    return balances;
  }

  /**
   * Apply for leave
   */
  async applyLeave(employeeId: string, data: ApplyLeaveInput) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, gender: true, joiningDate: true, status: true },
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

    // Calculate business days
    const days = data.isHalfDay ? 0.5 : await this.calculateBusinessDays(startDate, endDate, employee.organizationId);

    if (days <= 0) {
      throw new BadRequestError('Selected dates have no working days');
    }

    // ===== POLICY ENFORCEMENT =====

    // 1. Min days check
    if (leaveType.minDays && days < Number(leaveType.minDays)) {
      throw new BadRequestError(`Minimum ${Number(leaveType.minDays)} day(s) required for ${leaveType.name}`);
    }

    // 2. Max days check
    if (leaveType.maxDays && days > Number(leaveType.maxDays)) {
      throw new BadRequestError(`Maximum ${Number(leaveType.maxDays)} day(s) allowed for ${leaveType.name}`);
    }

    // 3. Same-day check
    if (!leaveType.allowSameDay && startDateOnly.getTime() === today.getTime()) {
      throw new BadRequestError(`Same-day leave application is not allowed for ${leaveType.name}`);
    }

    // 4. Notice days check
    if (leaveType.noticeDays && leaveType.noticeDays > 0) {
      const diffMs = startDateOnly.getTime() - today.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < leaveType.noticeDays) {
        throw new BadRequestError(`${leaveType.name} requires at least ${leaveType.noticeDays} day(s) advance notice`);
      }
    }

    // 5. Max per month check
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
        throw new BadRequestError(`Maximum ${leaveType.maxPerMonth} leave(s) per month allowed for ${leaveType.name}`);
      }
    }

    // 6. Gender restriction
    if (leaveType.gender && employee.gender !== leaveType.gender) {
      throw new BadRequestError(`${leaveType.name} is restricted to ${leaveType.gender} employees`);
    }

    // 7. Probation / Confirmed check
    if (leaveType.applicableTo !== 'ALL' && employee.joiningDate) {
      const probationEnd = new Date(employee.joiningDate);
      probationEnd.setMonth(probationEnd.getMonth() + (leaveType.probationMonths || 3));
      const isInProbation = today < probationEnd;

      if (leaveType.applicableTo === 'CONFIRMED' && isInProbation) {
        throw new BadRequestError(`${leaveType.name} is only available for confirmed employees (after ${leaveType.probationMonths || 3} months probation)`);
      }
      if (leaveType.applicableTo === 'PROBATION' && !isInProbation) {
        throw new BadRequestError(`${leaveType.name} is only available during probation period`);
      }
    }

    // 8. Weekend adjacent check
    if (!leaveType.allowWeekendAdjacent) {
      const dayBefore = new Date(startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayAfter = new Date(endDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const beforeDay = dayBefore.getDay();
      const afterDay = dayAfter.getDay();
      if (beforeDay === 0 || beforeDay === 6 || afterDay === 0 || afterDay === 6) {
        throw new BadRequestError(`${leaveType.name} cannot be taken adjacent to weekends`);
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
        throw new BadRequestError(`Insufficient leave balance. Available: ${available}, Requested: ${days}`);
      }
    }

    // Check for overlapping leaves
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'MANAGER_APPROVED', 'APPROVED'] },
        OR: [
          { startDate: { lte: endDate }, endDate: { gte: startDate } },
        ],
      },
    });

    if (overlapping) {
      throw new BadRequestError('You already have a leave request for overlapping dates');
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

    // Emit real-time event for HR
    emitToOrg(employee.organizationId, 'leave:applied', {
      employeeId, employeeName: `${employee.firstName} ${employee.lastName}`,
      leaveType: request.leaveType?.name, days: request.days, startDate: request.startDate,
    });

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
      // HR/Admin/SuperAdmin see ALL pending leaves in the organization
      const orgEmployees = await prisma.employee.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true },
      });
      where = {
        employeeId: { in: orgEmployees.map((e) => e.id) },
        status: 'PENDING',
      };
    } else {
      // Manager sees only direct reports
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
   * Approve or reject a leave request
   */
  async handleLeaveAction(requestId: string, action: 'APPROVED' | 'REJECTED' | 'MANAGER_APPROVED', approvedBy: string, remarks?: string, organizationId?: string) {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: { select: { managerId: true } } },
    });
    if (!request) throw new NotFoundError('Leave request');

    // Allow action from PENDING or MANAGER_APPROVED states
    const validFromStates = action === 'MANAGER_APPROVED'
      ? ['PENDING']
      : ['PENDING', 'MANAGER_APPROVED'];
    if (!validFromStates.includes(request.status)) {
      throw new BadRequestError(`Cannot ${action.toLowerCase().replace('_', ' ')} a ${request.status} request`);
    }

    // Determine the actual status to set
    let finalStatus = action;

    // If a Manager approves a PENDING request → set MANAGER_APPROVED (not final APPROVED)
    // HR can approve directly from any state
    if (action === 'APPROVED' && request.status === 'PENDING' && request.employee?.managerId) {
      // Check if the approver is the manager — if so, set MANAGER_APPROVED
      const approverEmployee = await prisma.employee.findFirst({
        where: { userId: approvedBy },
      });
      const approverUser = await prisma.user.findUnique({ where: { id: approvedBy } });

      if (approverUser?.role === 'MANAGER' && approverEmployee?.id === request.employee.managerId) {
        finalStatus = 'MANAGER_APPROVED';
      }
    }

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
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
      });

      if (balance) {
        if (finalStatus === 'APPROVED') {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: {
              used: { increment: Number(request.days) },
              pending: { decrement: Number(request.days) },
            },
          });

          // Create ON_LEAVE attendance records for the approved leave dates
          const leaveStart = new Date(request.startDate);
          const leaveEnd = new Date(request.endDate);
          const current = new Date(leaveStart);
          while (current <= leaveEnd) {
            const dow = current.getDay();
            if (dow !== 0 && dow !== 6) { // Skip weekends
              const dateOnly = new Date(current);
              dateOnly.setHours(0, 0, 0, 0);
              await tx.attendanceRecord.upsert({
                where: { employeeId_date: { employeeId: request.employeeId, date: dateOnly } },
                update: { status: 'ON_LEAVE', source: 'MANUAL_HR', notes: `Leave: ${updatedRequest.leaveType?.name}` },
                create: {
                  employeeId: request.employeeId,
                  date: dateOnly,
                  status: 'ON_LEAVE',
                  source: 'MANUAL_HR',
                  notes: `Leave: ${updatedRequest.leaveType?.name}`,
                  workMode: 'OFFICE',
                },
              });
            }
            current.setDate(current.getDate() + 1);
          }
        } else {
          // Rejected — release pending
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { pending: { decrement: Number(request.days) } },
          });
        }
      }

      return updatedRequest;
    });

    // Audit log for leave approval/rejection
    if (organizationId) {
      await createAuditLog({
        userId: approvedBy,
        organizationId,
        entity: 'LeaveRequest',
        entityId: requestId,
        action: action === 'APPROVED' ? 'APPROVE' : 'REJECT',
        oldValue: { status: 'PENDING' },
        newValue: { status: action, approverRemarks: remarks || null },
      });
    }

    // Emit real-time event to the employee
    const emp = await prisma.employee.findUnique({ where: { id: request.employeeId }, select: { userId: true } });
    if (emp?.userId) {
      emitToUser(emp.userId, 'leave:actioned', {
        requestId, action, leaveType: updated.leaveType?.name, remarks,
      });
    }

    return updated;
  }

  /**
   * Cancel a leave request (employee)
   */
  async cancelLeave(requestId: string, employeeId: string) {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, employeeId },
    });
    if (!request) throw new NotFoundError('Leave request');
    if (request.status !== 'PENDING') {
      throw new BadRequestError('Only pending requests can be cancelled');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED' },
      });

      const year = new Date(request.startDate).getFullYear();
      const balance = await tx.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
      });

      if (balance) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { pending: { decrement: Number(request.days) } },
        });
      }

      return cancelled;
    });

    return updated;
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
   * Calculate business days between two dates
   */
  private async calculateBusinessDays(start: Date, end: Date, organizationId: string): Promise<number> {
    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days++;
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  }
}

export const leaveService = new LeaveService();
