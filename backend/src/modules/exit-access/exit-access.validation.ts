import { z } from 'zod';

export const upsertExitAccessSchema = z.object({
  canViewDashboard: z.boolean().optional().default(false),
  canViewPayslips: z.boolean().optional().default(true),
  canDownloadPayslips: z.boolean().optional().default(true),
  canViewAttendance: z.boolean().optional().default(false),
  canMarkAttendance: z.boolean().optional().default(false),
  canApplyLeave: z.boolean().optional().default(false),
  canViewLeaveBalance: z.boolean().optional().default(false),
  canViewDocuments: z.boolean().optional().default(true),
  canDownloadDocuments: z.boolean().optional().default(true),
  canViewHelpdesk: z.boolean().optional().default(false),
  canCreateTicket: z.boolean().optional().default(false),
  canViewAnnouncements: z.boolean().optional().default(false),
  canViewProfile: z.boolean().optional().default(true),
  accessExpiresAt: z.string().datetime().optional().nullable(),
});

export type UpsertExitAccessInput = z.infer<typeof upsertExitAccessSchema>;
