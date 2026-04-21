/**
 * Tests for key Express middleware:
 *  - authenticate: JWT verification (valid / expired / missing)
 *  - requirePermission: RBAC resource+action check (admin pass / employee 403)
 *  - rateLimiter: Redis-backed rate limiting (429 after max requests)
 *
 * All heavy dependencies (prisma, redis, jwt env) are mocked.
 * Tests use a mock req/res/next pattern — no real HTTP requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── env stubs — must precede module imports ────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    exitAccessConfig: { findUnique: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-id' }) },
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn(),
    expire: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
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

// ── Imports after mocks ────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';
import { authenticate, requirePermission, authorize } from '../middleware/auth.middleware.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { redis } from '../lib/redis.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mock Express req / res / next
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-test-001';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    user: undefined,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res: Partial<Response> = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

/** Build a signed JWT for middleware tests (uses the test secret). */
function signToken(payload: Record<string, any>, expiresIn = '1h') {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn } as any);
}

// ─────────────────────────────────────────────────────────────────────────────
// authenticate middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() and sets req.user for a valid Bearer token', () => {
    const payload = {
      userId: 'u-1',
      email: 'admin@aniston.com',
      role: 'ADMIN',
      organizationId: ORG_ID,
    };
    const token = signToken(payload);
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = makeNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // next must have been called without arguments (no error)
    expect(next).toHaveBeenCalledWith();
    expect(req.user?.userId).toBe('u-1');
    expect(req.user?.role).toBe('ADMIN' as any);
  });

  it('calls next(UnauthorizedError) when Authorization header is missing', () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = makeNext();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('calls next(UnauthorizedError) when Authorization header does not start with Bearer', () => {
    const req = makeReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
    const res = makeRes();
    const next = makeNext();

    authenticate(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('calls next(UnauthorizedError) when token is expired', () => {
    const token = signToken(
      { userId: 'u-2', email: 'old@aniston.com', role: 'EMPLOYEE', organizationId: ORG_ID },
      '-1s' // already expired
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = makeNext();

    authenticate(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/token expired/i);
  });

  it('calls next(UnauthorizedError) when token is malformed', () => {
    const req = makeReq({ headers: { authorization: 'Bearer not.a.valid.jwt' } });
    const res = makeRes();
    const next = makeNext();

    authenticate(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/invalid token/i);
  });

  it('calls next(UnauthorizedError) for a token with mfaPending:true', () => {
    const token = signToken({
      userId: 'u-3',
      email: 'mfa@aniston.com',
      role: 'EMPLOYEE',
      organizationId: ORG_ID,
      mfaPending: true,
    });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = makeNext();

    authenticate(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/MFA verification required/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requirePermission middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('requirePermission middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() for SUPER_ADMIN on a protected employee resource', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-sa',
      email: 'sa@aniston.com',
      role: 'SUPER_ADMIN' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    requirePermission('employee', 'read')(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() for ADMIN on employee:read', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-adm',
      email: 'admin@aniston.com',
      role: 'ADMIN' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    requirePermission('employee', 'read')(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) for EMPLOYEE on payroll:read', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-emp',
      email: 'emp@aniston.com',
      role: 'EMPLOYEE' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    requirePermission('payroll', 'read')(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('calls next(UnauthorizedError) when req.user is not set', () => {
    const req = makeReq();
    req.user = undefined;
    const res = makeRes();
    const next = makeNext();

    requirePermission('employee', 'read')(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('calls next() for HR on leave:read', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-hr',
      email: 'hr@aniston.com',
      role: 'HR' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    requirePermission('leave', 'read')(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) for EMPLOYEE on settings:update', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-emp',
      email: 'emp@aniston.com',
      role: 'EMPLOYEE' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    requirePermission('settings', 'update')(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// authorize middleware (role-based, not permission-based)
// ─────────────────────────────────────────────────────────────────────────────

describe('authorize middleware', () => {
  it('calls next() when user role is in the allowed list', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-hr',
      email: 'hr@aniston.com',
      role: 'HR' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    authorize('ADMIN' as any, 'HR' as any)(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when user role is not in the allowed list', () => {
    const req = makeReq();
    req.user = {
      userId: 'u-emp',
      email: 'emp@aniston.com',
      role: 'EMPLOYEE' as any,
      organizationId: ORG_ID,
    };
    const res = makeRes();
    const next = makeNext();

    authorize('ADMIN' as any, 'HR' as any)(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('calls next(UnauthorizedError) when req.user is absent', () => {
    const req = makeReq();
    req.user = undefined;
    const res = makeRes();
    const next = makeNext();

    authorize('ADMIN' as any)(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rateLimiter middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('rateLimiter middleware', () => {
  const MAX = 3;
  const limiter = rateLimiter({ windowMs: 60_000, max: MAX, keyPrefix: 'test-rl' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.expire).mockResolvedValue(1 as any);
  });

  it('calls next() for requests below the limit', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(1 as any);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() exactly at the limit (current === max)', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(MAX as any);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(AppError 429) when limit is exceeded (current > max)', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce((MAX + 1) as any);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('sets X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(1 as any);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', MAX);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', MAX - 1);
  });

  it('X-RateLimit-Remaining is 0 (not negative) when limit is exceeded', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce((MAX + 5) as any);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
  });

  it('calls next() (allows through) when Redis throws — fail open', async () => {
    vi.mocked(redis.incr).mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    // Rate limiter must fail open to avoid blocking legitimate requests on Redis outage
    expect(next).toHaveBeenCalledWith();
  });

  it('sets a window expiry on the first request (current === 1)', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(1 as any);

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    // expire should be called only on the first hit in the window
    expect(redis.expire).toHaveBeenCalledWith(expect.stringContaining('test-rl'), 60);
  });

  it('does NOT reset the expiry on subsequent requests in the same window', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(2 as any); // second request

    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await limiter(req, res, next);

    expect(redis.expire).not.toHaveBeenCalled();
  });
});
