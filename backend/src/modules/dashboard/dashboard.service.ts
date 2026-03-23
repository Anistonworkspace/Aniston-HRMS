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
    ] = await Promise.all([
      prisma.employee.count({ where: { organizationId, deletedAt: null } }),
      prisma.employee.count({ where: { organizationId, status: 'ACTIVE', deletedAt: null } }),
      prisma.department.count({ where: { organizationId, deletedAt: null } }),
      prisma.attendanceRecord.count({
        where: { date: today, status: 'PRESENT', employee: { organizationId } },
      }),
      prisma.leaveRequest.count({
        where: { status: 'PENDING', employee: { organizationId } },
      }),
      prisma.jobOpening.count({ where: { organizationId, status: 'OPEN' } }),
    ]);

    // Upcoming birthdays (next 30 days)
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, dateOfBirth: { not: null } },
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
      upcomingBirthdays,
      recentHires,
    };
  }
}

export const dashboardService = new DashboardService();
