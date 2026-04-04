import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import type { CreateDesignationInput, UpdateDesignationInput, SearchDesignationQuery } from './designation.validation.js';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function generateCode(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 20);
}

export class DesignationService {
  async list(organizationId: string, query?: SearchDesignationQuery) {
    const where: any = { organizationId, deletedAt: null };

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (!query?.includeArchived) {
      where.isActive = where.isActive ?? true;
    }
    if (query?.departmentId) {
      where.departmentId = query.departmentId;
    }
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const designations = await prisma.designation.findMany({
      where,
      include: {
        _count: { select: { employees: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
    return designations;
  }

  async create(data: CreateDesignationInput, organizationId: string, userId: string) {
    const slug = generateSlug(data.name);
    const code = data.code || generateCode(data.name);

    // Case-insensitive duplicate check
    const existing = await prisma.designation.findFirst({
      where: {
        organizationId,
        name: { equals: data.name, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    if (existing) {
      throw new ConflictError(`Designation "${data.name}" already exists`);
    }

    // Check code uniqueness
    if (code) {
      const codeExists = await prisma.designation.findFirst({
        where: { organizationId, code, deletedAt: null },
      });
      if (codeExists) {
        throw new ConflictError(`Designation code "${code}" already exists`);
      }
    }

    const desig = await prisma.designation.create({
      data: {
        name: data.name,
        slug,
        code,
        level: data.level,
        levelBand: data.levelBand,
        description: data.description,
        departmentId: data.departmentId,
        isActive: data.isActive ?? true,
        createdById: userId,
        updatedById: userId,
        organizationId,
      },
      include: {
        _count: { select: { employees: true } },
        department: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Designation',
      entityId: desig.id,
      action: 'CREATE',
      newValue: { name: data.name, code, slug, departmentId: data.departmentId },
    });

    return desig;
  }

  async update(id: string, data: UpdateDesignationInput, organizationId: string, userId: string) {
    const existing = await prisma.designation.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Designation');

    // If name is changing, check for duplicates
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.designation.findFirst({
        where: {
          organizationId,
          name: { equals: data.name, mode: 'insensitive' },
          deletedAt: null,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictError(`Designation "${data.name}" already exists`);
      }
    }

    const updateData: any = { ...data, updatedById: userId };
    if (data.name) {
      updateData.slug = generateSlug(data.name);
      if (!data.code) updateData.code = existing.code || generateCode(data.name);
    }

    const desig = await prisma.designation.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { employees: true } },
        department: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Designation',
      entityId: id,
      action: 'UPDATE',
      oldValue: { name: existing.name, isActive: existing.isActive },
      newValue: data,
    });

    return desig;
  }

  async archive(id: string, organizationId: string, userId: string) {
    const desig = await prisma.designation.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!desig) throw new NotFoundError('Designation');

    const updated = await prisma.designation.update({
      where: { id },
      data: { isActive: false, updatedById: userId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Designation',
      entityId: id,
      action: 'UPDATE',
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });

    return updated;
  }

  async reactivate(id: string, organizationId: string, userId: string) {
    const desig = await prisma.designation.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!desig) throw new NotFoundError('Designation');

    const updated = await prisma.designation.update({
      where: { id },
      data: { isActive: true, updatedById: userId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Designation',
      entityId: id,
      action: 'UPDATE',
      oldValue: { isActive: false },
      newValue: { isActive: true },
    });

    return updated;
  }

  async softDelete(id: string, organizationId: string, userId: string) {
    const desig = await prisma.designation.findFirst({
      where: { id, organizationId },
    });
    if (!desig) throw new NotFoundError('Designation');

    await prisma.designation.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Designation',
      entityId: id,
      action: 'DELETE',
      oldValue: { name: desig.name },
    });
  }
}

export const designationService = new DesignationService();
