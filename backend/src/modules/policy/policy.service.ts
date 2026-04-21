import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
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

  async getById(id: string, organizationId: string) {
    const policy = await prisma.policy.findFirst({
      where: { id, organizationId, isActive: true },
      include: { acknowledgments: true, _count: { select: { acknowledgments: true } } },
    });
    if (!policy) throw new NotFoundError('Policy');
    return policy;
  }

  async create(data: CreatePolicyInput, organizationId: string, userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestError('A PDF or document file is required');
    }

    const filePath = storageService.buildUrl(StorageFolder.POLICIES, file.filename);
    const policy = await prisma.policy.create({
      data: {
        title: data.title,
        filePath,
        fileName: file.originalname,
        downloadAllowed: data.downloadAllowed ?? false,
        organizationId,
        createdById: userId,
        updatedById: userId,
      },
    });

    await createAuditLog({
      userId,
      entity: 'Policy',
      entityId: policy.id,
      action: 'CREATE',
      newValue: { title: data.title, fileName: file.originalname },
      organizationId,
    });

    return policy;
  }

  async update(id: string, organizationId: string, userId: string, data: UpdatePolicyInput, file?: Express.Multer.File) {
    const existing = await prisma.policy.findFirst({ where: { id, organizationId, isActive: true } });
    if (!existing) throw new NotFoundError('Policy');

    const oldValue = { title: existing.title, fileName: existing.fileName };
    const updateData: any = {
      version: existing.version + 1,
      updatedById: userId,
    };

    if (data.title) updateData.title = data.title;
    if (data.downloadAllowed !== undefined) updateData.downloadAllowed = data.downloadAllowed;
    if (file) {
      // Delete the old file when replacing with a new one
      await storageService.deleteFile(existing.filePath);
      updateData.filePath = storageService.buildUrl(StorageFolder.POLICIES, file.filename);
      updateData.fileName = file.originalname;
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      userId,
      entity: 'Policy',
      entityId: id,
      action: 'UPDATE',
      oldValue,
      newValue: { title: policy.title, fileName: policy.fileName },
      organizationId,
    });

    return policy;
  }

  async delete(id: string, organizationId: string, userId: string) {
    const existing = await prisma.policy.findFirst({ where: { id, organizationId, isActive: true } });
    if (!existing) throw new NotFoundError('Policy');

    // Delete the physical file
    await storageService.deleteFile(existing.filePath);

    await prisma.policy.update({
      where: { id },
      data: { isActive: false },
    });

    await createAuditLog({
      userId,
      entity: 'Policy',
      entityId: id,
      action: 'DELETE',
      oldValue: { title: existing.title, fileName: existing.fileName },
      organizationId,
    });
  }

  async acknowledge(policyId: string, employeeId: string | undefined, organizationId: string) {
    if (!employeeId) throw new BadRequestError('No employee profile');
    // Verify policy belongs to the user's organization
    const policy = await prisma.policy.findFirst({ where: { id: policyId, organizationId, isActive: true } });
    if (!policy) throw new NotFoundError('Policy');
    // Idempotent — silently ignore if already acknowledged
    const existing = await prisma.policyAcknowledgment.findFirst({ where: { policyId, employeeId } });
    if (existing) return existing;
    const ack = await prisma.policyAcknowledgment.create({
      data: { policyId, employeeId },
    });
    return ack;
  }

  // Secure stream — returns file path for sendFile (streaming, not buffered)
  async streamFile(id: string, organizationId: string, employeeId: string | undefined, isAdmin: boolean) {
    const policy = await prisma.policy.findFirst({ where: { id, organizationId, isActive: true } });
    if (!policy) throw new NotFoundError('Policy');
    if (!policy.filePath) throw new NotFoundError('Policy has no file attached');

    const fullPath = storageService.resolvePath(policy.filePath);
    if (!fs.existsSync(fullPath)) {
      // Log for server-side diagnosis
      console.error(`[Policy] File not found on disk. id=${id} filePath=${policy.filePath} resolved=${fullPath}`);
      throw new NotFoundError('Policy file not found on server. Please re-upload the document.');
    }

    return {
      fullPath,
      fileName: policy.fileName || 'policy.pdf',
      downloadAllowed: isAdmin || policy.downloadAllowed,
    };
  }
}

export const policyService = new PolicyService();
