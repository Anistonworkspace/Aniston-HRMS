import path from 'path';
import fs from 'fs';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import type { CreatePolicyInput, UpdatePolicyInput } from './policy.validation.js';

function getProjectRoot(): string {
  let base = process.cwd();
  if (base.endsWith('backend') || base.endsWith('backend\\') || base.endsWith('backend/')) {
    base = path.resolve(base, '..');
  }
  return base;
}

function deleteUploadedFile(fileUrl: string | null | undefined) {
  if (!fileUrl) return;
  const fullPath = path.join(getProjectRoot(), fileUrl);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch (err) {
      console.error(`[Policy] Failed to delete file: ${fullPath}`, err);
    }
  }
}

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

    const filePath = `/uploads/${file.filename}`;
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
      deleteUploadedFile(existing.filePath);
      updateData.filePath = `/uploads/${file.filename}`;
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
    deleteUploadedFile(existing.filePath);

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

  async acknowledge(policyId: string, employeeId: string | undefined) {
    if (!employeeId) {
      throw new BadRequestError('No employee profile');
    }
    const ack = await prisma.policyAcknowledgment.create({
      data: { policyId, employeeId },
    });
    return ack;
  }

  // Secure stream — returns file buffer with proper headers
  async streamFile(id: string, organizationId: string, employeeId: string | undefined, isAdmin: boolean) {
    const policy = await prisma.policy.findFirst({ where: { id, organizationId, isActive: true } });
    if (!policy || !policy.filePath) throw new NotFoundError('Policy');

    const fullPath = path.join(getProjectRoot(), policy.filePath);
    if (!fs.existsSync(fullPath)) throw new NotFoundError('Policy file');

    return {
      buffer: fs.readFileSync(fullPath),
      fileName: policy.fileName || 'policy.pdf',
      downloadAllowed: isAdmin || policy.downloadAllowed,
    };
  }
}

export const policyService = new PolicyService();
