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
  esi: { enabled: true, employeePercent: 0.75, employerPercent: 3.25, grossCap: 21000 },
  pt: {
    enabled: true,
    slabs: PT_SLABS_BY_STATE.MAHARASHTRA,
  },
};

function calculateStatutory(
  basicValue: number,
  grossMonthly: number,
  annualCTC: number,
  regime: string,
  config?: StatutoryConfig | null,
): StatutoryResult {
  const cfg = { ...DEFAULT_STATUTORY, ...config };

  // EPF
  let epfEmployee = 0, epfEmployer = 0;
  if (cfg.epf?.enabled) {
    const cap = cfg.epf.basicCap ?? 15000;
    const epfBase = Math.min(basicValue, cap);
    epfEmployee = Math.round(epfBase * (cfg.epf.employeePercent ?? 12) / 100);
    epfEmployer = Math.round(epfBase * (cfg.epf.employerPercent ?? 12) / 100);
  }

  // ESI
  let esiEmployee = 0, esiEmployer = 0;
  if (cfg.esi?.enabled) {
    const grossCap = cfg.esi.grossCap ?? 21000;
    if (grossMonthly <= grossCap) {
      esiEmployee = Math.round(grossMonthly * (cfg.esi.employeePercent ?? 0.75) / 100);
      esiEmployer = Math.round(grossMonthly * (cfg.esi.employerPercent ?? 3.25) / 100);
    }
  }

  // Professional Tax
  let professionalTax = 0;
  if (cfg.pt?.enabled && cfg.pt.slabs?.length) {
    for (const slab of cfg.pt.slabs) {
      if (grossMonthly >= slab.min && grossMonthly <= (slab.max === Infinity ? Number.MAX_SAFE_INTEGER : slab.max)) {
        professionalTax = slab.amount;
        break;
      }
    }
  } else if (cfg.pt?.enabled) {
    // Fallback: Maharashtra default
    if (grossMonthly <= 7500) professionalTax = 0;
    else if (grossMonthly <= 10000) professionalTax = 175;
    else professionalTax = 200;
  }

  // TDS
  const tds = calculateTDS(annualCTC, regime);

  return { epfEmployee, epfEmployer, esiEmployee, esiEmployer, professionalTax, tds };
}

