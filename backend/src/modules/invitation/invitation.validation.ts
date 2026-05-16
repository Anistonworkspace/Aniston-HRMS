import { z } from 'zod';

export const createInvitationSchema = z.object({
  // Contact — at least one required; email sends invite link, mobile sends WhatsApp
  email: z.string().email('Invalid email address').optional(),
  mobileNumber: z.string().min(10, 'Enter a valid mobile number').optional(),

  // employmentType: optional — HR can assign later via employee profile editor.
  // When provided, drives EPF/ESI/PT eligibility, leave balance seeding, salary template.
  // INTERN → stipend only; CONTRACT → typically exempt from statutory deductions.
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),

  // departmentId: optional — HR can assign later via employee profile editor.
  // Assigns team, affects leave policy and org chart placement.
  departmentId: z.string().uuid('Select a valid department').optional(),

  // designationId: optional — HR can assign later via employee profile editor.
  // Job title used on offer letters, payslips, and org chart.
  designationId: z.string().uuid('Select a valid designation').optional(),

  // managerId: optional — HR can assign later via employee profile editor.
  // Sets direct reporting line; routes leave/regularization approvals.
  managerId: z.string().uuid('Select a valid reporting manager').optional(),

  // officeLocationId: optional — HR can assign later via employee profile editor.
  // Determines geofence boundary for OFFICE attendance check-in.
  officeLocationId: z.string().uuid('Select a valid office location').optional(),

  // shiftId: optional — creates a ShiftAssignment on acceptance when provided.
  shiftId: z.string().uuid('Select a valid shift').optional(),

  // workMode: optional — defaults to OFFICE if not provided.
  //   OFFICE → geofence auto check-in, FIELD_SALES → GPS trail every 60s,
  //   PROJECT_SITE → photo check-in, REMOTE/HYBRID → manual.
  workMode: z.enum(['OFFICE', 'HYBRID', 'FIELD_SALES', 'PROJECT_SITE', 'REMOTE']).optional(),

  // proposedJoiningDate: optional — transferred to Employee.joiningDate on acceptance.
  // Payroll uses this for first-month pro-ration; leave accrual starts from this date.
  proposedJoiningDate: z.string().optional(),

  // experienceLevel: determines required KYC documents during onboarding
  //   EXPERIENCED → requires previous employment docs (experience letter, last payslip, etc.)
  //   FRESHER → standard docs only
  //   INTERN → enrollment proof required
  experienceLevel: z.enum(['INTERN', 'FRESHER', 'EXPERIENCED']).default('FRESHER'),

  // experienceDocFields: HR-configured custom doc requirements for EXPERIENCED employees
  //   Array of { key: string, label: string, required: boolean }
  experienceDocFields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean().default(true),
  })).optional(),

  // role: HR can invite EMPLOYEE, INTERN, MANAGER, HR, ADMIN
  // SUPER_ADMIN enforcement is done in the service layer; defaults to EMPLOYEE if not provided
  role: z.enum(['EMPLOYEE', 'INTERN', 'MANAGER', 'HR', 'ADMIN']).optional().default('EMPLOYEE'),

  notes: z.string().max(1000).optional(),
  sendWelcomeEmail: z.boolean().default(true),
}).refine(
  (data) => data.email || data.mobileNumber,
  {
    message: 'Provide at least one contact method — email, mobile number, or both',
    path: ['email'],
  }
);

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
