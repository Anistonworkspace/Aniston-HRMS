import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';

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
        effectiveFrom: new Date(),
      },
    });

    // Also update CTC on employee record
    await prisma.employee.update({
      where: { id: employeeId },
      data: { ctc },
    });

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
        where: { organizationId, status: 'ACTIVE', deletedAt: null },
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
        const presentDays = totalWorkingDays - lopDays;

        // Prorate salary for LOP
        const dailyRate = Number(sal.ctc) / 12 / totalWorkingDays;
        const lopDeduction = Math.round(dailyRate * lopDays);

        const gross = Number(sal.basic) + Number(sal.hra) +
          Number(sal.da || 0) + Number(sal.ta || 0) +
          Number(sal.medicalAllowance || 0) + Number(sal.specialAllowance || 0);

        const deductions = Number(sal.pfEmployee || 0) + Number(sal.esiEmployee || 0) +
          Number(sal.professionalTax || 0) + Number(sal.tds || 0);

        const netSalary = gross - deductions - lopDeduction;

        await prisma.payrollRecord.create({
          data: {
            payrollRunId: runId,
            employeeId: emp.id,
            grossSalary: gross,
            netSalary: Math.max(netSalary, 0),
            basic: Number(sal.basic),
            hra: Number(sal.hra),
            otherEarnings: {
              da: Number(sal.da || 0),
              ta: Number(sal.ta || 0),
              medical: Number(sal.medicalAllowance || 0),
              special: Number(sal.specialAllowance || 0),
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

        totalGross += gross;
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
   * Get employee's payslips
   */
  async getMyPayslips(employeeId: string) {
    return prisma.payrollRecord.findMany({
      where: { employeeId },
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
      if (day !== 0 && day !== 6) workingDays++;
    }
    return workingDays;
  }

  private async getLOPDays(employeeId: string, month: number, year: number): Promise<number> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const absentCount = await prisma.attendanceRecord.count({
      where: {
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: 'ABSENT',
      },
    });

    return absentCount;
  }
}

export const payrollService = new PayrollService();
