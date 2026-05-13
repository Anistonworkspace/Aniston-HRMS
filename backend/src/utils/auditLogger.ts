import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { logger } from '../lib/logger.js';

export interface AuditLogParams {
  userId: string | null;
  organizationId: string;
  entity: string;      // e.g. 'Employee', 'LeaveRequest', 'PayrollRun'
  entityId: string;
  action: string;       // 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT'
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
}

export async function createAuditLog(params: AuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        organizationId: params.organizationId,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        oldValue: params.oldValue !== undefined ? (params.oldValue as Prisma.InputJsonValue) : Prisma.JsonNull,
        newValue: params.newValue !== undefined ? (params.newValue as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    // Don't let audit logging failures break the main operation
    logger.error('Audit log failed:', err);
  }
}
