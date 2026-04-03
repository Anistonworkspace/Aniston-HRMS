import { prisma } from '../../lib/prisma.js';
import type { DashboardAlert, AttentionItem } from '@aniston/shared';

export class DashboardService {
  /**
   * Original stats endpoint — kept for backward compat (employee dashboard uses it)
   */
  async getStats(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalEmployees,
      activeEmployees,
      departmentCount,
      presentToday,
      onLeaveToday,
      pendingLeaves,
      openPositions,
      hiringPassed,
    ] = await Promise.all([
      prisma.employee.count({ where: { organizationId, deletedAt: null, isSystemAccount: { not: true } } }),
      prisma.employee.count({ where: { organizationId, status: 'ACTIVE', deletedAt: null, isSystemAccount: { not: true } } }),
      prisma.department.count({ where: { organizationId, deletedAt: null } }),
      prisma.attendanceRecord.count({
        where: { date: today, status: 'PRESENT', employee: { organizationId } },
      }),
      prisma.leaveRequest.count({
        where: {
          status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
          startDate: { lte: today },
          endDate: { gte: today },
          employee: { organizationId },
        },
      }),
      prisma.leaveRequest.count({
        where: { status: 'PENDING', employee: { organizationId } },
      }),
      prisma.jobOpening.count({ where: { organizationId, status: 'OPEN' } }),
      prisma.walkInCandidate.count({ where: { organizationId, status: 'SELECTED' } }),
    ]) as any;

