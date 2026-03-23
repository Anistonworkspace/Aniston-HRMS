import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import type { CreateDesignationInput, UpdateDesignationInput } from './designation.validation.js';

export class DesignationService {
  async list(organizationId: string) {
    const designations = await prisma.designation.findMany({
      where: { organizationId, deletedAt: null },
      include: { _count: { select: { employees: true } } },
      orderBy: { level: 'asc' },
    });
    return designations;
  }

  async create(data: CreateDesignationInput, organizationId: string) {
    const desig = await prisma.designation.create({
      data: { ...data, organizationId },
    });
    return desig;
  }

  async update(id: string, data: UpdateDesignationInput) {
    const desig = await prisma.designation.update({
      where: { id },
      data,
    });
    return desig;
  }

  async softDelete(id: string, organizationId: string) {
    const d = await prisma.designation.findFirst({
      where: { id, organizationId },
    });
    if (!d) throw new NotFoundError('Designation');

    await prisma.designation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const designationService = new DesignationService();
