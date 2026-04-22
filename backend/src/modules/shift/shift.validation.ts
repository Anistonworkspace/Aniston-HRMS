import { z } from 'zod';

export const createShiftSchema = z.object({
  name: z.string().min(2).max(50),
  code: z.string().min(1).max(30).toUpperCase(),
  shiftType: z.enum(['OFFICE', 'FIELD']).default('OFFICE'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm format'),
  // graceMinutes is an alias for lateGraceMinutes — kept for backward compatibility with older clients
  graceMinutes: z.coerce.number().int().min(0).optional(),
  halfDayHours: z.coerce.number().min(1).default(4),
  fullDayHours: z.coerce.number().min(1).default(8),
  trackingIntervalMinutes: z.coerce.number().int().min(15).max(480).optional(),
  isDefault: z.boolean().default(false),
  // Attendance policy per shift
  // If lateGraceMinutes is omitted but graceMinutes is provided, graceMinutes is used as the value
  lateGraceMinutes: z.coerce.number().int().min(0).default(15),
  lateHalfDayAfterMins: z.coerce.number().int().min(0).default(120),
  latePenaltyEnabled: z.boolean().default(false),
  latePenaltyPerCount: z.coerce.number().int().min(1).default(3),
  weekOffDays: z.array(z.number().int().min(0).max(6)).default([0]),
  otEnabled: z.boolean().default(false),
  otThresholdMinutes: z.coerce.number().int().min(0).default(30),
  otRateMultiplier: z.coerce.number().min(1).default(1.5),
  otMaxHoursPerDay: z.coerce.number().min(0).default(4),
  compOffEnabled: z.boolean().default(false),
  compOffMinOTHours: z.coerce.number().min(0).default(4),
  compOffExpiryDays: z.coerce.number().int().min(0).default(30),
  sundayWorkEnabled: z.boolean().default(false),
  sundayPayMultiplier: z.coerce.number().min(1).max(10).default(2.0),
  // WFH policy
  allowWfh: z.boolean().default(false),
  wfhDays: z.array(z.number().int().min(0).max(6)).default([]),
  // WFH Shift — entire shift is WFH; no geofence or GPS tracking
  isWfhShift: z.boolean().default(false).optional(),
});

export const updateShiftSchema = createShiftSchema.partial();

export const assignShiftSchema = z.object({
  employeeId: z.string().uuid(),
  shiftId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
});

export const createLocationSchema = z.object({
  name: z.string().min(2).max(100),
  address: z.string().min(2).max(200),
  city: z.string().min(1).max(100),
  state: z.string().optional(),
  country: z.string().default('India'),
  timezone: z.string().default('Asia/Kolkata'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(50).max(5000).default(200),
  autoCheckIn: z.boolean().default(false),
  autoCheckOut: z.boolean().default(false),
  strictMode: z.boolean().default(false),
});

export const updateLocationSchema = createLocationSchema.partial();

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type AssignShiftInput = z.infer<typeof assignShiftSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
