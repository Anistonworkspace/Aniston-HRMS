import { z } from 'zod';

export const attendanceSummaryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const leaveSummaryQuerySchema = z.object({
  year: z.coerce.number().optional(),
});

export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;
export type LeaveSummaryQuery = z.infer<typeof leaveSummaryQuerySchema>;
