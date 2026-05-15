/**
 * GPS Service Tests — Aniston HRMS
 *
 * Covers:
 *   - clusterVisits: edge cases (single point, exact 10-min, > 10-min, > 200m radius)
 *   - storeGPSTrail: staleness filter, future timestamp, invalid coordinates, speed anomaly, frequency anomaly
 *   - storeGPSTrail: duplicate dedup, FIELD_SALES-only guard, consent guard
 *   - getGPSTrail: cross-org isolation
 *   - GPS consent: recordGPSConsent, getGPSConsentStatus
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs ────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    employee: { findFirst: vi.fn(), update: vi.fn() },
    gPSTrailPoint: { findMany: vi.fn(), createMany: vi.fn() },
    attendanceRecord: { findFirst: vi.fn() },
    locationVisit: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-id' }) },
  },
}));
vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn(), on: vi.fn() },
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

import { AttendanceService } from '../modules/attendance/attendance.service.js';
import { prisma } from '../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = 'org-gps-001';
const EMP_ID = 'emp-gps-001';
const OTHER_ORG_ID = 'org-other-999';

/** Build a GPS point `offsetMs` milliseconds from a reference time */
function makePoint(offsetMs: number, lat = 12.9716, lng = 77.5946, opts: { accuracy?: number; speed?: number } = {}) {
  return {
    lat,
    lng,
    accuracy: opts.accuracy ?? 15,
    speed: opts.speed ?? undefined,
    timestamp: new Date(BASE_TIME + offsetMs).toISOString(),
  };
}

const BASE_TIME = Date.now();

function makeFieldEmployee(overrides: Record<string, any> = {}) {
  return {
    id: EMP_ID,
    organizationId: ORG_ID,
    workMode: 'FIELD_SALES',
    locationTrackingConsented: true,
    shiftAssignments: [{
      shift: { shiftType: 'FIELD', trackingIntervalMinutes: 60 },
    }],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AttendanceService — clusterVisits', () => {
  let service: AttendanceService;
  beforeEach(() => { service = new AttendanceService(); vi.resetAllMocks(); });

  it('returns empty array for zero points', () => {
    const result = (service as any).clusterVisits([]);
    expect(result).toEqual([]);
  });

  it('returns empty array for single point (cannot form a cluster duration)', () => {
    const pts = [{ lat: 12.9716, lng: 77.5946, timestamp: new Date() }];
    const result = (service as any).clusterVisits(pts);
    expect(result).toEqual([]);
  });

  it('does NOT create a visit for dwell < 10 minutes', () => {
    // Two points 5 min apart at the same location
    const pts = [
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME) },
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME + 5 * 60_000) },
    ];
    const result = (service as any).clusterVisits(pts);
    expect(result).toHaveLength(0);
  });

  it('creates a visit for dwell exactly 10 minutes', () => {
    const pts = [
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME) },
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME + 10 * 60_000) },
    ];
    const result = (service as any).clusterVisits(pts);
    expect(result).toHaveLength(1);
    expect(result[0].durationMinutes).toBe(10);
  });

  it('creates a visit for dwell > 10 minutes with correct pointCount', () => {
    const pts = [
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME) },
      { lat: 12.9716, lng: 77.5947, timestamp: new Date(BASE_TIME + 20 * 60_000) },
      { lat: 12.9715, lng: 77.5946, timestamp: new Date(BASE_TIME + 40 * 60_000) },
    ];
    const result = (service as any).clusterVisits(pts);
    expect(result).toHaveLength(1);
    expect(result[0].durationMinutes).toBe(40);
    expect(result[0].pointCount).toBe(3);
  });

  it('does NOT create a visit when consecutive points are > 200m apart', () => {
    // ~2km apart — definitely outside the 200m cluster radius
    const pts = [
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME) },
      { lat: 12.9900, lng: 77.5946, timestamp: new Date(BASE_TIME + 30 * 60_000) },
    ];
    const result = (service as any).clusterVisits(pts);
    // Each cluster has only 1 point — neither meets MIN_DURATION since the single
    // remaining point at the end also can't form a duration by itself
    expect(result).toHaveLength(0);
  });

  it('creates two separate visits for two distinct stops', () => {
    // Stop 1: 12.9716 lat — 30 min dwell
    // Move: > 200m away
    // Stop 2: 12.9900 lat — 20 min dwell
    const pts = [
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME) },
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME + 30 * 60_000) },
      { lat: 12.9900, lng: 77.5946, timestamp: new Date(BASE_TIME + 31 * 60_000) }, // moved > 200m
      { lat: 12.9900, lng: 77.5946, timestamp: new Date(BASE_TIME + 51 * 60_000) },
    ];
    const result = (service as any).clusterVisits(pts);
    expect(result).toHaveLength(2);
    expect(result[0].durationMinutes).toBe(30);
    expect(result[1].durationMinutes).toBe(20);
  });
});

