import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmployeeCategory = 'ACTIVE' | 'PROBATION' | 'INTERN' | 'NOTICE_PERIOD' | 'ALL';

export interface ResolvedAllocation {
  days: number;
  accrualType: 'UPFRONT' | 'MONTHLY';
  isProrata: boolean;
  category: EmployeeCategory;
  monthlyDays: number;
  basis: string; // human-readable explanation
}

interface EmployeeSnapshot {
  id: string;
  status: string;
  joiningDate: Date | null;
  organizationId: string;
  user: { role: string } | null;
}

// ─── Policy Engine ────────────────────────────────────────────────────────────

export class LeavePolicyService {

  // ── Category resolution ─────────────────────────────────────────────────────

  getEmployeeCategory(emp: Pick<EmployeeSnapshot, 'status' | 'user'>): EmployeeCategory {
    const role = emp.user?.role;
    if (role === 'INTERN' || emp.status === 'INTERN') return 'INTERN';
    if (emp.status === 'PROBATION') return 'PROBATION';
    if (emp.status === 'ACTIVE') return 'ACTIVE';
    if (emp.status === 'NOTICE_PERIOD') return 'NOTICE_PERIOD';
    return 'ALL';
  }

  // ── Prorata calculation ──────────────────────────────────────────────────────

  /**
   * Calculate prorated days based on the number of months remaining in the year
   * starting from `startMonth` (1-indexed).  Rounds to nearest 0.5.
   */
  calculateProrataDays(yearlyDays: number, startMonth: number): number {
    if (startMonth <= 1) return yearlyDays;
    const monthsRemaining = 12 - startMonth + 1;
    const raw = yearlyDays * (monthsRemaining / 12);
    return Math.round(raw * 2) / 2; // round to nearest 0.5
  }

  /**
   * Effective start month for a given year (1-indexed).
   * Returns 1 if the employee joined before this year.
   */
  private getStartMonth(emp: Pick<EmployeeSnapshot, 'joiningDate'>, year: number): number {
    if (!emp.joiningDate) return 1;
    const joined = new Date(emp.joiningDate);
    if (joined.getFullYear() < year) return 1;
    if (joined.getFullYear() > year) return 12;
    return joined.getMonth() + 1;
  }

  // ── Default policy bootstrap ─────────────────────────────────────────────────

  /**
   * Get or create the default leave policy for an org.
   * On first call, auto-creates a sensible policy with standard rules.
   */
  async getOrCreateDefaultPolicy(organizationId: string) {
    let policy = await prisma.leavePolicy.findFirst({
      where: { organizationId, isDefault: true, isActive: true, deletedAt: null },
      include: {
        rules: {
          include: {
            leaveType: { select: { id: true, name: true, code: true, isPaid: true, isActive: true } },
          },
        },
      },
    });

    if (!policy) {
      policy = await this._bootstrapDefaultPolicy(organizationId);
    }

    return policy;
  }

