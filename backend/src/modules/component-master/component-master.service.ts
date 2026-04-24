import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';

// Default components seeded for new orgs — standard Indian payroll structure.
// HR can add more or edit these from Settings → Salary Components.
const DEFAULT_COMPONENTS = [
  {
    name: 'Basic Salary', code: 'BASIC', type: 'EARNING', category: 'STANDARD',
    calculationRule: 'PERCENTAGE_CTC', percentageOf: 'CTC', defaultPercentage: 50,
    isTaxable: true, isStatutory: false, sortOrder: 1,
    description: 'Basic salary — 50% of CTC. Base for HRA, EPF, and other percentage components.',
  },
  {
    name: 'HRA', code: 'HRA', type: 'EARNING', category: 'ALLOWANCE',
    calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 40,
    isTaxable: false, isStatutory: false, sortOrder: 2,
    description: 'House Rent Allowance — 40% of Basic. Partially/fully exempt under Sec 10(13A).',
  },
  {
    name: 'Conveyance Allowance', code: 'CONVEYANCE_ALLOW', type: 'EARNING', category: 'ALLOWANCE',
    calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 6,
    isTaxable: false, isStatutory: false, sortOrder: 3,
    description: 'Conveyance allowance — 6% of Basic. Exempt up to ₹1,600/month per tax rules.',
  },
  {
    name: 'Medical Allowance', code: 'MEDICAL_ALLOW', type: 'EARNING', category: 'ALLOWANCE',
    calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 5,
    isTaxable: false, isStatutory: false, sortOrder: 4,
    description: 'Medical allowance — 5% of Basic. Exempt up to ₹15,000/year on submission of bills.',
  },
  {
    name: 'Special Allowance', code: 'SPECIAL_ALLOW', type: 'EARNING', category: 'ALLOWANCE',
    calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 20,
    isTaxable: true, isStatutory: false, sortOrder: 5,
    description: 'Balancing/special allowance — 20% of Basic. HR can adjust this percentage.',
  },
  {
    name: 'EPF (Employee)', code: 'EPF_EE', type: 'DEDUCTION', category: 'STATUTORY',
    calculationRule: 'PERCENTAGE_BASIC', percentageOf: 'BASIC', defaultPercentage: 12,
    isTaxable: false, isStatutory: true, sortOrder: 100,
  },
];

// Legacy codes from the old 20-component seed that are no longer defaults.
// cleanupLegacyDefaults() hard-deletes these from any org that still has them.
// NOTE: HRA is intentionally removed from this list — it is a standard default again.
const LEGACY_DEFAULT_CODES = [
  'DA', 'TA', 'MEDICAL', 'SPECIAL', 'LTA', 'PERF_BONUS', 'SHIFT_ALLOW',
  'NIGHT_PREMIUM', 'CCA', 'INTERNET', 'PHONE',
  'EPF_ER',
  'ESI_EE', 'ESI_ER', 'PT', 'TDS',
  'LOAN_RECOVERY', 'CANTEEN', 'ADVANCE_DED',
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
   * Remove legacy default components (old 20-component seed) from this org.
   * Safe to call on any org — only deletes components whose codes match the
   * old seed list; HR-created components with the same codes would also be
   * removed, so this should only be called once after initial migration.
   */
  async cleanupLegacyDefaults(organizationId: string, userId: string) {
    const result = await prisma.salaryComponentMaster.deleteMany({
      where: { organizationId, code: { in: LEGACY_DEFAULT_CODES } },
    });

    if (result.count > 0) {
      await createAuditLog({
        userId, organizationId,
        entity: 'SalaryComponentMaster', entityId: 'bulk-cleanup',
        action: 'DELETE',
        newValue: { deletedCount: result.count, reason: 'Legacy default components removed — Basic+HRA only policy' },
      });
    }

    return { deleted: result.count };
  }

  /**
   * Seed default salary components for an organization.
   * Idempotent — uses skipDuplicates so safe to call on existing orgs;
   * only components whose codes don't already exist will be inserted.
   */
  async seedDefaults(organizationId: string, userId: string) {
    const result = await prisma.salaryComponentMaster.createMany({
      data: DEFAULT_COMPONENTS.map(comp => ({
        name: comp.name,
        code: comp.code,
        type: comp.type as any,
        category: (comp.category as any) ?? 'STANDARD',
        calculationRule: (comp.calculationRule as any) ?? 'FIXED',
        percentageOf: (comp as any).percentageOf ?? null,
        defaultValue: (comp as any).defaultValue ?? null,
        defaultPercentage: (comp as any).defaultPercentage ?? null,
        isTaxable: comp.isTaxable,
        isStatutory: comp.isStatutory,
        sortOrder: comp.sortOrder,
        description: (comp as any).description ?? null,
        organizationId,
        createdBy: userId,
      })),
      skipDuplicates: true,
    });

    if (result.count > 0) {
      await createAuditLog({
        userId, organizationId,
        entity: 'SalaryComponentMaster', entityId: 'bulk-seed',
        action: 'CREATE',
        newValue: { seededCount: result.count, reason: 'Default salary components seeded' },
      });
    }

    return { seeded: result.count };
  }
}

export const componentMasterService = new ComponentMasterService();