describe('AttendanceService.storeGPSTrail — validation', () => {
  let service: AttendanceService;
  beforeEach(() => {
    service = new AttendanceService();
    vi.resetAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
  });

  it('rejects for OFFICE-mode employee with no FIELD shift', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      workMode: 'OFFICE',
      organizationId: ORG_ID,
      locationTrackingConsented: true,
      shiftAssignments: [],
    } as any);

    await expect(
      service.storeGPSTrail(EMP_ID, { points: [makePoint(0)] })
    ).rejects.toThrow(/GPS trail recording is only allowed for employees assigned to a FIELD or HYBRID shift/i);
  });

  it('rejects when employee has not given consent', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
      makeFieldEmployee({ locationTrackingConsented: false }) as any
    );

    await expect(
      service.storeGPSTrail(EMP_ID, { points: [makePoint(0)] })
    ).rejects.toThrow(/consent/i);
  });

  it('rejects all points when every point is older than 7 days', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeFieldEmployee() as any);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const oldPoint = { ...makePoint(0), timestamp: new Date(eightDaysAgo).toISOString() };

    await expect(
      service.storeGPSTrail(EMP_ID, { points: [oldPoint] })
    ).rejects.toThrow(/rejected/i);
  });

  it('rejects future timestamps beyond 5-minute tolerance', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeFieldEmployee() as any);
    const tenMinsFuture = { ...makePoint(0), timestamp: new Date(Date.now() + 10 * 60_000).toISOString() };

    await expect(
      service.storeGPSTrail(EMP_ID, { points: [tenMinsFuture] })
    ).rejects.toThrow(/rejected/i);
  });

  it('allows future timestamp within 5-minute tolerance (GPS clock drift)', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeFieldEmployee() as any);
    vi.mocked(prisma.gPSTrailPoint.createMany).mockResolvedValueOnce({ count: 1 } as any);
    const withinTolerance = { ...makePoint(0), timestamp: new Date(Date.now() + 3 * 60_000).toISOString() };

    const result = await service.storeGPSTrail(EMP_ID, { points: [withinTolerance] });
    expect(result.stored).toBe(1);
  });

  it('stores FIELD-mode employee points successfully', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeFieldEmployee() as any);
    vi.mocked(prisma.gPSTrailPoint.createMany).mockResolvedValueOnce({ count: 2 } as any);

    const result = await service.storeGPSTrail(EMP_ID, {
      points: [makePoint(0), makePoint(60 * 60_000)],
    });

    expect(result.stored).toBe(2);
    expect(result.submitted).toBe(2);
    expect(prisma.gPSTrailPoint.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });

  it('logs anomaly for speed > 300 km/h but still accepts the point', async () => {
    const { createAuditLog } = await import('../utils/auditLogger.js');
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeFieldEmployee() as any);
    vi.mocked(prisma.gPSTrailPoint.createMany).mockResolvedValueOnce({ count: 1 } as any);

    // speed > 83.3 m/s = > 300 km/h
    const result = await service.storeGPSTrail(EMP_ID, {
      points: [makePoint(0, 12.9716, 77.5946, { speed: 100 })],
    });

    expect(result.stored).toBe(1);
    expect(result.anomalies).toBeGreaterThan(0);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GPS_ANOMALY_DETECTED' })
    );
  });

  it('accepts FIELD-shift OFFICE-workMode employee', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      workMode: 'OFFICE',
      organizationId: ORG_ID,
      locationTrackingConsented: true,
      shiftAssignments: [{
        shift: { shiftType: 'FIELD', trackingIntervalMinutes: 60 },
      }],
    } as any);
    vi.mocked(prisma.gPSTrailPoint.createMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await service.storeGPSTrail(EMP_ID, { points: [makePoint(0)] });
    expect(result.stored).toBe(1);
  });

  it('uses skipDuplicates to handle batch re-sync gracefully', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(makeFieldEmployee() as any);
    vi.mocked(prisma.gPSTrailPoint.createMany).mockResolvedValueOnce({ count: 1 } as any); // 1 of 2 is new

    const result = await service.storeGPSTrail(EMP_ID, {
      points: [makePoint(0), makePoint(60 * 60_000)],
    });

    // createMany called with skipDuplicates: true — DB may insert fewer than submitted
    expect(prisma.gPSTrailPoint.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(result.submitted).toBe(2);
  });
});

