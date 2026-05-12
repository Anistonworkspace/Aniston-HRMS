import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { EmployeeStatus } from '@prisma/client';
import type { DashboardAlert, AttentionItem } from '@aniston/shared';

const CACHE_TTL = 60; // 60 seconds cache for dashboard data

// ── Redis circuit breaker ──────────────────────────────────────────────────
// If Redis fails 3+ times within 30 s we open the circuit and skip Redis
// entirely until the window resets, to avoid blocking the compute path.
let redisFailCount = 0;
let lastRedisFailTime = 0;
const REDIS_CIRCUIT_OPEN_THRESHOLD = 3;
const REDIS_CIRCUIT_RESET_MS = 30_000;

export class DashboardService {
  /**
   * Cache wrapper — check Redis first, compute on miss.
   * Includes a circuit breaker: if Redis has failed 3+ times in the last
   * 30 s the wrapper skips Redis and calls compute() directly.
   */
  private async cached<T>(key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
    // Circuit breaker — open?
    const circuitOpen =
      redisFailCount >= REDIS_CIRCUIT_OPEN_THRESHOLD &&
      Date.now() - lastRedisFailTime < REDIS_CIRCUIT_RESET_MS;

    if (!circuitOpen) {
      try {
        const cached = await redis.get(key);
        if (cached) {
          // Successful hit — reset failure counter
          redisFailCount = 0;
          return JSON.parse(cached);
        }
      } catch {
        // Redis read failure — increment circuit-breaker counter
        redisFailCount += 1;
        lastRedisFailTime = Date.now();
      }
    }

    const result = await compute();

    if (!circuitOpen) {
      try {
        await redis.setex(key, ttl, JSON.stringify(result));
      } catch {
        // Redis write failure — increment counter
        redisFailCount += 1;
        lastRedisFailTime = Date.now();
      }
    }

    return result;
  }

