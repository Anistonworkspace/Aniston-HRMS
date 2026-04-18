import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { aiService } from '../../services/ai.service.js';
import type { SalaryComponent, StatutoryConfig, SalaryStructureInput } from './payroll.validation.js';

// ────────────────────────────────────────────────────────────────────
// Configurable statutory calculations (replaces hardcoded logic)
// ────────────────────────────────────────────────────────────────────

interface StatutoryResult {
  epfEmployee: number;
  epfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  professionalTax: number;
  tds: number;
}

// Professional Tax slabs by Indian state (default: Maharashtra)
const PT_SLABS_BY_STATE: Record<string, { min: number; max: number; amount: number }[]> = {
  MAHARASHTRA: [
    { min: 0, max: 7500, amount: 0 },
    { min: 7501, max: 10000, amount: 175 },
    { min: 10001, max: Infinity, amount: 200 },
  ],
  KARNATAKA: [
    { min: 0, max: 15000, amount: 0 },
    { min: 15001, max: Infinity, amount: 200 },
  ],
  TELANGANA: [
    { min: 0, max: 15000, amount: 0 },
    { min: 15001, max: 20000, amount: 150 },
    { min: 20001, max: Infinity, amount: 200 },
  ],
  WEST_BENGAL: [
    { min: 0, max: 10000, amount: 0 },
    { min: 10001, max: 15000, amount: 110 },
    { min: 15001, max: 25000, amount: 130 },
    { min: 25001, max: 40000, amount: 150 },
    { min: 40001, max: Infinity, amount: 200 },
  ],
  TAMIL_NADU: [
    { min: 0, max: 21000, amount: 0 },
    { min: 21001, max: 30000, amount: 100 },
    { min: 30001, max: 45000, amount: 235 },
    { min: 45001, max: 60000, amount: 510 },
    { min: 60001, max: 75000, amount: 760 },
    { min: 75001, max: Infinity, amount: 1095 },
  ],
  // States with NO professional tax
  DELHI: [],
  RAJASTHAN: [],
  UTTAR_PRADESH: [],
  HARYANA: [],
  UTTARAKHAND: [],
};

const DEFAULT_STATUTORY: StatutoryConfig = {
  epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 },
  esi: { enabled: false, employeePercent: 0.75, employerPercent: 3.25, grossCap: 21000 },
  pt:  { enabled: false, slabs: PT_SLABS_BY_STATE.MAHARASHTRA },
};

interface StatutoryExemptions {
  epfExempt?: boolean;
  esiExempt?: boolean;
  ptExempt?: boolean;
}

function calculateStatutory(
  basicValue: number,
  grossMonthly: number,
  annualCTC: number,
  regime: string,
  config?: StatutoryConfig | null,
  exemptions?: StatutoryExemptions,
  /** Remaining months in the financial year for this employee — used to pro-rate TDS */
  remainingMonths?: number,
  /** Override PT state (from org.defaultPTState) when config has no slabs */
  ptStateOverride?: string,
): StatutoryResult {
  const cfg = { ...DEFAULT_STATUTORY, ...config };

  // ── EPF ────────────────────────────────────────────────────────────
  // EPF is calculated on basic salary (capped at ₹15,000), NOT on gross.
  // Skip if employee is exempt (e.g. interns, contract workers).
  let epfEmployee = 0, epfEmployer = 0;
  if (cfg.epf?.enabled && !exemptions?.epfExempt) {
    const cap = cfg.epf.basicCap ?? 15000;
    const epfBase = Math.min(basicValue, cap);
    epfEmployee = Math.round(epfBase * (cfg.epf.employeePercent ?? 12) / 100);
    epfEmployer = Math.round(epfBase * (cfg.epf.employerPercent ?? 12) / 100);
  }

  // ── ESI ────────────────────────────────────────────────────────────
  // ESI is calculated on gross salary; auto-excluded when gross > grossCap.
  // Skip if employee is permanently exempt.
  let esiEmployee = 0, esiEmployer = 0;
  if (cfg.esi?.enabled && !exemptions?.esiExempt) {
    const grossCap = cfg.esi.grossCap ?? 21000;
    if (grossMonthly <= grossCap) {
      esiEmployee = Math.round(grossMonthly * (cfg.esi.employeePercent ?? 0.75) / 100);
      esiEmployer = Math.round(grossMonthly * (cfg.esi.employerPercent ?? 3.25) / 100);
    }
  }

  // ── Professional Tax ───────────────────────────────────────────────
  // Slab varies by state. Skip if employee is exempt.
  let professionalTax = 0;
  if (cfg.pt?.enabled && !exemptions?.ptExempt) {
    // Use config slabs if available, else fall back to ptStateOverride or Maharashtra default
    let slabs = cfg.pt.slabs;
    if (!slabs?.length && ptStateOverride) {
      slabs = PT_SLABS_BY_STATE[ptStateOverride.toUpperCase()] ?? PT_SLABS_BY_STATE.MAHARASHTRA;
    }
    if (slabs?.length) {
      for (const slab of slabs) {
        if (grossMonthly >= slab.min && grossMonthly <= (slab.max === Infinity ? Number.MAX_SAFE_INTEGER : slab.max)) {
          professionalTax = slab.amount;
          break;
        }
      }
    } else {
      // Hard fallback: Maharashtra slabs
      if (grossMonthly > 10000) professionalTax = 200;
      else if (grossMonthly > 7500) professionalTax = 175;
    }
  }

  // ── TDS ────────────────────────────────────────────────────────────
  // Pro-rated across remaining financial year months for mid-year joiners/exits.
  const tds = calculateTDS(annualCTC, regime, remainingMonths);

  return { epfEmployee, epfEmployer, esiEmployee, esiEmployer, professionalTax, tds };
}

/**
 * Calculate monthly TDS.
 *
 * @param annualCTC - Annual gross salary used to project tax liability
 * @param regime - 'NEW_REGIME' | 'OLD_REGIME'
 * @param remainingMonths - Months left in the financial year for this employee (default 12).
 *   For mid-year joiners/exits, pass the actual count so TDS is spread correctly.
 */
function calculateTDS(annualCTC: number, regime: string, remainingMonths: number = 12): number {
  const months = Math.max(1, Math.round(remainingMonths)); // at least 1 month
  const taxable = annualCTC - 50000; // Standard deduction

  if (regime === 'NEW_REGIME') {
    let tax = 0;
    const slabs = [
      { limit: 300000, rate: 0 },
      { limit: 700000, rate: 0.05 },
      { limit: 1000000, rate: 0.10 },
      { limit: 1200000, rate: 0.15 },
      { limit: 1500000, rate: 0.20 },
      { limit: Infinity, rate: 0.30 },
    ];
    let remaining = Math.max(taxable, 0);
    let prevLimit = 0;
    for (const slab of slabs) {
      const slabAmount = Math.min(remaining, slab.limit - prevLimit);
      if (slabAmount <= 0) break;
      tax += slabAmount * slab.rate;
      remaining -= slabAmount;
      prevLimit = slab.limit;
    }
    tax = tax + Math.round(tax * 0.04); // 4% health & education cess
    if (taxable <= 700000) tax = 0;     // rebate u/s 87A
    return Math.round(tax / months);
  }

  // Old regime
  let tax = 0;
  const slabs = [
    { limit: 250000, rate: 0 },
    { limit: 500000, rate: 0.05 },
    { limit: 1000000, rate: 0.20 },
    { limit: Infinity, rate: 0.30 },
  ];
  let remaining = Math.max(taxable, 0);
  let prevLimit = 0;
  for (const slab of slabs) {
    const slabAmount = Math.min(remaining, slab.limit - prevLimit);
    if (slabAmount <= 0) break;
    tax += slabAmount * slab.rate;
    remaining -= slabAmount;
    prevLimit = slab.limit;
  }
  tax = tax + Math.round(tax * 0.04); // 4% cess
  if (taxable <= 500000) tax = 0;     // rebate u/s 87A
  return Math.round(tax / months);
}

