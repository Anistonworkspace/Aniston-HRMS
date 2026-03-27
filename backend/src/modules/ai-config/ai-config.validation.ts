import { z } from 'zod';

export const upsertAiConfigSchema = z.object({
  provider: z.enum(['DEEPSEEK', 'OPENAI', 'ANTHROPIC', 'GEMINI', 'CUSTOM']),
  apiKey: z.string().min(1, 'API key is required').optional(),
  baseUrl: z.string().url('Must be a valid URL').optional().nullable(),
  modelName: z.string().min(1, 'Model name is required'),
});

export type UpsertAiConfigInput = z.infer<typeof upsertAiConfigSchema>;
