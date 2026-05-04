import { z } from 'zod';

export const createHolidaySchema = z.object({
  name: z.string().min(1, 'Holiday name is required').max(200),
  date: z.string().min(1, 'Date is required'),
  type: z.string().default('PUBLIC'),  // PUBLIC, OPTIONAL, EVENT, CUSTOM
  isOptional: z.boolean().default(false),
  isHalfDay: z.boolean().default(false),
  halfDaySession: z.enum(['FIRST_HALF', 'SECOND_HALF']).optional(),
  description: z.string().max(2000).optional(),
  color: z.string().max(10).optional(),
  notifyEmployees: z.boolean().default(true),
});

export const updateHolidaySchema = createHolidaySchema.partial();

export const holidayQuerySchema = z.object({
  year: z.coerce.number().optional(),
  type: z.string().optional(),
});

export const bulkHolidaysSchema = z.object({
  holidays: z.array(createHolidaySchema).min(1).max(50),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type HolidayQuery = z.infer<typeof holidayQuerySchema>;
export type BulkHolidaysInput = z.infer<typeof bulkHolidaysSchema>;
