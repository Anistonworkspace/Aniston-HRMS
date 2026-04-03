import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { aiService } from '../../services/ai.service.js';

/**
 * Indian Statutory Payroll Calculation Functions
 */

// EPF: 12% of basic, capped at basic of 15,000
function calculateEPF(basic: number): { employee: number; employer: number } {
  const epfBase = Math.min(basic, 15000);
  return {
    employee: Math.round(epfBase * 0.12),
    employer: Math.round(epfBase * 0.12),
  };
}

// ESI: 0.75% employee + 3.25% employer, only if gross <= 21,000
function calculateESI(gross: number): { employee: number; employer: number } {
  if (gross > 21000) return { employee: 0, employer: 0 };
  return {
    employee: Math.round(gross * 0.0075),
    employer: Math.round(gross * 0.0325),
  };
}

// Professional Tax (simplified — Maharashtra slab as default)
function calculateProfessionalTax(gross: number): number {
  if (gross <= 7500) return 0;
  if (gross <= 10000) return 175;
  return 200; // max PT per month in most states
}

// TDS (simplified monthly estimate)
function calculateTDS(annualCTC: number, regime: string): number {
  const taxable = annualCTC - 50000; // Standard deduction

  if (regime === 'NEW_REGIME') {
    // New Regime FY 2025-26 slabs
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

    // 4% health & education cess
    tax = Math.round(tax * 1.04);
    // Section 87A rebate — income up to 7L, full rebate
    if (taxable <= 700000) tax = 0;
    return Math.round(tax / 12);
  }

  // Old regime (simplified)
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

export class PayrollService {
  /**
   * Get salary structure for an employee
   */
  async getSalaryStructure(employeeId: string) {
    const structure = await prisma.salaryStructure.findUnique({
      where: { employeeId },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    if (!structure) throw new NotFoundError('Salary structure');
    return structure;
  }

  /**
   * Create or update salary structure
   */
  async upsertSalaryStructure(employeeId: string, data: {
    ctc: number;
    basic: number;
    hra: number;
    da?: number;
    ta?: number;
    medicalAllowance?: number;
    specialAllowance?: number;
    lta?: number;
    incomeTaxRegime?: string;
    enabledComponents?: Record<string, boolean>;
  }) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundError('Employee');

    const { ctc, basic, hra } = data;
    const gross = basic + hra + (data.da || 0) + (data.ta || 0) +
      (data.medicalAllowance || 0) + (data.specialAllowance || 0) + (data.lta || 0);

    // Calculate statutory deductions
    const epf = calculateEPF(basic);
    const esi = calculateESI(gross);
    const pt = calculateProfessionalTax(gross);
    const regime = data.incomeTaxRegime || 'NEW_REGIME';
    const tds = calculateTDS(ctc, regime);

    const structure = await prisma.salaryStructure.upsert({
      where: { employeeId },
      create: {
        employeeId,
        ctc,
        basic,
        hra,
        da: data.da || null,
        ta: data.ta || null,
        medicalAllowance: data.medicalAllowance || null,
        specialAllowance: data.specialAllowance || null,
        lta: data.lta || null,
        pfEmployee: epf.employee,
        pfEmployer: epf.employer,
        esiEmployee: esi.employee,
        esiEmployer: esi.employer,
        professionalTax: pt,
        tds,
        incomeTaxRegime: regime as any,
        enabledComponents: data.enabledComponents || undefined,
        effectiveFrom: new Date(),
      },
      update: {
        ctc,
        basic,
        hra,
        da: data.da || null,
        ta: data.ta || null,
        medicalAllowance: data.medicalAllowance || null,
        specialAllowance: data.specialAllowance || null,
        lta: data.lta || null,
        pfEmployee: epf.employee,
        pfEmployer: epf.employer,
        esiEmployee: esi.employee,
        esiEmployer: esi.employer,
        professionalTax: pt,
        tds,
        incomeTaxRegime: regime as any,
        enabledComponents: data.enabledComponents || undefined,
        effectiveFrom: new Date(),
      },
    });

    // Also update CTC on employee record
    await prisma.employee.update({
      where: { id: employeeId },
      data: { ctc },
    });

    // Save salary history
    try {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { organizationId: true } });
      if (emp) {
        const existing = await prisma.salaryHistory.findFirst({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
        const changeType = existing ? 'REVISION' : 'INITIAL';
        await this.saveSalaryHistory(employeeId, data, changeType, undefined, 'system', emp.organizationId);
      }
    } catch { /* non-blocking */ }

    return structure;
  }

  /**
   * Initiate a payroll run
   */
  async createPayrollRun(month: number, year: number, organizationId: string, initiatedBy: string) {
    // Check if run exists
    const existing = await prisma.payrollRun.findUnique({
      where: { month_year_organizationId: { month, year, organizationId } },
    });
    if (existing) throw new BadRequestError(`Payroll run already exists for ${month}/${year}`);

    const run = await prisma.payrollRun.create({
      data: {
        month,
        year,
        status: 'DRAFT',
        processedBy: initiatedBy,
        organizationId,
      },
    });

    await createAuditLog({
      userId: initiatedBy,
      organizationId,
      entity: 'PayrollRun',
      entityId: run.id,
      action: 'CREATE',
      newValue: { month, year, status: 'DRAFT' },
    });

    return run;
  }

  /**
   * Process payroll — calculate payslips for all active employees
   */
  async processPayroll(runId: string, organizationId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Payroll run');
    if (run.status !== 'DRAFT') throw new BadRequestError('Payroll can only be processed from DRAFT status');

    await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'PROCESSING' } });

    try {
      // Get all active employees with salary structures
      const employees = await prisma.employee.findMany({
        where: { organizationId, status: 'ACTIVE', deletedAt: null, isSystemAccount: { not: true } },
        include: { salaryStructure: true },
      });

      // Get working days in month
      const totalWorkingDays = this.getWorkingDaysInMonth(run.month, run.year);

      let totalGross = 0;
      let totalNet = 0;
      let totalDeductions = 0;

      for (const emp of employees) {
        if (!emp.salaryStructure) continue;
        const sal = emp.salaryStructure;

        // Count LOP days (absent days without leave)
        const lopDays = await this.getLOPDays(emp.id, run.month, run.year);
        const sundaysWorked = await this.getSundaysWorked(emp.id, run.month, run.year);
        const presentDays = totalWorkingDays - lopDays;

        // Prorate salary for LOP and Sunday bonus
        const dailyRate = Number(sal.ctc) / 12 / totalWorkingDays;
        const lopDeduction = Math.round(dailyRate * lopDays);
        const sundayBonus = Math.round(dailyRate * sundaysWorked);

        const gross = Number(sal.basic) + Number(sal.hra) +
          Number(sal.da || 0) + Number(sal.ta || 0) +
          Number(sal.medicalAllowance || 0) + Number(sal.specialAllowance || 0);

        const deductions = Number(sal.pfEmployee || 0) + Number(sal.esiEmployee || 0) +
          Number(sal.professionalTax || 0) + Number(sal.tds || 0);

        const adjustedGross = gross + sundayBonus;
        const netSalary = adjustedGross - deductions - lopDeduction;

        await prisma.payrollRecord.create({
          data: {
            payrollRunId: runId,
            employeeId: emp.id,
            grossSalary: adjustedGross,
            netSalary: Math.max(netSalary, 0),
            basic: Number(sal.basic),
            hra: Number(sal.hra),
            otherEarnings: {
              da: Number(sal.da || 0),
              ta: Number(sal.ta || 0),
              medical: Number(sal.medicalAllowance || 0),
              special: Number(sal.specialAllowance || 0),
              sundayBonus,
              sundaysWorked,
            },
            epfEmployee: Number(sal.pfEmployee || 0),
            epfEmployer: Number(sal.pfEmployer || 0),
            esiEmployee: Number(sal.esiEmployee || 0),
            esiEmployer: Number(sal.esiEmployer || 0),
            professionalTax: Number(sal.professionalTax || 0),
            tds: Number(sal.tds || 0),
            lopDays,
            lopDeduction,
            workingDays: totalWorkingDays,
            presentDays,
          },
        });

        totalGross += adjustedGross;
        totalNet += Math.max(netSalary, 0);
        totalDeductions += deductions + lopDeduction;
      }

      await prisma.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          totalGross,
          totalNet,
          totalDeductions,
        },
      });

      await createAuditLog({
        userId: run.processedBy || 'system',
        organizationId,
        entity: 'PayrollRun',
        entityId: runId,
        action: 'UPDATE',
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'COMPLETED', totalGross, totalNet, totalDeductions },
      });

      return { processed: employees.filter((e) => e.salaryStructure).length, totalGross, totalNet };
    } catch (err) {
      await prisma.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT' } });
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
  async getPayrollRecords(runId: string) {
    return prisma.payrollRecord.findMany({
      where: { payrollRunId: runId },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
        },
      },
      orderBy: { employee: { firstName: 'asc' } },
    });
  }

  /**
   * Get a single payroll record by ID (for PDF generation)
   */
  async getPayrollRecordById(recordId: string) {
    const record = await prisma.payrollRecord.findUnique({
      where: { id: recordId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            email: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
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
      include: {
        payrollRun: { select: { month: true, year: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private getWorkingDaysInMonth(month: number, year: number): number {
    const daysInMonth = new Date(year, month, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month - 1, d).getDay();
      if (day !== 0) workingDays++; // Only Sunday is weekoff
    }
    return workingDays;
  }

  private async getLOPDays(employeeId: string, month: number, year: number): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // Get all ABSENT attendance records
    const absentRecords = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: 'ABSENT',
      },
      select: { date: true },
    });

    if (absentRecords.length === 0) return 0;

    // Get approved leave dates for this employee in this month
    const approvedLeaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { startDate: true, endDate: true, leaveType: { select: { isPaid: true } } },
    });

    // Build set of approved paid leave dates
    const approvedPaidDates = new Set<string>();
    for (const leave of approvedLeaves) {
      if (!leave.leaveType?.isPaid) continue; // Unpaid leaves ARE LOP
      const current = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      while (current <= end) {
        approvedPaidDates.add(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
    }

    // Count ABSENT days NOT covered by approved paid leave
    let lopDays = 0;
    for (const record of absentRecords) {
      const dateStr = new Date(record.date).toISOString().split('T')[0];
      if (!approvedPaidDates.has(dateStr)) {
        lopDays++;
      }
    }

    return lopDays;
  }

  /**
   * Count Sundays where employee was present (for extra day pay)
   */
  private async getSundaysWorked(employeeId: string, month: number, year: number): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    // Find attendance records on Sundays (day=0) with status PRESENT
    const sundayRecords = await prisma.attendanceRecord.count({
      where: {
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: 'PRESENT',
      },
    });

    // Count which of those are actually Sundays
    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: 'PRESENT',
      },
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
    const record = await prisma.payrollRecord.findUnique({
      where: { id: recordId },
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
      userId: amendedBy,
      organizationId,
      entity: 'PayrollRecord',
      entityId: recordId,
      action: 'UPDATE',
      oldValue: oldValues,
      newValue: { ...updateData, reason: data.reason },
    });

    return updated;
  }

  /**
   * Get salary history for an employee
   */
  async getSalaryHistory(employeeId: string) {
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
    changedBy: string, organizationId: string
  ) {
    await prisma.salaryHistory.create({
      data: {
        employeeId,
        changeType,
        ctc: data.ctc,
        basic: data.basic,
        hra: data.hra,
        da: data.da || null,
        ta: data.ta || null,
        medicalAllowance: data.medicalAllowance || null,
        specialAllowance: data.specialAllowance || null,
        effectiveFrom: new Date(),
        reason,
        changedBy,
        organizationId,
      },
    });
  }

  /**
   * AI-powered payroll anomaly detection for a payroll run
   */
  async detectAnomalies(runId: string, organizationId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Payroll run');

    const records = await prisma.payrollRecord.findMany({
      where: { payrollRunId: runId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
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
