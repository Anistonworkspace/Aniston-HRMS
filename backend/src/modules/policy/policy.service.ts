import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import type { CreatePolicyInput, UpdatePolicyInput } from './policy.validation.js';

export class PolicyService {
  async list(organizationId: string, employeeId?: string) {
    const policies = await prisma.policy.findMany({
      where: { organizationId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { acknowledgments: true } },
        ...(employeeId ? { acknowledgments: { where: { employeeId }, take: 1 } } : {}),
      },
    });
    return policies;
  }

  async getById(id: string) {
    const policy = await prisma.policy.findUnique({
      where: { id },
      include: { acknowledgments: true, _count: { select: { acknowledgments: true } } },
    });
    return policy;
  }

  async create(data: CreatePolicyInput, organizationId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestError('A PDF or document file is required');
    }

    const filePath = `/uploads/${file.filename}`;
    const policy = await prisma.policy.create({
      data: {
        title: data.title,
        filePath,
        fileName: file.originalname,
        organizationId,
      },
    });
    return policy;
  }

  async update(id: string, data: UpdatePolicyInput, file?: Express.Multer.File) {
    const existing = await prisma.policy.findUnique({ where: { id } });
    if (!existing) throw new BadRequestError('Policy not found');

    const updateData: any = {
      version: existing.version + 1,
    };

    if (data.title) updateData.title = data.title;
    if (file) {
      updateData.filePath = `/uploads/${file.filename}`;
      updateData.fileName = file.originalname;
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: updateData,
    });
    return policy;
  }

  async acknowledge(policyId: string, employeeId: string | undefined) {
    if (!employeeId) {
      throw new BadRequestError('No employee profile');
    }
    const ack = await prisma.policyAcknowledgment.create({
      data: { policyId, employeeId },
    });
    return ack;
  }
}

export const policyService = new PolicyService();