  // ── Timeout helper ────────────────────────────────────────────────────────
  /**
   * Race a computation against a hard timeout (default 15 s).
   * On timeout: tries to return the last Redis-cached value if available,
   * otherwise re-throws so the caller can surface a 503.
   */
  private async withTimeout<T>(
    cacheKey: string,
    compute: () => Promise<T>,
    timeoutMs = 15_000,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Dashboard query timeout')), timeoutMs),
    );
    try {
      return await Promise.race([compute(), timeoutPromise]);
    } catch (err) {
      if (err instanceof Error && err.message === 'Dashboard query timeout') {
        // Try to serve stale data from Redis before giving up
        try {
          const stale = await redis.get(cacheKey);
          if (stale) return JSON.parse(stale) as T;
        } catch { /* Redis unavailable — fall through */ }
      }
      throw err;
    }
  }

  /**
   * Original stats endpoint — kept for backward compat (employee dashboard uses it)
   */
  async getStats(organizationId: string) {
    const key = `dashboard:employee:${organizationId}`;
    return this.withTimeout(key, () =>
      this.cached(key, CACHE_TTL, () => this._getStats(organizationId)),
    );
  }

  private async _getStats(organizationId: string) {
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

    // Upcoming birthdays (next 30 days) — Issue B fix: filter by month in DB
    const now = new Date();
    const bdayCurrentMonth = now.getMonth() + 1;
    const bdayNextMonth = bdayCurrentMonth === 12 ? 1 : bdayCurrentMonth + 1;
    const birthdayEmpsRaw = await prisma.$queryRaw<
      { id: string; firstName: string; lastName: string; dateOfBirth: Date; avatar: string | null }[]
    >`
      SELECT id, "firstName", "lastName", "dateOfBirth", avatar
      FROM   "Employee"
      WHERE  "organizationId" = ${organizationId}
        AND  "deletedAt" IS NULL
        AND  ("isSystemAccount" IS NULL OR "isSystemAccount" = false)
        AND  "dateOfBirth" IS NOT NULL
        AND  EXTRACT(MONTH FROM "dateOfBirth") IN (${bdayCurrentMonth}, ${bdayNextMonth})
      LIMIT  50
    `;
    const upcomingBirthdays = birthdayEmpsRaw
      .filter((e) => {
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
    const key = `dashboard:superadmin:${organizationId}`;
    return this.withTimeout(key, () =>
      this.cached(key, CACHE_TTL, () => this._getSuperAdminStats(organizationId)),
    );
  }

  private async _getSuperAdminStats(organizationId: string) {
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

    // === TRENDS (last 6 months) — DB-side aggregations to avoid loading all
    //     records into Node.js memory ===
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const sixMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Build month boundaries for bucketing (used for label generation + JS merge)
    const monthBuckets: { start: Date; end: Date; label: string; key: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const label = mStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      // Zero-padded "YYYY-MM" key for matching $queryRaw results
      const key = `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets.push({ start: mStart, end: mEnd, label, key });
    }

    // ── Issue A fix: use $queryRaw + groupBy so the DB does the bucketing ──

    // Hires per month — DATE_TRUNC returns a timestamp; cast to text for the key
    const hiresRaw = await prisma.$queryRaw<{ month_key: string; cnt: bigint }[]>`
      SELECT TO_CHAR(DATE_TRUNC('month', "joiningDate"), 'YYYY-MM') AS month_key,
             COUNT(*)::bigint AS cnt
      FROM   "Employee"
      WHERE  "organizationId" = ${organizationId}
        AND  "deletedAt" IS NULL
        AND  ("isSystemAccount" IS NULL OR "isSystemAccount" = false)
        AND  "joiningDate" >= ${sixMonthsAgo}
        AND  "joiningDate" <= ${sixMonthEnd}
      GROUP  BY 1
    `;

    // Exits per month
    const exitsRaw = await prisma.$queryRaw<{ month_key: string; cnt: bigint }[]>`
      SELECT TO_CHAR(DATE_TRUNC('month', "lastWorkingDate"), 'YYYY-MM') AS month_key,
             COUNT(*)::bigint AS cnt
      FROM   "Employee"
      WHERE  "organizationId" = ${organizationId}
        AND  "deletedAt" IS NULL
        AND  ("isSystemAccount" IS NULL OR "isSystemAccount" = false)
        AND  "lastWorkingDate" >= ${sixMonthsAgo}
        AND  "lastWorkingDate" <= ${sixMonthEnd}
      GROUP  BY 1
    `;

    // Attendance: present + total working records per month (two rows per month_key)
    // We get (month_key, present_cnt, working_cnt) in a single scan via conditional agg
    const attendanceRaw = await prisma.$queryRaw<
      { month_key: string; present_cnt: bigint; working_cnt: bigint }[]
    >`
      SELECT TO_CHAR(DATE_TRUNC('month', ar.date), 'YYYY-MM') AS month_key,
             COUNT(*) FILTER (WHERE ar.status IN ('PRESENT','WORK_FROM_HOME','HALF_DAY'))::bigint AS present_cnt,
             COUNT(*) FILTER (WHERE ar.status NOT IN ('HOLIDAY','WEEKEND'))::bigint           AS working_cnt
      FROM   "AttendanceRecord" ar
      JOIN   "Employee" e ON e.id = ar."employeeId"
      WHERE  e."organizationId" = ${organizationId}
        AND  ar.date >= ${sixMonthsAgo}
        AND  ar.date <= ${sixMonthEnd}
      GROUP  BY 1
    `;

    // Leave days per month — leave requests can span month boundaries so we
    // sum the days field (pre-computed) grouped by the month the leave *starts*.
    // This is an approximation (same as the old code's overlapsMonth approach
    // was also an approximation), but keeps the query simple and DB-side.
    const leaveRaw = await prisma.$queryRaw<{ month_key: string; total_days: number }[]>`
      SELECT TO_CHAR(DATE_TRUNC('month', lr."startDate"), 'YYYY-MM') AS month_key,
             COALESCE(SUM(lr.days), 0)::float AS total_days
      FROM   "LeaveRequest" lr
      JOIN   "Employee" e ON e.id = lr."employeeId"
      WHERE  e."organizationId" = ${organizationId}
        AND  lr.status IN ('APPROVED','MANAGER_APPROVED')
        AND  lr."startDate" >= ${sixMonthsAgo}
        AND  lr."startDate" <= ${sixMonthEnd}
      GROUP  BY 1
    `;

    // Convert raw rows into lookup maps keyed by "YYYY-MM"
    const hiresMap = new Map(hiresRaw.map(r => [r.month_key, Number(r.cnt)]));
    const exitsMap = new Map(exitsRaw.map(r => [r.month_key, Number(r.cnt)]));
    const attendanceMap = new Map(
      attendanceRaw.map(r => [r.month_key, { present: Number(r.present_cnt), working: Number(r.working_cnt) }])
    );
    const leaveMap = new Map(leaveRaw.map(r => [r.month_key, Number(r.total_days)]));

    const hiringTrend: { month: string; hires: number; exits: number }[] = [];
    const attendanceTrend: { month: string; avgPercentage: number }[] = [];
    const leaveTrend: { month: string; totalDays: number }[] = [];

    for (const bucket of monthBuckets) {
      const hires = hiresMap.get(bucket.key) ?? 0;
      const exits = exitsMap.get(bucket.key) ?? 0;
      const att = attendanceMap.get(bucket.key) ?? { present: 0, working: 0 };
      const leaveDays = leaveMap.get(bucket.key) ?? 0;

      hiringTrend.push({ month: bucket.label, hires, exits });
      attendanceTrend.push({
        month: bucket.label,
        avgPercentage: att.working > 0 ? Math.round((att.present / att.working) * 100) : 0,
      });
      leaveTrend.push({ month: bucket.label, totalDays: leaveDays });
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
    // Check today's attendance rate — use all work-eligible statuses as denominator
    const [todayPresent, workEligibleCount] = await Promise.all([
      prisma.attendanceRecord.count({
        where: { date: today, status: { in: ['PRESENT', 'WORK_FROM_HOME'] }, employee: { organizationId } },
      }),
      prisma.employee.count({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] } },
      }),
    ]);
    const attendanceRate = workEligibleCount > 0 ? Math.round((todayPresent / workEligibleCount) * 100) : 0;
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

    // === BIRTHDAYS — Issue B fix: push month/day filter into PostgreSQL ===
    // EXTRACT-based filter means we only fetch employees whose birthday falls
    // within the current or next calendar month — never the full table.
    const currentMonth = now.getMonth() + 1; // 1-indexed
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const upcomingBirthdaysRaw = await prisma.$queryRaw<
      { id: string; firstName: string; lastName: string; dateOfBirth: Date; avatar: string | null }[]
    >`
      SELECT id, "firstName", "lastName", "dateOfBirth", avatar
      FROM   "Employee"
      WHERE  "organizationId" = ${organizationId}
        AND  "deletedAt" IS NULL
        AND  ("isSystemAccount" IS NULL OR "isSystemAccount" = false)
        AND  "dateOfBirth" IS NOT NULL
        AND  EXTRACT(MONTH FROM "dateOfBirth") IN (${currentMonth}, ${nextMonth})
      LIMIT  50
    `;
    const upcomingBirthdays = upcomingBirthdaysRaw
      .filter((e) => {
        const bday = new Date(e.dateOfBirth);
        const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
        if (thisYearBday < now) thisYearBday.setFullYear(now.getFullYear() + 1);
        const daysUntil = Math.ceil((thisYearBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil >= 0 && daysUntil <= 30;
      })
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
  async getHRStats(organizationId: string, userId?: string, role?: string) {
    const key = `dashboard:hr:${organizationId}:${userId || 'all'}`;
    return this.withTimeout(key, () =>
      this.cached(key, CACHE_TTL, () => this._getHRStats(organizationId, userId, role)),
    );
  }

  private async _getHRStats(organizationId: string, userId?: string, role?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();

    // Work-eligible employees — must exactly match attendance command center scope
    // NOTICE_PERIOD employees still mark attendance during their notice period
    const WORK_STATUSES: EmployeeStatus[] = [EmployeeStatus.ACTIVE, EmployeeStatus.PROBATION, EmployeeStatus.INTERN, EmployeeStatus.NOTICE_PERIOD];
    const activeCount = await prisma.employee.count({
      where: { organizationId, status: { in: WORK_STATUSES }, deletedAt: null, isSystemAccount: { not: true } },
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
    // notCheckedIn = work-eligible employees who have no attendance record and are not on approved leave today
    const notCheckedIn = Math.max(activeCount - totalCheckedIn - onLeaveCount, 0);

    // Late arrivals + present list — use stored lateMinutes (same source as Attendance Command Center)
    const [allTodayRecords, presentRecords] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          date: today,
          status: { in: ['PRESENT', 'WORK_FROM_HOME', 'HALF_DAY'] },
          checkIn: { not: null },
          employee: { organizationId },
        },
        select: {
          lateMinutes: true,
          notes: true,
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      // Present employees list for popup (include WFH too)
      prisma.attendanceRecord.findMany({
        where: { date: today, status: { in: ['PRESENT', 'HALF_DAY', 'WORK_FROM_HOME'] }, employee: { organizationId } },
        select: { employee: { select: { id: true, firstName: true, lastName: true } } },
        take: 100,
      }),
    ]);

    // Use stored lateMinutes — identical logic to getCommandCenterStats
    const lateEmployeesList: { id: string; name: string }[] = allTodayRecords
      .filter((r) => (r.lateMinutes ?? 0) > 0 || r.notes?.includes('[Late by'))
      .map((r) => ({ id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}` }));
    const lateCount = lateEmployeesList.length;

    // absent = notCheckedIn (real-time: employees who are active, not checked in, not on leave)
    const absentCount = notCheckedIn;

    // Build employee lists for popup drill-down — sorted alphabetically
    const presentEmployeesList = presentRecords
      .map((r) => ({ id: r.employee.id, name: `${r.employee.firstName} ${r.employee.lastName}` }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // For absent: fetch active employees, subtract checked-in and on-leave.
    // Issue B fix: use take: 100 on the absent query so the DB limits the
    // result set instead of pulling every employee and slicing in JS.
    const [onLeaveEmpIds] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: {
          status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
          startDate: { lte: today },
          endDate: { gte: today },
          employee: { organizationId },
        },
        select: { employeeId: true },
      }),
    ]);

    const checkedInSet = new Set(checkedInIds.map((r: { employeeId: string }) => r.employeeId));
    const onLeaveSet = new Set(onLeaveEmpIds.map((r: { employeeId: string }) => r.employeeId));

    // Absent list: DB does the heavy lifting — exclude checked-in and on-leave IDs
    const checkedInArray = [...checkedInSet];
    const onLeaveArray = [...onLeaveSet];
    const absentEmployeesList = await prisma.employee
      .findMany({
        where: {
          organizationId,
          status: { in: WORK_STATUSES },
          deletedAt: null,
          isSystemAccount: { not: true },
          id: {
            notIn: [...checkedInArray, ...onLeaveArray],
          },
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 100,
      })
      .then((rows) => rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })));

    // On-leave list: fetch only employees in the on-leave set (already small)
    const onLeaveEmployeesList =
      onLeaveArray.length === 0
        ? []
        : await prisma.employee
            .findMany({
              where: {
                organizationId,
                deletedAt: null,
                id: { in: onLeaveArray },
              },
              select: { id: true, firstName: true, lastName: true },
              orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            })
            .then((rows) => rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })));

    const todayAttendance = {
      present: totalCheckedIn,   // all checked-in (PRESENT + WFH + HALF_DAY)
      presentOnly: presentCount, // strict PRESENT only (for detailed breakdown if needed)
      absent: absentCount,
      late: lateCount,
      onLeave: onLeaveCount,
      notCheckedIn,
      workFromHome: wfhCount,
      halfDay: halfDayCount,
      totalActive: activeCount,
      presentEmployees: presentEmployeesList,
      absentEmployees: absentEmployeesList,
      lateEmployees: lateEmployeesList.sort((a, b) => a.name.localeCompare(b.name)),
      onLeaveEmployees: onLeaveEmployeesList,
    };

    // === ACTION CENTER ===
    const [
      leaveRequests,
      regularizations,
      helpdeskTickets,
      documentsToVerify,
      pendingOnboarding,
      unverifiedDocRecords,
      openTicketsRecords,
    ] = await Promise.all([
      prisma.leaveRequest.count({ where: { status: 'PENDING', employee: { organizationId } } }),
      prisma.attendanceRegularization.count({
        where: { status: 'PENDING', attendance: { employee: { organizationId } } },
      }),
      prisma.ticket.count({ where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] }, ...(role === 'HR' && userId ? { assignedTo: userId } : {}) } }),
      // Count distinct employees (not documents) with pending docs
      prisma.document.findMany({
        where: {
          status: 'PENDING',
          deletedAt: null,
          employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
          employeeId: { not: null },
        },
        select: { employeeId: true },
        distinct: ['employeeId'],
      }).then(rows => rows.length),
      prisma.employee.count({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, onboardingComplete: false, status: 'ACTIVE' },
      }),
      // Employees with unverified documents — only real, non-deleted employees
      prisma.document.findMany({
        where: {
          status: 'PENDING',
          deletedAt: null,
          employeeId: { not: null },
          employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } },
        },
        select: { employee: { select: { id: true, firstName: true, lastName: true } } },
        distinct: ['employeeId'],
        take: 50,
        orderBy: { employee: { firstName: 'asc' } },
      }),
      // Open/In-Progress tickets for popup
      prisma.ticket.findMany({
        where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] }, ...(role === 'HR' && userId ? { assignedTo: userId } : {}) },
        select: {
          id: true,
          ticketCode: true,
          subject: true,
          employee: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const unverifiedDocEmployees = unverifiedDocRecords
      .filter((d: any) => d.employee?.id)
      .map((d: any) => ({ id: d.employee.id, name: `${d.employee.firstName} ${d.employee.lastName}`.trim() }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const openTicketsList = openTicketsRecords.map((t: any) => ({
      id: t.id,
      ticketCode: t.ticketCode,
      subject: t.subject,
      employeeName: `${t.employee?.firstName || ''} ${t.employee?.lastName || ''}`.trim(),
    }));

    const pendingActions = { leaveRequests, regularizations, helpdeskTickets, documentsToVerify, pendingOnboarding, unverifiedDocEmployees, openTicketsList };

    // === ATTENTION ITEMS ===
    const attentionItems: AttentionItem[] = [];

    // Late employees
    for (const le of lateEmployeesList.slice(0, 5)) {
      attentionItems.push({
        type: 'late',
        title: 'Late Arrival',
        description: `${le.name} checked in late today`,
        employeeId: le.id,
        employeeName: le.name,
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

    // Issue B fix: push birthday month filter into DB; only fetch 2 months max
    const hrBdayCurrentMonth = now.getMonth() + 1;
    const hrBdayNextMonth = hrBdayCurrentMonth === 12 ? 1 : hrBdayCurrentMonth + 1;

    const [recentHires, hrBirthdayEmps] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, joiningDate: { gte: thirtyDaysAgo } },
        select: { id: true, firstName: true, lastName: true, joiningDate: true, department: { select: { name: true } } },
        orderBy: { joiningDate: 'desc' },
        take: 5,
      }),
      prisma.$queryRaw<
        { id: string; firstName: string; lastName: string; dateOfBirth: Date; avatar: string | null }[]
      >`
        SELECT id, "firstName", "lastName", "dateOfBirth", avatar
        FROM   "Employee"
        WHERE  "organizationId" = ${organizationId}
          AND  "deletedAt" IS NULL
          AND  ("isSystemAccount" IS NULL OR "isSystemAccount" = false)
          AND  "dateOfBirth" IS NOT NULL
          AND  EXTRACT(MONTH FROM "dateOfBirth") IN (${hrBdayCurrentMonth}, ${hrBdayNextMonth})
        LIMIT  50
      `,
    ]);

    const upcomingBirthdays = hrBirthdayEmps
      .filter((e) => {
        const bday = new Date(e.dateOfBirth);
        const thisYearBday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
        if (thisYearBday < now) thisYearBday.setFullYear(now.getFullYear() + 1);
        const daysUntil = Math.ceil((thisYearBday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil >= 0 && daysUntil <= 14;
      })
      .map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, dateOfBirth: e.dateOfBirth, avatar: e.avatar }))
      .slice(0, 5);

    // Today's leaves details + recent pending leave requests + HR KPIs (parallel)
    const [todayLeaves, recentLeaveRequests, totalEmployees, pendingOnboardingCount] = await Promise.all([
      prisma.leaveRequest.findMany({
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
      }),
      prisma.leaveRequest.findMany({
        where: { status: 'PENDING', employee: { organizationId } },
        select: {
          id: true,
          days: true,
          startDate: true,
          endDate: true,
          reason: true,
          employee: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          leaveType: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.employee.count({ where: { organizationId, deletedAt: null, isSystemAccount: { not: true } } }),
      prisma.employee.count({ where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, onboardingComplete: false } }),
    ]);

    return {
      todayAttendance,
      pendingActions,
      attentionItems,
      upcomingBirthdays,
      hrKpis: { totalEmployees, pendingOnboarding: pendingOnboardingCount },
      recentHires: recentHires.map((h) => ({ ...h, department: h.department?.name })),
      todayLeaves: todayLeaves.map((l) => ({
        id: l.id,
        employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        leaveType: l.leaveType.name,
        days: Number(l.days),
      })),
      recentLeaveRequests: recentLeaveRequests.map((l) => ({
        id: l.id,
        employeeId: l.employee.id,
        employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        avatar: l.employee.avatar,
        leaveType: l.leaveType.name,
        days: Number(l.days),
        startDate: l.startDate,
        endDate: l.endDate,
        reason: l.reason,
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

  /**
   * UNIFIED SUMMARY — returns role-appropriate data in a single call
   */
  async getSummary(organizationId: string, role: string) {
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      return { role: 'SUPER_ADMIN', data: await this.getSuperAdminStats(organizationId) };
    }
    if (role === 'HR') {
      return { role: 'HR', data: await this.getHRStats(organizationId) };
    }
    // MANAGER / EMPLOYEE / others
    return { role: 'EMPLOYEE', data: await this.getStats(organizationId) };
  }
}

export const dashboardService = new DashboardService();
