import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import type { CreateDepartmentInput, UpdateDepartmentInput, SearchDepartmentQuery } from './department.validation.js';

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

export class DepartmentService {
  async list(organizationId: string, query?: SearchDepartmentQuery) {
    const where: any = { organizationId, deletedAt: null };

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (!query?.includeArchived) {
      where.isActive = where.isActive ?? true;
    }
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const departments = await prisma.department.findMany({
      where,
      include: {
        _count: { select: { employees: true, designations: true } },
        head: { select: { id: true, firstName: true, lastName: true } },
        parentDepartment: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return departments;
  }

  async create(data: CreateDepartmentInput, organizationId: string, userId: string) {
    const slug = generateSlug(data.name);
    const code = data.code || generateCode(data.name);

    // Case-insensitive duplicate check (including archived)
    const existing = await prisma.department.findFirst({
      where: {
        organizationId,
        name: { equals: data.name, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    if (existing) {
      throw new ConflictError(`Department "${data.name}" already exists`);
    }

    // Check code uniqueness
    if (code) {
      const codeExists = await prisma.department.findFirst({
        where: { organizationId, code, deletedAt: null },
      });
      if (codeExists) {
        throw new ConflictError(`Department code "${code}" already exists`);
      }
    }

    const dept = await prisma.department.create({
      data: {
        name: data.name,
        slug,
        code,
        description: data.description,
        headId: data.headId,
        parentDepartmentId: data.parentDepartmentId,
        isActive: data.isActive ?? true,
        createdById: userId,
        updatedById: userId,
        organizationId,
      },
      include: {
        _count: { select: { employees: true, designations: true } },
        head: { select: { id: true, firstName: true, lastName: true } },
        parentDepartment: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Department',
      entityId: dept.id,
      action: 'CREATE',
      newValue: { name: data.name, code, slug },
    });

    return dept;
  }

  async update(id: string, data: UpdateDepartmentInput, organizationId: string, userId: string) {
    const existing = await prisma.department.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Department');

    // If name is changing, check for duplicates
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.department.findFirst({
        where: {
          organizationId,
          name: { equals: data.name, mode: 'insensitive' },
          deletedAt: null,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictError(`Department "${data.name}" already exists`);
      }
    }

    const updateData: any = { ...data, updatedById: userId };
    if (data.name) {
      updateData.slug = generateSlug(data.name);
      if (!data.code) updateData.code = existing.code || generateCode(data.name);
    }

    const dept = await prisma.department.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { employees: true, designations: true } },
        head: { select: { id: true, firstName: true, lastName: true } },
        parentDepartment: { select: { id: true, name: true } },
      },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Department',
      entityId: id,
      action: 'UPDATE',
      oldValue: { name: existing.name, isActive: existing.isActive },
      newValue: data,
    });

    return dept;
  }

  async archive(id: string, organizationId: string, userId: string) {
    const dept = await prisma.department.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!dept) throw new NotFoundError('Department');

    const updated = await prisma.department.update({
      where: { id },
      data: { isActive: false, updatedById: userId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Department',
      entityId: id,
      action: 'UPDATE',
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });

    return updated;
  }

  async reactivate(id: string, organizationId: string, userId: string) {
    const dept = await prisma.department.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!dept) throw new NotFoundError('Department');

    const updated = await prisma.department.update({
      where: { id },
      data: { isActive: true, updatedById: userId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Department',
      entityId: id,
      action: 'UPDATE',
      oldValue: { isActive: false },
      newValue: { isActive: true },
    });

    return updated;
  }

  async softDelete(id: string, organizationId: string, userId: string) {
    const dept = await prisma.department.findFirst({
      where: { id, organizationId },
    });
    if (!dept) throw new NotFoundError('Department');

    const assigned = await prisma.employee.count({
      where: { departmentId: id, deletedAt: null },
    });
    if (assigned > 0) {
      throw new BadRequestError(`Cannot delete — ${assigned} employee${assigned > 1 ? 's are' : ' is'} assigned to this department. Reassign them first.`);
    }

    await prisma.department.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'Department',
      entityId: id,
      action: 'DELETE',
      oldValue: { name: dept.name },
    });
  }
}

export const departmentService = new DepartmentService();
