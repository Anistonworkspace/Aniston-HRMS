/**
 * Tests for AiConfigService + POST /api/settings/ai-config integration.
 *
 * All external dependencies (prisma, redis, encrypt/decrypt, fetch) are mocked
 * so no real database or network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── env stubs required before any module import ───────────────────────────
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-that-is-at-least-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mock heavy infrastructure ─────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    aiApiConfig: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
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

// ── Import after mocks ────────────────────────────────────────────────────
import { AiConfigService } from '../modules/ai-config/ai-config.service.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { encrypt, decrypt } from '../utils/encryption.js';

// ─────────────────────────────────────────────────────────────────────────
// Unit tests — AiConfigService
// ─────────────────────────────────────────────────────────────────────────

describe('AiConfigService', () => {
  let service: AiConfigService;

  const ORG_ID = 'org-test-001';
  const USER_ID = 'user-admin-001';

  beforeEach(() => {
    service = new AiConfigService();
    vi.clearAllMocks();
  });

  // ── getConfig ──────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns default config object when no active config exists', async () => {
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce(null);

      const result = await service.getConfig(ORG_ID);

      expect(result).not.toBeNull();
      expect(result.hasApiKey).toBe(false);
      expect(result.id).toBeNull();
      expect(result.isActive).toBe(false);
      expect(prisma.aiApiConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_ID, isActive: true },
        })
      );
    });

    it('returns masked config when an active config exists', async () => {
      const rawKey = 'sk-test-api-key-abcdefgh1234';
      const encryptedKey = encrypt(rawKey);

      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce({
        id: 'cfg-1',
        organizationId: ORG_ID,
        provider: 'OPENAI',
        apiKeyEncrypted: encryptedKey,
        baseUrl: null,
        modelName: 'gpt-4o',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
      } as any);

      const result = await service.getConfig(ORG_ID);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe('OPENAI');
      // Key must be masked — should contain the last 4 chars of rawKey
      expect(result!.apiKeyMasked).toContain(rawKey.slice(-4));
      // Must NOT expose the full key
      expect(result!.apiKeyMasked).not.toBe(rawKey);
      expect(result!.apiKeyMasked).toMatch(/^••+/);
    });

    it('returns default mask when decryption fails', async () => {
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce({
        id: 'cfg-bad',
        organizationId: ORG_ID,
        provider: 'DEEPSEEK',
        apiKeyEncrypted: 'not-valid-ciphertext',
        baseUrl: null,
        modelName: 'deepseek-chat',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
      } as any);

      const result = await service.getConfig(ORG_ID);

      // Should not throw; should fall back to default mask
      expect(result).not.toBeNull();
      expect(result!.apiKeyMasked).toBe('••••••••');
    });
  });

  // ── upsertConfig ───────────────────────────────────────────────────────
  // The service uses prisma.$transaction([updateMany, upsert]) returning
  // [updateManyResult, configResult]. We mock $transaction to capture what
  // is passed and simulate the return value.

  describe('upsertConfig', () => {
    /**
     * Helper: sets up $transaction mock that:
     * 1. Resolves the Prisma operations passed in (executing them against the mocked prisma)
     * 2. Returns [updateManyResult, upsertResult]
     * The `configOverrides` lets tests control what the upsert "returns".
     */
    function mockTransaction(configOverrides: Record<string, any> = {}) {
      const configResult = {
        id: 'cfg-tx',
        organizationId: ORG_ID,
        provider: 'OPENAI',
        apiKeyEncrypted: 'placeholder',
        modelName: 'gpt-4o',
        isActive: true,
        baseUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
        ...configOverrides,
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) => {
        // ops[0] is the updateMany promise, ops[1] is the upsert promise
        // Execute both against our mocked prisma
        const results = await Promise.all(ops);
        return results;
      });

      // Mock the individual operations that will be called inside $transaction
      vi.mocked(prisma.aiApiConfig.updateMany).mockResolvedValueOnce({ count: 0 });
      vi.mocked(prisma.aiApiConfig.upsert).mockResolvedValueOnce(configResult as any);

      return configResult;
    }

    it('encrypts the API key before storing', async () => {
      const plainKey = 'sk-super-secret-key-xyz';
      mockTransaction();

      await service.upsertConfig(
        ORG_ID,
        { provider: 'OPENAI', apiKey: plainKey, modelName: 'gpt-4o' },
        USER_ID
      );

      // The upsert call should have received the encrypted key (not plaintext)
      const upsertCall = vi.mocked(prisma.aiApiConfig.upsert).mock.calls[0][0] as any;
      const storedEncrypted: string = upsertCall.create.apiKeyEncrypted;

      expect(storedEncrypted).not.toBe(plainKey);
      expect(decrypt(storedEncrypted)).toBe(plainKey);
    });

    it('deactivates other providers by passing updateMany inside the transaction', async () => {
      mockTransaction({ provider: 'ANTHROPIC' });

      await service.upsertConfig(
        ORG_ID,
        { provider: 'ANTHROPIC', apiKey: 'sk-ant-key', modelName: 'claude-3-5-sonnet-20241022' },
        USER_ID
      );

      // $transaction must have been called (atomicity ensured)
      expect(prisma.$transaction).toHaveBeenCalledOnce();

      // The updateMany op inside the transaction targets active configs
      const updateManyCall = vi.mocked(prisma.aiApiConfig.updateMany).mock.calls[0][0] as any;
      expect(updateManyCall.where).toEqual({ organizationId: ORG_ID, isActive: true });
      expect(updateManyCall.data).toEqual({ isActive: false });

      // The upsert must set isActive: true for the new provider
      const upsertCall = vi.mocked(prisma.aiApiConfig.upsert).mock.calls[0][0] as any;
      expect(upsertCall.create.isActive).toBe(true);
      expect(upsertCall.update.isActive).toBe(true);
    });

    it('invalidates the Redis cache after upsert', async () => {
      mockTransaction({ provider: 'GEMINI' });

      await service.upsertConfig(
        ORG_ID,
        { provider: 'GEMINI', apiKey: 'gemini-key', modelName: 'gemini-1.5-pro' },
        USER_ID
      );

      expect(redis.del).toHaveBeenCalledWith(`ai-config:${ORG_ID}`);
    });

    it('reuses existing encrypted key when no new apiKey is supplied', async () => {
      const existingEncrypted = encrypt('existing-key');

      // findFirst returns the existing config (for key reuse lookup)
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce({
        id: 'cfg-existing',
        organizationId: ORG_ID,
        provider: 'DEEPSEEK',
        apiKeyEncrypted: existingEncrypted,
        modelName: 'deepseek-chat',
        isActive: false,
        baseUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
      } as any);

      // $transaction mock that captures the upsert args
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) =>
        Promise.all(ops)
      );
      vi.mocked(prisma.aiApiConfig.updateMany).mockResolvedValueOnce({ count: 0 });
      vi.mocked(prisma.aiApiConfig.upsert).mockImplementationOnce(async (args: any) => ({
        id: 'cfg-existing',
        organizationId: ORG_ID,
        provider: 'DEEPSEEK',
        apiKeyEncrypted: args.update.apiKeyEncrypted,
        modelName: 'deepseek-chat-v2',
        isActive: true,
        baseUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
      }));

      await service.upsertConfig(
        ORG_ID,
        { provider: 'DEEPSEEK', modelName: 'deepseek-chat-v2' }, // no apiKey
        USER_ID
      );

      const upsertCall = vi.mocked(prisma.aiApiConfig.upsert).mock.calls[0][0] as any;
      // The existing encrypted key must be passed through unchanged
      expect(upsertCall.update.apiKeyEncrypted).toBe(existingEncrypted);
      expect(upsertCall.create.apiKeyEncrypted).toBe(existingEncrypted);
    });

    it('throws when apiKey is omitted and no prior config exists', async () => {
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce(null);

      await expect(
        service.upsertConfig(
          ORG_ID,
          { provider: 'OPENAI', modelName: 'gpt-4o' }, // no apiKey
          USER_ID
        )
      ).rejects.toThrow('API key is required for a new configuration');
    });
  });

  // ── testConnection ─────────────────────────────────────────────────────

  describe('testConnection', () => {
    it('returns error response when no config is configured', async () => {
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce(null);

      const result = await service.testConnection(ORG_ID);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/No AI provider configured/i);
    });

    it('returns success:false and message on provider HTTP error', async () => {
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce({
        id: 'cfg-fail',
        organizationId: ORG_ID,
        provider: 'OPENAI',
        apiKeyEncrypted: encrypt('bad-key'),
        modelName: 'gpt-4o',
        isActive: true,
        baseUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
      } as any);

      // Simulate fetch throwing a network error
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('ECONNREFUSED — AI provider unavailable')
      );

      const result = await service.testConnection(ORG_ID);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();

      fetchSpy.mockRestore();
    });

    it('returns success:true with latency on valid provider response', async () => {
      vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce({
        id: 'cfg-ok',
        organizationId: ORG_ID,
        provider: 'OPENAI',
        apiKeyEncrypted: encrypt('sk-valid-key'),
        modelName: 'gpt-4o',
        isActive: true,
        baseUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: USER_ID,
      } as any);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Aniston HRMS' } }],
        }),
      } as Response);

      const result = await service.testConnection(ORG_ID);

      expect(result.success).toBe(true);
      expect(typeof (result as any).latencyMs).toBe('number');
      expect((result as any).provider).toBe('OPENAI');

      fetchSpy.mockRestore();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration tests — POST /api/settings/ai-config
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/settings/ai-config (integration)', () => {
  // We test routing + auth guard without hitting the DB by keeping mocks in
  // place and generating real JWTs signed with the test secret.

  let request: any;
  let jwt: any;
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const supertest = await import('supertest');
    jwt = await import('jsonwebtoken');
    const appModule = await import('../app.js');
    app = appModule.app;
    request = supertest.default(app);
  });

  function makeToken(role: string, orgId = ORG_ID) {
    return jwt.sign(
      { userId: 'u-1', email: 'admin@aniston.com', role, organizationId: orgId },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );
  }

  const ORG_ID = 'org-test-001';

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request.put('/api/settings/ai-config').send({
      provider: 'OPENAI',
      apiKey: 'sk-test',
      modelName: 'gpt-4o',
    });
    expect(res.status).toBe(401);
  });

  it('rejects EMPLOYEE role with 403', async () => {
    const token = makeToken('EMPLOYEE');
    const res = await request
      .put('/api/settings/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'OPENAI', apiKey: 'sk-test', modelName: 'gpt-4o' });
    expect(res.status).toBe(403);
  });

  it('rejects HR role with 403 (not authorized for ai-config)', async () => {
    const token = makeToken('HR');
    const res = await request
      .put('/api/settings/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'OPENAI', apiKey: 'sk-test', modelName: 'gpt-4o' });
    expect(res.status).toBe(403);
  });

  it('accepts SUPER_ADMIN and returns 200', async () => {
    const cfgResult = {
      id: 'cfg-sa',
      organizationId: ORG_ID,
      provider: 'OPENAI',
      apiKeyEncrypted: encrypt('sk-super'),
      modelName: 'gpt-4o',
      isActive: true,
      baseUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: 'u-1',
    };
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) =>
      Promise.all(ops)
    );
    vi.mocked(prisma.aiApiConfig.updateMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.aiApiConfig.upsert).mockResolvedValueOnce(cfgResult as any);

    const token = makeToken('SUPER_ADMIN');
    const res = await request
      .put('/api/settings/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'OPENAI', apiKey: 'sk-super', modelName: 'gpt-4o' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts ADMIN and returns 200', async () => {
    const cfgResult = {
      id: 'cfg-adm',
      organizationId: ORG_ID,
      provider: 'DEEPSEEK',
      apiKeyEncrypted: encrypt('sk-admin'),
      modelName: 'deepseek-chat',
      isActive: true,
      baseUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: 'u-2',
    };
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) =>
      Promise.all(ops)
    );
    vi.mocked(prisma.aiApiConfig.updateMany).mockResolvedValueOnce({ count: 0 });
    vi.mocked(prisma.aiApiConfig.upsert).mockResolvedValueOnce(cfgResult as any);

    const token = makeToken('ADMIN');
    const res = await request
      .put('/api/settings/ai-config')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'DEEPSEEK', apiKey: 'sk-admin', modelName: 'deepseek-chat' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/settings/ai-config returns default config when unconfigured', async () => {
    vi.mocked(prisma.aiApiConfig.findFirst).mockResolvedValueOnce(null);

    const token = makeToken('ADMIN');
    const res = await request
      .get('/api/settings/ai-config')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasApiKey).toBe(false);
  });
});