  private async _bootstrapDefaultPolicy(organizationId: string) {
    // Get active leave types for this org
    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true, isPaid: true, defaultBalance: true, applicableTo: true },
    });

    const clType = leaveTypes.find(lt => lt.code === 'CL' && !lt.name.toLowerCase().includes('probation'));
    const elType = leaveTypes.find(lt => lt.code === 'EL');
    const lwpType = leaveTypes.find(lt => lt.code === 'LWP');

    const rules: { leaveTypeId: string; employeeCategory: string; yearlyDays: number; monthlyDays: number; accrualType: string; isProrata: boolean; daysAllowed: number; isAllowed: boolean }[] = [];

    // CL: Active 10/year (prorata), Probation 1/month, Intern 1/month
    if (clType) {
      rules.push({ leaveTypeId: clType.id, employeeCategory: 'ACTIVE', yearlyDays: 10, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: true, daysAllowed: 10, isAllowed: true });
      rules.push({ leaveTypeId: clType.id, employeeCategory: 'PROBATION', yearlyDays: 0, monthlyDays: 1, accrualType: 'MONTHLY', isProrata: false, daysAllowed: 0, isAllowed: true });
      rules.push({ leaveTypeId: clType.id, employeeCategory: 'INTERN', yearlyDays: 0, monthlyDays: 1, accrualType: 'MONTHLY', isProrata: false, daysAllowed: 0, isAllowed: true });
    }

    // EL: Active 10/year (prorata)
    if (elType) {
      rules.push({ leaveTypeId: elType.id, employeeCategory: 'ACTIVE', yearlyDays: 10, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: true, daysAllowed: 10, isAllowed: true });
    }

    // LWP: ALL categories, unlimited (0 = allowed, balance not tracked)
    if (lwpType) {
      rules.push({ leaveTypeId: lwpType.id, employeeCategory: 'ALL', yearlyDays: 0, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: false, daysAllowed: 0, isAllowed: true });
    }

    // Any remaining leave types (SL, PL, custom) — mapped but disabled so history is preserved
    for (const lt of leaveTypes) {
      const alreadyMapped = rules.some(r => r.leaveTypeId === lt.id);
      if (!alreadyMapped) {
        rules.push({ leaveTypeId: lt.id, employeeCategory: 'ALL', yearlyDays: 0, monthlyDays: 0, accrualType: 'UPFRONT', isProrata: false, daysAllowed: 0, isAllowed: false });
      }
    }

    return prisma.leavePolicy.create({
      data: {
        name: 'Default Leave Policy',
        description: 'Auto-generated default policy. Edit allocation rules from Leave Management → Policy Settings.',
        organizationId,
        isDefault: true,
        isActive: true,
        probationDurationMonths: 3,
        internDurationMonths: 3,
        rules: { createMany: { data: rules } },
      },
      include: {
        rules: {
          include: {
            leaveType: { select: { id: true, name: true, code: true, isPaid: true, isActive: true } },
          },
        },
      },
    });
  }

  // ── Allocation resolution ────────────────────────────────────────────────────

  /**
   * Resolve the allocated days for an employee + leave type from the default policy.
   * Returns null if the leave type is not allowed for this employee's category.
   */
  async resolveAllocation(
    emp: EmployeeSnapshot,
    leaveTypeId: string,
    year: number,
  ): Promise<ResolvedAllocation | null> {
    const policy = await this.getOrCreateDefaultPolicy(emp.organizationId);
    return this._resolveFromPolicy(emp, leaveTypeId, year, policy);
  }

  _resolveFromPolicy(
    emp: EmployeeSnapshot,
    leaveTypeId: string,
    year: number,
    policy: { rules: any[]; probationDurationMonths: number; internDurationMonths: number },
  ): ResolvedAllocation | null {
    const category = this.getEmployeeCategory(emp);

    // Exact match first, then fall back to ALL
    const rule = policy.rules.find(r => r.leaveTypeId === leaveTypeId && r.employeeCategory === category)
      ?? policy.rules.find(r => r.leaveTypeId === leaveTypeId && r.employeeCategory === 'ALL');

    if (!rule || !rule.isAllowed) return null;

    const accrualType = (rule.accrualType || 'UPFRONT') as 'UPFRONT' | 'MONTHLY';

    if (accrualType === 'MONTHLY' && rule.monthlyDays > 0) {
      // Monthly: cap at policy duration (probation/intern period)
      const maxMonths = category === 'PROBATION'
        ? policy.probationDurationMonths
        : category === 'INTERN'
          ? policy.internDurationMonths
          : 12;
      const days = rule.monthlyDays * maxMonths;
      return {
        days,
        accrualType,
        isProrata: false,
        category,
        monthlyDays: rule.monthlyDays,
        basis: `${rule.monthlyDays} day/month × ${maxMonths} months (${category.toLowerCase()})`,
      };
    }

    // Upfront yearly
    let days = rule.yearlyDays || rule.daysAllowed || 0;

    if (rule.isProrata && emp.joiningDate) {
      const startMonth = this.getStartMonth(emp, year);
      if (startMonth > 1) {
        const proratedDays = this.calculateProrataDays(days, startMonth);
        return {
          days: proratedDays,
          accrualType,
          isProrata: true,
          category,
          monthlyDays: 0,
          basis: `${days}/year prorated from month ${startMonth} = ${proratedDays} days`,
        };
      }
    }

    return {
      days,
      accrualType,
      isProrata: false,
      category,
      monthlyDays: 0,
      basis: `${days} days/year (${category.toLowerCase()})`,
    };
  }

  // ── Bulk allocation for an employee ─────────────────────────────────────────

  /**
   * Allocate (or re-allocate) all applicable leave balances for an employee
   * based on the default policy. Safe to call multiple times — only creates
   * missing balances, does not overwrite existing ones unless `force` is true.
   */
  async allocateForEmployee(
    employeeId: string,
    year: number,
    options: { force?: boolean; triggeredBy?: string } = {},
  ): Promise<{ created: number; skipped: number; updated: number }> {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, status: true, joiningDate: true, organizationId: true, user: { select: { role: true } } },
    });
    if (!emp) return { created: 0, skipped: 0, updated: 0 };

    // Only eligible statuses should receive leave allocations
    const NON_ELIGIBLE = ['ONBOARDING', 'NOTICE_PERIOD', 'SUSPENDED', 'INACTIVE', 'TERMINATED', 'ABSCONDED'];
    if (NON_ELIGIBLE.includes(emp.status)) return { created: 0, skipped: 0, updated: 0 };

    const policy = await this.getOrCreateDefaultPolicy(emp.organizationId);
    const category = this.getEmployeeCategory(emp);

    // Rules applicable to this employee's category
    const applicableRules = policy.rules.filter(r =>
      (r.employeeCategory === category || r.employeeCategory === 'ALL') &&
      r.isAllowed &&
      r.leaveType?.isActive !== false,
    );

    let created = 0; let skipped = 0; let updated = 0;

    for (const rule of applicableRules) {
      const allocation = this._resolveFromPolicy(emp, rule.leaveTypeId, year, policy);
      if (!allocation || allocation.days < 0) { skipped++; continue; }

      const existing = await prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: rule.leaveTypeId, year } },
      });

      if (!existing) {
        await (prisma.leaveBalance.create as any)({
          data: {
            employeeId,
            leaveTypeId: rule.leaveTypeId,
            year,
            policyAllocated: allocation.days,
            manualAdjustment: 0,
            previousUsed: 0,
            allocated: allocation.days,
            used: 0,
            pending: 0,
            carriedForward: 0,
            organizationId: emp.organizationId,
          },
        });
        await this._logAllocation(employeeId, rule.leaveTypeId, policy.id || '', year, 'INITIAL', allocation.days, null, allocation, options.triggeredBy, emp.organizationId);
        created++;
      } else if (options.force) {
        // Update only policyAllocated; preserve manualAdjustment and other fields
        const prevPolicyAlloc = Number((existing as any).policyAllocated ?? existing.allocated);
        const manualAdj = Number((existing as any).manualAdjustment ?? 0);
        const newAllocated = allocation.days + manualAdj;
        if (prevPolicyAlloc !== allocation.days) {
          await (prisma.leaveBalance.update as any)({
            where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: rule.leaveTypeId, year } },
            data: {
              policyAllocated: allocation.days,
              allocated: newAllocated,
            },
          });
          await this._logAllocation(employeeId, rule.leaveTypeId, policy.id || '', year, 'POLICY_CHANGE', allocation.days, prevPolicyAlloc, allocation, options.triggeredBy, emp.organizationId);
          updated++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    return { created, skipped, updated };
  }

  // ── Prorata reallocation on status change ────────────────────────────────────

  /**
   * When an employee graduates from PROBATION → ACTIVE (or INTERN → ACTIVE),
   * recalculate their leave balance for the remainder of the year using the
   * ACTIVE prorata rules.  Adds to any existing balance (does not reset used days).
   */
  async applyProbationGraduation(
    employeeId: string,
    year: number,
    triggeredBy?: string,
  ): Promise<{ adjusted: { leaveTypeName: string; addedDays: number }[] }> {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, status: true, joiningDate: true, organizationId: true, user: { select: { role: true } } },
    });
    if (!emp) return { adjusted: [] };

    const policy = await this.getOrCreateDefaultPolicy(emp.organizationId);
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-indexed

    // Get ACTIVE rules only
    const activeRules = policy.rules.filter(r =>
      r.employeeCategory === 'ACTIVE' && r.isAllowed && r.leaveType?.isActive !== false,
    );

    const adjusted: { leaveTypeName: string; addedDays: number }[] = [];

    for (const rule of activeRules) {
      if (!rule.yearlyDays && !rule.daysAllowed) continue;
      const yearlyDays = rule.yearlyDays || rule.daysAllowed || 0;

      // Prorata from current month (graduation month)
      const proratedDays = this.calculateProrataDays(yearlyDays, currentMonth);
      if (proratedDays <= 0) continue;

      const existing = await prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: rule.leaveTypeId, year } },
      });

      if (existing) {
        const prevPolicyAlloc = Number((existing as any).policyAllocated ?? existing.allocated);
        const manualAdj = Number((existing as any).manualAdjustment ?? 0);
        const newPolicyAlloc = prevPolicyAlloc + proratedDays;
        const newAllocated = newPolicyAlloc + manualAdj;
        await (prisma.leaveBalance.update as any)({
          where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: rule.leaveTypeId, year } },
          data: {
            policyAllocated: newPolicyAlloc,
            allocated: newAllocated,
          },
        });
        await this._logAllocation(
          employeeId, rule.leaveTypeId, policy.id || '', year,
          'PRORATA', proratedDays, prevPolicyAlloc,
          { days: proratedDays, basis: `Prorated from month ${currentMonth} on probation graduation`, accrualType: 'UPFRONT', isProrata: true, category: 'ACTIVE', monthlyDays: 0 },
          triggeredBy, emp.organizationId,
        );
      } else {
        await (prisma.leaveBalance.create as any)({
          data: {
            employeeId, leaveTypeId: rule.leaveTypeId, year,
            policyAllocated: proratedDays,
            manualAdjustment: 0,
            previousUsed: 0,
            allocated: proratedDays, used: 0, pending: 0, carriedForward: 0,
            organizationId: emp.organizationId,
          },
        });
        await this._logAllocation(
          employeeId, rule.leaveTypeId, policy.id || '', year,
          'PRORATA', proratedDays, null,
          { days: proratedDays, basis: `Prorated from month ${currentMonth} on probation graduation`, accrualType: 'UPFRONT', isProrata: true, category: 'ACTIVE', monthlyDays: 0 },
          triggeredBy, emp.organizationId,
        );
      }

      adjusted.push({ leaveTypeName: rule.leaveType?.name || rule.leaveTypeId, addedDays: proratedDays });
    }

    return { adjusted };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _logAllocation(
    employeeId: string,
    leaveTypeId: string,
    policyId: string,
    year: number,
    allocationType: string,
    days: number,
    previousDays: number | null,
    allocation: Partial<ResolvedAllocation>,
    changedBy: string | undefined,
    organizationId: string,
  ) {
    try {
      await prisma.leaveAllocationLog.create({
        data: {
          employeeId,
          leaveTypeId,
          policyId: policyId || undefined,
          year,
          allocationType,
          days,
          previousDays: previousDays ?? undefined,
          reason: allocation.basis,
          calculationBasis: allocation as any,
          changedBy,
          organizationId,
        },
      });
    } catch (err) {
      logger.warn('[LeavePolicyService] Failed to write allocation log:', err);
    }
  }
}

export const leavePolicyService = new LeavePolicyService();
