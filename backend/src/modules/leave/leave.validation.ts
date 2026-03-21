import { z } from 'zod';

export const applyLeaveSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  isHalfDay: z.boolean().default(false),
  halfDaySession: z.enum(['FIRST_HALF', 'SECOND_HALF']).optional(),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
  attachmentUrl: z.string().optional(),
});

export const leaveActionSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().optional(),
});

export const leaveQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  status: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  year: z.coerce.number().optional(),
});

export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;
export type LeaveActionInput = z.infer<typeof leaveActionSchema>;
export type LeaveQuery = z.infer<typeof leaveQuerySchema>;
