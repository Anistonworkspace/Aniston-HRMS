/**
 * Tests for LeaveService — balance checks, overlap detection, state machine,
 * optimistic lock (G-01), and balance deduction atomicity.
 *
 * All external dependencies are mocked. No real database calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs ────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    leaveType: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    leaveBalance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    leaveRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    holiday: { findMany: vi.fn(), findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    policy: { findFirst: vi.fn() },
    policyAcknowledgment: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    leaveApprovalDecision: { create: vi.fn() },
    leaveNotificationLog: { create: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-id' }) },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../jobs/queues.js', () => ({
  emailQueue: { add: vi.fn() },
  notificationQueue: { add: vi.fn() },
  payrollQueue: { add: vi.fn() },
  bulkResumeQueue: { add: vi.fn() },
  enqueueEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/auditLogger.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sockets/index.js', () => ({
  emitToOrg: vi.fn(),
  emitToUser: vi.fn(),
  invalidateDashboardCache: vi.fn().mockReturnValue(Promise.resolve(undefined)),
}));

vi.mock('../modules/task-integration/task-integration.service.js', () => ({
  taskIntegrationService: {
    auditTasksForLeave: vi.fn().mockResolvedValue({ integrationStatus: 'SKIPPED', riskLevel: 'LOW', riskScore: 0 }),
    getActiveConfig: vi.fn().mockResolvedValue(null),
    persistAudit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../modules/leave/leave-policy.service.js', () => ({
  leavePolicyService: {
    getOrCreateDefaultPolicy: vi.fn().mockResolvedValue({
      id: 'policy-001',
      organizationId: 'org-leave-001',
      allowUnpaidLeave: true,
      maxPaidLeavesPerMonth: 0,
      rules: [],
    }),
    getEmployeeCategory: vi.fn().mockReturnValue('ACTIVE'),
    _resolveFromPolicy: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-characters-long',
    FRONTEND_URL: 'http://localhost:5173',
  },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { LeaveService } from '../modules/leave/leave.service.js';
import { prisma } from '../lib/prisma.js';
import { invalidateDashboardCache } from '../sockets/index.js';
import { leavePolicyService } from '../modules/leave/leave-policy.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-leave-001';
const EMP_ID = 'emp-leave-001';
const LEAVE_TYPE_ID = 'lt-annual-001';

function makeEmployee(overrides: Record<string, any> = {}) {
  return {
    id: EMP_ID,
    organizationId: ORG_ID,
    firstName: 'Jane',
    lastName: 'Smith',
    gender: 'FEMALE',
    joiningDate: new Date('2023-01-01'),
    status: 'ACTIVE',
    email: 'jane@aniston.com',
    managerId: null,
    userId: 'user-leave-001',
    user: { role: 'EMPLOYEE' },
    ...overrides,
  };
}

function makeLeaveType(overrides: Record<string, any> = {}) {
  return {
    id: LEAVE_TYPE_ID,
    name: 'Annual Leave',
    code: 'AL',
    isActive: true,
    isPaid: true,
    requiresApproval: true,
    allowSameDay: true,
    allowWeekendAdjacent: true,
    allowPastDates: true,
    noticeDays: 0,
    maxDays: null,
    minDays: null,
    maxPerMonth: null,
    gender: null,
    applicableTo: 'ALL',
    applicableToRole: null,
    applicableToEmployeeIds: null,
    probationMonths: 0,
    maxAdvanceDays: null,
    defaultBalance: 12,
    organizationId: ORG_ID,
    ...overrides,
  };
}

function makeBalance(overrides: Record<string, any> = {}) {
  return {
    id: 'bal-001',
    employeeId: EMP_ID,
    leaveTypeId: LEAVE_TYPE_ID,
    year: new Date().getFullYear(),
    allocated: 12,
    used: 0,
    pending: 0,
    carriedForward: 0,
    ...overrides,
  };
}

function makeLeaveRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'req-001',
    employeeId: EMP_ID,
    leaveTypeId: LEAVE_TYPE_ID,
    startDate: new Date('2027-06-10'),
    endDate: new Date('2027-06-11'),
    days: 2,
    status: 'PENDING',
    reason: 'Family trip',
    isHalfDay: false,
    halfDaySession: null,
    riskLevel: 'LOW',
    riskScore: 0,
    backupEmployeeId: null,
    noticeHours: 48,
    leaveType: { name: 'Annual Leave', code: 'AL' },
    employee: { managerId: null, userId: 'user-leave-001', organizationId: ORG_ID, firstName: 'Jane', lastName: 'Smith' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — LeaveService
// ─────────────────────────────────────────────────────────────────────────────

describe('LeaveService', () => {
  let service: LeaveService;

  beforeEach(() => {
    service = new LeaveService();
    vi.resetAllMocks();
    // Restore essential mocks after resetAllMocks
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
    vi.mocked(prisma.leaveApprovalDecision.create).mockResolvedValue({} as any);
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([]);
    vi.mocked(prisma.holiday.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.policy.findFirst).mockResolvedValue(null); // no leave policy requiring ack
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      workingDays: '1,2,3,4,5,6',
    } as any);
    // invalidateDashboardCache must return a Promise (service calls .catch() on return value)
    vi.mocked(invalidateDashboardCache).mockReturnValue(Promise.resolve(undefined));
  });

  // ── applyLeave — balance checks ───────────────────────────────────────────

  describe('applyLeave — balance check', () => {
    it('throws BadRequestError when days > available and allowUnpaidLeave is disabled', async () => {
      // When HR disables unpaid leave, excess-balance requests must still be rejected
      vi.mocked(leavePolicyService.getOrCreateDefaultPolicy).mockResolvedValue({
        id: 'policy-001',
        organizationId: ORG_ID,
        allowUnpaidLeave: false,
        maxPaidLeavesPerMonth: 0,
        rules: [],
      } as any);

      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(makeEmployee() as any);
      vi.mocked(prisma.leaveType.findFirst).mockResolvedValueOnce(makeLeaveType() as any);
      vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(0);

      // Balance: 2 available but requesting 3
      const balance = makeBalance({ allocated: 5, used: 3, pending: 0, carriedForward: 0 });
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValueOnce(balance as any);

      await expect(
        service.applyLeave(EMP_ID, {
          leaveTypeId: LEAVE_TYPE_ID,
          startDate: '2027-06-10',
          endDate: '2027-06-12', // 3 days Mon-Wed
          reason: 'Vacation',
          isHalfDay: false,
        } as any)
      ).rejects.toThrow(/Insufficient.*balance/i);

      // Restore default for subsequent tests
      vi.mocked(leavePolicyService.getOrCreateDefaultPolicy).mockResolvedValue({
        id: 'policy-001',
        organizationId: ORG_ID,
        allowUnpaidLeave: true,
        maxPaidLeavesPerMonth: 0,
        rules: [],
      } as any);
    });

    it('auto-splits excess days as unpaid when allowUnpaidLeave is enabled', async () => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(makeEmployee() as any);
      vi.mocked(prisma.leaveType.findFirst).mockResolvedValueOnce(makeLeaveType() as any);
      vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(0);

      // 2 days available, requesting 3 — 1 day should auto-split to unpaid
      const balance = makeBalance({ allocated: 5, used: 3, pending: 0, carriedForward: 0 });
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValueOnce(balance as any);

      const createdRequest = makeLeaveRequest({ days: 3 });
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(createdRequest),
          },
          leaveBalance: { update: vi.fn().mockResolvedValue({}) },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return fn(txMock);
      });

      const result = await service.applyLeave(EMP_ID, {
        leaveTypeId: LEAVE_TYPE_ID,
        startDate: '2027-06-10',
        endDate: '2027-06-12',
        reason: 'Vacation',
        isHalfDay: false,
      } as any);

      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
    });

    it('allows application when balance is sufficient', async () => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(makeEmployee() as any);
      vi.mocked(prisma.leaveType.findFirst).mockResolvedValueOnce(makeLeaveType() as any);
      vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(0);

      // 10 days available, requesting 2
      const balance = makeBalance({ allocated: 12, used: 0, pending: 0, carriedForward: 0 });
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValueOnce(balance as any);

      const createdRequest = makeLeaveRequest();
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            findFirst: vi.fn().mockResolvedValue(null), // no overlap
            create: vi.fn().mockResolvedValue(createdRequest),
          },
          leaveBalance: { update: vi.fn().mockResolvedValue({}) },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return fn(txMock);
      });

      const result = await service.applyLeave(EMP_ID, {
        leaveTypeId: LEAVE_TYPE_ID,
        startDate: '2027-06-10',
        endDate: '2027-06-11',
        reason: 'Vacation',
        isHalfDay: false,
      } as any);

      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING');
    });
  });

  // ── applyLeave — overlap detection ────────────────────────────────────────

  describe('applyLeave — overlap detection', () => {
    it('throws BadRequestError when an overlapping request exists (G-02 inside transaction)', async () => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(makeEmployee() as any);
      vi.mocked(prisma.leaveType.findFirst).mockResolvedValueOnce(makeLeaveType() as any);
      vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(0);

      const balance = makeBalance({ allocated: 12, used: 0, pending: 0, carriedForward: 0 });
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValueOnce(balance as any);

      // Transaction re-check finds overlap
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            findFirst: vi.fn().mockResolvedValue(makeLeaveRequest({ status: 'PENDING' })),
            create: vi.fn(),
          },
          leaveBalance: { update: vi.fn() },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { upsert: vi.fn() },
        };
        return fn(txMock);
      });

      await expect(
        service.applyLeave(EMP_ID, {
          leaveTypeId: LEAVE_TYPE_ID,
          startDate: '2027-06-10',
          endDate: '2027-06-11',
          reason: 'Vacation',
          isHalfDay: false,
        } as any)
      ).rejects.toThrow(/already have a leave request/i);
    });
  });

  // ── handleLeaveAction — state machine ─────────────────────────────────────

  describe('handleLeaveAction — state machine', () => {
    it('throws BadRequestError when trying to APPROVE a REJECTED request', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'REJECTED' }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'HR' } as any);

      await expect(
        service.handleLeaveAction('req-001', 'APPROVED', 'approver-001', 'OK', ORG_ID)
      ).rejects.toThrow(/Cannot.*APPROVED.*REJECTED/i);
    });

    it('throws BadRequestError when MANAGER tries to APPROVE (not first-step)', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'PENDING' }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'MANAGER' } as any);

      await expect(
        service.handleLeaveAction('req-001', 'APPROVED', 'mgr-001', 'Looks good', ORG_ID)
      ).rejects.toThrow(/Managers can only perform first-step approval/i);
    });

    it('allows MANAGER_APPROVED on a PENDING request when actor is MANAGER', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'PENDING' }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'MANAGER' } as any);

      const updatedRequest = makeLeaveRequest({ status: 'MANAGER_APPROVED' });
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            update: vi.fn().mockResolvedValue(updatedRequest),
          },
          leaveBalance: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { upsert: vi.fn() },
          user: { findUnique: vi.fn().mockResolvedValue({ role: 'MANAGER' }) },
          leaveApprovalDecision: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(txMock);
      });

      const result = await service.handleLeaveAction('req-001', 'MANAGER_APPROVED', 'mgr-001', 'Good', ORG_ID);

      expect(result.status).toBe('MANAGER_APPROVED');
    });

    it('throws BadRequestError for invalid org boundary (different organization)', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({
          employee: {
            managerId: null,
            userId: 'user-leave-001',
            organizationId: 'org-different',
            firstName: 'Jane',
            lastName: 'Smith',
          },
        }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'HR' } as any);

      await expect(
        service.handleLeaveAction('req-001', 'APPROVED', 'approver-001', 'OK', ORG_ID)
      ).rejects.toThrow(/Unauthorized.*organization/i);
    });
  });

  // ── handleLeaveAction — optimistic lock (G-01) ────────────────────────────

  describe('handleLeaveAction — optimistic lock (G-01)', () => {
    it('throws BadRequestError when P2025 occurs (concurrent approval)', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'PENDING' }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'HR' } as any);

      // Simulate P2025 from Prisma (record not found because another approver acted first)
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const p2025Error = Object.assign(new Error('Record not found'), { code: 'P2025' });
        const txMock = {
          leaveRequest: {
            update: vi.fn().mockRejectedValue(p2025Error),
          },
          leaveBalance: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          user: { findUnique: vi.fn().mockResolvedValue({ role: 'HR' }) },
          leaveApprovalDecision: { create: vi.fn() },
        };
        return fn(txMock);
      });

      await expect(
        service.handleLeaveAction('req-001', 'APPROVED', 'approver-001', 'Approved', ORG_ID)
      ).rejects.toThrow(/already acted on/i);
    });
  });

  // ── handleLeaveAction — balance deduction atomicity ───────────────────────

  describe('handleLeaveAction — balance deduction atomicity', () => {
    it('calls leaveBalance.update with used increment on APPROVED', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'PENDING' }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'HR' } as any);

      const balanceUpdateMock = vi.fn().mockResolvedValue({});
      const leaveBalanceFindUnique = vi.fn().mockResolvedValue(makeBalance({ pending: 2 }));

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            update: vi.fn().mockResolvedValue(makeLeaveRequest({ status: 'APPROVED' })),
          },
          leaveBalance: { findUnique: leaveBalanceFindUnique, update: balanceUpdateMock },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { upsert: vi.fn().mockResolvedValue({}) },
          user: { findUnique: vi.fn().mockResolvedValue({ role: 'HR' }) },
          leaveApprovalDecision: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(txMock);
      });

      await service.handleLeaveAction('req-001', 'APPROVED', 'hr-001', 'OK', ORG_ID);

      expect(balanceUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            used: expect.objectContaining({ increment: 2 }),
          }),
        })
      );
    });

    it('calls leaveBalance.update with pending decrement on REJECTED (from PENDING)', async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'PENDING' }) as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'HR' } as any);

      const balanceUpdateMock = vi.fn().mockResolvedValue({});
      const leaveBalanceFindUnique = vi.fn().mockResolvedValue(makeBalance({ pending: 2 }));

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            update: vi.fn().mockResolvedValue(makeLeaveRequest({ status: 'REJECTED' })),
          },
          leaveBalance: { findUnique: leaveBalanceFindUnique, update: balanceUpdateMock },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { deleteMany: vi.fn().mockResolvedValue({}) },
          user: { findUnique: vi.fn().mockResolvedValue({ role: 'HR' }) },
          leaveApprovalDecision: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(txMock);
      });

      await service.handleLeaveAction('req-001', 'REJECTED', 'hr-001', 'Not approved', ORG_ID);

      expect(balanceUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pending: expect.objectContaining({ decrement: expect.any(Number) }),
          }),
        })
      );
    });
  });

  // ── cancelLeave ───────────────────────────────────────────────────────────

  describe('cancelLeave', () => {
    it('throws BadRequestError when leave is already REJECTED', async () => {
      vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValueOnce(
        makeLeaveRequest({ status: 'REJECTED' }) as any
      );

      await expect(service.cancelLeave('req-001', EMP_ID)).rejects.toThrow(
        /cannot be cancelled/i
      );
    });

    it('throws NotFoundError when leave request does not exist', async () => {
      vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValueOnce(null);

      await expect(service.cancelLeave('ghost-req', EMP_ID)).rejects.toThrow(
        'Leave request not found'
      );
    });
  });

  // ── applyLeave — unpaid leave (no balance needed) ─────────────────────────

  describe('applyLeave — unpaid leave type', () => {
    it('does not throw balance error for unpaid leave even with 0 balance', async () => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(makeEmployee() as any);
      vi.mocked(prisma.leaveType.findFirst).mockResolvedValueOnce(
        makeLeaveType({ isPaid: false }) as any
      );
      vi.mocked(prisma.leaveRequest.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.leaveBalance.findUnique).mockResolvedValueOnce(null); // no balance record

      const createdRequest = makeLeaveRequest({ status: 'PENDING' });
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          leaveRequest: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(createdRequest),
          },
          leaveBalance: { update: vi.fn() },
          holiday: { findMany: vi.fn().mockResolvedValue([]) },
          attendanceRecord: { upsert: vi.fn() },
        };
        return fn(txMock);
      });

      const result = await service.applyLeave(EMP_ID, {
        leaveTypeId: LEAVE_TYPE_ID,
        startDate: '2027-06-10',
        endDate: '2027-06-10',
        reason: 'Personal',
        isHalfDay: false,
      } as any);

      expect(result.status).toBe('PENDING');
    });
  });
});
