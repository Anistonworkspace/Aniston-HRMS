import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import type { CreateDepartmentInput, UpdateDepartmentInput } from './department.validation.js';

export class DepartmentService {
  async list(organizationId: string) {
    const departments = await prisma.department.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        _count: { select: { employees: true } },
        head: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { name: 'asc' },
    });
    return departments;
  }

  async create(data: CreateDepartmentInput, organizationId: string) {
    const dept = await prisma.department.create({
      data: { ...data, organizationId },
    });
    return dept;
  }

  async update(id: string, data: UpdateDepartmentInput) {
    const dept = await prisma.department.update({
      where: { id },
      data,
    });
    return dept;
  }

  async softDelete(id: string, organizationId: string) {
    const dept = await prisma.department.findFirst({
      where: { id, organizationId },
    });
    if (!dept) throw new NotFoundError('Department');

    await prisma.department.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const departmentService = new DepartmentService();
