/**
 * Tests for AuthService — login, token refresh, password management.
 *
 * All external dependencies (prisma, redis, bcrypt, jwt, queues) are mocked.
 * No real database or network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs — must come before any module import ──────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    deviceSession: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    userMFA: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-id' }),
    },
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', []]),
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
  enqueueEmail: vi.fn().mockReturnValue(Promise.resolve(undefined)),
  enqueueNotification: vi.fn().mockReturnValue(Promise.resolve(undefined)),
}));

vi.mock('../modules/employee-permissions/employee-permissions.service.js', () => ({
  employeePermissionService: {
    getEffectivePermissions: vi.fn().mockResolvedValue({}),
  },
}));

// bcryptjs must be mocked at the module level (ESM does not allow vi.spyOn on namespace exports)
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
  compare: vi.fn(),
  hash: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { AuthService } from '../modules/auth/auth.service.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { enqueueEmail } from '../jobs/queues.js';
import bcrypt from 'bcryptjs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-test-001';

/**
 * Build a mock user that has an active status and a hashed password.
 * bcrypt.hash('password123', 12) output — precomputed to avoid bcrypt calls in helpers.
 * We use bcrypt compare in the service against this hash, so tests that exercise
 * password validation mock bcrypt.compare directly.
 */
function makeActiveUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-001',
    email: 'employee@aniston.com',
    passwordHash: '$2a$12$testhashedpassword', // placeholder — service calls bcrypt.compare
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    organizationId: ORG_ID,
    lastLoginAt: null,
    employee: {
      id: 'emp-001',
      firstName: 'Test',
      lastName: 'User',
      avatar: null,
      status: 'PROBATION',
      exitStatus: null,
      workMode: 'OFFICE',
      onboardingComplete: true,
      documentGate: { kycStatus: 'VERIFIED' },
      exitAccessConfig: null,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — AuthService
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    service = new AuthService();
    vi.resetAllMocks();
    // Restore essential mocks after resetAllMocks
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
    vi.mocked(redis.setex).mockResolvedValue('OK' as any);
    vi.mocked(redis.del).mockResolvedValue(1 as any);
    vi.mocked(redis.scan).mockResolvedValue(['0', []] as any);
    vi.mocked(prisma.userMFA.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.deviceSession.findUnique).mockResolvedValue(null);
    // bcrypt defaults — tests that need specific behavior override these
    vi.mocked(bcrypt.compare).mockResolvedValue(false as any);
    vi.mocked(bcrypt.hash).mockResolvedValue('$2a$12$mocked-hash' as any);
    // enqueueEmail must return a Promise so .catch() in forgotPassword works
    vi.mocked(enqueueEmail).mockReturnValue(Promise.resolve(undefined) as any);
  });

  // ── login — success ────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns accessToken, refreshToken, and user on success', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);
      vi.mocked(prisma.userMFA.findUnique).mockResolvedValueOnce(null); // no MFA

      // Mock bcrypt to approve the password
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);

      vi.mocked(prisma.user.update).mockResolvedValueOnce(mockUser as any);

      const result = await service.login('employee@aniston.com', 'password123');

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.id).toBe('user-001');
      expect(result.user.email).toBe('employee@aniston.com');
      expect(result.user.role).toBe('EMPLOYEE');
      // mfaRequired must NOT be set on a normal login
      expect((result as any).mfaRequired).toBeFalsy();
    });

    it('throws UnauthorizedError when email does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(service.login('nobody@aniston.com', 'password123')).rejects.toThrow(
        'Invalid email or password'
      );
    });

    it('throws UnauthorizedError when password is wrong', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as any);

      await expect(service.login('employee@aniston.com', 'wrongpass')).rejects.toThrow(
        'Invalid email or password'
      );
    });

    it('throws UnauthorizedError for an inactive user without exit access', async () => {
      const inactiveUser = makeActiveUser({
        status: 'INACTIVE',
        employee: {
          ...makeActiveUser().employee,
          exitAccessConfig: null,
        },
      });
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(inactiveUser as any);

      await expect(service.login('employee@aniston.com', 'password123')).rejects.toThrow(
        'Account is inactive'
      );
    });

    it('returns mfaRequired:true and tempToken when MFA is enabled — no accessToken', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);

      // MFA is enabled for this user
      vi.mocked(prisma.userMFA.findUnique).mockResolvedValueOnce({
        userId: 'user-001',
        isEnabled: true,
        secret: 'totp-secret',
      } as any);

      const result = await service.login('employee@aniston.com', 'password123') as any;

      expect(result.mfaRequired).toBe(true);
      expect(result.tempToken).toBeTruthy();
      // accessToken must be empty string (not a real token) when MFA is pending
      expect(result.accessToken).toBe('');
      expect(result.refreshToken).toBe('');
    });

    it('sets lastLoginAt after a successful login', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);
      vi.mocked(prisma.userMFA.findUnique).mockResolvedValueOnce(null);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce(mockUser as any);

      await service.login('employee@aniston.com', 'password123');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-001' },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        })
      );
    });

    it('stores the refresh token in Redis with a 7-day TTL', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);
      vi.mocked(prisma.userMFA.findUnique).mockResolvedValueOnce(null);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce(mockUser as any);

      await service.login('employee@aniston.com', 'password123');

      // The refresh token should have been stored in Redis
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^refresh_token:/),
        7 * 24 * 60 * 60,
        'user-001'
      );
    });
  });

  // ── refreshAccessToken ─────────────────────────────────────────────────────

  describe('refreshAccessToken', () => {
    it('returns a new accessToken and rotated refreshToken when token is valid', async () => {
      const mockUser = makeActiveUser();

      // Redis returns the userId for this refresh token
      vi.mocked(redis.get).mockResolvedValueOnce('user-001');
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      const result = await service.refreshAccessToken('valid-refresh-token-abc');

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      // Old token must be deleted, new one stored
      expect(redis.del).toHaveBeenCalledWith('refresh_token:valid-refresh-token-abc');
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^refresh_token:/),
        7 * 24 * 60 * 60,
        'user-001'
      );
    });

    it('throws UnauthorizedError when Redis returns null (expired/missing token)', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce(null);

      await expect(service.refreshAccessToken('expired-token')).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });

    it('throws UnauthorizedError when user no longer exists in DB', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce('user-ghost-id');
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(service.refreshAccessToken('orphan-refresh-token')).rejects.toThrow(
        'User not found or inactive'
      );
      // The stale Redis key must be cleaned up
      expect(redis.del).toHaveBeenCalledWith('refresh_token:orphan-refresh-token');
    });

    it('throws UnauthorizedError for inactive users without valid exit access', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce('user-001');
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
        makeActiveUser({
          status: 'INACTIVE',
          employee: { ...makeActiveUser().employee, exitAccessConfig: null },
        }) as any
      );

      await expect(service.refreshAccessToken('inactive-refresh-token')).rejects.toThrow(
        'User not found or inactive'
      );
    });
  });

  // ── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('returns the generic message even for nonexistent email (no email enumeration)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      const result = await service.forgotPassword('ghost@aniston.com');

      expect(result.message).toBe('If the email exists, a reset link has been sent');
      // No Redis key should be written for a nonexistent user
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('returns the generic message for an existing email and stores a reset token', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      const result = await service.forgotPassword('employee@aniston.com');

      expect(result.message).toBe('If the email exists, a reset link has been sent');
      // Redis must store a 1-hour TTL reset token
      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^reset_token:/),
        3600,
        'user-001'
      );
    });
  });

  // ── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('updates the password hash and deletes the Redis reset key', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce('user-001'); // token resolves to userId
      vi.mocked(prisma.user.update).mockResolvedValueOnce(makeActiveUser() as any);

      const result = await service.resetPassword('valid-reset-token', 'NewSecurePass@123');

      expect(result.message).toBe('Password reset successfully');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-001' },
          data: expect.objectContaining({ passwordHash: expect.any(String) }),
        })
      );
      // The reset token must be deleted from Redis after use
      expect(redis.del).toHaveBeenCalledWith('reset_token:valid-reset-token');
    });

    it('throws BadRequestError for an invalid or expired reset token', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce(null);

      await expect(service.resetPassword('fake-token', 'NewPass@123')).rejects.toThrow(
        'Invalid or expired reset token'
      );
    });

    it('hashes the new password (does not store plaintext)', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce('user-001');
      vi.mocked(prisma.user.update).mockResolvedValueOnce(makeActiveUser() as any);

      const plainNewPassword = 'PlainTextPassword!';
      await service.resetPassword('good-token', plainNewPassword);

      const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0] as any;
      const storedHash: string = updateCall.data.passwordHash;

      // The stored value must not equal the plain text
      expect(storedHash).not.toBe(plainNewPassword);
      // bcrypt hashes start with $2a$ or $2b$
      expect(storedHash).toMatch(/^\$2[ab]\$/);
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('throws BadRequestError when current password is wrong', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as any);

      await expect(
        service.changePassword('user-001', 'wrongCurrentPass', 'newPass@123')
      ).rejects.toThrow('Current password is incorrect');
    });

    it('returns new tokens and success message on valid change', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        ...mockUser,
        employee: { id: 'emp-001' },
      } as any);

      const result = await service.changePassword('user-001', 'currentPass@123', 'newPass@456');

      expect(result.message).toBe('Password changed successfully');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it('revokes all existing refresh tokens after password change', async () => {
      const mockUser = makeActiveUser();
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        ...mockUser,
        employee: { id: 'emp-001' },
      } as any);

      // Simulate one stale token found during SCAN
      vi.mocked(redis.scan).mockResolvedValueOnce(['0', ['refresh_token:old-token-xyz']] as any);
      vi.mocked(redis.get).mockResolvedValueOnce('user-001'); // matches current user

      await service.changePassword('user-001', 'currentPass', 'newPass@456');

      // The old token in Redis must be deleted
      expect(redis.del).toHaveBeenCalledWith('refresh_token:old-token-xyz');
    });
  });

  // ── generateAccessToken ────────────────────────────────────────────────────

  describe('generateAccessToken', () => {
    it('returns a valid JWT string', () => {
      const mockUser = makeActiveUser();
      const token = service.generateAccessToken(mockUser);

      expect(typeof token).toBe('string');
      // A JWT has exactly 3 dot-separated parts
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('embeds userId, email, role, and organizationId in the payload', async () => {
      const jwt = await import('jsonwebtoken');
      const mockUser = makeActiveUser();
      const token = service.generateAccessToken(mockUser);

      const decoded = jwt.default.decode(token) as any;
      expect(decoded.userId).toBe('user-001');
      expect(decoded.email).toBe('employee@aniston.com');
      expect(decoded.role).toBe('EMPLOYEE');
      expect(decoded.organizationId).toBe(ORG_ID);
    });

    it('generates different tokens for different users', () => {
      const user1 = makeActiveUser({ id: 'user-a', email: 'a@aniston.com' });
      const user2 = makeActiveUser({ id: 'user-b', email: 'b@aniston.com' });

      const token1 = service.generateAccessToken(user1);
      const token2 = service.generateAccessToken(user2);

      expect(token1).not.toBe(token2);
    });
  });

  // ── generateRefreshToken ────────────────────────────────────────────────────

  describe('generateRefreshToken', () => {
    it('returns a non-empty string token', async () => {
      vi.mocked(redis.setex).mockResolvedValueOnce('OK' as any);
      const token = await service.generateRefreshToken('user-001');
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(10);
    });

    it('stores the token in Redis with correct TTL and userId', async () => {
      vi.mocked(redis.setex).mockResolvedValueOnce('OK' as any);
      const token = await service.generateRefreshToken('user-xyz');
      expect(redis.setex).toHaveBeenCalledWith(
        `refresh_token:${token}`,
        7 * 24 * 60 * 60,
        'user-xyz'
      );
    });
  });
});
