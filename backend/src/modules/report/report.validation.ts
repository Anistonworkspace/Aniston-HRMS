import { z } from 'zod';

export const attendanceSummaryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const leaveSummaryQuerySchema = z.object({
  year: z.coerce.number().optional(),
});

const validDate = (label: string) =>
  z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: use YYYY-MM-DD`)
    .refine((v) => {
      const d = new Date(v);
      if (isNaN(d.getTime())) return false;
      const [y, m, day] = v.split('-').map(Number);
      return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
    }, { message: `${label}: invalid calendar date` })
    .optional();

export const attendanceDetailQuerySchema = z.object({
  from: validDate('From date'),
  to: validDate('To date'),
  departmentId: z.string().uuid('Invalid department ID').optional(),
  employeeId: z.string().uuid('Invalid employee ID').optional(),
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND', 'WORK_FROM_HOME']).optional(),
  format: z.enum(['json', 'xlsx']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(10000).default(50),
});

export const leaveDetailQuerySchema = z.object({
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100).optional(),
  leaveTypeId: z.string().uuid('Invalid leave type ID').optional(),
  status: z.enum(['DRAFT', 'PENDING', 'MANAGER_APPROVED', 'APPROVED', 'APPROVED_WITH_CONDITION', 'REJECTED', 'CANCELLED']).optional(),
  departmentId: z.string().uuid('Invalid department ID').optional(),
  format: z.enum(['json', 'xlsx']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(10000).default(50),
});

export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;
export type LeaveSummaryQuery = z.infer<typeof leaveSummaryQuerySchema>;
export type AttendanceDetailQuery = z.infer<typeof attendanceDetailQuerySchema>;
export type LeaveDetailQuery = z.infer<typeof leaveDetailQuerySchema>;
