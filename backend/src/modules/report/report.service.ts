import { prisma } from '../../lib/prisma.js';
import type { AttendanceSummaryQuery, LeaveSummaryQuery } from './report.validation.js';

export class ReportService {
  async getEmployeesForExcel(organizationId: string) {
    return prisma.employee.findMany({
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
    });
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

  async getAttendanceSummary(organizationId: string, query: AttendanceSummaryQuery) {
    const now = new Date();
    const start = query.startDate ? new Date(query.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = query.endDate ? new Date(query.endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const statusCounts = await prisma.attendanceRecord.groupBy({
      by: ['status'],
      _count: true,
      where: {
        employee: { organizationId },
        date: { gte: start, lte: end },
      },
    });

    const dailyAttendance = await prisma.attendanceRecord.groupBy({
      by: ['date'],
      _count: true,
      where: {
        employee: { organizationId },
        date: { gte: start, lte: end },
        status: 'PRESENT',
      },
      orderBy: { date: 'asc' },
    });

    return {
      period: { start, end },
      statusBreakdown: statusCounts.map((s) => ({ status: s.status, count: s._count })),
      dailyPresent: dailyAttendance.map((d) => ({ date: d.date, count: d._count })),
    };
  }

  async getLeaveSummary(organizationId: string, query: LeaveSummaryQuery) {
    const year = query.year || new Date().getFullYear();

    const leavesByType = await prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      _sum: { days: true },
      _count: true,
      where: {
        employee: { organizationId },
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
