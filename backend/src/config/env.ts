import { z } from 'zod';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (works whether cwd is root or backend/).
// override: true ensures .env always wins over any shell/PM2-level env vars
// so production FRONTEND_URL is always read from the file, not stale process env.
config({ path: resolve(process.cwd(), '.env'), override: true });
config({ path: resolve(process.cwd(), '..', '.env'), override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  // G-10: Required in production to enforce AES-256-GCM key separation from JWT signing key.
  // In development/test the encryption.ts module falls back to JWT_SECRET when this is absent.
  ENCRYPTION_KEY: process.env.NODE_ENV === 'production'
    ? z.string().min(32)
    : z.string().min(32).optional(),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  FRONTEND_URL: z.string().default('https://hr.anistonav.com'),
  API_URL: z.string().default('https://hr.anistonav.com/api'),
  AI_SERVICE_URL: z.string().default('http://localhost:8000'),
  AI_SERVICE_API_KEY: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().default('aniston-hrms'),
  SMTP_HOST: z.string().default('smtp.office365.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@aniston.in'),
  // Injected via GitHub Secret ANISTON_TEST at deploy time.
  // Takes priority over any per-org DB-stored key for all OPENAI provider calls.
  OPENAI_API_KEY: z.string().optional(),
  // Activity data retention (default: 30 days per compliance policy)
  ACTIVITY_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  ACTIVITY_CLEANUP_ENABLED: z.string().default('true'),
  ACTIVITY_CLEANUP_CRON: z.string().default('0 3 * * *'), // 03:00 UTC daily
  // GPS trail retention (default: 90 days; override to reduce storage on large deployments)
  GPS_TRAIL_RETENTION_DAYS: z.string().optional().default('90'),
});

/** Detect suspiciously low-entropy secrets (repeated chars, all-numeric, common dev patterns) */
function warnWeakSecret(name: string, value: string) {
  if (process.env.NODE_ENV !== 'production') return;
  const unique = new Set(value.split('')).size;
  const isLowEntropy = unique < 8; // fewer than 8 distinct chars in a 32+ char string
  const devPatterns = ['secret', 'password', 'changeme', 'example', 'test', '1234', 'abcd'];
  const isPattern = devPatterns.some(p => value.toLowerCase().includes(p));
  if (isLowEntropy || isPattern) {
    console.error(`⚠️  SECURITY WARNING: ${name} appears to be a weak or dev secret. Use a cryptographically random value in production.`);
  }
}

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  const data = result.data;
  warnWeakSecret('JWT_SECRET', data.JWT_SECRET);
  warnWeakSecret('JWT_REFRESH_SECRET', data.JWT_REFRESH_SECRET);
  return data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