    // Upcoming birthdays (next 30 days)
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, dateOfBirth: { not: null } },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, avatar: true },
    });

    const now = new Date();
    const upcomingBirthdays = employees
      .filter((e) => {
        if (!e.dateOfBirth) return false;
        const bday = new Date(e.dateOfBirth);
        const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
        if (thisYearBday < now) thisYearBday.setFullYear(now.getFullYear() + 1);
        const daysUntil = Math.ceil((thisYearBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil >= 0 && daysUntil <= 30;
      })
      .map((e) => ({
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        dateOfBirth: e.dateOfBirth,
        avatar: e.avatar,
      }))
      .slice(0, 5);

    // Recent hires (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentHires = await prisma.employee.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isSystemAccount: { not: true },
        joiningDate: { gte: thirtyDaysAgo },
      },
      select: { id: true, firstName: true, lastName: true, joiningDate: true, avatar: true },
      orderBy: { joiningDate: 'desc' },
      take: 5,
    });

    return {
      totalEmployees,
      activeEmployees,
      departmentCount,
      presentToday,
      onLeaveToday,
      openPositions,
      pendingLeaves,
      hiringPassed,
      upcomingBirthdays,
      recentHires,
    };
  }

  /**
   * SUPER ADMIN DASHBOARD — company-level analytics
   */
  async getSuperAdminStats(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    // === KPI GRID (parallel) ===
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalEmployees,
      activeEmployees,
      exitedLastYear,
      startOfYearCount,
      openPositions,
      newHiresThisMonth,
      lastPayrollRun,
    ] = await Promise.all([
      prisma.employee.count({ where: { organizationId, deletedAt: null, isSystemAccount: { not: true } } }),
      prisma.employee.count({ where: { organizationId, status: 'ACTIVE', deletedAt: null, isSystemAccount: { not: true } } }),
      // Employees who left in last 12 months
      prisma.employee.count({
        where: {
          organizationId,
          deletedAt: null,
          isSystemAccount: { not: true },
          status: { in: ['TERMINATED', 'INACTIVE'] },
          lastWorkingDate: { gte: oneYearAgo },
        },
      }),
      // Headcount at start of year (joined before this year and not exited before this year)
      prisma.employee.count({
        where: {
          organizationId,
          deletedAt: null,
          isSystemAccount: { not: true },
          joiningDate: { lt: new Date(now.getFullYear(), 0, 1) },
          OR: [
            { lastWorkingDate: null },
            { lastWorkingDate: { gte: new Date(now.getFullYear(), 0, 1) } },
          ],
        },
      }),
      prisma.jobOpening.count({ where: { organizationId, status: 'OPEN' } }),
      prisma.employee.count({
        where: {
          organizationId,
          deletedAt: null,
          isSystemAccount: { not: true },
          joiningDate: { gte: thisMonthStart },
        },
      }),
      // Last completed payroll
      prisma.payrollRun.findFirst({
        where: { organizationId, status: { in: ['COMPLETED', 'LOCKED'] } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: { totalNet: true, month: true, year: true },
      }),
    ]);

    // Attrition rate = exits in 12 months / avg headcount
    const avgHeadcount = Math.max((startOfYearCount + totalEmployees) / 2, 1);
    const attritionRate = Math.round((exitedLastYear / avgHeadcount) * 100 * 10) / 10;

    const monthlyPayrollCost = lastPayrollRun ? Number(lastPayrollRun.totalNet || 0) : 0;

    // === TRENDS (last 6 months) ===
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const hiringTrend: { month: string; hires: number; exits: number }[] = [];
    const attendanceTrend: { month: string; avgPercentage: number }[] = [];
    const leaveTrend: { month: string; totalDays: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const monthLabel = mStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

      const [hires, exits, presentDays, totalWorkingDays, leaveDays] = await Promise.all([
        prisma.employee.count({
          where: {
            organizationId, deletedAt: null, isSystemAccount: { not: true },
            joiningDate: { gte: mStart, lte: mEnd },
          },
        }),
        prisma.employee.count({
          where: {
            organizationId, deletedAt: null, isSystemAccount: { not: true },
            lastWorkingDate: { gte: mStart, lte: mEnd },
          },
        }),
        prisma.attendanceRecord.count({
          where: {
            date: { gte: mStart, lte: mEnd },
            status: { in: ['PRESENT', 'WORK_FROM_HOME', 'HALF_DAY'] },
            employee: { organizationId },
          },
        }),
        prisma.attendanceRecord.count({
          where: {
            date: { gte: mStart, lte: mEnd },
            status: { notIn: ['HOLIDAY', 'WEEKEND'] },
            employee: { organizationId },
          },
        }),
        prisma.leaveRequest.aggregate({
          where: {
            status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
            startDate: { lte: mEnd },
            endDate: { gte: mStart },
            employee: { organizationId },
          },
          _sum: { days: true },
        }),
      ]);

      hiringTrend.push({ month: monthLabel, hires, exits });
      attendanceTrend.push({
        month: monthLabel,
        avgPercentage: totalWorkingDays > 0 ? Math.round((presentDays / totalWorkingDays) * 100) : 0,
      });
      leaveTrend.push({ month: monthLabel, totalDays: Number(leaveDays._sum.days || 0) });
    }

    // === ALERTS ===
    const alerts: DashboardAlert[] = [];
    if (attritionRate > 15) {
      alerts.push({
        type: 'danger',
        title: 'High Attrition',
        message: `Attrition rate is ${attritionRate}% — above the 15% threshold`,
        action: '/exit-management',
      });
    }
    // Check today's attendance rate
    const todayPresent = await prisma.attendanceRecord.count({
      where: { date: today, status: { in: ['PRESENT', 'WORK_FROM_HOME'] }, employee: { organizationId } },
    });
    const attendanceRate = activeEmployees > 0 ? Math.round((todayPresent / activeEmployees) * 100) : 0;
    if (attendanceRate < 70 && attendanceRate > 0) {
      alerts.push({
        type: 'warning',
        title: 'Low Attendance Today',
        message: `Only ${attendanceRate}% of active employees are present today`,
        action: '/attendance',
      });
    }
    const pendingLeaves = await prisma.leaveRequest.count({
      where: { status: 'PENDING', employee: { organizationId } },
    });
    if (pendingLeaves > 10) {
      alerts.push({
        type: 'warning',
        title: 'Pending Leave Backlog',
        message: `${pendingLeaves} leave requests awaiting approval`,
        action: '/pending-approvals',
      });
    }

    // === RECENT ACTIVITY ===
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [recentHires, recentExits] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, joiningDate: { gte: thirtyDaysAgo } },
        select: { id: true, firstName: true, lastName: true, joiningDate: true, department: { select: { name: true } } },
        orderBy: { joiningDate: 'desc' },
        take: 5,
      }),
      prisma.employee.findMany({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, lastWorkingDate: { gte: thirtyDaysAgo } },
        select: { id: true, firstName: true, lastName: true, lastWorkingDate: true, department: { select: { name: true } } },
        orderBy: { lastWorkingDate: 'desc' },
        take: 5,
      }),
    ]);

    // === DEPARTMENT BREAKDOWN ===
    const departments = await prisma.department.findMany({
      where: { organizationId, deletedAt: null },
      select: { name: true, _count: { select: { employees: { where: { deletedAt: null, isSystemAccount: { not: true } } } } } },
      orderBy: { employees: { _count: 'desc' } },
      take: 10,
    });
    const departmentBreakdown = departments.map((d) => ({ name: d.name, count: d._count.employees }));

    // === BIRTHDAYS ===
    const allEmps = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, dateOfBirth: { not: null } },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, avatar: true },
    });
    const upcomingBirthdays = allEmps
      .filter((e) => {
        if (!e.dateOfBirth) return false;
        const bday = new Date(e.dateOfBirth);
        const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
        if (thisYearBday < now) thisYearBday.setFullYear(now.getFullYear() + 1);
        const daysUntil = Math.ceil((thisYearBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil >= 0 && daysUntil <= 30;
      })
      .map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, dateOfBirth: e.dateOfBirth, avatar: e.avatar }))
      .slice(0, 5);

    return {
      totalEmployees,
      activeEmployees,
      attritionRate,
      monthlyPayrollCost,
      openPositions,
      newHiresThisMonth,
      hiringTrend,
      attendanceTrend,
      leaveTrend,
      alerts,
      recentHires: recentHires.map((h) => ({ ...h, department: h.department?.name })),
      recentExits: recentExits.map((e) => ({ ...e, department: e.department?.name })),
      departmentBreakdown,
      upcomingBirthdays,
    };
  }

  /**
   * HR DASHBOARD — daily operations
   */
  async getHRStats(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    // Active employees count
    const activeCount = await prisma.employee.count({
      where: { organizationId, status: 'ACTIVE', deletedAt: null, isSystemAccount: { not: true } },
    });

    // === TODAY'S ATTENDANCE (parallel) ===
    const [
      presentCount,
      wfhCount,
      halfDayCount,
      onLeaveCount,
      checkedInIds,
    ] = await Promise.all([
      prisma.attendanceRecord.count({
        where: { date: today, status: 'PRESENT', employee: { organizationId } },
      }),
      prisma.attendanceRecord.count({
        where: { date: today, status: 'WORK_FROM_HOME', employee: { organizationId } },
      }),
      prisma.attendanceRecord.count({
        where: { date: today, status: 'HALF_DAY', employee: { organizationId } },
      }),
      prisma.leaveRequest.count({
        where: {
          status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
          startDate: { lte: today },
          endDate: { gte: today },
          employee: { organizationId },
        },
      }),
      prisma.attendanceRecord.findMany({
        where: { date: today, employee: { organizationId } },
        select: { employeeId: true },
      }),
    ]);

    const totalCheckedIn = presentCount + wfhCount + halfDayCount;
    const notCheckedIn = Math.max(activeCount - totalCheckedIn - onLeaveCount, 0);

    // Late arrivals — employees who checked in after shift grace period
    const lateRecords = await prisma.attendanceRecord.findMany({
      where: {
        date: today,
        status: { in: ['PRESENT', 'WORK_FROM_HOME'] },
        checkIn: { not: null },
        employee: { organizationId },
      },
      select: {
        checkIn: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            shiftAssignments: {
              where: { isActive: true },
              select: { shift: { select: { startTime: true, graceMinutes: true } } },
              take: 1,
            },
          },
        },
      },
    });

    let lateCount = 0;
    const lateEmployees: { employeeId: string; employeeName: string }[] = [];
    for (const rec of lateRecords) {
      if (!rec.checkIn) continue;
      const shift = rec.employee.shiftAssignments[0]?.shift;
      const startTime = shift?.startTime || '09:00';
      const grace = shift?.graceMinutes || 15;
      const [sh, sm] = startTime.split(':').map(Number);
      const deadline = new Date(today);
      deadline.setHours(sh, sm + grace, 0, 0);
      if (new Date(rec.checkIn) > deadline) {
        lateCount++;
        lateEmployees.push({
          employeeId: rec.employee.id,
          employeeName: `${rec.employee.firstName} ${rec.employee.lastName}`,
        });
      }
    }

    const todayAttendance = {
      present: presentCount,
      absent: Math.max(activeCount - totalCheckedIn - onLeaveCount, 0),
      late: lateCount,
      onLeave: onLeaveCount,
      notCheckedIn,
      workFromHome: wfhCount,
      totalActive: activeCount,
    };

    // === ACTION CENTER ===
    const [
      leaveRequests,
      regularizations,
      helpdeskTickets,
      documentsToVerify,
      pendingOnboarding,
    ] = await Promise.all([
      prisma.leaveRequest.count({ where: { status: 'PENDING', employee: { organizationId } } }),
      prisma.attendanceRegularization.count({
        where: { status: 'PENDING', attendance: { employee: { organizationId } } },
      }),
      prisma.ticket.count({ where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.document.count({ where: { status: 'PENDING', employee: { organizationId } } }),
      prisma.employee.count({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, onboardingComplete: false, status: 'ACTIVE' },
      }),
    ]);

    const pendingActions = { leaveRequests, regularizations, helpdeskTickets, documentsToVerify, pendingOnboarding };

    // === ATTENTION ITEMS ===
    const attentionItems: AttentionItem[] = [];

    // Late employees
    for (const le of lateEmployees.slice(0, 5)) {
      attentionItems.push({
        type: 'late',
        title: 'Late Arrival',
        description: `${le.employeeName} checked in late today`,
        employeeId: le.employeeId,
        employeeName: le.employeeName,
        action: '/attendance',
      });
    }

    // Missing checkouts (checked in but no checkout, and it's past 7pm)
    if (now.getHours() >= 19) {
      const missingCheckouts = await prisma.attendanceRecord.findMany({
        where: {
          date: today,
          checkIn: { not: null },
          checkOut: null,
          employee: { organizationId },
        },
        select: { employee: { select: { id: true, firstName: true, lastName: true } } },
        take: 5,
      });
      for (const mc of missingCheckouts) {
        attentionItems.push({
          type: 'missing_checkout',
          title: 'Missing Check-out',
          description: `${mc.employee.firstName} ${mc.employee.lastName} hasn't checked out`,
          employeeId: mc.employee.id,
          employeeName: `${mc.employee.firstName} ${mc.employee.lastName}`,
          action: '/attendance',
        });
      }
    }

    // Probation ending in next 7 days
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const probationEnding = await prisma.employee.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isSystemAccount: { not: true },
        status: 'ACTIVE',
        probationEndDate: { gte: today, lte: sevenDaysFromNow },
      },
      select: { id: true, firstName: true, lastName: true, probationEndDate: true },
      take: 5,
    });
    for (const pe of probationEnding) {
      attentionItems.push({
        type: 'probation_ending',
        title: 'Probation Ending Soon',
        description: `${pe.firstName} ${pe.lastName}'s probation ends on ${pe.probationEndDate?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`,
        employeeId: pe.id,
        employeeName: `${pe.firstName} ${pe.lastName}`,
      });
    }

    // === QUICK STATS ===
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [recentHires, birthdayEmps] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, joiningDate: { gte: thirtyDaysAgo } },
        select: { id: true, firstName: true, lastName: true, joiningDate: true, department: { select: { name: true } } },
        orderBy: { joiningDate: 'desc' },
        take: 5,
      }),
      prisma.employee.findMany({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, dateOfBirth: { not: null } },
        select: { id: true, firstName: true, lastName: true, dateOfBirth: true, avatar: true },
      }),
    ]);

    const upcomingBirthdays = birthdayEmps
      .filter((e) => {
        if (!e.dateOfBirth) return false;
        const bday = new Date(e.dateOfBirth);
        const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
        if (thisYearBday < now) thisYearBday.setFullYear(now.getFullYear() + 1);
        const daysUntil = Math.ceil((thisYearBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil >= 0 && daysUntil <= 14;
      })
      .map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, dateOfBirth: e.dateOfBirth, avatar: e.avatar }))
      .slice(0, 5);

    // Today's leaves details
    const todayLeaves = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
        startDate: { lte: today },
        endDate: { gte: today },
        employee: { organizationId },
      },
      select: {
        id: true,
        days: true,
        employee: { select: { firstName: true, lastName: true } },
        leaveType: { select: { name: true } },
      },
      take: 10,
    });

    return {
      todayAttendance,
      pendingActions,
      attentionItems,
      upcomingBirthdays,
      recentHires: recentHires.map((h) => ({ ...h, department: h.department?.name })),
      todayLeaves: todayLeaves.map((l) => ({
        id: l.id,
        employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        leaveType: l.leaveType.name,
        days: Number(l.days),
      })),
    };
  }

  async getPendingApprovals(organizationId: string, filters?: { search?: string; page?: number; limit?: number }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const employeeNameFilter = filters?.search
      ? {
          employee: {
            organizationId,
            OR: [
              { firstName: { contains: filters.search, mode: 'insensitive' as const } },
              { lastName: { contains: filters.search, mode: 'insensitive' as const } },
            ],
          },
        }
      : { employee: { organizationId } };

    const [pendingLeaves, pendingLeavesCount, openTickets, openTicketsCount] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: { status: 'PENDING', ...employeeNameFilter },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } },
          leaveType: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.leaveRequest.count({ where: { status: 'PENDING', ...employeeNameFilter } }),
      prisma.ticket.findMany({
        where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] }, ...( filters?.search ? { employee: { OR: [{ firstName: { contains: filters.search, mode: 'insensitive' as const } }, { lastName: { contains: filters.search, mode: 'insensitive' as const } }] } } : {}) },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.ticket.count({ where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] }, ...( filters?.search ? { employee: { OR: [{ firstName: { contains: filters.search, mode: 'insensitive' as const } }, { lastName: { contains: filters.search, mode: 'insensitive' as const } }] } } : {}) } }),
    ]);

    return {
      pendingLeaves: { data: pendingLeaves, total: pendingLeavesCount },
      openTickets: { data: openTickets, total: openTicketsCount },
    };
  }
}

export const dashboardService = new DashboardService();
