import { z } from 'zod';

export const createHolidaySchema = z.object({
  name: z.string().min(1, 'Holiday name is required').max(200),
  date: z.string().min(1, 'Date is required'),
  type: z.string().default('PUBLIC'),
  isOptional: z.boolean().default(false),
});

export const updateHolidaySchema = createHolidaySchema.partial();

export const holidayQuerySchema = z.object({
  year: z.coerce.number().optional(),
  type: z.string().optional(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type HolidayQuery = z.infer<typeof holidayQuerySchema>;
