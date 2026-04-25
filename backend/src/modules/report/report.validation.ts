import { z } from 'zod';

export const attendanceSummaryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const leaveSummaryQuerySchema = z.object({
  year: z.coerce.number().optional(),
});

export const attendanceDetailQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  departmentId: z.string().optional(),
  employeeId: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
});

export const leaveDetailQuerySchema = z.object({
  month: z.coerce.number().optional(),
  year: z.coerce.number().optional(),
  leaveTypeId: z.string().optional(),
  status: z.string().optional(),
  departmentId: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
});

export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;
export type LeaveSummaryQuery = z.infer<typeof leaveSummaryQuerySchema>;
export type AttendanceDetailQuery = z.infer<typeof attendanceDetailQuerySchema>;
export type LeaveDetailQuery = z.infer<typeof leaveDetailQuerySchema>;
