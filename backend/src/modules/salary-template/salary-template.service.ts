import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';

export class SalaryTemplateService {
  /**
   * Create a new salary template
   */
  async createTemplate(data: {
    name: string;
    type: string;
    description?: string;
    ctc: number;
    basic: number;
    hra: number;
    da?: number;
    ta?: number;
    medicalAllowance?: number;
    specialAllowance?: number;
    lta?: number;
    performanceBonus?: number;
    incomeTaxRegime?: string;
    components?: any[];
    statutoryConfig?: Record<string, any>;
    lockedFields?: string[];
    isDefault?: boolean;
  }, organizationId: string, userId: string) {
    // If setting as default, unset other defaults of same type
    if (data.isDefault) {
      await prisma.salaryTemplate.updateMany({
        where: { organizationId, type: data.type as any, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
    }

    const template = await prisma.salaryTemplate.create({
      data: {
        name: data.name,
        type: data.type as any,
        description: data.description,
        ctc: data.ctc,
        basic: data.basic,
        hra: data.hra,
        da: data.da ?? null,
        ta: data.ta ?? null,
        medicalAllowance: data.medicalAllowance ?? null,
        specialAllowance: data.specialAllowance ?? null,
        lta: data.lta ?? null,
        performanceBonus: data.performanceBonus ?? null,
        incomeTaxRegime: (data.incomeTaxRegime as any) || 'NEW_REGIME',
        components: data.components ?? undefined,
        statutoryConfig: data.statutoryConfig ?? undefined,
        lockedFields: data.lockedFields ?? undefined,
        isDefault: data.isDefault ?? false,
        organizationId,
        createdBy: userId,
      },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'SalaryTemplate',
      entityId: template.id,
      action: 'CREATE',
      newValue: { name: data.name, type: data.type, ctc: data.ctc },
    });

    return template;
  }

  /**
   * List all active templates for the organization
   */
  async listTemplates(organizationId: string, type?: string) {
    const where: any = { organizationId, deletedAt: null };
    if (type) where.type = type;
    return prisma.salaryTemplate.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Get a single template by ID
   */
  async getTemplate(id: string, organizationId: string) {
    const template = await prisma.salaryTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!template) throw new NotFoundError('Salary template');
    return template;
  }

  /**
   * Update an existing template
   */
  async updateTemplate(id: string, data: Record<string, any>, organizationId: string, userId: string) {
    const existing = await prisma.salaryTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Salary template');

    // If setting as default, unset others
    if (data.isDefault) {
      await prisma.salaryTemplate.updateMany({
        where: { organizationId, type: existing.type, isDefault: true, deletedAt: null, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.salaryTemplate.update({
      where: { id },
      data: {
        ...data,
        incomeTaxRegime: data.incomeTaxRegime || undefined,
        updatedBy: userId,
      },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'SalaryTemplate',
      entityId: id,
      action: 'UPDATE',
      oldValue: {
        name: existing.name,
        ctc: Number(existing.ctc),
        components: existing.components ?? null,
        isDefault: existing.isDefault,
      },
      newValue: {
        name: updated.name,
        ctc: Number(updated.ctc),
        components: updated.components ?? null,
        isDefault: updated.isDefault,
      },
    });

    return updated;
  }

  /**
   * Soft-delete a template
   */
  async deleteTemplate(id: string, organizationId: string, userId: string) {
    const existing = await prisma.salaryTemplate.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Salary template');

    await prisma.salaryTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'SalaryTemplate',
      entityId: id,
      action: 'DELETE',
      oldValue: { name: existing.name, type: existing.type },
    });
  }

  /**
   * Apply a template to one or more employees.
   * - Checks for existing salary to prevent accidental overwrite (requires confirmOverwrite).
   * - Respects lockedFields — prevents overriding locked component values.
   * - Creates SalaryHistory entry with full audit trail.
   */
  async applyTemplate(data: {
    templateId: string;
    employeeIds: string[];
    effectiveFrom: string;
    reason: string;
    overrides?: Record<string, number>;
    confirmOverwrite?: boolean;
  }, organizationId: string, userId: string) {
    const template = await prisma.salaryTemplate.findFirst({
      where: { id: data.templateId, organizationId, deletedAt: null, isActive: true },
    });
    if (!template) throw new NotFoundError('Salary template');

    // Fetch the user name for audit snapshot
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, employee: { select: { firstName: true, lastName: true } } },
    });
    const changedByName = user?.employee
      ? `${user.employee.firstName} ${user.employee.lastName}`
      : user?.email || 'Unknown';

    // Validate employees belong to org
    const employees = await prisma.employee.findMany({
      where: { id: { in: data.employeeIds }, organizationId, deletedAt: null },
      include: { salaryStructure: true },
    });
    if (employees.length === 0) throw new BadRequestError('No valid employees found');

    // Check for existing salary structures (overwrite protection)
    const employeesWithSalary = employees.filter(e => e.salaryStructure);
    if (employeesWithSalary.length > 0 && !data.confirmOverwrite) {
      return {
        requiresConfirmation: true,
        employeesWithExistingSalary: employeesWithSalary.map(e => ({
          id: e.id,
          name: `${e.firstName} ${e.lastName}`,
          employeeCode: e.employeeCode,
          currentCtc: e.salaryStructure ? Number(e.salaryStructure.ctc) : null,
        })),
        message: `${employeesWithSalary.length} employee(s) already have salary structures. Set confirmOverwrite: true to proceed.`,
      };
    }

    // Build the salary values from template, applying overrides (respecting locked fields)
    const lockedFields = (template.lockedFields as string[]) || [];
    const overrides = data.overrides || {};

    // Reject overrides on locked fields
    for (const field of Object.keys(overrides)) {
      if (lockedFields.includes(field)) {
        throw new BadRequestError(`Field "${field}" is locked in this template and cannot be overridden`);
      }
    }

    const salaryValues = {
      ctc: overrides.ctc ?? Number(template.ctc),
      basic: overrides.basic ?? Number(template.basic),
      hra: overrides.hra ?? Number(template.hra),
      da: overrides.da ?? (template.da ? Number(template.da) : null),
      ta: overrides.ta ?? (template.ta ? Number(template.ta) : null),
      medicalAllowance: overrides.medicalAllowance ?? (template.medicalAllowance ? Number(template.medicalAllowance) : null),
      specialAllowance: overrides.specialAllowance ?? (template.specialAllowance ? Number(template.specialAllowance) : null),
      lta: overrides.lta ?? (template.lta ? Number(template.lta) : null),
      performanceBonus: overrides.performanceBonus ?? (template.performanceBonus ? Number(template.performanceBonus) : null),
    };

    // Build dynamic components[] from template — ensures payroll processing works correctly
    let componentsJson = template.components as any[] | null;
    if (!componentsJson || !Array.isArray(componentsJson) || componentsJson.length === 0) {
      // Build from flat fields
      const comps: { name: string; type: string; value: number; isPercentage: boolean }[] = [];
      if (salaryValues.basic > 0) comps.push({ name: 'Basic', type: 'earning', value: salaryValues.basic, isPercentage: false });
      if (salaryValues.hra > 0) comps.push({ name: 'HRA', type: 'earning', value: salaryValues.hra, isPercentage: false });
      if (salaryValues.da) comps.push({ name: 'DA', type: 'earning', value: salaryValues.da, isPercentage: false });
      if (salaryValues.ta) comps.push({ name: 'TA', type: 'earning', value: salaryValues.ta, isPercentage: false });
      if (salaryValues.medicalAllowance) comps.push({ name: 'Medical Allowance', type: 'earning', value: salaryValues.medicalAllowance, isPercentage: false });
      if (salaryValues.specialAllowance) comps.push({ name: 'Special Allowance', type: 'earning', value: salaryValues.specialAllowance, isPercentage: false });
      if (salaryValues.lta) comps.push({ name: 'LTA', type: 'earning', value: salaryValues.lta, isPercentage: false });
      componentsJson = comps;
    }

    // Calculate statutory deductions for the structure
    const basicValue = salaryValues.basic;
    const monthlyGross = componentsJson.filter((c: any) => c.type === 'earning').reduce((s: number, c: any) => s + (c.value || 0), 0);
    const epfBase = Math.min(basicValue, 15000);
    const pfEmployee = Math.round(epfBase * 0.12);
    const pfEmployer = Math.round(epfBase * 0.12);
    const esiEmployee = monthlyGross <= 21000 ? Math.round(monthlyGross * 0.0075) : 0;
    const esiEmployer = monthlyGross <= 21000 ? Math.round(monthlyGross * 0.0325) : 0;
    const professionalTax = monthlyGross > 15000 ? 200 : monthlyGross > 10000 ? 175 : 0;

    const effectiveDate = new Date(data.effectiveFrom);
    const results: { employeeId: string; name: string; status: string }[] = [];

    // Use a transaction for atomicity
    await prisma.$transaction(async (tx) => {
      for (const emp of employees) {
        const previousCtc = emp.salaryStructure ? Number(emp.salaryStructure.ctc) : null;
        const currentVersion = emp.salaryStructure?.version ?? 0;
        const changeType = emp.salaryStructure ? 'TEMPLATE_APPLIED' : 'INITIAL';

        // Common salary structure data
        const structData = {
          templateId: template.id,
          templateName: template.name,
          ctc: salaryValues.ctc,
          basic: salaryValues.basic,
          hra: salaryValues.hra,
          da: salaryValues.da,
          ta: salaryValues.ta,
          medicalAllowance: salaryValues.medicalAllowance,
          specialAllowance: salaryValues.specialAllowance,
          lta: salaryValues.lta,
          performanceBonus: salaryValues.performanceBonus,
          incomeTaxRegime: template.incomeTaxRegime,
          components: componentsJson as any,
          statutoryConfig: template.statutoryConfig ?? undefined,
          lockedFields: template.lockedFields ?? undefined,
          pfEmployee, pfEmployer, esiEmployee, esiEmployer, professionalTax,
          effectiveFrom: effectiveDate,
        };

        // Upsert salary structure with dynamic components
        await tx.salaryStructure.upsert({
          where: { employeeId: emp.id },
          create: { employeeId: emp.id, ...structData, version: 1 },
          update: { ...structData, version: currentVersion + 1 },
        });

        // Update CTC on employee record
        await tx.employee.update({
          where: { id: emp.id },
          data: { ctc: salaryValues.ctc },
        });

        // Create salary history entry
        await tx.salaryHistory.create({
          data: {
            employeeId: emp.id,
            changeType: changeType as any,
            ctc: salaryValues.ctc,
            basic: salaryValues.basic,
            hra: salaryValues.hra,
            da: salaryValues.da,
            ta: salaryValues.ta,
            medicalAllowance: salaryValues.medicalAllowance,
            specialAllowance: salaryValues.specialAllowance,
            lta: salaryValues.lta,
            components: template.components ?? undefined,
            templateId: template.id,
            templateName: template.name,
            effectiveFrom: effectiveDate,
            reason: data.reason,
            changedBy: userId,
            changedByName,
            previousCtc,
            organizationId,
          },
        });

        results.push({
          employeeId: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          status: 'applied',
        });
      }
    }, { timeout: 60000 });

    // Audit log
    await createAuditLog({
      userId,
      organizationId,
      entity: 'SalaryTemplate',
      entityId: template.id,
      action: 'UPDATE',
      newValue: {
        action: 'APPLY_TO_EMPLOYEES',
        templateName: template.name,
        employeeCount: results.length,
        effectiveFrom: data.effectiveFrom,
        reason: data.reason,
      },
    });

    return { applied: results.length, results };
  }

  /**
   * Save an employee's current salary structure as a new template
   */
  async saveAsTemplate(data: {
    employeeId: string;
    name: string;
    type: string;
    description?: string;
    lockedFields?: string[];
  }, organizationId: string, userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId, deletedAt: null },
      include: { salaryStructure: true },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (!employee.salaryStructure) throw new BadRequestError('Employee has no salary structure to save as template');

    const sal = employee.salaryStructure;
    return this.createTemplate({
      name: data.name,
      type: data.type,
      description: data.description || `Created from ${employee.firstName} ${employee.lastName}'s salary`,
      ctc: Number(sal.ctc),
      basic: Number(sal.basic || 0),
      hra: Number(sal.hra || 0),
      da: sal.da ? Number(sal.da) : undefined,
      ta: sal.ta ? Number(sal.ta) : undefined,
      medicalAllowance: sal.medicalAllowance ? Number(sal.medicalAllowance) : undefined,
      specialAllowance: sal.specialAllowance ? Number(sal.specialAllowance) : undefined,
      lta: sal.lta ? Number(sal.lta) : undefined,
      performanceBonus: sal.performanceBonus ? Number(sal.performanceBonus) : undefined,
      incomeTaxRegime: sal.incomeTaxRegime,
      components: sal.components as any[] | undefined,
      statutoryConfig: sal.statutoryConfig as Record<string, any> | undefined,
      lockedFields: data.lockedFields,
    }, organizationId, userId);
  }
}

export const salaryTemplateService = new SalaryTemplateService();
