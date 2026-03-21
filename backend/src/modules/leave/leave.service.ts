import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import type { ApplyLeaveInput, LeaveQuery } from './leave.validation.js';

export class LeaveService {
  /**
   * Get leave types for the organization
   */
  async getLeaveTypes(organizationId: string) {
    return prisma.leaveType.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get leave balances for an employee (current year)
   */
  async getBalances(employeeId: string, year?: number) {
    const currentYear = year || new Date().getFullYear();

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Get all leave types
    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId: employee.organizationId },
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

    // Calculate business days
    const days = data.isHalfDay ? 0.5 : this.calculateBusinessDays(startDate, endDate, employee.organizationId);

    if (days <= 0) {
      throw new BadRequestError('Selected dates have no working days');
    }

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
        status: { in: ['PENDING', 'APPROVED'] },
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
  async getPendingApprovals(managerId: string, organizationId: string, query: LeaveQuery) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    // Get direct reports of the manager
    const directReports = await prisma.employee.findMany({
      where: { managerId, organizationId, deletedAt: null },
      select: { id: true },
    });
    const reporteeIds = directReports.map((r) => r.id);

    const where: any = {
      employeeId: { in: reporteeIds },
      status: 'PENDING',
    };

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
  async handleLeaveAction(requestId: string, action: 'APPROVED' | 'REJECTED', approvedBy: string, remarks?: string) {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundError('Leave request');
    if (request.status !== 'PENDING') {
      throw new BadRequestError(`Cannot ${action.toLowerCase()} a ${request.status} request`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: action,
          approvedBy,
          approverRemarks: remarks || null,
        },
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
        if (action === 'APPROVED') {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: {
              used: { increment: Number(request.days) },
              pending: { decrement: Number(request.days) },
            },
          });
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
