import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();
router.use(authenticate);

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalEmployees,
      activeEmployees,
      departmentCount,
    ] = await Promise.all([
      prisma.employee.count({ where: { organizationId: orgId, deletedAt: null } }),
      prisma.employee.count({ where: { organizationId: orgId, status: 'ACTIVE', deletedAt: null } }),
      prisma.department.count({ where: { organizationId: orgId, deletedAt: null } }),
    ]);

    // Upcoming birthdays (next 30 days)
    const employees = await prisma.employee.findMany({
      where: { organizationId: orgId, deletedAt: null, dateOfBirth: { not: null } },
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
        organizationId: orgId,
        deletedAt: null,
        joiningDate: { gte: thirtyDaysAgo },
      },
      select: { id: true, firstName: true, lastName: true, joiningDate: true, avatar: true },
      orderBy: { joiningDate: 'desc' },
      take: 5,
    });

    res.json({
      success: true,
      data: {
        totalEmployees,
        activeEmployees,
        departmentCount,
        presentToday: 0, // Will be populated when attendance module is built
        onLeaveToday: 0,
        openPositions: 0,
        pendingLeaves: 0,
        upcomingBirthdays,
        recentHires,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as dashboardRouter };
