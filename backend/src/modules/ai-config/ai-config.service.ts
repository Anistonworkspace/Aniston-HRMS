import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { BadRequestError, ServiceUnavailableError } from '../../middleware/errorHandler.js';
import { logger } from '../../lib/logger.js';
import type { AiProvider } from '@prisma/client';
import type { UpsertAiConfigInput } from './ai-config.validation.js';

const CACHE_KEY_PREFIX = 'ai-config:';
const CACHE_TTL = 3600; // 1 hour (increased from 60s to reduce decrypt overhead)

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

    if (!config) {
      // Return a default shape so the frontend knows "no config yet" vs "config exists"
      return {
        id: null,
        provider: 'DEEPSEEK',
        apiKeyMasked: '',
        hasApiKey: false,
        baseUrl: null,
        modelName: 'deepseek-chat',
        isActive: false,
        updatedAt: null,
        updatedBy: null,
      };
    }

    // Mask the API key — show only last 4 characters
    let maskedKey = '••••••••';
    let hasApiKey = false;
    let decryptError = false;

    if (config.apiKeyEncrypted) {
      try {
        const raw = decrypt(config.apiKeyEncrypted);
        if (raw && raw.length > 0) {
          hasApiKey = true;
          if (raw.length > 4) {
            maskedKey = '••••••••' + raw.slice(-4);
          }
        }
      } catch (err) {
        // Key exists in DB but can't be decrypted — log this critical error
        logger.error(`[AI Config] Failed to decrypt API key for org ${organizationId}, config ${config.id}: ${(err as Error).message}`);
        decryptError = true;
        hasApiKey = false;
      }
    }

    return {
      id: config.id,
      provider: config.provider,
      apiKeyMasked: maskedKey,
      hasApiKey,
      decryptError,
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
      // Verify encryption round-trip — decrypt immediately to ensure key is recoverable
      try {
        const verified = decrypt(apiKeyEncrypted);
        if (verified !== apiKey) {
          logger.error(`[AI Config] Encryption round-trip verification FAILED for org ${organizationId}`);
          throw new BadRequestError('Failed to securely store API key. Please try again.');
        }
      } catch (err) {
        if (err instanceof BadRequestError) throw err;
        logger.error(`[AI Config] Encryption verification error for org ${organizationId}: ${(err as Error).message}`);
        throw new BadRequestError('Failed to encrypt API key. Please contact support.');
      }
    } else {
      // Try to find existing key: first by same provider, then ANY active config for this org
      const existing = await prisma.aiApiConfig.findFirst({
        where: { organizationId, provider: provider as AiProvider },
      });
      if (existing?.apiKeyEncrypted) {
        // Verify the existing key can still be decrypted
        try {
          decrypt(existing.apiKeyEncrypted);
          apiKeyEncrypted = existing.apiKeyEncrypted;
        } catch {
          logger.error(`[AI Config] Existing key for ${provider} cannot be decrypted for org ${organizationId}. User must re-enter key.`);
          throw new BadRequestError('Your saved API key could not be read. Please re-enter your API key.');
        }
      } else {
        // Fallback: check if ANY active config has a key (user might be switching providers)
        const anyActive = await prisma.aiApiConfig.findFirst({
          where: { organizationId, isActive: true },
        });
        if (anyActive?.apiKeyEncrypted) {
          try {
            decrypt(anyActive.apiKeyEncrypted);
            apiKeyEncrypted = anyActive.apiKeyEncrypted;
          } catch {
            throw new BadRequestError('API key is required. Please enter your API key.');
          }
        } else {
          throw new BadRequestError('API key is required for a new configuration');
        }
      }
    }

    // When baseUrl is explicitly set (including empty string to clear it), use the provided value.
    // When baseUrl is undefined/omitted from the request, preserve the existing DB value.
    let resolvedBaseUrl: string | null | undefined;
    if (baseUrl !== undefined) {
      // User explicitly sent a baseUrl — use it (empty string clears the field → null)
      resolvedBaseUrl = baseUrl || null;
    } else {
      // Not provided — preserve existing value by omitting from update payload
      resolvedBaseUrl = undefined;
    }

    // Fetch existing to handle baseUrl preservation in create path
    const existingConfig = await prisma.aiApiConfig.findFirst({
      where: { organizationId, provider: provider as AiProvider },
    });
    const createBaseUrl = resolvedBaseUrl !== undefined ? resolvedBaseUrl : existingConfig?.baseUrl ?? null;
    const updateData: any = { apiKeyEncrypted, modelName, isActive: true, updatedBy: userId };
    if (resolvedBaseUrl !== undefined) updateData.baseUrl = resolvedBaseUrl;

    // Atomic: deactivate all + upsert active config
    let config: any;
    try {
      const [, saved] = await prisma.$transaction([
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
            baseUrl: createBaseUrl,
            modelName,
            isActive: true,
            updatedBy: userId,
          },
          update: updateData,
        }),
      ]);
      config = saved;
    } catch (err: any) {
      logger.error(`[AI Config] Failed to save config for org ${organizationId}: ${err.message}`);
      throw new BadRequestError('Failed to save AI configuration. Please try again.');
    }

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
  async testConnection(organizationId: string, overrides?: { modelName?: string; baseUrl?: string; provider?: string; apiKey?: string }) {
    const config = await prisma.aiApiConfig.findFirst({
      where: { organizationId, isActive: true },
    });

    // If user provided an apiKey override, use that directly; otherwise decrypt from DB
    let apiKey: string | undefined;
    if (overrides?.apiKey) {
      apiKey = overrides.apiKey;
    } else if (config) {
      try {
        apiKey = decrypt(config.apiKeyEncrypted);
      } catch {
        return { success: false, message: 'Failed to decrypt API key. Please re-save your configuration with a new API key.', provider: config?.provider, model: config?.modelName };
      }
    }

    if (!apiKey) {
      return { success: false, message: 'No API key available. Please enter an API key and try again.', provider: config?.provider || overrides?.provider, model: config?.modelName || overrides?.modelName };
    }

    // Use overrides from request body if provided (test what user typed, not just what's saved)
    const testProvider = overrides?.provider || config?.provider || 'DEEPSEEK';
    const testModel = overrides?.modelName || config?.modelName || 'deepseek-chat';
    const testBaseUrl = overrides?.baseUrl !== undefined ? overrides.baseUrl : (config?.baseUrl ?? null);

    const startTime = Date.now();

    try {
      const result = await this.callProvider(testProvider as any, apiKey, testModel, testBaseUrl, 'Say OK in one word.');
      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        latencyMs,
        model: testModel,
        provider: testProvider,
        response: result.slice(0, 200),
      };
    } catch (err: any) {
      const message = err.message || 'Unknown error';
      // Parse common API error patterns for user-friendly messages
      if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid_api_key')) {
        return { success: false, message: `Authentication failed: Your ${testProvider} API key is invalid. Please check and re-enter it.`, provider: testProvider, model: testModel };
      }
      if (message.includes('404') || message.includes('model_not_found')) {
        return { success: false, message: `Model "${testModel}" not found for ${testProvider}. Please check the model name.`, provider: testProvider, model: testModel };
      }
      if (message.includes('429') || message.includes('rate_limit')) {
        return { success: false, message: `Rate limit hit for ${testProvider}. Please wait and try again.`, provider: testProvider, model: testModel };
      }
      if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        return { success: false, message: `Cannot reach ${testProvider} API. Check your network connection or base URL.`, provider: testProvider, model: testModel };
      }
      return {
        success: false,
        message: `Connection failed: ${message.slice(0, 300)}`,
        provider: testProvider,
        model: testModel,
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

    let apiKey: string;
    try {
      apiKey = decrypt(config.apiKeyEncrypted);
    } catch (err) {
      logger.error(`[AI Config] Failed to decrypt active config for org ${organizationId}: ${(err as Error).message}`);
      return null;
    }

    if (!apiKey) return null;

    const raw = {
      provider: config.provider,
      apiKey,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
    };

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
        if (!baseUrl) {
          throw new Error('Base URL is required for Custom provider. Please set a Base URL in the AI config settings.');
        }
        // OpenAI-compatible API
        const normalizedBase = baseUrl.replace(/\/+$/, ''); // trim trailing slashes
        const url = provider === 'OPENAI'
          ? 'https://api.openai.com/v1/chat/completions'
          : provider === 'DEEPSEEK'
          ? 'https://api.deepseek.com/v1/chat/completions'
          : normalizedBase.endsWith('/v1')
            ? `${normalizedBase}/chat/completions`
            : normalizedBase.endsWith('/chat/completions')
            ? normalizedBase  // already the full endpoint
            : `${normalizedBase}/v1/chat/completions`;

        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: modelName,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 100,
            }),
            signal: AbortSignal.timeout(30000),
          });
        } catch (fetchErr: any) {
          throw new ServiceUnavailableError(`Cannot reach ${provider} API: ${fetchErr.message}`);
        }

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`${provider} API error ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || 'No response';
      }

      case 'ANTHROPIC': {
        let res: Response;
        try {
          res = await fetch('https://api.anthropic.com/v1/messages', {
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
            signal: AbortSignal.timeout(30000),
          });
        } catch (fetchErr: any) {
          throw new ServiceUnavailableError(`Cannot reach Anthropic API: ${fetchErr.message}`);
        }

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await res.json();
        return data.content?.[0]?.text || 'No response';
      }

      case 'GEMINI': {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
            signal: AbortSignal.timeout(30000),
          });
        } catch (fetchErr: any) {
          throw new ServiceUnavailableError(`Cannot reach Gemini API: ${fetchErr.message}`);
        }

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
