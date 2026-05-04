/**
 * Tests for AttendanceService — clock-in duplicate prevention, clock-out state
 * checks, and getTodayStatus.
 *
 * All external dependencies are mocked. No real database calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    employee: { findFirst: vi.fn(), findUnique: vi.fn() },
    attendanceRecord: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    attendanceLog: { create: vi.fn() },
    attendancePolicy: { findUnique: vi.fn() },
    leaveRequest: { findFirst: vi.fn() },
    holiday: { findFirst: vi.fn(), findMany: vi.fn() },
    shiftAssignment: { findFirst: vi.fn() },
    shift: { findFirst: vi.fn() },
    projectSiteCheckIn: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
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

// ── Imports after mocks ───────────────────────────────────────────────────────
import { AttendanceService } from '../modules/attendance/attendance.service.js';
import { prisma } from '../lib/prisma.js';
import { invalidateDashboardCache } from '../sockets/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-att-001';
const EMP_ID = 'emp-att-001';

function makeEmployee(overrides: Record<string, any> = {}) {
  return {
    id: EMP_ID,
    firstName: 'Tom',
    lastName: 'Jones',
    employeeCode: 'EMP-ATT-001',
    organizationId: ORG_ID,
    status: 'ACTIVE',
    workMode: 'OFFICE',
    deletedAt: null,
    allowSundayWork: false,
    officeLocation: {
      id: 'loc-001',
      name: 'HQ',
      geofence: {
        id: 'geo-001',
        radiusMeters: 200,
        strictMode: false,
        coordinates: { lat: 12.9716, lng: 77.5946 },
      },
    },
    ...overrides,
  };
}

function makeAttendanceRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'rec-att-001',
    employeeId: EMP_ID,
    date: new Date(),
    checkIn: new Date(),
    checkOut: null,
    status: 'PRESENT',
    workMode: 'OFFICE',
    source: 'MANUAL_APP',
    notes: null,
    geofenceViolation: false,
    clockInCount: 1,
    totalHours: null,
    breaks: [],
    logs: [],
    ...overrides,
  };
}

function makeClockInData(overrides: Record<string, any> = {}) {
  return {
    deviceType: 'mobile',
    isPwa: false,
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 10,
    source: 'MANUAL_APP',
    ...overrides,
  };
}

function makeClockOutData(overrides: Record<string, any> = {}) {
  return {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 10,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — AttendanceService
// ─────────────────────────────────────────────────────────────────────────────

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(() => {
    // Pin clock to 08:30 IST (03:00 UTC) on a Tuesday — within the 60-min
    // pre-shift window for a 09:00 shift, so early-clock-in guard never fires.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T03:00:00.000Z'));

    service = new AttendanceService();
    vi.resetAllMocks();
    // Restore essential mocks after resetAllMocks
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
    vi.mocked(prisma.attendanceLog.create).mockResolvedValue({ id: 'log-001' } as any);
    vi.mocked(prisma.holiday.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([]);
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValue(null);
    // Return a default shift so clockIn doesn't fail with "No shift assigned".
    // weekOffDays: [] so tests pass on any day of the week (including Sunday).
    vi.mocked(prisma.shift.findFirst).mockResolvedValue({
      id: 'shift-default-001',
      name: 'Default Shift',
      isDefault: true,
      isActive: true,
      weekOffDays: [],
      sundayWorkEnabled: false,
      sundayPayMultiplier: 2.0,
      startTime: '09:00',
      endTime: '18:00',
    } as any);
    vi.mocked(prisma.attendancePolicy.findUnique).mockResolvedValue({
      weekOffDays: [],
      sundayWorkEnabled: false,
      lateGraceMinutes: 15,
      lateHalfDayAfterMins: 60,
    } as any);
    // invalidateDashboardCache must return a Promise (service calls .catch() on the return value)
    vi.mocked(invalidateDashboardCache).mockReturnValue(Promise.resolve(undefined));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── clockIn — duplicate prevention ────────────────────────────────────────

  describe('clockIn — duplicate prevention', () => {
    it('throws BadRequestError with "Already clocked in" when employee has active session', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeEmployee() as any);

      // $transaction finds an existing record with checkIn set and no checkOut → already clocked in
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const activeRecord = makeAttendanceRecord({ checkIn: new Date(), checkOut: null });
        const txMock = {
          attendanceRecord: {
            findUnique: vi.fn().mockResolvedValue(activeRecord),
          },
        };
        return fn(txMock);
      });

      await expect(
        service.clockIn(EMP_ID, makeClockInData() as any, ORG_ID)
      ).rejects.toThrow(/Already clocked in/i);
    });

    it('creates a new attendance record when no record exists for today', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeEmployee() as any);

      const newRecord = makeAttendanceRecord();

      // $transaction: no existing record → returns null
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          attendanceRecord: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        };
        return fn(txMock);
      });

      vi.mocked(prisma.attendanceRecord.upsert).mockResolvedValueOnce(newRecord as any);
      vi.mocked(prisma.attendanceLog.create).mockResolvedValueOnce({ id: 'log-001' } as any);

      const result = await service.clockIn(EMP_ID, makeClockInData() as any, ORG_ID);

      expect(prisma.attendanceRecord.upsert).toHaveBeenCalled();
      expect(result.status).toBe('PRESENT');
    });

    it('throws BadRequestError when trying to clock in from a non-mobile device', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeEmployee() as any);

      await expect(
        service.clockIn(EMP_ID, makeClockInData({ deviceType: 'desktop', isPwa: false }) as any, ORG_ID)
      ).rejects.toThrow(/mobile device/i);
    });

    it('allows clock-in from PWA even if deviceType is not mobile', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeEmployee() as any);

      const newRecord = makeAttendanceRecord();

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          attendanceRecord: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        return fn(txMock);
      });

      vi.mocked(prisma.attendanceRecord.upsert).mockResolvedValueOnce(newRecord as any);
      vi.mocked(prisma.attendanceLog.create).mockResolvedValueOnce({ id: 'log-001' } as any);

      // isPwa=true should bypass the mobile-only check
      const result = await service.clockIn(
        EMP_ID,
        makeClockInData({ deviceType: 'desktop', isPwa: true }) as any,
        ORG_ID
      );

      expect(result.status).toBe('PRESENT');
    });
  });

  // ── clockOut — state checks ────────────────────────────────────────────────

  describe('clockOut — state checks', () => {
    it('throws BadRequestError "Already clocked out for today" when record has checkOut set', async () => {
      const alreadyClockedOut = makeAttendanceRecord({
        checkIn: new Date(Date.now() - 8 * 60 * 60 * 1000),
        checkOut: new Date(),
      });

      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ status: 'ACTIVE' } as any);
      // No shift assignment → shiftType defaults to 'OFFICE', no geofence, but lat/lng supplied so location check passes
      vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce(null);

      // $transaction finds today's record with checkOut already set
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          attendanceRecord: {
            findUnique: vi.fn()
              .mockResolvedValueOnce(alreadyClockedOut) // today's record
              .mockResolvedValueOnce(null),             // yesterday (not needed)
            update: vi.fn(),
          },
        };
        return fn(txMock);
      });

      await expect(
        service.clockOut(EMP_ID, makeClockOutData() as any)
      ).rejects.toThrow(/Already clocked out/i);
    });

    it('throws BadRequestError "No clock-in found" when no record exists for today or yesterday', async () => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ status: 'ACTIVE' } as any);
      // No shift assignment → lat/lng supplied so location check passes
      vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce(null);

      // $transaction: no record today, no record yesterday
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txMock = {
          attendanceRecord: {
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
        };
        return fn(txMock);
      });

      await expect(
        service.clockOut(EMP_ID, makeClockOutData() as any)
      ).rejects.toThrow(/No clock-in found/i);
    });
  });

  // ── clockIn — shift snapshot ──────────────────────────────────────────────

  describe('clockIn — shift snapshot', () => {
    it('stores shiftId and shiftAssignmentId when active assignment exists', async () => {
      const SNAP_SHIFT_ID = 'shift-snap-001';
      const SNAP_ASSIGN_ID = 'sa-snap-001';

      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeEmployee() as any);

      // Active assignment overrides the default shift
      vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce({
        id: SNAP_ASSIGN_ID,
        shiftId: SNAP_SHIFT_ID,
        employeeId: EMP_ID,
        startDate: new Date('2026-01-01'),
        endDate: null,
        shift: {
          id: SNAP_SHIFT_ID,
          name: 'General Shift',
          shiftType: 'OFFICE',
          isDefault: false,
          isActive: true,
          weekOffDays: [],
          sundayWorkEnabled: false,
          sundayPayMultiplier: 2.0,
          startTime: '09:00',
          endTime: '18:00',
          graceMinutes: 15,
          trackingIntervalMinutes: 60,
        },
        location: null,
      } as any);

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        return fn({ attendanceRecord: { findUnique: vi.fn().mockResolvedValue(null) } });
      });

      const snapRecord = { ...makeAttendanceRecord(), shiftId: SNAP_SHIFT_ID, shiftAssignmentId: SNAP_ASSIGN_ID };
      vi.mocked(prisma.attendanceRecord.upsert).mockResolvedValueOnce(snapRecord as any);
      vi.mocked(prisma.attendanceLog.create).mockResolvedValueOnce({ id: 'log-001' } as any);

      await service.clockIn(EMP_ID, makeClockInData({ isPwa: true }) as any, ORG_ID);

      const upsertCall = vi.mocked(prisma.attendanceRecord.upsert).mock.calls[0][0];
      expect((upsertCall.create as any).shiftId).toBe(SNAP_SHIFT_ID);
      expect((upsertCall.create as any).shiftAssignmentId).toBe(SNAP_ASSIGN_ID);
    });

    it('sets shiftAssignmentId to null and uses default shiftId when no active assignment exists', async () => {
      const DEFAULT_SHIFT_ID = 'shift-default-001'; // matches shift.findFirst mock in beforeEach

      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeEmployee() as any);
      // shiftAssignment.findFirst returns null (already set in beforeEach)

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        return fn({ attendanceRecord: { findUnique: vi.fn().mockResolvedValue(null) } });
      });

      const noAssignRecord = { ...makeAttendanceRecord(), shiftId: DEFAULT_SHIFT_ID, shiftAssignmentId: null };
      vi.mocked(prisma.attendanceRecord.upsert).mockResolvedValueOnce(noAssignRecord as any);
      vi.mocked(prisma.attendanceLog.create).mockResolvedValueOnce({ id: 'log-002' } as any);

      await service.clockIn(EMP_ID, makeClockInData({ isPwa: true }) as any, ORG_ID);

      const upsertCall = vi.mocked(prisma.attendanceRecord.upsert).mock.calls[0][0];
      // No assignment → shiftAssignmentId must be null
      expect((upsertCall.create as any).shiftAssignmentId).toBeNull();
      // shiftId must be the fallback default shift id
      expect((upsertCall.create as any).shiftId).toBe(DEFAULT_SHIFT_ID);
    });
  });

  // ── getTodayStatus ─────────────────────────────────────────────────────────

  describe('getTodayStatus', () => {
    it('returns isCheckedIn=false and isCheckedOut=false when no record exists', async () => {
      vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(
        makeEmployee({ workMode: 'OFFICE' }) as any
      );
      vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.attendancePolicy.findUnique).mockResolvedValueOnce({
        weekOffDays: [0],
      } as any);

      const result = await service.getTodayStatus(EMP_ID);

      expect(result.record).toBeNull();
      expect(result.isCheckedIn).toBe(false);
      expect(result.isCheckedOut).toBe(false);
    });

    it('returns isCheckedIn=true when record has checkIn but no checkOut', async () => {
      const activeRecord = makeAttendanceRecord({
        checkIn: new Date(),
        checkOut: null,
        breaks: [],
        logs: [],
      });
      vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValueOnce(activeRecord as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(
        makeEmployee({ workMode: 'OFFICE' }) as any
      );
      vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.attendancePolicy.findUnique).mockResolvedValueOnce({
        weekOffDays: [0],
      } as any);

      const result = await service.getTodayStatus(EMP_ID);

      expect(result.isCheckedIn).toBe(true);
      expect(result.isCheckedOut).toBe(false);
      expect(result.record).toBeTruthy();
    });

    it('returns isCheckedIn=false and isCheckedOut=true when record has both checkIn and checkOut', async () => {
      const completedRecord = makeAttendanceRecord({
        checkIn: new Date(Date.now() - 8 * 60 * 60 * 1000),
        checkOut: new Date(),
        totalHours: 8,
        breaks: [],
        logs: [],
      });
      vi.mocked(prisma.attendanceRecord.findUnique).mockResolvedValueOnce(completedRecord as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce(
        makeEmployee({ workMode: 'OFFICE' }) as any
      );
      vi.mocked(prisma.shiftAssignment.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.attendancePolicy.findUnique).mockResolvedValueOnce({
        weekOffDays: [0],
      } as any);

      const result = await service.getTodayStatus(EMP_ID);

      expect(result.isCheckedIn).toBe(false);
      expect(result.isCheckedOut).toBe(true);
    });
  });
});
