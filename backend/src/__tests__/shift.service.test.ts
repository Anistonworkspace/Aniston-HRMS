/**
 * Tests for ShiftService — overlap detection, soft-delete filtering,
 * same-startDate idempotency, and open-ended assignment closure.
 *
 * Also covers the EmployeeService workMode-strip invariant: employee.update()
 * must never write workMode to the DB (it is derived from ShiftAssignment only).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs ────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    employee: { findFirst: vi.fn(), update: vi.fn() },
    shift: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    shiftAssignment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-id' }) },
    user: { update: vi.fn() },
    salaryHistory: { create: vi.fn() },
  },
}));

vi.mock('../sockets/index.js', () => ({
  emitToUser: vi.fn(),
  emitToOrg: vi.fn(),
  invalidateDashboardCache: vi.fn().mockReturnValue(Promise.resolve(undefined)),
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

vi.mock('../services/storage.service.js', () => ({
  storageService: { deleteFile: vi.fn(), uploadFile: vi.fn(), getSignedUrl: vi.fn() },
}));

vi.mock('../utils/encryption.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
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

// ── Imports after mocks ───────────────────────────────────────────────────────
import { ShiftService } from '../modules/shift/shift.service.js';
import { EmployeeService } from '../modules/employee/employee.service.js';
import { prisma } from '../lib/prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID   = 'org-shift-001';
const EMP_ID   = 'emp-shift-001';
const SHIFT_ID = 'shift-office-001';
const ADMIN_ID = 'user-admin-001';

function makeDbEmployee(overrides: Record<string, any> = {}) {
  return {
    id: EMP_ID,
    organizationId: ORG_ID,
    status: 'ACTIVE',
    workMode: 'OFFICE',
    userId: 'user-001',
    deletedAt: null,
    email: 'emp@example.com',
    firstName: 'Tom',
    lastName: 'Jones',
    ctc: null,
    managerId: null,
    ...overrides,
  };
}

function makeDbShift(overrides: Record<string, any> = {}) {
  return {
    id: SHIFT_ID,
    organizationId: ORG_ID,
    name: 'General Shift',
    code: 'GENERAL-SHIFT',
    shiftType: 'OFFICE',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 15,
    weekOffDays: [],
    isDefault: true,
    isActive: true,
    sundayWorkEnabled: false,
    sundayPayMultiplier: 2.0,
    trackingIntervalMinutes: 60,
    ...overrides,
  };
}

function makeAssignment(overrides: Record<string, any> = {}) {
  return {
    id: 'sa-001',
    employeeId: EMP_ID,
    shiftId: SHIFT_ID,
    organizationId: ORG_ID,
    startDate: new Date('2026-04-01'),
    endDate: null,
    assignedBy: ADMIN_ID,
    locationId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    shift: makeDbShift(),
    location: null,
    employee: { firstName: 'Tom', lastName: 'Jones', employeeCode: 'EMP-001', workMode: 'OFFICE' },
    ...overrides,
  };
}

/** Returns an AssignShiftInput-shaped object */
function makeAssignInput(overrides: Record<string, any> = {}) {
  return {
    employeeId: EMP_ID,
    shiftId: SHIFT_ID,
    startDate: '2026-05-01',
    endDate: undefined,
    locationId: undefined,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — ShiftService.assignShift
// ─────────────────────────────────────────────────────────────────────────────

describe('ShiftService — assignShift', () => {
  let service: ShiftService;

  beforeEach(() => {
    service = new ShiftService();
    vi.resetAllMocks();
    // Restore stubs after reset
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(makeDbEmployee() as any);
    vi.mocked(prisma.shift.findFirst).mockResolvedValue(makeDbShift() as any);
  });

  it('rejects a forward bounded overlap (existing May 10–20, new May 1–15)', async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      const txMock = {
        shiftAssignment: {
          // sameStart check: no existing assignment starting May 1
          findFirst: vi.fn()
            .mockResolvedValueOnce(null)
            // overlap check: existing bounded assignment May 10–20 overlaps new May 1–15
            .mockResolvedValueOnce({
              id: 'sa-overlap',
              startDate: new Date('2026-05-10'),
              endDate: new Date('2026-05-20'),
            }),
          create: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
        employee: { update: vi.fn() },
      };
      return fn(txMock);
    });

    await expect(
      service.assignShift(
        makeAssignInput({ startDate: '2026-05-01', endDate: '2026-05-15' }) as any,
        ORG_ID,
        ADMIN_ID,
      )
    ).rejects.toThrow(/Shift assignment conflict/i);
  });

  it('updates existing row instead of creating duplicate when same startDate is resubmitted', async () => {
    const existingAssign = makeAssignment({ id: 'sa-existing', startDate: new Date('2026-05-01') });

    let txShiftAssign: any;
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      txShiftAssign = {
        shiftAssignment: {
          // sameStart check: found — same start date
          findFirst: vi.fn()
            .mockResolvedValueOnce(existingAssign)
            // overlap check: nothing overlaps (sameStart excluded via NOT clause)
            .mockResolvedValueOnce(null),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue(existingAssign),
          updateMany: vi.fn(),
        },
        employee: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(txShiftAssign);
    });

    await service.assignShift(
      makeAssignInput({ startDate: '2026-05-01' }) as any,
      ORG_ID,
      ADMIN_ID,
    );

    // update called, create NOT called
    expect(txShiftAssign.shiftAssignment.update).toHaveBeenCalledOnce();
    expect(txShiftAssign.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it('succeeds and creates assignment when only soft-deleted rows exist in the date range', async () => {
    let txShiftAssign: any;
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      txShiftAssign = {
        shiftAssignment: {
          // Both findFirst calls return null — soft-deleted rows are excluded by deletedAt:null filter
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(makeAssignment()),
          update: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        employee: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(txShiftAssign);
    });

    await service.assignShift(makeAssignInput() as any, ORG_ID, ADMIN_ID);

    expect(txShiftAssign.shiftAssignment.create).toHaveBeenCalledOnce();
    expect(txShiftAssign.shiftAssignment.update).not.toHaveBeenCalled();
  });

  it('closes open-ended previous assignment when a new one is assigned', async () => {
    let txShiftAssign: any;
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      txShiftAssign = {
        shiftAssignment: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(makeAssignment({ startDate: new Date('2026-05-01') })),
          update: vi.fn(),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        employee: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(txShiftAssign);
    });

    await service.assignShift(makeAssignInput({ startDate: '2026-05-01' }) as any, ORG_ID, ADMIN_ID);

    // updateMany must have been called to close the previous open-ended assignment
    expect(txShiftAssign.shiftAssignment.updateMany).toHaveBeenCalledOnce();
    const updateManyCall = txShiftAssign.shiftAssignment.updateMany.mock.calls[0][0];
    expect(updateManyCall.where.deletedAt).toBeNull();
    expect(updateManyCall.where.endDate).toBeNull();
    expect(updateManyCall.data.endDate).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — ShiftService.getEmployeeShift
// ─────────────────────────────────────────────────────────────────────────────

describe('ShiftService — getEmployeeShift', () => {
  let service: ShiftService;

  beforeEach(() => {
    service = new ShiftService();
    vi.resetAllMocks();
  });

  it('returns null when only soft-deleted assignments exist (deletedAt filter active)', async () => {
    // Simulate DB returning null because the only matching row has deletedAt set
    vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce(null);

    const result = await service.getEmployeeShift(EMP_ID);

    expect(result).toBeNull();
    // Verify the query includes deletedAt: null in the where clause
    const findFirstCall = vi.mocked(prisma.shiftAssignment.findFirst).mock.calls[0][0];
    expect((findFirstCall?.where as any)?.deletedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — EmployeeService workMode strip invariant
// ─────────────────────────────────────────────────────────────────────────────

describe('EmployeeService — workMode strip', () => {
  let service: EmployeeService;

  beforeEach(() => {
    service = new EmployeeService();
    vi.resetAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
  });

  it('never passes workMode to prisma.employee.update even when caller supplies it', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeDbEmployee() as any);

    let capturedUpdateData: any = null;
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      const txMock = {
        employee: {
          update: vi.fn().mockImplementation(({ data }: any) => {
            capturedUpdateData = data;
            return Promise.resolve({ ...makeDbEmployee(), department: null, designation: null });
          }),
        },
        user: { update: vi.fn() },
        salaryHistory: { create: vi.fn() },
        shiftAssignment: { updateMany: vi.fn(), create: vi.fn() },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-id' }) },
      };
      return fn(txMock);
    });

    await service.update(
      EMP_ID,
      { workMode: 'FIELD_SALES', firstName: 'UpdatedName' } as any,
      ORG_ID,
      ADMIN_ID,
      'SUPER_ADMIN',
    );

    expect(capturedUpdateData).toBeDefined();
    expect(capturedUpdateData.workMode).toBeUndefined();
    expect(capturedUpdateData.firstName).toBe('UpdatedName');
  });
});
