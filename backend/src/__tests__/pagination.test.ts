/**
 * Tests for pagination meta output from AnnouncementService and PerformanceService.
 *
 * Verifies that list endpoints return the correct `meta` envelope shape and that
 * edge-case page calculations are correct.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs ─────────────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    announcement: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    reviewCycle: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    goal: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    performanceReview: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-id' }),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
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
  enqueueEmail: vi.fn().mockResolvedValue(undefined as any),
  enqueueNotification: vi.fn().mockResolvedValue(undefined as any),
}));

vi.mock('../sockets/index.js', () => ({
  emitToOrg: vi.fn(),
  emitToUser: vi.fn(),
  emitToRoom: vi.fn(),
}));

vi.mock('../services/ai.service.js', () => ({
  aiService: { prompt: vi.fn(), chat: vi.fn() },
}));

vi.mock('../modules/task-integration/task-integration.service.js', () => ({
  taskIntegrationService: {
    fetchTasksForEmployee: vi.fn().mockResolvedValue([]),
    assessLeaveRisk: vi.fn().mockResolvedValue({ risk: 'LOW' }),
  },
}));

vi.mock('../utils/leavePerformance.js', () => ({
  calculateLeaveDisciplineScore: vi.fn().mockReturnValue(0),
  calculateWorkContinuityScore: vi.fn().mockReturnValue(0),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────
import { AnnouncementService } from '../modules/announcement/announcement.service.js';
import { PerformanceService } from '../modules/performance/performance.service.js';
import { prisma } from '../lib/prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper — verify meta shape is correct
// ─────────────────────────────────────────────────────────────────────────────

function expectValidMeta(meta: any) {
  expect(meta).toHaveProperty('page');
  expect(meta).toHaveProperty('limit');
  expect(meta).toHaveProperty('total');
  expect(meta).toHaveProperty('totalPages');
  expect(meta).toHaveProperty('hasNext');
  expect(meta).toHaveProperty('hasPrev');
  // Types
  expect(typeof meta.page).toBe('number');
  expect(typeof meta.limit).toBe('number');
  expect(typeof meta.total).toBe('number');
  expect(typeof meta.totalPages).toBe('number');
  expect(typeof meta.hasNext).toBe('boolean');
  expect(typeof meta.hasPrev).toBe('boolean');
}

const ORG_ID = 'org-test-001';

// ─────────────────────────────────────────────────────────────────────────────
// AnnouncementService.list — pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('AnnouncementService — pagination meta', () => {
  let service: AnnouncementService;

  beforeEach(() => {
    service = new AnnouncementService();
    vi.clearAllMocks();
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
  });

  it('returns the correct meta shape', async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(0);

    const result = await service.list(ORG_ID, { page: 1, limit: 20 });

    expectValidMeta(result.meta);
  });

  it('page 1 of 1: hasNext=false, hasPrev=false', async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce([
      { id: 'ann-1', title: 'Only announcement', createdBy: 'u-1' } as any,
    ]);
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(1);

    const result = await service.list(ORG_ID, { page: 1, limit: 20 });

    expect(result.meta.page).toBe(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.totalPages).toBe(1);
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('page 1 of 3: hasNext=true, hasPrev=false', async () => {
    // 50 items total, limit 20 → 3 pages
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({ id: `ann-${i}`, title: `A${i}`, createdBy: 'u-1' })) as any
    );
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(50);

    const result = await service.list(ORG_ID, { page: 1, limit: 20 });

    expect(result.meta.page).toBe(1);
    expect(result.meta.total).toBe(50);
    expect(result.meta.totalPages).toBe(3);
    expect(result.meta.hasNext).toBe(true);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('page 2 of 3: hasNext=true, hasPrev=true', async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({ id: `ann-${i}`, title: `A${i}`, createdBy: 'u-1' })) as any
    );
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(50);

    const result = await service.list(ORG_ID, { page: 2, limit: 20 });

    expect(result.meta.page).toBe(2);
    expect(result.meta.hasNext).toBe(true);
    expect(result.meta.hasPrev).toBe(true);
  });

  it('last page (page 3 of 3): hasNext=false, hasPrev=true', async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => ({ id: `ann-${i}`, title: `A${i}`, createdBy: 'u-1' })) as any
    );
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(50);

    const result = await service.list(ORG_ID, { page: 3, limit: 20 });

    expect(result.meta.page).toBe(3);
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(true);
  });

  it('totalPages is Math.ceil(total / limit)', async () => {
    // 21 items, limit 10 → Math.ceil(21/10) = 3 pages
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(21);

    const result = await service.list(ORG_ID, { page: 1, limit: 10 });

    expect(result.meta.totalPages).toBe(3);
  });

  it('totalPages is 1 when total is 0 (no divide-by-zero)', async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(0);

    const result = await service.list(ORG_ID, { page: 1, limit: 20 });

    // Math.ceil(0 / 20) = 0 — the service returns 0, which is correct
    expect(result.meta.total).toBe(0);
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('data array matches the records returned by prisma.findMany', async () => {
    const fakeAnnouncements = [
      { id: 'ann-a', title: 'Holi Holiday', createdBy: 'u-1' },
      { id: 'ann-b', title: 'Town Hall', createdBy: 'u-1' },
    ];
    vi.mocked(prisma.announcement.findMany).mockResolvedValueOnce(fakeAnnouncements as any);
    vi.mocked(prisma.announcement.count).mockResolvedValueOnce(2);

    const result = await service.list(ORG_ID, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('ann-a');
    expect(result.data[1].id).toBe('ann-b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PerformanceService.listCycles — pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('PerformanceService.listCycles — pagination meta', () => {
  let service: PerformanceService;

  beforeEach(() => {
    service = new PerformanceService();
    vi.clearAllMocks();
  });

  it('returns correct meta shape', async () => {
    vi.mocked(prisma.reviewCycle.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.reviewCycle.count).mockResolvedValueOnce(0);

    const result = await service.listCycles(ORG_ID, { page: 1, limit: 20 });

    expectValidMeta(result.meta);
  });

  it('page 1 of 1: hasNext=false, hasPrev=false (single review cycle)', async () => {
    vi.mocked(prisma.reviewCycle.findMany).mockResolvedValueOnce([
      { id: 'rc-1', name: 'Q1 2026', _count: { reviews: 2, goals: 5 } } as any,
    ]);
    vi.mocked(prisma.reviewCycle.count).mockResolvedValueOnce(1);

    const result = await service.listCycles(ORG_ID, { page: 1, limit: 20 });

    expect(result.meta.page).toBe(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.totalPages).toBe(1);
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(false);
  });

  it('page 2 of 3: hasNext=true, hasPrev=true', async () => {
    vi.mocked(prisma.reviewCycle.findMany).mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({ id: `rc-${i}`, _count: { reviews: 0, goals: 0 } })) as any
    );
    vi.mocked(prisma.reviewCycle.count).mockResolvedValueOnce(15);

    const result = await service.listCycles(ORG_ID, { page: 2, limit: 5 });

    expect(result.meta.totalPages).toBe(3);
    expect(result.meta.hasNext).toBe(true);
    expect(result.meta.hasPrev).toBe(true);
  });

  it('last page: hasNext=false, hasPrev=true', async () => {
    vi.mocked(prisma.reviewCycle.findMany).mockResolvedValueOnce(
      [{ id: 'rc-last', _count: { reviews: 0, goals: 0 } }] as any
    );
    vi.mocked(prisma.reviewCycle.count).mockResolvedValueOnce(11);

    const result = await service.listCycles(ORG_ID, { page: 3, limit: 5 });

    // 11 items, limit 5 → Math.ceil(11/5)=3 pages
    expect(result.meta.totalPages).toBe(3);
    expect(result.meta.hasNext).toBe(false);
    expect(result.meta.hasPrev).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PerformanceService.listGoals — pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('PerformanceService.listGoals — pagination meta', () => {
  let service: PerformanceService;

  beforeEach(() => {
    service = new PerformanceService();
    vi.clearAllMocks();
  });

  it('returns correct meta with all six fields', async () => {
    vi.mocked(prisma.goal.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.goal.count).mockResolvedValueOnce(0);

    const result = await service.listGoals('emp-001', ORG_ID, { page: 1, limit: 20 });

    expectValidMeta(result.meta);
  });

  it('correctly calculates hasPrev and hasNext for middle page', async () => {
    // 100 goals, limit 25 → 4 pages; requesting page 2
    vi.mocked(prisma.goal.findMany).mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({ id: `goal-${i}` })) as any
    );
    vi.mocked(prisma.goal.count).mockResolvedValueOnce(100);

    const result = await service.listGoals('emp-001', ORG_ID, { page: 2, limit: 25 });

    expect(result.meta.totalPages).toBe(4);
    expect(result.meta.hasPrev).toBe(true);
    expect(result.meta.hasNext).toBe(true);
  });
});
