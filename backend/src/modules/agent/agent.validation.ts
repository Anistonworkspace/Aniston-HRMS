import { z } from 'zod';

export const activityEntrySchema = z.object({
  activeApp: z.string().optional(),
  activeWindow: z.string().max(500).optional(),
  activeUrl: z.string().max(1000).optional(),
  category: z.enum(['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE']).optional(),
  durationSeconds: z.number().int().min(0).default(0),
  idleSeconds: z.number().int().min(0).default(0),
  keystrokes: z.number().int().min(0).default(0),
  mouseClicks: z.number().int().min(0).default(0),
  mouseDistance: z.number().int().min(0).default(0),
  timestamp: z.string(),
});

export const heartbeatSchema = z.object({
  activities: z.array(activityEntrySchema).min(1).max(100),
});

export const screenshotMetadataSchema = z.object({
  activeApp: z.string().optional(),
  activeWindow: z.string().max(500).optional(),
  timestamp: z.string().optional(),
});

// Live mode control (admin)
export const setLiveModeSchema = z.object({
  employeeId: z.string().uuid(),
  enabled: z.boolean(),
  intervalSeconds: z.number().int().min(5).max(300).optional().default(30),
});

// Date URL param validation
export const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format');

// Agent setup (admin)
export const generateCodeSchema = z.object({
  employeeId: z.string().uuid(),
});

export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type ScreenshotMetadata = z.infer<typeof screenshotMetadataSchema>;
export type GenerateCodeInput = z.infer<typeof generateCodeSchema>;