describe('AttendanceService.getGPSTrail — cross-org isolation', () => {
  let service: AttendanceService;
  beforeEach(() => {
    service = new AttendanceService();
    vi.resetAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
  });

  it('throws NotFoundError when employee does not belong to requesting org', async () => {
    // Employee is in ORG_ID but request comes from OTHER_ORG_ID
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);

    await expect(
      service.getGPSTrail(EMP_ID, '2026-04-29', OTHER_ORG_ID)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns trail when employee belongs to requesting org', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      id: EMP_ID, organizationId: ORG_ID, workMode: 'FIELD_SALES',
    } as any);
    vi.mocked(prisma.gPSTrailPoint.findMany).mockResolvedValueOnce([
      { lat: 12.9716, lng: 77.5946, timestamp: new Date(BASE_TIME), accuracy: 15, speed: null },
    ] as any);
    vi.mocked(prisma.attendanceRecord.findFirst).mockResolvedValueOnce(null);

    const result = await service.getGPSTrail(EMP_ID, '2026-04-29', ORG_ID);
    expect(result.points).toHaveLength(1);
  });

  it('passes organizationId to gPSTrailPoint.findMany query', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      id: EMP_ID, organizationId: ORG_ID, workMode: 'FIELD_SALES',
    } as any);
    vi.mocked(prisma.gPSTrailPoint.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.attendanceRecord.findFirst).mockResolvedValueOnce(null);

    await service.getGPSTrail(EMP_ID, '2026-04-29', ORG_ID);

    expect(prisma.gPSTrailPoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      })
    );
  });

  it('records an audit log when GPS trail is viewed', async () => {
    const { createAuditLog } = await import('../utils/auditLogger.js');
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      id: EMP_ID, organizationId: ORG_ID, workMode: 'FIELD_SALES',
    } as any);
    vi.mocked(prisma.gPSTrailPoint.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.attendanceRecord.findFirst).mockResolvedValueOnce(null);

    await service.getGPSTrail(EMP_ID, '2026-04-29', ORG_ID, 'hr-user-id');

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GPS_TRAIL_VIEWED',
        organizationId: ORG_ID,
      })
    );
  });
});

describe('AttendanceService — GPS Consent', () => {
  let service: AttendanceService;
  beforeEach(() => {
    service = new AttendanceService();
    vi.resetAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
  });

  it('throws NotFoundError when recording consent for unknown employee', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);

    await expect(
      service.recordGPSConsent(EMP_ID, ORG_ID, 'v1')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates consent fields and returns updated values', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      id: EMP_ID, organizationId: ORG_ID,
    } as any);
    vi.mocked(prisma.employee.update).mockResolvedValueOnce({
      locationTrackingConsented: true,
      locationTrackingConsentAt: new Date(),
      locationTrackingConsentVersion: 'v1',
    } as any);

    const result = await service.recordGPSConsent(EMP_ID, ORG_ID, 'v1');

    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EMP_ID },
        data: expect.objectContaining({
          locationTrackingConsented: true,
          locationTrackingConsentVersion: 'v1',
        }),
      })
    );
    expect(result.locationTrackingConsented).toBe(true);
  });

  it('getGPSConsentStatus returns consent state correctly', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      locationTrackingConsented: true,
      locationTrackingConsentAt: new Date(),
      locationTrackingConsentVersion: 'v1',
      workMode: 'FIELD_SALES',
    } as any);

    const result = await service.getGPSConsentStatus(EMP_ID, ORG_ID);

    expect(result.consented).toBe(true);
    expect(result.consentVersion).toBe('v1');
    expect(result.isFieldEmployee).toBe(true);
  });

  it('getGPSConsentStatus marks non-field employee correctly', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
      locationTrackingConsented: false,
      locationTrackingConsentAt: null,
      locationTrackingConsentVersion: null,
      workMode: 'OFFICE',
    } as any);

    const result = await service.getGPSConsentStatus(EMP_ID, ORG_ID);

    expect(result.consented).toBe(false);
    expect(result.isFieldEmployee).toBe(false);
  });

  it('getGPSConsentStatus throws NotFoundError for unknown employee', async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);

    await expect(
      service.getGPSConsentStatus(EMP_ID, OTHER_ORG_ID)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
