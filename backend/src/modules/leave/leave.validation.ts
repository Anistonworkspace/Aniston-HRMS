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

export const createLeaveTypeSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(1).max(10).toUpperCase(),
  defaultBalance: z.number().min(0).max(365),
  carryForward: z.boolean().default(false),
  maxCarryForward: z.number().min(0).optional(),
  isPaid: z.boolean().default(true),
  minDays: z.number().min(0.5).default(0.5),
  maxDays: z.number().min(0.5).optional(),
  noticeDays: z.number().int().min(0).default(0),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  applicableTo: z.enum(['ALL', 'PROBATION', 'CONFIRMED']).default('ALL'),
  maxPerMonth: z.number().int().min(1).optional(),
  allowWeekendAdjacent: z.boolean().default(true),
  allowSameDay: z.boolean().default(false),
  probationMonths: z.number().int().min(0).default(3),
  requiresApproval: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial();

export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;
export type LeaveActionInput = z.infer<typeof leaveActionSchema>;
export type LeaveQuery = z.infer<typeof leaveQuerySchema>;
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
