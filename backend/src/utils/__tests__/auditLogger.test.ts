import { describe, it, expect, vi } from 'vitest';

// Mock prisma before importing the module
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
    },
  },
}));

import { createAuditLog } from '../auditLogger.js';
import { prisma } from '../../lib/prisma.js';

describe('createAuditLog', () => {
  it('should create an audit log entry', async () => {
    await createAuditLog({
      userId: 'user-1',
      organizationId: 'org-1',
      entity: 'Employee',
      entityId: 'emp-1',
      action: 'CREATE',
      newValue: { name: 'John Doe' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        organizationId: 'org-1',
        entity: 'Employee',
        entityId: 'emp-1',
        action: 'CREATE',
        newValue: { name: 'John Doe' },
      }),
    });
  });

  it('should not throw when prisma fails', async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error('DB error'));

    // Should not throw
    await expect(
      createAuditLog({
        userId: 'user-1',
        organizationId: 'org-1',
        entity: 'Employee',
        entityId: 'emp-1',
        action: 'DELETE',
      })
    ).resolves.not.toThrow();
  });
});
