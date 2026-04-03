/**
 * Tests for InvitationService + POST /api/invitations integration.
 *
 * All external dependencies are mocked — no real DB/Redis/email calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs ─────────────────────────────────────────────────────────────
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-that-is-at-least-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

// ── Mocks (must be declared before any import that triggers module init) ──
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    employeeInvitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
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
  enqueueEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../modules/auth/auth.service.js', () => ({
  authService: {
    generateAccessToken: vi.fn().mockReturnValue('mock-access-token'),
    generateRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
  },
}));

vi.mock('../utils/employeeCode.js', () => ({
  generateEmployeeCode: vi.fn().mockResolvedValue('EMP-001'),
}));

// ── Imports after mocks ───────────────────────────────────────────────────
import { InvitationService } from '../modules/invitation/invitation.service.js';
import { prisma } from '../lib/prisma.js';
import { enqueueEmail } from '../jobs/queues.js';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-test-001';
const ADMIN_USER_ID = 'user-admin-001';

function makePendingInvitation(overrides: Record<string, any> = {}) {
  const now = new Date();
  const exp = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  return {
    id: 'inv-001',
    organizationId: ORG_ID,
    email: 'newjoin@example.com',
    mobileNumber: null,
    inviteToken: 'token-uuid-abc',
    status: 'PENDING',
    invitedBy: ADMIN_USER_ID,
    expiresAt: exp,
    acceptedAt: null,
    employeeId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Unit tests — InvitationService
// ─────────────────────────────────────────────────────────────────────────

describe('InvitationService', () => {
  let service: InvitationService;

  beforeEach(() => {
    service = new InvitationService();
    vi.clearAllMocks();
  });

  // ── createInvitation ───────────────────────────────────────────────────

  describe('createInvitation', () => {
    it('creates a DB record with a 72-hour expiry', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(null); // no pending
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null); // no existing employee

      const fakeInvitation = makePendingInvitation();
      vi.mocked(prisma.employeeInvitation.create).mockResolvedValueOnce(fakeInvitation as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
      } as any);

      const beforeCall = Date.now();
      const result = await service.createInvitation(
        { email: 'newjoin@example.com', role: 'EMPLOYEE' as const },
        ORG_ID,
        ADMIN_USER_ID
      );
      const afterCall = Date.now();

      // Verify create was called
      expect(prisma.employeeInvitation.create).toHaveBeenCalledOnce();

      const createArg = vi.mocked(prisma.employeeInvitation.create).mock.calls[0][0] as any;
      const expiresAt: Date = createArg.data.expiresAt;

      // The expiry passed to create must be ~72 hours from now (±5s tolerance)
      const diffMs = expiresAt.getTime() - beforeCall;
      const expectedMs = 72 * 60 * 60 * 1000;
      expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 5000);
      expect(diffMs).toBeLessThanOrEqual(expectedMs + (afterCall - beforeCall) + 5000);

      // Result must expose inviteUrl and status
      expect(result.inviteUrl).toContain(fakeInvitation.inviteToken);
      expect(result.status).toBe('PENDING');
    });

    it('sends an invitation email', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.employeeInvitation.create).mockResolvedValueOnce(makePendingInvitation() as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
      } as any);

      await service.createInvitation(
        { email: 'newjoin@example.com', role: 'EMPLOYEE' as const },
        ORG_ID,
        ADMIN_USER_ID
      );

      expect(enqueueEmail).toHaveBeenCalledOnce();
      expect(enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'newjoin@example.com', template: 'employee-invite' })
      );
    });

    it('rejects a duplicate pending email', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(
        makePendingInvitation() as any // existing pending
      );

      await expect(
        service.createInvitation({ email: 'newjoin@example.com', role: 'EMPLOYEE' as const }, ORG_ID, ADMIN_USER_ID)
      ).rejects.toThrow('A pending invitation already exists for this email');

      expect(prisma.employeeInvitation.create).not.toHaveBeenCalled();
    });

    it('rejects if an employee with that email already exists', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(null); // no pending inv
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
        id: 'emp-existing',
        email: 'newjoin@example.com',
      } as any);

      await expect(
        service.createInvitation({ email: 'newjoin@example.com', role: 'EMPLOYEE' as const }, ORG_ID, ADMIN_USER_ID)
      ).rejects.toThrow('An employee with this email already exists');
    });

    it('normalizes email to lowercase before saving', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.employeeInvitation.create).mockResolvedValueOnce(
        makePendingInvitation({ email: 'upper@example.com' }) as any
      );
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
      } as any);

      await service.createInvitation({ email: 'UPPER@EXAMPLE.COM', role: 'EMPLOYEE' as const }, ORG_ID, ADMIN_USER_ID);

      const createArg = vi.mocked(prisma.employeeInvitation.create).mock.calls[0][0] as any;
      expect(createArg.data.email).toBe('upper@example.com');
    });
  });

  // ── validateToken ──────────────────────────────────────────────────────

  describe('validateToken', () => {
    it('returns valid:false with reason "expired" for tokens past expiresAt', async () => {
      const expiredInvitation = makePendingInvitation({
        expiresAt: new Date(Date.now() - 1000), // already expired
      });
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        expiredInvitation as any
      );
      vi.mocked(prisma.employeeInvitation.update).mockResolvedValueOnce({
        ...expiredInvitation,
        status: 'EXPIRED',
      } as any);

      const result = await service.validateToken('token-uuid-abc');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
      // Must update the invitation status to EXPIRED
      expect(prisma.employeeInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } })
      );
    });

    it('returns valid:false with reason "already_accepted" for accepted tokens', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation({ status: 'ACCEPTED' }) as any
      );

      const result = await service.validateToken('token-uuid-abc');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('already_accepted');
    });

    it('returns valid:true with org details for a valid pending token', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation() as any // future expiresAt
      );
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
        logo: null,
      } as any);

      const result = await service.validateToken('token-uuid-abc');

      expect(result.valid).toBe(true);
      expect(result.status).toBe('PENDING');
      expect((result as any).organization?.name).toBe('Aniston Technologies');
    });

    it('throws NotFoundError for unknown token', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(null);

      await expect(service.validateToken('non-existent-token')).rejects.toThrow(
        'Invitation not found'
      );
    });
  });

  // ── completeInvitation ─────────────────────────────────────────────────

  describe('completeInvitation', () => {
    const completionData = {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      phone: '9876543210',
      password: 'SecurePass@123',
    };

    it('creates User + Employee in a single transaction', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation() as any
      );
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null) // no existing user (pre-check)
        .mockResolvedValueOnce({     // auto-login lookup after transaction
          id: 'new-user-id', email: 'priya@example.com', role: 'EMPLOYEE',
          organizationId: ORG_ID, employee: { id: 'new-emp-id', firstName: 'Priya',
          lastName: 'Sharma', avatar: null, status: 'PROBATION', workMode: 'OFFICE',
          onboardingComplete: false, documentGate: null },
        } as any);

      // generateEmployeeCode calls prisma.employee.findMany to find existing codes.
      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { employeeCode: 'EMP-003' },
        { employeeCode: 'EMP-005' },
      ] as any);

      const mockUser = { id: 'new-user-id', email: 'priya@example.com', role: 'EMPLOYEE', organizationId: ORG_ID };
      const mockEmployee = {
        id: 'new-emp-id',
        employeeCode: 'EMP-006',
        email: 'priya@example.com',
      };

      // $transaction executes the callback — simulate by calling the fn with a fake tx
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const txPrisma = {
          user: { create: vi.fn().mockResolvedValueOnce(mockUser) },
          employee: { create: vi.fn().mockResolvedValueOnce(mockEmployee) },
          employeeInvitation: { update: vi.fn().mockResolvedValueOnce({}) },
        };
        return fn(txPrisma);
      });

      const result = await service.completeInvitation('token-uuid-abc', completionData);

      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(result.employeeId).toBe('new-emp-id');
      // employeeCode must follow the EMP-NNN format
      expect(result.employeeCode).toMatch(/^EMP-\d{3}$/);
    });

    it('returns tokens and user data after successful completion', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation() as any
      );
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null) // no existing user
        .mockResolvedValueOnce({     // auto-login lookup
          id: 'u-new', email: 'priya@example.com', role: 'EMPLOYEE',
          organizationId: ORG_ID, employee: { id: 'e-new', firstName: 'Priya',
          lastName: 'Sharma', avatar: null, status: 'PROBATION', workMode: 'OFFICE',
          onboardingComplete: false, documentGate: null },
        } as any);
      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { employeeCode: 'EMP-003' },
        { employeeCode: 'EMP-005' },
      ] as any);

      const mockUser = { id: 'u-new', email: 'priya@example.com', role: 'EMPLOYEE', organizationId: ORG_ID };
      const mockEmployee = { id: 'e-new', employeeCode: 'EMP-006', email: 'priya@example.com' };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
        const tx = {
          user: { create: vi.fn().mockResolvedValueOnce(mockUser) },
          employee: { create: vi.fn().mockResolvedValueOnce(mockEmployee) },
          employeeInvitation: { update: vi.fn().mockResolvedValueOnce({}) },
        };
        return fn(tx);
      });

      const result = await service.completeInvitation('token-uuid-abc', completionData);
      expect(result.accessToken).toBeDefined();
      expect(result.employeeId).toBe('e-new');
    });

    it('throws BadRequestError when invitation is already accepted', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation({ status: 'ACCEPTED' }) as any
      );

      await expect(
        service.completeInvitation('token-uuid-abc', completionData)
      ).rejects.toThrow('Invitation is no longer valid');
    });

    it('throws BadRequestError when invitation has expired', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation({ expiresAt: new Date(Date.now() - 1000) }) as any
      );

      await expect(
        service.completeInvitation('token-uuid-abc', completionData)
      ).rejects.toThrow('Invitation has expired');
    });

    it('throws BadRequestError when user with email already exists', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation() as any
      );
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'existing-user',
        email: 'priya@example.com',
        status: 'ACTIVE',
      } as any);
      // Active employee exists for this user — triggers the duplicate block
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
        id: 'emp-existing',
        userId: 'existing-user',
        deletedAt: null,
      } as any);

      await expect(
        service.completeInvitation('token-uuid-abc', completionData)
      ).rejects.toThrow('A user with this email already exists');
    });
  });

  // ── resendInvitation ───────────────────────────────────────────────────

  describe('resendInvitation', () => {
    it('extends expiry by 72 hours and regenerates the token', async () => {
      const oldExpiry = new Date(Date.now() - 1000); // already expired
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(
        makePendingInvitation({ expiresAt: oldExpiry, status: 'EXPIRED' }) as any
      );

      const newExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      vi.mocked(prisma.employeeInvitation.update).mockResolvedValueOnce(
        makePendingInvitation({ expiresAt: newExpiry, inviteToken: 'new-token-xyz' }) as any
      );
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
      } as any);

      const beforeCall = Date.now();
      const result = await service.resendInvitation('inv-001', ORG_ID, ADMIN_USER_ID);

      expect(result.success).toBe(true);
      expect(result.expiresAt.getTime()).toBeGreaterThan(beforeCall + 71 * 60 * 60 * 1000);

      const updateArg = vi.mocked(prisma.employeeInvitation.update).mock.calls[0][0] as any;
      expect(updateArg.data.status).toBe('PENDING');
      // inviteToken must be regenerated (not null/undefined)
      expect(updateArg.data.inviteToken).toBeDefined();
    });

    it('sends a reminder email on resend', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(
        makePendingInvitation({ status: 'EXPIRED' }) as any
      );
      vi.mocked(prisma.employeeInvitation.update).mockResolvedValueOnce(
        makePendingInvitation({ inviteToken: 'new-token-resend' }) as any
      );
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
      } as any);

      await service.resendInvitation('inv-001', ORG_ID, ADMIN_USER_ID);

      expect(enqueueEmail).toHaveBeenCalledOnce();
      expect(enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newjoin@example.com',
          template: 'employee-invite',
        })
      );
    });

    it('throws BadRequestError when trying to resend an accepted invitation', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(
        makePendingInvitation({ status: 'ACCEPTED' }) as any
      );

      await expect(
        service.resendInvitation('inv-001', ORG_ID, ADMIN_USER_ID)
      ).rejects.toThrow('Invitation already accepted');
    });

    it('throws NotFoundError when invitation does not exist in the org', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(null);

      await expect(
        service.resendInvitation('non-existent', ORG_ID, ADMIN_USER_ID)
      ).rejects.toThrow('Invitation not found');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration tests — /api/invitations
// ─────────────────────────────────────────────────────────────────────────

describe('/api/invitations (integration)', () => {
  let request: any;
  let jwtLib: any;
  let app: any;

  const ORG_ID = 'org-test-001';

  beforeEach(async () => {
    vi.clearAllMocks();
    const supertest = await import('supertest');
    jwtLib = await import('jsonwebtoken');
    const appModule = await import('../app.js');
    app = appModule.app;
    request = supertest.default(app);
  });

  function makeToken(role: string, userId = 'u-1') {
    return jwtLib.sign(
      { userId, email: `${role.toLowerCase()}@aniston.com`, role, organizationId: ORG_ID },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );
  }

  // ── POST /api/invitations ──────────────────────────────────────────────

  describe('POST /api/invitations', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request.post('/api/invitations').send({ email: 'x@example.com' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for EMPLOYEE role (no employee:create permission)', async () => {
      const token = makeToken('EMPLOYEE');
      const res = await request
        .post('/api/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(403);
    });

    it('returns 201 for SUPER_ADMIN with valid payload', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.employeeInvitation.create).mockResolvedValueOnce(
        makePendingInvitation({ email: 'recruit@aniston.com' }) as any
      );
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
      } as any);

      const token = makeToken('SUPER_ADMIN');
      const res = await request
        .post('/api/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'recruit@aniston.com' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.inviteUrl).toBeDefined();
    });

    it('returns 400 on duplicate pending email', async () => {
      vi.mocked(prisma.employeeInvitation.findFirst).mockResolvedValueOnce(
        makePendingInvitation() as any
      );
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(null);

      const token = makeToken('ADMIN');
      const res = await request
        .post('/api/invitations')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'newjoin@example.com', role: 'EMPLOYEE' as const });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/pending invitation already exists/i);
    });
  });

  // ── GET /api/invitations/validate/:token — public endpoint ────────────

  describe('GET /api/invitations/validate/:token', () => {
    it('returns valid:true without auth header for a good token', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation() as any
      );
      vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
        id: ORG_ID,
        name: 'Aniston Technologies',
        logo: null,
      } as any);

      const res = await request.get('/api/invitations/validate/token-uuid-abc');

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it('returns valid:false for expired tokens without auth header', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(
        makePendingInvitation({ expiresAt: new Date(Date.now() - 1000) }) as any
      );
      vi.mocked(prisma.employeeInvitation.update).mockResolvedValueOnce({} as any);

      const res = await request.get('/api/invitations/validate/expired-token');

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.reason).toBe('expired');
    });

    it('returns 404 for unknown token', async () => {
      vi.mocked(prisma.employeeInvitation.findUnique).mockResolvedValueOnce(null);

      const res = await request.get('/api/invitations/validate/does-not-exist');

      expect(res.status).toBe(404);
    });
  });
});
