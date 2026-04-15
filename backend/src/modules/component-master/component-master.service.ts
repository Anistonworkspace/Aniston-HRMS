import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';

// Default components that get seeded when org has none
const DEFAULT_COMPONENTS = [
  { name: 'Basic Salary', code: 'BASIC', type: 'EARNING', category: 'STANDARD', calculationRule: 'PERCENTAGE_CTC', percentageOf: 'CTC', defaultPercentage: 50, isTaxable: true, isStatutory: false, sortOrder: 1 },
  { name: 'House Rent Allowance', code: 'HRA', type: 'EARNING', category: 'STANDARD', calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 40, isTaxable: true, isStatutory: false, sortOrder: 2 },
  { name: 'Dearness Allowance', code: 'DA', type: 'EARNING', category: 'STANDARD', calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 10, isTaxable: true, isStatutory: false, sortOrder: 3 },
  { name: 'Transport Allowance', code: 'TA', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', defaultValue: 1600, isTaxable: true, isStatutory: false, sortOrder: 4 },
  { name: 'Medical Allowance', code: 'MEDICAL', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', defaultValue: 1250, isTaxable: true, isStatutory: false, sortOrder: 5 },
  { name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', isTaxable: true, isStatutory: false, sortOrder: 6 },
  { name: 'Leave Travel Allowance', code: 'LTA', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', isTaxable: false, isStatutory: false, sortOrder: 7 },
  { name: 'Performance Bonus', code: 'PERF_BONUS', type: 'EARNING', category: 'BONUS', calculationRule: 'FIXED', isTaxable: true, isStatutory: false, sortOrder: 8 },
  { name: 'Shift Allowance', code: 'SHIFT_ALLOW', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', isTaxable: true, isStatutory: false, sortOrder: 9 },
  { name: 'Night Premium', code: 'NIGHT_PREMIUM', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', isTaxable: true, isStatutory: false, sortOrder: 10 },
  { name: 'City Compensatory Allowance', code: 'CCA', type: 'EARNING', category: 'ALLOWANCE', calculationRule: 'FIXED', isTaxable: true, isStatutory: false, sortOrder: 11 },
  { name: 'Internet Allowance', code: 'INTERNET', type: 'EARNING', category: 'REIMBURSEMENT', calculationRule: 'FIXED', isTaxable: false, isStatutory: false, sortOrder: 12 },
  { name: 'Phone Allowance', code: 'PHONE', type: 'EARNING', category: 'REIMBURSEMENT', calculationRule: 'FIXED', isTaxable: false, isStatutory: false, sortOrder: 13 },
  // Deductions
  { name: 'EPF (Employee)', code: 'EPF_EE', type: 'DEDUCTION', category: 'STATUTORY', calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 12, isTaxable: false, isStatutory: true, sortOrder: 100 },
  { name: 'EPF (Employer)', code: 'EPF_ER', type: 'DEDUCTION', category: 'STATUTORY', calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 12, isTaxable: false, isStatutory: true, sortOrder: 101 },
  { name: 'ESI (Employee)', code: 'ESI_EE', type: 'DEDUCTION', category: 'STATUTORY', calculationRule: 'PERCENTAGE_CTC', defaultPercentage: 0.75, isTaxable: false, isStatutory: true, sortOrder: 102 },
  { name: 'ESI (Employer)', code: 'ESI_ER', type: 'DEDUCTION', category: 'STATUTORY', calculationRule: 'PERCENTAGE_CTC', defaultPercentage: 3.25, isTaxable: false, isStatutory: true, sortOrder: 103 },
  { name: 'Professional Tax', code: 'PT', type: 'DEDUCTION', category: 'STATUTORY', calculationRule: 'SLAB', isTaxable: false, isStatutory: true, sortOrder: 104 },
  { name: 'TDS', code: 'TDS', type: 'DEDUCTION', category: 'STATUTORY', calculationRule: 'SLAB', isTaxable: false, isStatutory: true, sortOrder: 105 },
  { name: 'Loan Recovery', code: 'LOAN_RECOVERY', type: 'DEDUCTION', category: 'CUSTOM', calculationRule: 'FIXED', isTaxable: false, isStatutory: false, sortOrder: 110 },
  { name: 'Canteen Deduction', code: 'CANTEEN', type: 'DEDUCTION', category: 'CUSTOM', calculationRule: 'FIXED', isTaxable: false, isStatutory: false, sortOrder: 111 },
  { name: 'Advance Deduction', code: 'ADVANCE_DED', type: 'DEDUCTION', category: 'CUSTOM', calculationRule: 'FIXED', isTaxable: false, isStatutory: false, sortOrder: 112 },
];

export class ComponentMasterService {
  /**
   * Get all components for org. Auto-seeds defaults if none exist.
   */
  async listComponents(organizationId: string, type?: string) {
    let components = await prisma.salaryComponentMaster.findMany({
      where: { organizationId, deletedAt: null, ...(type ? { type: type as any } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // Auto-seed defaults only if this org has NEVER had any components (even deleted ones)
    // Checking total count (incl. deleted) prevents re-seeding after intentional deletions
    if (components.length === 0 && !type) {
      const totalEver = await prisma.salaryComponentMaster.count({ where: { organizationId } });
      if (totalEver === 0) {
        await this.seedDefaults(organizationId, 'system');
        components = await prisma.salaryComponentMaster.findMany({
          where: { organizationId, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
      }
    }

    return components;
  }

  async getComponent(id: string, organizationId: string) {
    const comp = await prisma.salaryComponentMaster.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!comp) throw new NotFoundError('Salary component');
    return comp;
  }

  async createComponent(data: {
    name: string; code: string; type: string;
    category?: string; calculationRule?: string; percentageOf?: string;
    defaultValue?: number; defaultPercentage?: number;
    isTaxable?: boolean; isStatutory?: boolean; sortOrder?: number; description?: string;
  }, organizationId: string, userId: string) {
    // Check unique code
    const existing = await prisma.salaryComponentMaster.findFirst({
      where: { code: data.code, organizationId, deletedAt: null },
    });
    if (existing) throw new BadRequestError(`Component with code "${data.code}" already exists`);

    const component = await prisma.salaryComponentMaster.create({
      data: {
        name: data.name,
        code: data.code,
        type: data.type as any,
        category: (data.category as any) || 'CUSTOM',
        calculationRule: (data.calculationRule as any) || 'FIXED',
        percentageOf: data.percentageOf,
        defaultValue: data.defaultValue,
        defaultPercentage: data.defaultPercentage,
        isTaxable: data.isTaxable ?? true,
        isStatutory: data.isStatutory ?? false,
        sortOrder: data.sortOrder ?? 50,
        description: data.description,
        organizationId,
        createdBy: userId,
      },
    });

    await createAuditLog({
      userId, organizationId,
      entity: 'SalaryComponentMaster', entityId: component.id,
      action: 'CREATE', newValue: { name: data.name, code: data.code, type: data.type },
    });

    return component;
  }

  async updateComponent(id: string, data: Record<string, any>, organizationId: string, userId: string) {
    const existing = await prisma.salaryComponentMaster.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Salary component');

    // If code changed, check uniqueness
    if (data.code && data.code !== existing.code) {
      const dup = await prisma.salaryComponentMaster.findFirst({
        where: { code: data.code, organizationId, deletedAt: null, id: { not: id } },
      });
      if (dup) throw new BadRequestError(`Component with code "${data.code}" already exists`);
    }

    const updated = await prisma.salaryComponentMaster.update({
      where: { id },
      data: { ...data, type: data.type as any, category: data.category as any, calculationRule: data.calculationRule as any },
    });

    await createAuditLog({
      userId, organizationId,
      entity: 'SalaryComponentMaster', entityId: id,
      action: 'UPDATE',
      oldValue: { name: existing.name, code: existing.code },
      newValue: { name: updated.name, code: updated.code },
    });

    return updated;
  }

  async deleteComponent(id: string, organizationId: string, userId: string) {
    const existing = await prisma.salaryComponentMaster.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Salary component');
    if (existing.isStatutory) throw new BadRequestError('Cannot delete statutory components');

    // Hard delete — component is permanently removed and will NOT reappear on server restart
    await prisma.salaryComponentMaster.delete({ where: { id } });

    await createAuditLog({
      userId, organizationId,
      entity: 'SalaryComponentMaster', entityId: id,
      action: 'DELETE', oldValue: { name: existing.name, code: existing.code },
    });
  }

  async reorderComponents(components: { id: string; sortOrder: number }[], organizationId: string) {
    await prisma.$transaction(
      components.map(c =>
        prisma.salaryComponentMaster.update({
          where: { id: c.id },
          data: { sortOrder: c.sortOrder },
        })
      )
    );
  }

  async toggleActive(id: string, organizationId: string, userId: string) {
    const existing = await prisma.salaryComponentMaster.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Salary component');

    const updated = await prisma.salaryComponentMaster.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await createAuditLog({
      userId, organizationId,
      entity: 'SalaryComponentMaster', entityId: id,
      action: 'UPDATE',
      oldValue: { isActive: existing.isActive },
      newValue: { isActive: updated.isActive },
    });

    return updated;
  }

  /**
   * Seed default salary components for an organization
   */
  async seedDefaults(organizationId: string, userId: string) {
    // Count ALL (including deleted) — never re-seed if the org has had components before
    const existing = await prisma.salaryComponentMaster.count({
      where: { organizationId },
    });
    if (existing > 0) return { seeded: 0 };

    const created = await prisma.$transaction(
      DEFAULT_COMPONENTS.map(comp =>
        prisma.salaryComponentMaster.create({
          data: {
            ...comp,
            type: comp.type as any,
            category: comp.category as any,
            calculationRule: comp.calculationRule as any,
            organizationId,
            createdBy: userId,
          },
        })
      )
    );

    return { seeded: created.length };
  }
}

export const componentMasterService = new ComponentMasterService();
