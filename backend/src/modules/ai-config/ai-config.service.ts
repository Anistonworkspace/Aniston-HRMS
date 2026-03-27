import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import type { AiProvider } from '@prisma/client';
import type { UpsertAiConfigInput } from './ai-config.validation.js';

const CACHE_KEY_PREFIX = 'ai-config:';
const CACHE_TTL = 60; // 60 seconds

/**
 * AiConfigService — manages per-org AI provider configuration.
 *
 * - API keys are stored AES-256-GCM encrypted (`apiKeyEncrypted` column).
 * - Only one provider is active at a time per org; saving a new config
 *   deactivates all others automatically.
 * - The active config is Redis-cached for 60 s to avoid repeated DB + decrypt
 *   overhead on every AI request.
 *
 * Never instantiate directly — use the exported singleton `aiConfigService`.
 */
export class AiConfigService {
  /**
   * Get the active AI config for an org with the API key masked (last 4 chars visible).
   * Safe to return in API responses.
   *
   * @param organizationId - The org to look up.
   * @returns Masked config object, or `null` if no active config exists.
   */
  async getConfig(organizationId: string) {
    const config = await prisma.aiApiConfig.findFirst({
      where: { organizationId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!config) return null;

    // Mask the API key — show only last 4 characters
    let maskedKey = '••••••••';
    try {
      const raw = decrypt(config.apiKeyEncrypted);
      if (raw.length > 4) {
        maskedKey = '••••••••' + raw.slice(-4);
      }
    } catch {
      // If decryption fails, keep default mask
    }

    return {
      id: config.id,
      provider: config.provider,
      apiKeyMasked: maskedKey,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      isActive: config.isActive,
      updatedAt: config.updatedAt,
      updatedBy: config.updatedBy,
    };
  }

  /**
   * Upsert the AI provider config for an org.
   *
   * - Encrypts `apiKey` with AES-256-GCM before persisting.
   * - If `apiKey` is omitted in the input, the existing encrypted key is re-used
   *   (useful for updating model name or base URL without re-entering the key).
   * - Deactivates all other provider configs for the org before activating this one.
   * - Invalidates the Redis cache after saving.
   * - Writes an audit log entry.
   *
   * @param organizationId - The org to configure.
   * @param input - Validated upsert payload (provider, apiKey?, modelName, baseUrl?).
   * @param userId - ID of the user performing the change (for audit log).
   * @returns The saved `AiApiConfig` record (with encrypted key — not for API responses).
   * @throws `BadRequestError` if no `apiKey` is supplied for a brand-new provider.
   */
  async upsertConfig(organizationId: string, input: UpsertAiConfigInput, userId: string) {
    const { provider, apiKey, baseUrl, modelName } = input;

    // If no new API key provided, re-use the existing encrypted key
    let apiKeyEncrypted: string;
    if (apiKey) {
      apiKeyEncrypted = encrypt(apiKey);
    } else {
      const existing = await prisma.aiApiConfig.findFirst({
        where: { organizationId, provider: provider as AiProvider },
      });
      if (!existing) {
        throw new BadRequestError('API key is required for a new configuration');
      }
      apiKeyEncrypted = existing.apiKeyEncrypted;
    }

    // Atomic: deactivate all + upsert active config
    const [, config] = await prisma.$transaction([
      prisma.aiApiConfig.updateMany({
        where: { organizationId, isActive: true },
        data: { isActive: false },
      }),
      prisma.aiApiConfig.upsert({
        where: {
          organizationId_provider: { organizationId, provider: provider as AiProvider },
        },
        create: {
          organizationId,
          provider: provider as AiProvider,
          apiKeyEncrypted,
          baseUrl: baseUrl || null,
          modelName,
          isActive: true,
          updatedBy: userId,
        },
        update: {
          apiKeyEncrypted,
          baseUrl: baseUrl || null,
          modelName,
          isActive: true,
          updatedBy: userId,
        },
      }),
    ]);

    // Invalidate Redis cache
    await redis.del(`${CACHE_KEY_PREFIX}${organizationId}`);

    // Audit log
    await createAuditLog({
      userId,
      organizationId,
      entity: 'AiApiConfig',
      entityId: config.id,
      action: 'UPDATE',
      newValue: { provider, modelName, baseUrl },
    });

    return config;
  }

  /**
   * Test the org's configured AI provider by sending a short "Hello" prompt.
   *
   * @param organizationId - The org whose active config should be tested.
   * @returns `{ success, latencyMs, model, provider, response }` on success,
   *          or `{ success: false, message, provider, model }` on failure.
   */
  async testConnection(organizationId: string) {
    const config = await prisma.aiApiConfig.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!config) {
      return { success: false, message: 'No AI provider configured. Please save a configuration first.' };
    }

    const apiKey = decrypt(config.apiKeyEncrypted);
    const startTime = Date.now();

    try {
      const result = await this.callProvider(config.provider, apiKey, config.modelName, config.baseUrl, 'Say "Hello from Aniston HRMS" in one sentence.');
      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        latencyMs,
        model: config.modelName,
        provider: config.provider,
        response: result.slice(0, 200),
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Connection failed: ${err.message}`,
        provider: config.provider,
        model: config.modelName,
      };
    }
  }

  /**
   * Get the raw (decrypted) active config for **internal use only** (consumed by `AiService`).
   *
   * Never return this object in an API response — it contains the plaintext API key.
   * Results are Redis-cached for 60 s to minimize DB reads and decrypt operations.
   *
   * @param organizationId - The org to look up.
   * @returns `{ provider, apiKey, baseUrl, modelName }` or `null` if not configured.
   */
  async getActiveConfigRaw(organizationId: string) {
    // Check cache first
    const cached = await redis.get(`${CACHE_KEY_PREFIX}${organizationId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    const config = await prisma.aiApiConfig.findFirst({
      where: { organizationId, isActive: true },
    });

    if (!config) return null;

    const raw = {
      provider: config.provider,
      apiKey: decrypt(config.apiKeyEncrypted),
      baseUrl: config.baseUrl,
      modelName: config.modelName,
    };

    // Cache for 60 seconds
    await redis.setex(`${CACHE_KEY_PREFIX}${organizationId}`, CACHE_TTL, JSON.stringify(raw));

    return raw;
  }

  /**
   * Send a prompt to the configured AI provider.
   */
  private async callProvider(
    provider: string,
    apiKey: string,
    modelName: string,
    baseUrl: string | null,
    prompt: string
  ): Promise<string> {
    switch (provider) {
      case 'OPENAI':
      case 'DEEPSEEK':
      case 'CUSTOM': {
        // OpenAI-compatible API
        const url = provider === 'OPENAI'
          ? 'https://api.openai.com/v1/chat/completions'
          : provider === 'DEEPSEEK'
          ? 'https://api.deepseek.com/v1/chat/completions'
          : `${baseUrl}/v1/chat/completions`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`${provider} API error ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || 'No response';
      }

      case 'ANTHROPIC': {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelName,
            max_tokens: 100,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        return data.content?.[0]?.text || 'No response';
      }

      case 'GEMINI': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}

export const aiConfigService = new AiConfigService();
