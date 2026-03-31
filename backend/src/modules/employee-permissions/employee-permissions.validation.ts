import { z } from 'zod';

const PERMISSION_FIELDS = {
  canMarkAttendance: z.boolean(),
  canViewAttendanceHistory: z.boolean(),
  canApplyLeaves: z.boolean(),
  canViewLeaveBalance: z.boolean(),
  canViewPayslips: z.boolean(),
  canDownloadPayslips: z.boolean(),
  canViewDocuments: z.boolean(),
  canDownloadDocuments: z.boolean(),
  canViewDashboardStats: z.boolean(),
  canViewAnnouncements: z.boolean(),
  canViewPolicies: z.boolean(),
  canRaiseHelpdeskTickets: z.boolean(),
  canViewOrgChart: z.boolean(),
  canViewPerformance: z.boolean(),
  canViewEditProfile: z.boolean(),
};

export const upsertPresetSchema = z.object({
  role: z.enum(['EMPLOYEE', 'INTERN', 'MANAGER']),
  ...PERMISSION_FIELDS,
});

// For overrides, each field is nullable (null = inherit from preset)
export const upsertOverrideSchema = z.object({
  canMarkAttendance: z.boolean().nullable().optional(),
  canViewAttendanceHistory: z.boolean().nullable().optional(),
  canApplyLeaves: z.boolean().nullable().optional(),
  canViewLeaveBalance: z.boolean().nullable().optional(),
  canViewPayslips: z.boolean().nullable().optional(),
  canDownloadPayslips: z.boolean().nullable().optional(),
  canViewDocuments: z.boolean().nullable().optional(),
  canDownloadDocuments: z.boolean().nullable().optional(),
  canViewDashboardStats: z.boolean().nullable().optional(),
  canViewAnnouncements: z.boolean().nullable().optional(),
  canViewPolicies: z.boolean().nullable().optional(),
  canRaiseHelpdeskTickets: z.boolean().nullable().optional(),
  canViewOrgChart: z.boolean().nullable().optional(),
  canViewPerformance: z.boolean().nullable().optional(),
  canViewEditProfile: z.boolean().nullable().optional(),
});

export type UpsertPresetInput = z.infer<typeof upsertPresetSchema>;
export type UpsertOverrideInput = z.infer<typeof upsertOverrideSchema>;
