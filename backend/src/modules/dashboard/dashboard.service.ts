import { prisma } from '../../lib/prisma.js';

export class DashboardService {
  async getStats(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalEmployees,
      activeEmployees,
      departmentCount,
      presentToday,
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
      onLeaveToday: 0,
      openPositions,
      pendingLeaves,
      hiringPassed,
      upcomingBirthdays,
      recentHires,
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
