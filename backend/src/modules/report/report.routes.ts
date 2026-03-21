import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission('report', 'read'));

// Headcount report
router.get('/headcount', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const [total, byDepartment, byStatus, byWorkMode, byGender] = await Promise.all([
      prisma.employee.count({ where: { organizationId: orgId, deletedAt: null } }),
      prisma.employee.groupBy({
        by: ['departmentId'],
        _count: true,
        where: { organizationId: orgId, deletedAt: null },
      }),
      prisma.employee.groupBy({
        by: ['status'],
        _count: true,
        where: { organizationId: orgId, deletedAt: null },
      }),
      prisma.employee.groupBy({
        by: ['workMode'],
        _count: true,
        where: { organizationId: orgId, deletedAt: null },
      }),
      prisma.employee.groupBy({
        by: ['gender'],
        _count: true,
        where: { organizationId: orgId, deletedAt: null },
      }),
    ]);

    // Get department names
    const departments = await prisma.department.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    });
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));

    res.json({
      success: true,
      data: {
        total,
        byDepartment: byDepartment.map((d) => ({
          department: deptMap.get(d.departmentId || '') || 'Unassigned',
          count: d._count,
        })),
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
        byWorkMode: byWorkMode.map((w) => ({ workMode: w.workMode, count: w._count })),
        byGender: byGender.map((g) => ({ gender: g.gender, count: g._count })),
      },
    });
  } catch (err) { next(err); }
});

// Attendance summary
router.get('/attendance-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const statusCounts = await prisma.attendanceRecord.groupBy({
      by: ['status'],
      _count: true,
      where: {
        employee: { organizationId: orgId },
        date: { gte: start, lte: end },
      },
    });

    const dailyAttendance = await prisma.attendanceRecord.groupBy({
      by: ['date'],
      _count: true,
      where: {
        employee: { organizationId: orgId },
        date: { gte: start, lte: end },
        status: 'PRESENT',
      },
      orderBy: { date: 'asc' },
    });

    res.json({
      success: true,
      data: {
        period: { start, end },
        statusBreakdown: statusCounts.map((s) => ({ status: s.status, count: s._count })),
        dailyPresent: dailyAttendance.map((d) => ({ date: d.date, count: d._count })),
      },
    });
  } catch (err) { next(err); }
});

// Leave summary
router.get('/leave-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const year = Number(req.query.year) || new Date().getFullYear();

    const leavesByType = await prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      _sum: { days: true },
      _count: true,
      where: {
        employee: { organizationId: orgId },
        status: 'APPROVED',
        startDate: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) },
      },
    });

    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, code: true },
    });
    const typeMap = new Map(leaveTypes.map((t) => [t.id, t]));

    const monthlyLeaves = await prisma.leaveRequest.groupBy({
      by: ['startDate'],
      _count: true,
      where: {
        employee: { organizationId: orgId },
        status: 'APPROVED',
        startDate: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) },
      },
    });

    res.json({
      success: true,
      data: {
        year,
        byType: leavesByType.map((l) => ({
          leaveType: typeMap.get(l.leaveTypeId),
          totalDays: l._sum.days,
          count: l._count,
        })),
        totalApproved: leavesByType.reduce((sum, l) => sum + l._count, 0),
      },
    });
  } catch (err) { next(err); }
});

// Payroll summary
router.get('/payroll-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const runs = await prisma.payrollRun.findMany({
      where: { organizationId: orgId, status: 'COMPLETED' },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      select: { month: true, year: true, totalGross: true, totalNet: true, totalDeductions: true },
      take: 12,
    });

    res.json({
      success: true,
      data: {
        monthlyTrend: runs.map((r) => ({
          month: r.month,
          year: r.year,
          label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][r.month - 1]} ${r.year}`,
          gross: Number(r.totalGross || 0),
          net: Number(r.totalNet || 0),
          deductions: Number(r.totalDeductions || 0),
        })),
      },
    });
  } catch (err) { next(err); }
});

// Recruitment funnel
router.get('/recruitment-funnel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const pipeline = await prisma.application.groupBy({
      by: ['status'],
      _count: true,
      where: { jobOpening: { organizationId: orgId } },
    });

    const openJobs = await prisma.jobOpening.count({ where: { organizationId: orgId, status: 'OPEN' } });
    const totalApplications = await prisma.application.count({ where: { jobOpening: { organizationId: orgId } } });

    res.json({
      success: true,
      data: {
        openJobs,
        totalApplications,
        pipeline: pipeline.map((p) => ({ stage: p.status, count: p._count })),
      },
    });
  } catch (err) { next(err); }
});

export { router as reportRouter };
