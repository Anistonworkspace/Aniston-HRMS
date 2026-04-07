import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

interface AuditLogParams {
  userId: string;
  organizationId: string;
  entity: string;      // e.g. 'Employee', 'LeaveRequest', 'PayrollRun'
  entityId: string;
  action: string;       // 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT'
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
}

export async function createAuditLog(params: AuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        organizationId: params.organizationId,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        oldValue: params.oldValue || null,
        newValue: params.newValue || null,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (err) {
    // Don't let audit logging failures break the main operation
    logger.error('Audit log failed:', err);
  }
}
