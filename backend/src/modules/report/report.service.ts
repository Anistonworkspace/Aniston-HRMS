import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { decrypt } from '../../utils/encryption.js';
import { logger } from '../../lib/logger.js';
import type { AttendanceSummaryQuery, LeaveSummaryQuery, AttendanceDetailQuery, LeaveDetailQuery } from './report.validation.js';

/** Hard cap on the number of rows any single export query may return. */
const MAX_EXPORT_ROWS = 50000;

export class ReportService {
  async getEmployeesForExcel(organizationId: string) {
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
      select: {
        employeeCode: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        joiningDate: true,
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: { employeeCode: 'asc' },
      take: MAX_EXPORT_ROWS,
    });

    if (employees.length >= MAX_EXPORT_ROWS) {
      logger.warn(`[Report] Employee directory export truncated at ${MAX_EXPORT_ROWS} rows for org ${organizationId}`);
    }

    return employees;
  }

  async getHeadcount(organizationId: string) {
    const [total, byDepartment, byStatus, byWorkMode, byGender] = await Promise.all([
      prisma.employee.count({ where: { organizationId, deletedAt: null, isSystemAccount: { not: true } } }),
      prisma.employee.groupBy({
        by: ['departmentId'],
        _count: true,
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
      }),
      prisma.employee.groupBy({
        by: ['status'],
        _count: true,
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
      }),
      prisma.employee.groupBy({
        by: ['workMode'],
        _count: true,
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
      }),
      prisma.employee.groupBy({
        by: ['gender'],
        _count: true,
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
      }),
    ]);

    // Get department names
    const departments = await prisma.department.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));

    return {
      total,
      byDepartment: byDepartment.map((d) => ({
        department: deptMap.get(d.departmentId || '') || 'Unassigned',
        count: d._count,
      })),
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byWorkMode: byWorkMode.map((w) => ({ workMode: w.workMode, count: w._count })),
      byGender: byGender.map((g) => ({ gender: g.gender, count: g._count })),
    };
  }

  async getAttendanceSummary(
    organizationId: string,
    query: AttendanceSummaryQuery & { includePendingRegularizations?: boolean }
  ) {
    const now = new Date();
    const start = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = query.endDate ? new Date(query.endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const statusCounts = await prisma.attendanceRecord.groupBy({
      by: ['status'],
      _count: true,
      where: {
        employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
        date: { gte: start, lte: end },
      },
    });

    const dailyAttendance = await prisma.attendanceRecord.groupBy({
      by: ['date'],
      _count: true,
      where: {
        employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
        date: { gte: start, lte: end },
        status: 'PRESENT',
      },
      orderBy: { date: 'asc' },
    });

    // ── GAP-009: Pending regularization annotation ────────────────────────────
    let pendingRegularizations: Array<{
      attendanceId: string;
      employeeId: string;
      reason: string;
      requestedCheckIn: Date | null;
      requestedCheckOut: Date | null;
    }> = [];

    if (query.includePendingRegularizations) {
      pendingRegularizations = await prisma.attendanceRegularization.findMany({
        where: {
          status: 'PENDING',
          employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
          attendance: { date: { gte: start, lte: end } },
        },
        select: {
          attendanceId: true,
          employeeId: true,
          reason: true,
          requestedCheckIn: true,
          requestedCheckOut: true,
        },
      });
    }

    return {
      period: { start, end },
      statusBreakdown: statusCounts.map((s) => ({ status: s.status, count: s._count })),
      dailyPresent: dailyAttendance.map((d) => ({ date: d.date, count: d._count })),
      pendingRegularizations: query.includePendingRegularizations
        ? pendingRegularizations
        : undefined,
      pendingRegularizationCount: query.includePendingRegularizations
        ? pendingRegularizations.length
        : undefined,
    };
  }

  /**
   * Get attendance records for date range, annotating any that have PENDING
   * regularization requests. Used by the Excel export with pending-reg flag.
   */
  async getAttendanceRecordsWithRegularizationFlag(
    organizationId: string,
    query: AttendanceSummaryQuery & { includePendingRegularizations?: boolean }
  ) {
    const now = new Date();
    const start = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = query.endDate ? new Date(query.endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Reject excessively wide date ranges to prevent memory/timeout issues.
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 365) {
      throw new BadRequestError('Date range cannot exceed 365 days for exports.');
    }

    const records = await prisma.attendanceRecord.findMany({
      where: {
        employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
        date: { gte: start, lte: end },
      },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
      orderBy: [{ date: 'asc' }, { employee: { firstName: 'asc' } }],
      take: MAX_EXPORT_ROWS,
    });

    if (records.length >= MAX_EXPORT_ROWS) {
      logger.warn(`[Report] Export truncated at ${MAX_EXPORT_ROWS} rows for org ${organizationId}`);
    }

    let pendingRegMap = new Map<string, { reason: string }>();

    if (query.includePendingRegularizations) {
      const pending = await prisma.attendanceRegularization.findMany({
        where: {
          status: 'PENDING',
          employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
          attendance: { date: { gte: start, lte: end } },
        },
        select: {
          attendanceId: true,
          reason: true,
        },
      });
      pendingRegMap = new Map(pending.map((p) => [p.attendanceId, { reason: p.reason }]));
    }

    return records.map((rec) => ({
      ...rec,
      pendingRegularization: pendingRegMap.has(rec.id),
      regularizationReason: pendingRegMap.get(rec.id)?.reason ?? null,
    }));
  }

  async getLeaveSummary(organizationId: string, query: LeaveSummaryQuery) {
    const year = query.year || new Date().getFullYear();

    const leavesByType = await prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      _sum: { days: true },
      _count: true,
      where: {
        employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
        status: 'APPROVED',
        startDate: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) },
      },
    });

    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId },
      select: { id: true, name: true, code: true },
    });
    const typeMap = new Map(leaveTypes.map((t) => [t.id, t]));

    return {
      year,
      byType: leavesByType.map((l) => ({
        leaveType: typeMap.get(l.leaveTypeId),
        totalDays: l._sum.days,
        count: l._count,
      })),
      totalApproved: leavesByType.reduce((sum, l) => sum + l._count, 0),
    };
  }

  async getPayrollSummary(organizationId: string) {
    const runs = await prisma.payrollRun.findMany({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      select: { month: true, year: true, totalGross: true, totalNet: true, totalDeductions: true },
      take: 12,
    });

    return {
      monthlyTrend: runs.map((r) => ({
        month: r.month,
        year: r.year,
        label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][r.month - 1]} ${r.year}`,
        gross: Number(r.totalGross || 0),
        net: Number(r.totalNet || 0),
        deductions: Number(r.totalDeductions || 0),
      })),
    };
  }

  // ── Statutory Compliance Reports ────────────────────────────────────────────

  /**
   * Fetch payroll records for a given run, validating org ownership.
   * Shared by EPF, ESI, and Form 24Q exports.
   */
  private async getPayrollRunRecords(payrollRunId: string, organizationId: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: payrollRunId, organizationId },
    });
    if (!run) throw new NotFoundError('Payroll run');

    const records = await prisma.payrollRecord.findMany({
      where: { payrollRunId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            isSystemAccount: true,
            panNumber: true,
          },
        },
      },
      orderBy: { employee: { firstName: 'asc' } },
    });

    const decryptedRecords = records.map((r: any) => {
      if (r.employee?.panNumber) {
        try { r.employee.panNumber = decrypt(r.employee.panNumber); } catch { /* legacy plaintext */ }
      }
      return r;
    });
    return { run, records: decryptedRecords };
  }

  async getEpfChallanData(payrollRunId: string, organizationId: string) {
    return this.getPayrollRunRecords(payrollRunId, organizationId);
  }

  async getEsiReturnData(payrollRunId: string, organizationId: string) {
    return this.getPayrollRunRecords(payrollRunId, organizationId);
  }

  /**
   * Fetch payroll records for all months in a given quarter of a financial year.
   * Financial year format: "2025-26". Quarter: "Q1"–"Q4".
   *
   * Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar
   */
  async getForm24QData(financialYear: string, quarter: string, organizationId: string) {
    // Parse financial year start (e.g. "2025-26" → startYear = 2025)
    const [startYearStr] = financialYear.split('-');
    const startYear = parseInt(startYearStr, 10);
    if (isNaN(startYear)) throw new BadRequestError('Invalid financialYear format. Expected e.g. 2025-26');

    const QUARTER_MONTHS: Record<string, { months: number[]; year: (fy: number) => number }> = {
      Q1: { months: [4, 5, 6],    year: (fy) => fy },
      Q2: { months: [7, 8, 9],    year: (fy) => fy },
      Q3: { months: [10, 11, 12], year: (fy) => fy },
      Q4: { months: [1, 2, 3],    year: (fy) => fy + 1 },
    };

    const qDef = QUARTER_MONTHS[quarter];
    if (!qDef) throw new BadRequestError('Invalid quarter. Expected Q1, Q2, Q3, or Q4');

    const calYear = qDef.year(startYear);

    const records = await prisma.payrollRecord.findMany({
      where: {
        payrollRun: {
          organizationId,
          month: { in: qDef.months },
          year: calYear,
          status: { in: ['COMPLETED', 'LOCKED'] },
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            isSystemAccount: true,
            panNumber: true,
          },
        },
      },
      orderBy: { employee: { firstName: 'asc' } },
    });

    return records.map((r: any) => {
      if (r.employee?.panNumber) {
        try { r.employee.panNumber = decrypt(r.employee.panNumber); } catch { /* legacy plaintext */ }
      }
      return r;
    });
  }

  async getAttendanceDetail(organizationId: string, query: AttendanceDetailQuery) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const skip = (query.page - 1) * query.limit;

    const where: any = {
      employee: {
        organizationId,
        deletedAt: null,
        isSystemAccount: { not: true },
        ...(query.departmentId && { departmentId: query.departmentId }),
      },
      date: { gte: from, lte: to },
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...(query.status && { status: query.status }),
    };

    const [records, total, statusCounts] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              firstName: true, lastName: true, employeeCode: true,
              department: { select: { name: true } },
              designation: { select: { name: true } },
            },
          },
        },
        orderBy: [{ date: 'desc' }, { employee: { firstName: 'asc' } }],
        skip,
        take: query.limit,
      }),
      prisma.attendanceRecord.count({ where }),
      prisma.attendanceRecord.groupBy({
        by: ['status'], _count: true, where,
      }),
    ]);

    return {
      records: records.map((r) => ({
        id: r.id,
        employeeCode: r.employee.employeeCode,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
        department: r.employee.department?.name || 'Unassigned',
        designation: r.employee.designation?.name || '',
        date: r.date,
        status: r.status,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        totalHours: r.totalHours ? Number(r.totalHours) : null,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
      summary: {
        present: statusCounts.find((s) => s.status === 'PRESENT')?._count || 0,
        absent: statusCounts.find((s) => s.status === 'ABSENT')?._count || 0,
        halfDay: statusCounts.find((s) => s.status === 'HALF_DAY')?._count || 0,
        onLeave: statusCounts.find((s) => s.status === 'ON_LEAVE')?._count || 0,
        total,
      },
      period: { from, to },
    };
  }

  async getLeaveDetail(organizationId: string, query: LeaveDetailQuery) {
    const year = query.year || new Date().getFullYear();
    const skip = (query.page - 1) * query.limit;

    const startBound = query.month
      ? new Date(year, query.month - 1, 1)
      : new Date(year, 0, 1);
    const endBound = query.month
      ? new Date(year, query.month, 0)
      : new Date(year, 11, 31);

    const where: any = {
      employee: {
        organizationId,
        deletedAt: null,
        isSystemAccount: { not: true },
        ...(query.departmentId && { departmentId: query.departmentId }),
      },
      startDate: { gte: startBound, lte: endBound },
      ...(query.leaveTypeId && { leaveTypeId: query.leaveTypeId }),
      ...(query.status && { status: query.status }),
    };

    const whereWithoutStatus: any = {
      employee: {
        organizationId,
        deletedAt: null,
        isSystemAccount: { not: true },
        ...(query.departmentId && { departmentId: query.departmentId }),
      },
      startDate: { gte: startBound, lte: endBound },
      ...(query.leaveTypeId && { leaveTypeId: query.leaveTypeId }),
    };

    const [requests, total, statusCounts, usedLeaveTypeRows, periodTotal] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: {
            select: {
              firstName: true, lastName: true, employeeCode: true,
              department: { select: { name: true } },
            },
          },
          leaveType: { select: { name: true, code: true } },
        },
        orderBy: { startDate: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.leaveRequest.count({ where }),
      prisma.leaveRequest.groupBy({ by: ['status'], _count: true, where }),
      prisma.leaveRequest.findMany({
        where,
        select: { leaveTypeId: true, leaveType: { select: { id: true, name: true, code: true } } },
        distinct: ['leaveTypeId'],
      }),
      query.status ? prisma.leaveRequest.count({ where: whereWithoutStatus }) : Promise.resolve(null),
    ]);

    const leaveTypes = usedLeaveTypeRows
      .filter((r) => r.leaveType)
      .map((r) => r.leaveType!);

    return {
      records: requests.map((r) => ({
        id: r.id,
        employeeCode: r.employee.employeeCode,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
        department: r.employee.department?.name || 'Unassigned',
        leaveType: r.leaveType?.name || '',
        leaveCode: r.leaveType?.code || '',
        startDate: r.startDate,
        endDate: r.endDate,
        days: Number(r.days),
        status: r.status,
        reason: r.reason,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
      summary: {
        approved: (statusCounts.find((s) => s.status === 'APPROVED')?._count || 0) +
                  (statusCounts.find((s) => s.status === 'APPROVED_WITH_CONDITION')?._count || 0),
        managerApproved: statusCounts.find((s) => s.status === 'MANAGER_APPROVED')?._count || 0,
        pending: (statusCounts.find((s) => s.status === 'PENDING')?._count || 0) +
                 (statusCounts.find((s) => s.status === 'DRAFT')?._count || 0),
        rejected: statusCounts.find((s) => s.status === 'REJECTED')?._count || 0,
        total,
        periodTotal: periodTotal ?? total,
      },
      leaveTypes,
      period: { from: startBound, to: endBound },
    };
  }

  async getRecruitmentFunnel(organizationId: string) {
    const pipeline = await prisma.application.groupBy({
      by: ['status'],
      _count: true,
      where: { jobOpening: { organizationId } },
    });

    const openJobs = await prisma.jobOpening.count({ where: { organizationId, status: 'OPEN' } });
    const totalApplications = await prisma.application.count({ where: { jobOpening: { organizationId } } });

    return {
      openJobs,
      totalApplications,
      pipeline: pipeline.map((p) => ({ stage: p.status, count: p._count })),
    };
  }
}

export const reportService = new ReportService();