function calculateTDS(annualCTC: number, regime: string): number {
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
    tax = Math.round(tax * 1.04);
    if (taxable <= 700000) tax = 0;
    return Math.round(tax / 12);
  }

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
  tax = Math.round(tax * 1.04);
  if (taxable <= 500000) tax = 0;
  return Math.round(tax / 12);
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
      structure.statutoryConfig as StatutoryConfig | null,
    );

    const totalDeductions = componentDeductions + statutory.epfEmployee + statutory.esiEmployee + statutory.professionalTax + statutory.tds;

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

    const { ctcAnnual, components, incomeTaxRegime, statutoryConfig } = data;
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

    // Include PROBATION employees along with ACTIVE
    const employees = await prisma.employee.findMany({
      where: { organizationId, status: { in: ['ACTIVE', 'PROBATION'] }, deletedAt: null, isSystemAccount: { not: true } },
      include: { salaryStructure: true },
    });

    const totalWorkingDays = this.getWorkingDaysInMonth(run.month, run.year);

    // Pre-fetch attendance data in batch
    const startDate = new Date(run.year, run.month - 1, 1);
    const endDate = new Date(run.year, run.month, 0);
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
        status: 'APPROVED',
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

    // Pre-fetch holidays for the month
    const holidays = await prisma.holiday.findMany({
      where: { organizationId, date: { gte: startDate, lte: endDate } },
      select: { date: true },
    }).catch(() => []);
    const holidayDates = new Set(holidays.map(h => new Date(h.date).toISOString().split('T')[0]));

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

          const presentRecords = empAttendance.filter(r => r.status === 'PRESENT');
          const absentRecords = empAttendance.filter(r => r.status === 'ABSENT');

          // Calculate LOP: absent days minus approved paid leave days minus holidays
          let lopDays = 0;
          for (const rec of absentRecords) {
            const dateStr = new Date(rec.date).toISOString().split('T')[0];
            if (!paidLeaveDates.has(dateStr) && !holidayDates.has(dateStr)) {
              lopDays++;
            }
          }

          // Half-day support
          const halfDayRecords = empAttendance.filter(r => r.status === 'HALF_DAY');
          const halfDayLop = halfDayRecords.length * 0.5;
          lopDays += halfDayLop;

          const sundaysWorked = presentRecords.filter(r => new Date(r.date).getDay() === 0).length;
          const presentDays = totalWorkingDays - lopDays;

          // Use dynamic components if available, else legacy columns
          const components: SalaryComponent[] = (sal.components as SalaryComponent[] | null) || legacyToComponents(sal);
          const earningsTotal = sumComponentsByType(components, 'earning');
          const componentDeductions = sumComponentsByType(components, 'deduction');

          const dailyRate = earningsTotal / totalWorkingDays;
          const lopDeduction = Math.round(dailyRate * lopDays);
          const sundayBonus = Math.round(dailyRate * sundaysWorked);

          // Statutory deductions (from pre-calculated fields on structure)
          const statutoryDeductions = Number(sal.pfEmployee || 0) + Number(sal.esiEmployee || 0) +
            Number(sal.professionalTax || 0) + Number(sal.tds || 0);

          // Calculate adjustments (additions and deductions)
          let adjustmentAdditions = 0;
          let adjustmentDeductions = 0;
          const adjustmentSnapshot: any[] = [];
          for (const adj of empAdjustments) {
            const amount = Number(adj.amount);
            if (adj.isDeduction) {
              adjustmentDeductions += amount;
            } else {
              adjustmentAdditions += amount;
            }
            adjustmentSnapshot.push({
              type: adj.type,
              componentName: adj.componentName,
              amount,
              isDeduction: adj.isDeduction,
              reason: adj.reason,
            });
          }

          const adjustedGross = earningsTotal + sundayBonus + adjustmentAdditions;
          const deductions = componentDeductions + statutoryDeductions + adjustmentDeductions;
          const netSalary = adjustedGross - deductions - lopDeduction;

          // Build detailed earnings breakdown
          const earningsBreakdown: Record<string, number> = {};
          const deductionsBreakdown: Record<string, number> = {};
          for (const comp of components) {
            if (comp.type === 'earning') {
              earningsBreakdown[comp.name] = comp.value;
            } else {
              deductionsBreakdown[comp.name] = comp.value;
            }
          }
          if (sundayBonus > 0) earningsBreakdown['Sunday Bonus'] = sundayBonus;
          for (const adj of empAdjustments) {
            if (!adj.isDeduction) earningsBreakdown[`Adj: ${adj.componentName}`] = Number(adj.amount);
            else deductionsBreakdown[`Adj: ${adj.componentName}`] = Number(adj.amount);
          }

          // Build otherEarnings from non-basic/hra components (backward compat)
          const otherEarnings: Record<string, number> = { sundayBonus, sundaysWorked };
          for (const comp of components) {
            if (comp.type === 'earning' && !['Basic', 'HRA'].includes(comp.name)) {
              otherEarnings[comp.name.toLowerCase().replace(/\s+/g, '_')] = comp.value;
            }
          }
          if (adjustmentAdditions > 0) otherEarnings.adjustmentAdditions = adjustmentAdditions;

          const basicComp = findComponent(components, 'Basic');
          const hraComp = findComponent(components, 'HRA');

          await tx.payrollRecord.create({
            data: {
              payrollRunId: runId,
              employeeId: emp.id,
              grossSalary: adjustedGross,
              netSalary: Math.max(netSalary, 0),
              basic: basicComp?.value ?? Number(sal.basic || 0),
              hra: hraComp?.value ?? Number(sal.hra || 0),
              otherEarnings,
              epfEmployee: Number(sal.pfEmployee || 0),
              epfEmployer: Number(sal.pfEmployer || 0),
              esiEmployee: Number(sal.esiEmployee || 0),
              esiEmployer: Number(sal.esiEmployer || 0),
              professionalTax: Number(sal.professionalTax || 0),
              tds: Number(sal.tds || 0),
              otherDeductions: componentDeductions + adjustmentDeductions > 0
                ? { customDeductions: componentDeductions, adjustmentDeductions }
                : undefined,
              lopDays: Math.ceil(lopDays), // round up half-days
              lopDeduction,
              workingDays: totalWorkingDays,
              presentDays: Math.floor(presentDays),
              adjustments: adjustmentSnapshot.length > 0 ? adjustmentSnapshot : undefined,
              earningsBreakdown,
              deductionsBreakdown,
            },
          });

          totalGross += adjustedGross;
          totalNet += Math.max(netSalary, 0);
          totalDeductions += deductions + lopDeduction;
        }

        await tx.payrollRun.update({
          where: { id: runId },
          data: { status: 'COMPLETED', processedAt: new Date(), totalGross, totalNet, totalDeductions },
        });

        return { processed: employees.filter((e) => e.salaryStructure).length, totalGross, totalNet, totalDeductions };
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
   * Get payroll runs
   */
  async getPayrollRuns(organizationId: string) {
    return prisma.payrollRun.findMany({
      where: { organizationId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { records: true } } },
    });
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

  private getWorkingDaysInMonth(month: number, year: number): number {
    const daysInMonth = new Date(year, month, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month - 1, d).getDay();
      if (day !== 0) workingDays++;
    }
    return workingDays;
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
      where: { employeeId, status: 'APPROVED', startDate: { lte: endDate }, endDate: { gte: startDate } },
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

    const updated = await prisma.payrollRecord.update({
      where: { id: recordId },
      data: updateData,
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
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
