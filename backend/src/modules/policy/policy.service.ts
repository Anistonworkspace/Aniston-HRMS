import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import type { CreatePolicyInput, UpdatePolicyInput, PolicyQuery } from './policy.validation.js';

export class PolicyService {
  async list(query: PolicyQuery, organizationId: string, employeeId?: string) {
    const where: any = { organizationId, isActive: true };
    if (query.category) where.category = query.category;

    const policies = await prisma.policy.findMany({
      where,
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

  async create(data: CreatePolicyInput, organizationId: string) {
    const policy = await prisma.policy.create({
      data: { ...data, organizationId },
    });
    return policy;
  }

  async update(id: string, data: UpdatePolicyInput) {
    const existing = await prisma.policy.findUnique({ where: { id } });
    const policy = await prisma.policy.update({
      where: { id },
      data: { ...data, version: (existing?.version || 0) + 1 },
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

  getCategories() {
    return [
      { value: 'HR_GENERAL', label: 'HR General' },
      { value: 'LEAVE', label: 'Leave Policy' },
      { value: 'HYBRID', label: 'Hybrid Work' },
      { value: 'WORK_MANAGEMENT', label: 'Work Management' },
      { value: 'ESCALATION', label: 'Escalation' },
      { value: 'IT', label: 'IT Policy' },
      { value: 'CODE_OF_CONDUCT', label: 'Code of Conduct' },
      { value: 'HEALTH_SAFETY', label: 'Health & Safety' },
    ];
  }
}

export const policyService = new PolicyService();