/**
 * Count working days in a date range, respecting the org's workingDays CSV.
 * workingDays: '1,2,3,4,5,6' means Mon-Sat; '1,2,3,4,5' means Mon-Fri.
 */
function countWorkingDaysInRange(from: Date, to: Date, workingDayNums: Set<number>, holidayDates: Set<string>): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    const dow = cur.getDay();
    const ds = cur.toISOString().split('T')[0];
    if (workingDayNums.has(dow) && !holidayDates.has(ds)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Paid off-days: days that are NOT in workingDayNums (e.g. Sundays for a Mon-Sat org).
 * These are paid regardless — employees don't need to clock in on these days.
 */
function countPaidOffDaysInRange(from: Date, to: Date, workingDayNums: Set<number>): number {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    if (!workingDayNums.has(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Compute remaining months in the Indian financial year (Apr–Mar) from a given date.
 * Used for TDS pro-ration on mid-year joiners/exits.
 */
function remainingFinancialYearMonths(fromDate: Date): number {
  const m = fromDate.getMonth(); // 0-indexed
  const financialYearEnd = m >= 3 ? 3 : -9; // March of this FY or next
  const fyEndMonth = m >= 3 ? 3 + 12 : 3;   // months until next March
  // Simple: months from this month until March (inclusive)
  const monthsInFY = 12;
  const monthsPassed = m >= 3 ? m - 3 : m + 9; // months since April
  return Math.max(1, monthsInFY - monthsPassed);
}

// ────────────────────────────────────────────────────────────────────
// Component helpers
// ────────────────────────────────────────────────────────────────────

function sumComponentsByType(components: SalaryComponent[], type: 'earning' | 'deduction'): number {
  return components.filter(c => c.type === type).reduce((sum, c) => sum + c.value, 0);
}

function findComponent(components: SalaryComponent[], name: string): SalaryComponent | undefined {
  return components.find(c => c.name.toLowerCase() === name.toLowerCase());
}

/** Convert legacy fixed-column salary to components array */
function legacyToComponents(sal: any): SalaryComponent[] {
  const comps: SalaryComponent[] = [];
  const addEarning = (name: string, val: any) => {
    const v = Number(val || 0);
    if (v > 0) comps.push({ name, type: 'earning', value: v, isPercentage: false });
  };
  addEarning('Basic', sal.basic);
  addEarning('HRA', sal.hra);
  addEarning('DA', sal.da);
  addEarning('TA', sal.ta);
  addEarning('Medical Allowance', sal.medicalAllowance);
  addEarning('Special Allowance', sal.specialAllowance);
  addEarning('LTA', sal.lta);
  return comps;
}

/**
 * Canonical key map for otherEarnings — maps component names to well-known shorthand keys
 * consumed by the Excel exporter and the employee payslip UI.
 * Keys must stay in sync with payrollExcelExporter.ts and PayrollPage.tsx.
 */
const EARNINGS_KEY_MAP: Record<string, string> = {
  'da': 'da', 'dearness allowance': 'da',
  'ta': 'ta', 'transport allowance': 'ta', 'travelling allowance': 'ta',
  'medical allowance': 'medical', 'medical': 'medical',
  'special allowance': 'special', 'special': 'special',
  'lta': 'lta', 'leave travel allowance': 'lta', 'leave travel': 'lta',
  'sunday bonus': 'sundayBonus',
};

/** Normalize a component name to its canonical otherEarnings key */
function toEarningsKey(name: string): string {
  const lower = name.toLowerCase().trim();
  return EARNINGS_KEY_MAP[lower] ?? lower.replace(/\s+/g, '_');
}

/**
 * Build SalaryComponent[] from org's component master for "default" salary mode.
 * Computes values based on CTC/Basic using each component's calculationRule.
 * Includes both EARNING and DEDUCTION components from the master.
 */
function buildComponentsFromMaster(masterComps: any[], annualCtc: number): SalaryComponent[] {
  const monthly = annualCtc / 12;
  const activeComps = masterComps
    .filter((c: any) => c.isActive)
    .sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const earningComps = activeComps.filter((c: any) => c.type === 'EARNING');
  const deductionComps = activeComps.filter((c: any) => c.type === 'DEDUCTION');

  const result: SalaryComponent[] = [];

  // First pass: compute basic so PERCENTAGE_BASIC components can reference it
  let basicMonthly = 0;
  for (const mc of earningComps) {
    if (mc.code === 'BASIC') {
      const pct = mc.defaultPercentage ? Number(mc.defaultPercentage) : 50;
      basicMonthly = Math.round(monthly * pct / 100);
      break;
    }
  }
  if (basicMonthly === 0 && monthly > 0) basicMonthly = Math.round(monthly * 0.5);

  const calcValue = (mc: any): number => {
    if (mc.calculationRule === 'PERCENTAGE_CTC') {
      return Math.round(monthly * (mc.defaultPercentage ? Number(mc.defaultPercentage) : 0) / 100);
    }
    if (mc.calculationRule === 'PERCENTAGE_BASIC') {
      return Math.round(basicMonthly * (mc.defaultPercentage ? Number(mc.defaultPercentage) : 0) / 100);
    }
    return mc.defaultValue ? Number(mc.defaultValue) : 0;
  };

  for (const mc of earningComps) {
    const value = calcValue(mc);
    if (value > 0) {
      result.push({ name: mc.name, type: 'earning', value, isPercentage: mc.calculationRule !== 'FIXED' });
    }
  }

  // Non-statutory custom deductions from master (e.g. Loan Recovery).
  // Statutory deductions (EPF, ESI, PT) are handled by calculateStatutory — skip here to avoid double-counting.
  for (const mc of deductionComps) {
    if (mc.isStatutory) continue;
    const value = calcValue(mc);
    if (value > 0) {
      result.push({ name: mc.name, type: 'deduction', value, isPercentage: mc.calculationRule !== 'FIXED' });
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────
// Service
// ────────────────────────────────────────────────────────────────────

export class PayrollService {
  /**
   * Get salary structure for an employee
   */
  async getSalaryStructure(employeeId: string, organizationId: string) {
    const structure = await prisma.salaryStructure.findFirst({
      where: { employeeId, employee: { organizationId } },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    if (!structure) throw new NotFoundError('Salary structure');

    // Compute and attach calculated fields
    const components: SalaryComponent[] = (structure.components as SalaryComponent[] | null) || legacyToComponents(structure);
    const totalEarnings = sumComponentsByType(components, 'earning');
    const componentDeductions = sumComponentsByType(components, 'deduction');
    const basicComp = findComponent(components, 'Basic');
    const basicValue = basicComp?.value ?? Number(structure.basic || 0);

    const statutory = calculateStatutory(
      basicValue,
      totalEarnings,
      Number(structure.ctc),
      structure.incomeTaxRegime,
      { epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 }, esi: { enabled: false }, pt: { enabled: false } },
    );

    const totalDeductions = componentDeductions + statutory.epfEmployee + statutory.tds;

    return {
      ...structure,
      components,
      // Calculated fields
      monthlyGross: totalEarnings,
      totalDeductions,
      netTakeHome: totalEarnings - totalDeductions,
      statutory,
    };
  }

  /**
   * Create or update salary structure with dynamic components.
   *
   * Overwrite protection: if employee already has a salary and confirmOverwrite
   * is not true, returns a 409-style object requiring confirmation.
   *
   * Audit: records changedBy userId, changedByName snapshot, previousCtc, and
   * changeType (INITIAL / REVISION / PROMOTION / CORRECTION) in SalaryHistory.
   * Increments version on every revision.
   */
  async upsertSalaryStructure(
    employeeId: string,
    data: SalaryStructureInput & {
      effectiveFrom?: string;
      reason?: string;
      changeType?: string;
      confirmOverwrite?: boolean;
    },
    organizationId?: string,
    changedByUserId?: string,
  ) {
    const where = organizationId ? { id: employeeId, organizationId } : { id: employeeId };
    const employee = await prisma.employee.findFirst({ where, include: { salaryStructure: true } });
    if (!employee) throw new NotFoundError('Employee');

    // Overwrite protection — if salary exists and user did not confirm
    const existingStructure = employee.salaryStructure;
    if (existingStructure && !data.confirmOverwrite) {
      return {
        requiresConfirmation: true,
        currentCtc: Number(existingStructure.ctc),
        currentVersion: existingStructure.version,
        effectiveFrom: existingStructure.effectiveFrom,
        message: 'Employee already has a salary structure. Send confirmOverwrite: true to proceed.',
      };
    }

    const { ctcAnnual, components, incomeTaxRegime, statutoryConfig, isCustom } = data as any;
    const regime = incomeTaxRegime || 'NEW_REGIME';

    // Compute totals from components
    const totalEarnings = sumComponentsByType(components, 'earning');
    const componentDeductions = sumComponentsByType(components, 'deduction');
    const basicComp = findComponent(components, 'Basic');
    const basicValue = basicComp?.value ?? 0;

    // Check locked fields — prevent editing locked components if salary has template locks
    if (existingStructure?.lockedFields) {
      const locked = existingStructure.lockedFields as string[];
      if (locked.length > 0) {
        // Locked fields check: warn only, don't block (template apply handles strict enforcement)
      }
    }

    // Calculate configurable statutory deductions
    const statutory = calculateStatutory(basicValue, totalEarnings, ctcAnnual, regime, statutoryConfig);

    // Also write legacy columns for backward compat with payroll processing & PDF export
    const hraComp = findComponent(components, 'HRA');
    const daComp = findComponent(components, 'DA');
    const taComp = findComponent(components, 'TA');
    const medComp = findComponent(components, 'Medical Allowance');
    const specComp = findComponent(components, 'Special Allowance');
    const ltaComp = findComponent(components, 'LTA');

    const effectiveDate = data.effectiveFrom ? new Date(data.effectiveFrom) : new Date();
    const currentVersion = existingStructure?.version ?? 0;

    const upsertData = {
      ctc: ctcAnnual,
      isCustom: isCustom ?? false,
      components: components as any,
      statutoryConfig: statutoryConfig as any || undefined,
      basic: basicValue || null,
      hra: hraComp?.value ?? null,
      da: daComp?.value ?? null,
      ta: taComp?.value ?? null,
      medicalAllowance: medComp?.value ?? null,
      specialAllowance: specComp?.value ?? null,
      lta: ltaComp?.value ?? null,
      pfEmployee: statutory.epfEmployee,
      pfEmployer: statutory.epfEmployer,
      esiEmployee: statutory.esiEmployee,
      esiEmployer: statutory.esiEmployer,
      professionalTax: statutory.professionalTax,
      tds: statutory.tds,
      incomeTaxRegime: regime as any,
      effectiveFrom: effectiveDate,
    };

    const structure = await prisma.salaryStructure.upsert({
      where: { employeeId },
      create: { employeeId, ...upsertData, version: 1 },
      update: { ...upsertData, version: currentVersion + 1 },
    });

    // Update CTC on employee record
    await prisma.employee.update({ where: { id: employeeId }, data: { ctc: ctcAnnual } });

    // Save salary history with proper audit trail
    try {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { organizationId: true } });
      if (emp) {
        const existingHistory = await prisma.salaryHistory.findFirst({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
        const changeType = data.changeType || (existingHistory ? 'REVISION' : 'INITIAL');
        const previousCtc = existingStructure ? Number(existingStructure.ctc) : null;

        // Resolve user name for audit snapshot
        let changedByName: string | undefined;
        const userId = changedByUserId || 'system';
        if (changedByUserId) {
          const user = await prisma.user.findUnique({
            where: { id: changedByUserId },
            select: { email: true, employee: { select: { firstName: true, lastName: true } } },
          });
          changedByName = user?.employee
            ? `${user.employee.firstName} ${user.employee.lastName}`
            : user?.email || undefined;
        }

        await this.saveSalaryHistory(
          employeeId,
          { ctc: ctcAnnual, components, basic: basicValue, hra: hraComp?.value, da: daComp?.value, ta: taComp?.value, medicalAllowance: medComp?.value, specialAllowance: specComp?.value, lta: ltaComp?.value },
          changeType,
          data.reason,
          userId,
          emp.organizationId,
          previousCtc,
          changedByName,
        );
      }
    } catch { /* non-blocking */ }

    // Audit log
    if (changedByUserId && organizationId) {
      await createAuditLog({
        userId: changedByUserId,
        organizationId,
        entity: 'SalaryStructure',
        entityId: structure.id,
        action: existingStructure ? 'UPDATE' : 'CREATE',
        oldValue: existingStructure ? { ctc: Number(existingStructure.ctc), version: existingStructure.version } : undefined,
        newValue: { ctc: ctcAnnual, version: structure.version, effectiveFrom: effectiveDate.toISOString() },
      });
    }

    // Return with calculated fields
    const totalDeductions = componentDeductions + statutory.epfEmployee + statutory.esiEmployee + statutory.professionalTax + statutory.tds;
    return {
      ...structure,
      components,
      monthlyGross: totalEarnings,
      totalDeductions,
      netTakeHome: totalEarnings - totalDeductions,
      statutory,
    };
  }

  /**
   * Legacy upsert — accepts old flat structure (for bulk import compatibility)
   */
  async upsertSalaryStructureLegacy(employeeId: string, data: {
    ctc: number; basic: number; hra: number;
    da?: number; ta?: number; medicalAllowance?: number;
    specialAllowance?: number; lta?: number; incomeTaxRegime?: string;
  }, organizationId?: string) {
    // Convert to new component format
    const components: SalaryComponent[] = [];
    const add = (name: string, val: number | undefined) => {
      if (val && val > 0) components.push({ name, type: 'earning', value: val, isPercentage: false });
    };
    add('Basic', data.basic);
    add('HRA', data.hra);
    add('DA', data.da);
    add('TA', data.ta);
    add('Medical Allowance', data.medicalAllowance);
    add('Special Allowance', data.specialAllowance);
    add('LTA', data.lta);

    return this.upsertSalaryStructure(employeeId, {
      ctcAnnual: data.ctc,
      components,
      incomeTaxRegime: (data.incomeTaxRegime as 'OLD_REGIME' | 'NEW_REGIME') || undefined,
    }, organizationId);
  }

  /**
   * Initiate a payroll run
   */
  async createPayrollRun(month: number, year: number, organizationId: string, initiatedBy: string) {
    const existing = await prisma.payrollRun.findUnique({
      where: { month_year_organizationId: { month, year, organizationId } },
    });
    if (existing) throw new BadRequestError(`Payroll run already exists for ${month}/${year}`);

    const run = await prisma.payrollRun.create({
      data: { month, year, status: 'DRAFT', processedBy: initiatedBy, organizationId },
    });

    await createAuditLog({
      userId: initiatedBy, organizationId,
      entity: 'PayrollRun', entityId: run.id,
      action: 'CREATE', newValue: { month, year, status: 'DRAFT' },
    });

    return run;
  }

  /**
   * Process payroll — calculate payslips for all active employees
   * Now uses dynamic components when available, falls back to legacy columns
   */
  async processPayroll(runId: string, organizationId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Payroll run');
    if (run.status !== 'DRAFT') throw new BadRequestError('Payroll can only be processed from DRAFT status');

    // Fetch org-level payroll defaults (PT state, tax regime, working days)
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workingDays: true, defaultPTState: true, defaultTaxRegime: true },
    });
    const orgWorkingDaysStr = org?.workingDays ?? '1,2,3,4,5,6';
    const orgWorkingDayNums = new Set(orgWorkingDaysStr.split(',').map(Number));
    const orgDefaultPTState = (org as any)?.defaultPTState ?? 'MAHARASHTRA';
    const orgDefaultTaxRegime = (org as any)?.defaultTaxRegime ?? 'NEW_REGIME';

    // Only process employees with an active working status.
    // SUSPENDED, TERMINATED, INACTIVE, ABSCONDED employees are excluded.
    const employees = await prisma.employee.findMany({
      where: {
        organizationId,
        status: { in: ['ONBOARDING', 'ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] as any[] },
        deletedAt: null,
        isSystemAccount: { not: true },
      },
      include: { salaryStructure: true },
    });

    if (employees.length === 0) {
      throw new BadRequestError('No active employees found in this organization to process payroll for.');
    }

    // Pre-fetch component master once — used for both auto-create (F5) and payroll calculation
    const componentMasterAll = await prisma.salaryComponentMaster.findMany({
      where: { organizationId, deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // ── F5: Auto-create SalaryStructure for employees who have CTC set on their
    //        Employee record but no SalaryStructure row yet. Uses component master
    //        to compute the breakdown so nothing is stored manually.
    for (const emp of employees) {
      if (emp.salaryStructure) continue;                        // already has structure
      const ctcVal = Number((emp as any).ctc || 0);
      if (ctcVal <= 0) continue;                               // no CTC on employee record either
      if (componentMasterAll.length === 0) continue;           // no component master configured

      const autoComponents = buildComponentsFromMaster(componentMasterAll, ctcVal);
      if (autoComponents.length === 0) continue;               // master produced nothing

      const basicComp = findComponent(autoComponents, 'Basic');
      const hraComp   = findComponent(autoComponents, 'HRA');
      const daComp    = findComponent(autoComponents, 'DA');
      const taComp    = findComponent(autoComponents, 'TA');
      const medComp   = findComponent(autoComponents, 'Medical Allowance');
      const specComp  = findComponent(autoComponents, 'Special Allowance');
      const ltaComp   = findComponent(autoComponents, 'LTA');
      const totalEar  = sumComponentsByType(autoComponents, 'earning');
      const basicVal  = basicComp?.value ?? 0;
      const stat      = calculateStatutory(basicVal, totalEar, ctcVal, 'NEW_REGIME',
        { epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 }, esi: { enabled: false }, pt: { enabled: false } });

      try {
        const created = await prisma.salaryStructure.create({
          data: {
            employeeId:      emp.id,
            ctc:             ctcVal,
            isCustom:        false,
            components:      autoComponents as any,
            basic:           basicVal   || null,
            hra:             hraComp?.value  ?? null,
            da:              daComp?.value   ?? null,
            ta:              taComp?.value   ?? null,
            medicalAllowance: medComp?.value ?? null,
            specialAllowance: specComp?.value ?? null,
            lta:             ltaComp?.value  ?? null,
            pfEmployee:      stat.epfEmployee,
            pfEmployer:      stat.epfEmployer,
            esiEmployee:     stat.esiEmployee,
            esiEmployer:     stat.esiEmployer,
            professionalTax: stat.professionalTax,
            tds:             stat.tds,
            incomeTaxRegime: 'NEW_REGIME',
            effectiveFrom:   new Date(),
            version:         1,
          },
        });
        // Attach to in-memory employee object so payroll loop picks it up
        (emp as any).salaryStructure = created;
      } catch {
        // If create fails (e.g. duplicate key race), re-fetch
        (emp as any).salaryStructure = await prisma.salaryStructure.findFirst({ where: { employeeId: emp.id } });
      }
    }

    // ── F1: Guard — block processing if still no employees have salary structures
    const withSalary    = employees.filter(e => e.salaryStructure);
    const missingSalary = employees.filter(e => !e.salaryStructure);
    if (withSalary.length === 0) {
      const names = missingSalary.map(e => `${(e as any).firstName} ${(e as any).lastName} (${(e as any).employeeCode})`);
      throw new BadRequestError(
        `Cannot process payroll — no salary structure found for any employee. ` +
        `Please set CTC for: ${names.slice(0, 5).join(', ')}` +
        (names.length > 5 ? ` and ${names.length - 5} more.` : '.')
      );
    }

    // Pre-fetch attendance data in batch
    const startDate = new Date(run.year, run.month - 1, 1);
    const endDate = new Date(run.year, run.month, 0);

    // Fetch holidays FIRST so totalWorkingDays excludes them — keeps the pro-ration
    // denominator consistent with empWorkingDays (which also excludes holidays).
    // Without this, a month with 1 holiday gives ratio = 25/26 = 0.96 for full-month
    // employees instead of the correct 1.0.
    const holidaysEarly = await prisma.holiday.findMany({
      where: { organizationId, date: { gte: startDate, lte: endDate } },
      select: { date: true },
    }).catch(() => []);
    const holidayDatesEarly = new Set(holidaysEarly.map(h => new Date(h.date).toISOString().split('T')[0]));

    const totalWorkingDays = countWorkingDaysInRange(startDate, endDate, orgWorkingDayNums, holidayDatesEarly);
    const empIds = employees.filter(e => e.salaryStructure).map(e => e.id);

    const allAttendance = await prisma.attendanceRecord.findMany({
      where: { employeeId: { in: empIds }, date: { gte: startDate, lte: endDate } },
      select: { employeeId: true, date: true, status: true },
    });

    const attendanceByEmp = new Map<string, typeof allAttendance>();
    for (const rec of allAttendance) {
      if (!attendanceByEmp.has(rec.employeeId)) attendanceByEmp.set(rec.employeeId, []);
      attendanceByEmp.get(rec.employeeId)!.push(rec);
    }

    // Pre-fetch approved leave requests for LOP calculation
    const allLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: empIds },
        // Include all terminal-approved statuses so manager-approved leaves reduce LOP
        status: { in: ['APPROVED', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'] as any[] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { employeeId: true, startDate: true, endDate: true, leaveType: { select: { isPaid: true } } },
    });

    const paidLeaveDatesByEmp = new Map<string, Set<string>>();
    for (const leave of allLeaves) {
      if (!leave.leaveType?.isPaid) continue;
      if (!paidLeaveDatesByEmp.has(leave.employeeId)) paidLeaveDatesByEmp.set(leave.employeeId, new Set());
      const dates = paidLeaveDatesByEmp.get(leave.employeeId)!;
      const current = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      while (current <= end) {
        dates.add(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
    }

    // Pre-fetch APPROVED adjustments for this run
    const allAdjustments = await prisma.payrollAdjustment.findMany({
      where: { payrollRunId: runId, approvalStatus: 'APPROVED' },
    });
    const adjustmentsByEmp = new Map<string, typeof allAdjustments>();
    for (const adj of allAdjustments) {
      if (!adjustmentsByEmp.has(adj.employeeId)) adjustmentsByEmp.set(adj.employeeId, []);
      adjustmentsByEmp.get(adj.employeeId)!.push(adj);
    }

    // Reuse holiday set fetched earlier (before totalWorkingDays)
    const holidayDates = holidayDatesEarly;

    // componentMasterAll was already fetched above for F5 auto-create; reuse it here
    const componentMaster = componentMasterAll;

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.payrollRun.update({ where: { id: runId }, data: { status: 'PROCESSING' } });

        let totalGross = 0;
        let totalNet = 0;
        let totalDeductions = 0;

        for (const emp of employees) {
          if (!emp.salaryStructure) continue;
          const sal = emp.salaryStructure;
          const empAttendance = attendanceByEmp.get(emp.id) || [];
          const paidLeaveDates = paidLeaveDatesByEmp.get(emp.id) || new Set<string>();
          const empAdjustments = adjustmentsByEmp.get(emp.id) || [];

          // ── Determine the employee's effective work period for this month ──────
          // Pro-ration uses onboardingDate (HRMS registration date) rather than
          // joiningDate (contractual). This matters for pre-existing employees who
          // were added to the system later — their contractual date may predate HRMS.
          // Falls back to joiningDate only when onboardingDate is not set.
          // Mid-month exit: only count up to lastWorkingDate.
          let effectiveStart = new Date(startDate);
          let effectiveEnd   = new Date(endDate);

          const joiningDate     = (emp as any).joiningDate     ? new Date((emp as any).joiningDate)     : null;
          const onboardingDate  = (emp as any).onboardingDate  ? new Date((emp as any).onboardingDate)  : null;
          const lastWorkingDate = (emp as any).lastWorkingDate ? new Date((emp as any).lastWorkingDate) : null;

          // Use onboardingDate for payroll start; fall back to joiningDate
          const payrollStartDate = onboardingDate ?? joiningDate;
          if (payrollStartDate && payrollStartDate > startDate && payrollStartDate <= endDate) {
            effectiveStart = new Date(payrollStartDate);
            effectiveStart.setHours(0, 0, 0, 0);
          }
          // If employee's last working date is this month, salary ends on that day
          if (lastWorkingDate && lastWorkingDate >= startDate && lastWorkingDate < endDate) {
            effectiveEnd = new Date(lastWorkingDate);
            effectiveEnd.setHours(0, 0, 0, 0);
          }

          // Effective working days for this employee (used for pro-ration)
          const empWorkingDays = countWorkingDaysInRange(effectiveStart, effectiveEnd, orgWorkingDayNums, holidayDates);
          // Pro-ration ratio: 1.0 for full-month employees; < 1.0 for partial-month
          const proRationRatio = totalWorkingDays > 0 ? empWorkingDays / totalWorkingDays : 1;

          const presentRecords = empAttendance.filter(r => r.status === 'PRESENT');
          const absentRecords  = empAttendance.filter(r => r.status === 'ABSENT');
          const halfDayRecords = empAttendance.filter(r => r.status === 'HALF_DAY');

          // Build a set of every date that has ANY attendance record for this employee.
          const datesWithRecord = new Set(
            empAttendance.map(r => new Date(r.date).toISOString().split('T')[0])
          );

          // ── LOP calculation (3-layer, within effective period) ──────────────
          // Layer 1: explicit ABSENT records not covered by paid leave / holiday
          let lopDays = 0;
          for (const rec of absentRecords) {
            const recDate = new Date(rec.date);
            if (recDate < effectiveStart || recDate > effectiveEnd) continue; // outside effective period
            const ds = recDate.toISOString().split('T')[0];
            if (!paidLeaveDates.has(ds) && !holidayDates.has(ds)) lopDays++;
          }

          // Layer 2: half-days contribute 0.5 LOP each — unless covered by paid leave.
          // (e.g. employee takes a half-day paid leave: HALF_DAY attendance + approved leave
          // for the same date → only 0 LOP, not 0.5)
          for (const rec of halfDayRecords) {
            const recDate = new Date(rec.date);
            if (recDate >= effectiveStart && recDate <= effectiveEnd) {
              const ds = recDate.toISOString().split('T')[0];
              if (!paidLeaveDates.has(ds)) lopDays += 0.5;
            }
          }

          // Layer 3: working days (per org schedule) with NO record, not on paid leave, not holiday
          // — scan only within the employee's effective period
          const scanDay = new Date(effectiveStart);
          while (scanDay <= effectiveEnd) {
            const dow = scanDay.getDay();
            if (orgWorkingDayNums.has(dow)) { // only working days per org schedule
              const ds = scanDay.toISOString().split('T')[0];
              if (!holidayDates.has(ds) && !paidLeaveDates.has(ds) && !datesWithRecord.has(ds)) {
                lopDays++; // implicit absent
              }
            }
            scanDay.setDate(scanDay.getDate() + 1);
          }

          // Layer 4: ON_LEAVE attendance records NOT covered by a paid leave approval.
          // When an employee takes unpaid leave, the leave service creates an ON_LEAVE
          // attendance record. Layer 3 skips days that have a record; Layer 1 only catches
          // ABSENT records — so without this layer, unpaid leave silently escapes LOP.
          const onLeaveRecords = empAttendance.filter(r => r.status === 'ON_LEAVE');
          for (const rec of onLeaveRecords) {
            const recDate = new Date(rec.date);
            if (recDate < effectiveStart || recDate > effectiveEnd) continue;
            const ds = recDate.toISOString().split('T')[0];
            if (!paidLeaveDates.has(ds) && !holidayDates.has(ds)) lopDays++; // unpaid ON_LEAVE = LOP
          }

          // Paid off-days worked (e.g. Sundays for Mon-Sat org) — earn a bonus
          const paidOffDaysWorked = presentRecords.filter(r => {
            const d = new Date(r.date);
            return !orgWorkingDayNums.has(d.getDay()) && d >= effectiveStart && d <= effectiveEnd;
          }).length;

          // presentDays: count from month start (not effectiveStart) so HR-backdated
          // attendance records created before the onboardingDate are included.
          // LOP scan still uses effectiveStart — no penalty for pre-onboarding gaps.
          const presentDays =
            presentRecords.filter(r => { const d = new Date(r.date); return d >= startDate && d <= effectiveEnd; }).length
            + halfDayRecords.filter(r => { const d = new Date(r.date); return d >= startDate && d <= effectiveEnd; }).length * 0.5;

          // ── Salary components ─────────────────────────────────────────────────
          let components: SalaryComponent[];
          if (((sal as any).isCustom ?? false) === false && componentMaster.length > 0) {
            // Default employees: re-compute from master at payroll time so master
            // changes are automatically picked up, then pro-rate for partial month
            const fullMonthComponents = buildComponentsFromMaster(componentMaster, Number(sal.ctc));
            if (proRationRatio < 1) {
              // Scale each component value proportionally
              components = fullMonthComponents.map(c => ({ ...c, value: Math.round(c.value * proRationRatio) }));
            } else {
              components = fullMonthComponents;
            }
          } else {
            const rawComponents = (sal.components as SalaryComponent[] | null) || legacyToComponents(sal);
            if (proRationRatio < 1) {
              components = rawComponents.map(c => ({ ...c, value: Math.round(c.value * proRationRatio) }));
            } else {
              components = rawComponents;
            }
          }
          const earningsTotal      = sumComponentsByType(components, 'earning');
          const componentDeductions = sumComponentsByType(components, 'deduction');

          const dailyRate        = empWorkingDays > 0 ? earningsTotal / empWorkingDays : 0;
          const rawLopDeduction  = Math.round(dailyRate * lopDays);
          const paidOffBonus     = Math.round(dailyRate * paidOffDaysWorked); // e.g. Sunday bonus for Mon-Sat org

          // ── Statutory deductions ─────────────────────────────────────────────
          // Per-employee exemption flags take precedence over org defaults.
          const exemptions: StatutoryExemptions = {
            epfExempt: (emp as any).epfExempt === true,
            esiExempt: (emp as any).esiExempt === true,
            ptExempt:  (emp as any).ptExempt  === true,
          };

          // Determine tax regime: employee choice > salary structure > org default
          const taxRegime: string = (emp as any).incomeTaxRegimeChoice
            ?? sal.incomeTaxRegime
            ?? orgDefaultTaxRegime;

          // Pro-rate TDS: spread tax over remaining financial-year months from the employee's
          // actual start date. run.processedAt is NULL during DRAFT status, so never use it
          // as the base — it would silently fall back to month start instead of joining date.
          const tdsBaseDate = joiningDate && joiningDate > startDate ? joiningDate : startDate;
          const tdsMonths = remainingFinancialYearMonths(tdsBaseDate);

          // Statutory config: EPF always on; ESI and PT always off (component-master-driven payroll)
          const statutoryConfig: StatutoryConfig = {
            epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 },
            esi: { enabled: false },
            pt:  { enabled: false },
          };

          let recEpfEmployee: number, recEpfEmployer: number;
          let recEsiEmployee: number, recEsiEmployer: number;
          let recProfTax: number, recTds: number;

          const basicComp2 = findComponent(components, 'Basic') || findComponent(components, 'Basic Salary');
          const basicVal2  = basicComp2?.value ?? 0;

          if (((sal as any).isCustom ?? false) === false && componentMaster.length > 0) {
            // Default employee: compute live from components + exemptions
            const stat = calculateStatutory(
              basicVal2, earningsTotal, Number(sal.ctc) * proRationRatio,
              taxRegime, statutoryConfig, exemptions, tdsMonths, orgDefaultPTState
            );
            recEpfEmployee = stat.epfEmployee;
            recEpfEmployer = stat.epfEmployer;
            recEsiEmployee = stat.esiEmployee;
            recEsiEmployer = stat.esiEmployer;
            recProfTax     = stat.professionalTax;
            recTds         = stat.tds;
          } else {
            // Custom salary: use stored statutory values, pro-rated for partial months, with exemptions.
            if (exemptions.epfExempt) {
              recEpfEmployee = 0; recEpfEmployer = 0;
            } else {
              // EPF is % of basic — scale by pro-ration ratio so mid-month joiners/exits
              // don't pay a full month's EPF on a partial-month gross.
              recEpfEmployee = Math.round(Number(sal.pfEmployee || 0) * proRationRatio);
              recEpfEmployer = Math.round(Number(sal.pfEmployer || 0) * proRationRatio);
            }
            if (exemptions.esiExempt) {
              recEsiEmployee = 0; recEsiEmployer = 0;
            } else {
              // ESI is % of gross — same pro-ration applies.
              recEsiEmployee = Math.round(Number(sal.esiEmployee || 0) * proRationRatio);
              recEsiEmployer = Math.round(Number(sal.esiEmployer || 0) * proRationRatio);
            }
            // PT: fixed monthly slab amount — NOT pro-rated (standard Indian payroll practice).
            recProfTax = exemptions.ptExempt ? 0 : Number(sal.professionalTax || 0);
            // TDS: re-computed with regime choice + pro-ration even for custom employees.
            recTds = calculateTDS(Number(sal.ctc) * proRationRatio, taxRegime, tdsMonths);
          }

          const statutoryDeductions = recEpfEmployee + recEsiEmployee + recProfTax + recTds;

          // ── Adjustments ───────────────────────────────────────────────────────
          let adjustmentAdditions = 0, adjustmentDeductions = 0;
          const adjustmentSnapshot: any[] = [];
          for (const adj of empAdjustments) {
            const amount = Number(adj.amount);
            if (adj.isDeduction) adjustmentDeductions += amount;
            else adjustmentAdditions += amount;
            adjustmentSnapshot.push({ type: adj.type, componentName: adj.componentName, amount, isDeduction: adj.isDeduction, reason: adj.reason });
          }

          const adjustedGross = earningsTotal + paidOffBonus + adjustmentAdditions;
          const deductions    = componentDeductions + statutoryDeductions + adjustmentDeductions;
          // Cap LOP so it never exceeds what's left after statutory deductions.
          // Without this, payroll records show lopDeduction > netSalary, which is
          // misleading and makes Excel reconciliation impossible.
          const maxLop        = Math.max(0, adjustedGross - deductions);
          const lopDeduction  = Math.min(rawLopDeduction, maxLop);
          const netSalary     = Math.max(adjustedGross - deductions - lopDeduction, 0);

          // ── Bank details check ────────────────────────────────────────────────
          if (netSalary > 0 && !((emp as any).bankAccountNumber && (emp as any).ifscCode)) {
            console.warn(`[Payroll] Employee ${(emp as any).employeeCode} has no bank details — salary of ₹${netSalary} cannot be transferred.`);
          }

          // ── Earnings / deductions breakdown ───────────────────────────────────
          const earningsBreakdown: Record<string, number> = {};
          const deductionsBreakdown: Record<string, number> = {};
          for (const comp of components) {
            if (comp.type === 'earning') earningsBreakdown[comp.name] = comp.value;
            else deductionsBreakdown[comp.name] = comp.value;
          }
          if (paidOffBonus > 0) earningsBreakdown['Sunday Bonus'] = paidOffBonus;
          for (const adj of empAdjustments) {
            if (!adj.isDeduction) earningsBreakdown[`Adj: ${adj.componentName}`] = Number(adj.amount);
            else deductionsBreakdown[`Adj: ${adj.componentName}`] = Number(adj.amount);
          }
          if (proRationRatio < 1) {
            earningsBreakdown['_proRation'] = Math.round(proRationRatio * 100) / 100;
          }

          const otherEarnings: Record<string, number> = { sundayBonus: paidOffBonus, sundaysWorked: paidOffDaysWorked };
          for (const comp of components) {
            if (comp.type === 'earning' && !['Basic', 'HRA', 'Basic Salary', 'House Rent Allowance'].includes(comp.name)) {
              otherEarnings[toEarningsKey(comp.name)] = comp.value;
            }
          }
          if (adjustmentAdditions > 0) otherEarnings.adjustmentAdditions = adjustmentAdditions;

          const basicComp = findComponent(components, 'Basic') || findComponent(components, 'Basic Salary');
          const hraComp   = findComponent(components, 'HRA')   || findComponent(components, 'House Rent Allowance');

          // Guard: delete any existing record before creating (no @@unique on schema,
          // so re-processing the same run would otherwise create duplicate rows).
          await tx.payrollRecord.deleteMany({ where: { payrollRunId: runId, employeeId: emp.id } });

          await tx.payrollRecord.create({
            data: {
              payrollRunId:    runId,
              employeeId:      emp.id,
              grossSalary:     adjustedGross,
              netSalary,
              basic:           basicComp?.value ?? Number(sal.basic || 0),
              hra:             hraComp?.value   ?? Number(sal.hra   || 0),
              otherEarnings,
              epfEmployee:     recEpfEmployee,
              epfEmployer:     recEpfEmployer,
              esiEmployee:     recEsiEmployee,
              esiEmployer:     recEsiEmployer,
              professionalTax: recProfTax,
              tds:             recTds,
              otherDeductions: componentDeductions + adjustmentDeductions > 0
                ? { customDeductions: componentDeductions, adjustmentDeductions }
                : undefined,
              lopDays,          // now stored as Decimal — no rounding loss
              lopDeduction,
              workingDays:     empWorkingDays,   // employee's actual working days (not full month if mid-joiner/exit)
              presentDays,      // Decimal — half-days preserved
              adjustments:     adjustmentSnapshot.length > 0 ? adjustmentSnapshot : undefined,
              earningsBreakdown,
              deductionsBreakdown,
            },
          });

          totalGross      += adjustedGross;
          totalNet        += netSalary;
          totalDeductions += deductions + lopDeduction;
        }

        const processed = employees.filter((e) => e.salaryStructure).length;

        // F1: If somehow still 0 records were created inside the transaction, revert
        if (processed === 0) {
          await tx.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT' } });
          const names = employees.map(e => `${(e as any).firstName} ${(e as any).lastName} (${(e as any).employeeCode})`);
          throw new BadRequestError(
            `Payroll processed 0 employees. No salary structures or CTC values found. ` +
            `Please set up salary for: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}.`
          );
        }

        await tx.payrollRun.update({
          where: { id: runId },
          data: { status: 'COMPLETED', processedAt: new Date(), totalGross, totalNet, totalDeductions },
        });

        return { processed, totalGross, totalNet, totalDeductions, missingSalary: missingSalary.map(e => `${(e as any).firstName} ${(e as any).lastName}`) };
      }, { timeout: 120000 });

      await createAuditLog({
        userId: run.processedBy || 'system', organizationId,
        entity: 'PayrollRun', entityId: runId,
        action: 'UPDATE',
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'COMPLETED', totalGross: result.totalGross, totalNet: result.totalNet, totalDeductions: result.totalDeductions },
      });

      return result;
    } catch (err) {
      await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT' } }).catch(() => {});
      throw err;
    }
  }

  /**
   * Pre-flight check — returns employee readiness before processing payroll
   * Ready   = has SalaryStructure OR has ctc > 0 on Employee (auto-create eligible)
   * Missing = no salary structure and no CTC set — must be configured manually
   */
  async getPayrollPreflight(organizationId: string) {
    const [employees, componentMaster] = await Promise.all([
      prisma.employee.findMany({
        where: {
          organizationId,
          status: { notIn: ['TERMINATED', 'INACTIVE', 'ABSCONDED'] },
          deletedAt: null,
          isSystemAccount: { not: true },
        },
        include: {
          salaryStructure: { select: { id: true, ctc: true, isCustom: true, effectiveFrom: true } },
          department: { select: { name: true } },
        },
        orderBy: { firstName: 'asc' },
      }),
      prisma.salaryComponentMaster.findMany({
        where: { organizationId, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    const ready: any[] = [];
    const autoCreatable: any[] = [];
    const missing: any[] = [];

    for (const emp of employees) {
      const row = {
        id: emp.id,
        name: `${(emp as any).firstName} ${(emp as any).lastName}`,
        employeeCode: (emp as any).employeeCode,
        department: (emp as any).department?.name || '—',
        ctc: emp.salaryStructure ? Number(emp.salaryStructure.ctc) : Number((emp as any).ctc || 0),
        hasSalaryStructure: !!emp.salaryStructure,
        hasCtc: Number((emp as any).ctc || 0) > 0,
      };
      if (emp.salaryStructure) {
        ready.push({ ...row, source: 'saved' });
      } else if (Number((emp as any).ctc || 0) > 0 && componentMaster.length > 0) {
        autoCreatable.push({ ...row, source: 'auto-create' });
      } else {
        missing.push({ ...row, source: 'missing' });
      }
    }

    return {
      totalEmployees: employees.length,
      readyCount: ready.length,
      autoCreatableCount: autoCreatable.length,
      missingCount: missing.length,
      componentMasterConfigured: componentMaster.length > 0,
      ready,
      autoCreatable,
      missing,
      canProcess: ready.length + autoCreatable.length > 0,
    };
  }

  /**
   * Get payroll runs — includes processedByName snapshot for display
   */
  async getPayrollRuns(organizationId: string) {
    const runs = await prisma.payrollRun.findMany({
      where: { organizationId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { records: true } } },
    });

    // Resolve processedBy userId → display name (batched, non-blocking)
    if (runs.length === 0) return runs;
    const userIds = [...new Set(runs.map(r => r.processedBy).filter(Boolean))] as string[];
    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      try {
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true, email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        });
        nameMap = Object.fromEntries(users.map(u => [
          u.id,
          u.employee
            ? `${u.employee.firstName} ${u.employee.lastName}`.trim()
            : u.email,
        ]));
      } catch { /* non-blocking — name resolution failure should not break run listing */ }
    }

    return runs.map(r => ({
      ...r,
      processedByName: r.processedBy ? (nameMap[r.processedBy] ?? null) : null,
    }));
  }

  /**
   * Get a payroll run by ID
   */
  async getPayrollRunById(runId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Payroll run');
    return run;
  }

  /**
   * Get payroll records for a run
   */
  async getPayrollRecords(runId: string, organizationId?: string) {
    if (organizationId) {
      const run = await prisma.payrollRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new NotFoundError('Payroll run');
    }
    return prisma.payrollRecord.findMany({
      where: { payrollRunId: runId },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            isSystemAccount: true,
            joiningDate: true, onboardingDate: true, lastWorkingDate: true,
            department: { select: { name: true } },
            bankAccountNumber: true, bankName: true, ifscCode: true,
            accountHolderName: true, accountType: true,
          },
        },
      },
      orderBy: { employee: { firstName: 'asc' } },
    });
  }

  /**
   * Get a single payroll record by ID (for PDF generation)
   */
  async getPayrollRecordById(recordId: string, organizationId?: string) {
    const record = await prisma.payrollRecord.findFirst({
      where: { id: recordId, ...(organizationId ? { payrollRun: { organizationId } } : {}) },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true, email: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            bankAccountNumber: true, bankName: true, ifscCode: true,
            accountHolderName: true, accountType: true,
          },
        },
        payrollRun: { select: { month: true, year: true } },
      },
    });
    if (!record) throw new NotFoundError('Payroll record');
    return record;
  }

  /**
   * Get employee's payslips with optional month/year filter
   */
  async getMyPayslips(employeeId: string, month?: number, year?: number) {
    const where: any = {
      employeeId,
      payrollRun: { status: { in: ['COMPLETED', 'LOCKED'] } },
    };
    if (month) where.payrollRun.month = month;
    if (year) where.payrollRun.year = year;

    return prisma.payrollRecord.findMany({
      where,
      include: { payrollRun: { select: { month: true, year: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** @deprecated Use countWorkingDaysInRange() with org workingDays set instead */
  private getWorkingDaysInMonth(month: number, year: number): number {
    const start = new Date(year, month - 1, 1);
    const end   = new Date(year, month, 0);
    // Default Mon-Sat (no holidays known here — call site must account for holidays separately)
    const monSat = new Set([1, 2, 3, 4, 5, 6]);
    return countWorkingDaysInRange(start, end, monSat, new Set());
  }

  private async getLOPDays(employeeId: string, month: number, year: number): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const absentRecords = await prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: startDate, lte: endDate }, status: 'ABSENT' },
      select: { date: true },
    });

    if (absentRecords.length === 0) return 0;

    const approvedLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: { in: ['APPROVED', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'] as any[] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { startDate: true, endDate: true, leaveType: { select: { isPaid: true } } },
    });

    const approvedPaidDates = new Set<string>();
    for (const leave of approvedLeaves) {
      if (!leave.leaveType?.isPaid) continue;
      const current = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      while (current <= end) {
        approvedPaidDates.add(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
    }

    let lopDays = 0;
    for (const record of absentRecords) {
      const dateStr = new Date(record.date).toISOString().split('T')[0];
      if (!approvedPaidDates.has(dateStr)) lopDays++;
    }
    return lopDays;
  }

  private async getSundaysWorked(employeeId: string, month: number, year: number): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: startDate, lte: endDate }, status: 'PRESENT' },
      select: { date: true },
    });

    return records.filter(r => new Date(r.date).getDay() === 0).length;
  }

  /**
   * Amend a payroll record after processing (HR correction)
   */
  async amendPayrollRecord(recordId: string, data: {
    grossSalary?: number;
    netSalary?: number;
    basic?: number;
    hra?: number;
    epfEmployee?: number;
    esiEmployee?: number;
    professionalTax?: number;
    tds?: number;
    lopDays?: number;
    lopDeduction?: number;
    reason: string;
  }, amendedBy: string, organizationId: string) {
    const record = await prisma.payrollRecord.findFirst({
      where: { id: recordId, payrollRun: { organizationId } },
      include: { payrollRun: true },
    });
    if (!record) throw new NotFoundError('Payroll record');
    if (record.payrollRun.status === 'LOCKED') {
      throw new BadRequestError('Cannot amend a locked payroll run. Unlock it first.');
    }

    const oldValues = {
      grossSalary: Number(record.grossSalary),
      netSalary: Number(record.netSalary),
      basic: Number(record.basic),
      hra: Number(record.hra),
      lopDays: record.lopDays,
    };

    const updateData: any = {
      amendedBy,
      amendedAt: new Date(),
      amendmentReason: data.reason,
    };

    if (data.grossSalary !== undefined) updateData.grossSalary = data.grossSalary;
    if (data.netSalary !== undefined) updateData.netSalary = data.netSalary;
    if (data.basic !== undefined) updateData.basic = data.basic;
    if (data.hra !== undefined) updateData.hra = data.hra;
    if (data.epfEmployee !== undefined) updateData.epfEmployee = data.epfEmployee;
    if (data.esiEmployee !== undefined) updateData.esiEmployee = data.esiEmployee;
    if (data.professionalTax !== undefined) updateData.professionalTax = data.professionalTax;
    if (data.tds !== undefined) updateData.tds = data.tds;
    if (data.lopDays !== undefined) updateData.lopDays = data.lopDays;
    if (data.lopDeduction !== undefined) updateData.lopDeduction = data.lopDeduction;

    const updated = await prisma.$transaction(async (tx) => {
      const amendedRecord = await tx.payrollRecord.update({
        where: { id: recordId },
        data: updateData,
        include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
      });

      // Recalculate and sync PayrollRun totals after amendment
      const allRecords = await tx.payrollRecord.findMany({
        where: { payrollRunId: record.payrollRun.id },
        select: { grossSalary: true, netSalary: true, epfEmployee: true, esiEmployee: true, professionalTax: true, tds: true, lopDeduction: true },
      });
      const newTotalGross = allRecords.reduce((s, r) => s + Number(r.grossSalary || 0), 0);
      const newTotalNet = allRecords.reduce((s, r) => s + Number(r.netSalary || 0), 0);
      const newTotalDeductions = allRecords.reduce((s, r) =>
        s + Number(r.epfEmployee || 0) + Number(r.esiEmployee || 0) +
        Number(r.professionalTax || 0) + Number(r.tds || 0) + Number(r.lopDeduction || 0), 0);
      await tx.payrollRun.update({
        where: { id: record.payrollRun.id },
        data: { totalGross: newTotalGross, totalNet: newTotalNet, totalDeductions: newTotalDeductions },
      });

      return amendedRecord;
    });

    await createAuditLog({
      userId: amendedBy, organizationId,
      entity: 'PayrollRecord', entityId: recordId,
      action: 'UPDATE',
      oldValue: oldValues,
      newValue: { ...updateData, reason: data.reason },
    });

    return updated;
  }

  /**
   * Get salary history for an employee
   */
  async getSalaryHistory(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    return prisma.salaryHistory.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Save salary history entry when salary structure changes
   */
  private async saveSalaryHistory(
    employeeId: string, data: any, changeType: string, reason: string | undefined,
    changedBy: string, organizationId: string,
    previousCtc?: number | null, changedByName?: string,
  ) {
    await prisma.salaryHistory.create({
      data: {
        employeeId,
        changeType: changeType as any,
        ctc: data.ctc,
        components: data.components || undefined,
        basic: data.basic || null,
        hra: data.hra || null,
        da: data.da || null,
        ta: data.ta || null,
        medicalAllowance: data.medicalAllowance || null,
        specialAllowance: data.specialAllowance || null,
        lta: data.lta || null,
        templateId: data.templateId || null,
        templateName: data.templateName || null,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
        reason,
        changedBy,
        changedByName: changedByName || null,
        previousCtc: previousCtc ?? null,
        organizationId,
      },
    });
  }

  /**
   * AI-powered payroll anomaly detection for a payroll run
   */
  /**
   * Unlock a locked payroll run for corrections (SUPER_ADMIN only)
   */
  async unlockPayrollRun(runId: string, organizationId: string, unlockedBy: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, organizationId },
    });
    if (!run) throw new NotFoundError('Payroll run');
    if (run.status !== 'LOCKED') {
      throw new BadRequestError('Only LOCKED payroll runs can be unlocked');
    }

    const updated = await prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'COMPLETED' },
    });

    await createAuditLog({
      userId: unlockedBy,
      organizationId,
      entity: 'PayrollRun',
      entityId: runId,
      action: 'UPDATE',
      oldValue: { status: 'LOCKED' },
      newValue: { status: 'COMPLETED', unlockedBy, unlockedAt: new Date() },
    });

    return updated;
  }

  /**
   * Lock a completed payroll run (prevents further amendments)
   */
  async lockPayrollRun(runId: string, organizationId: string, lockedBy: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, organizationId },
    });
    if (!run) throw new NotFoundError('Payroll run');
    if (run.status !== 'COMPLETED') {
      throw new BadRequestError('Only COMPLETED payroll runs can be locked');
    }

    const updated = await prisma.payrollRun.update({
      where: { id: runId },
      data: { status: 'LOCKED' },
    });

    await createAuditLog({
      userId: lockedBy,
      organizationId,
      entity: 'PayrollRun',
      entityId: runId,
      action: 'UPDATE',
      oldValue: { status: 'COMPLETED' },
      newValue: { status: 'LOCKED', lockedBy, lockedAt: new Date() },
    });

    return updated;
  }

  async detectAnomalies(runId: string, organizationId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Payroll run');

    const records = await prisma.payrollRecord.findMany({
      where: { payrollRunId: runId },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    if (records.length === 0) throw new BadRequestError('No payroll records found for this run');

    const payrollSummary = records.map(r => ({
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeCode: r.employee.employeeCode,
      department: r.employee.department?.name || 'N/A',
      grossSalary: Number(r.grossSalary),
      netSalary: Number(r.netSalary),
      basic: Number(r.basic),
      hra: Number(r.hra),
      epfEmployee: Number(r.epfEmployee),
      esiEmployee: Number(r.esiEmployee),
      professionalTax: Number(r.professionalTax),
      tds: Number(r.tds),
      lopDays: r.lopDays,
      lopDeduction: Number(r.lopDeduction),
      workingDays: r.workingDays,
      presentDays: r.presentDays,
    }));

    const systemPrompt = 'You are a payroll auditor for an Indian company. Analyze this payroll data and flag any anomalies, unusual patterns, or potential errors. Consider: unusually high/low salary, excessive deductions, LOP inconsistencies, statutory compliance issues (EPF/ESI/PT/TDS). Return JSON: { anomalies: [{ employeeName: string, employeeCode: string, issue: string, severity: "LOW"|"MEDIUM"|"HIGH", recommendation: string }], overallHealth: "GOOD"|"WARNING"|"CRITICAL", summary: string }';
    const userPrompt = `Payroll Run: ${run.month}/${run.year}\nTotal Employees: ${records.length}\n\nEmployee Payroll Data:\n${JSON.stringify(payrollSummary, null, 2)}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);
    if (!result.success) throw new BadRequestError(result.error || 'AI anomaly detection failed');

    try {
      return JSON.parse(result.data!);
    } catch {
      return { rawResponse: result.data };
    }
  }
}

export const payrollService = new PayrollService();
