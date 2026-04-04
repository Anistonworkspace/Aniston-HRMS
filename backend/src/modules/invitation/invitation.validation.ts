import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email().optional(),
  mobileNumber: z.string().min(10).optional(),
  role: z.enum(['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN']).optional().default('EMPLOYEE'),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  officeLocationId: z.string().uuid().optional(),
  workMode: z.enum(['OFFICE', 'HYBRID', 'FIELD_SALES', 'PROJECT_SITE', 'REMOTE']).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  proposedJoiningDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  sendWelcomeEmail: z.boolean().default(true),
}).refine(
  (data) => data.email || data.mobileNumber,
  { message: 'At least one of email or mobile number is required' }
);

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
