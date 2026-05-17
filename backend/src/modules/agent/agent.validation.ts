import { z } from 'zod';

export const activityEntrySchema = z.object({
  // Max lengths prevent DB overflow from malicious or buggy agents
  activeApp: z.string().max(255).optional(),
  activeWindow: z.string().max(500).optional(),
  activeUrl: z.string().max(2000).optional(),
  category: z.enum(['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE']).optional(),
  // Each entry represents one 30-second tracking tick. The agent caps durationSeconds at the
  // tracking interval (TRACKING_INTERVAL_MS / 1000 = 30s) and idleSeconds at durationSeconds.
  // Allow up to 120s to tolerate agents with slightly longer poll intervals (e.g. 60s or 90s).
  // Values above 120 are almost certainly a bug or malicious input — reject them.
  durationSeconds: z.number().int().min(0).max(120).default(0),
  idleSeconds: z.number().int().min(0).max(120).default(0),
  keystrokes: z.number().int().min(0).default(0),
  mouseClicks: z.number().int().min(0).default(0),
  mouseDistance: z.number().int().min(0).default(0),
  timestamp: z.string().datetime({ offset: true }),
});

export const heartbeatSchema = z.object({
  // Increased from 100 → 1000: covers ~8h at 30s intervals.
  // Old cap (100) only buffered ~50min; agents offline >50min silently dropped data.
  activities: z.array(activityEntrySchema).min(1).max(1000),
});

export const screenshotMetadataSchema = z.object({
  activeApp: z.string().max(255).optional(),
  activeWindow: z.string().max(500).optional(),
  timestamp: z.string().optional(),
});

// Live mode control (admin)
export const setLiveModeSchema = z.object({
  employeeId: z.string().uuid(),
  enabled: z.boolean(),
  // Min 30s: below this, battery/storage abuse (sharp resize + upload = ~200ms CPU per cycle).
  // Max 3600s: useful for very low-frequency passive monitoring.
  intervalSeconds: z.number().int().min(30).max(3600).optional().default(30),
});

// Date URL param validation
export const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format');

// BUG-003: UUID path param validation — applied to all :employeeId / :historyId / :screenshotId params
export const employeeIdParamSchema = z.string().uuid('employeeId must be a valid UUID');
export const historyIdParamSchema = z.string().uuid('historyId must be a valid UUID');
export const screenshotIdParamSchema = z.string().uuid('screenshotId must be a valid UUID');

// Agent setup (admin)
export const generateCodeSchema = z.object({
  employeeId: z.string().uuid(),
});

// Pairing code format validation — BUG-008
// Regex matches PAIR_CHARS exactly: A-H, J-N, P-Z (excludes I, O), 2-9 (excludes 0, 1)
export const pairCodeSchema = z.string().regex(/^ANST-[A-HJKLMNPQRSTUVWXYZ2-9]{4}$/, 'Pairing code must be in format ANST-XXXX');

export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type ScreenshotMetadata = z.infer<typeof screenshotMetadataSchema>;
export type GenerateCodeInput = z.infer<typeof generateCodeSchema>;
