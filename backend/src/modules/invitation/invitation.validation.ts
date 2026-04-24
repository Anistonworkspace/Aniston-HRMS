import { z } from 'zod';

export const createInvitationSchema = z.object({
  // Contact — at least one required; email sends invite link, mobile sends WhatsApp
  email: z.string().email('Invalid email address').optional(),
  mobileNumber: z.string().min(10, 'Enter a valid mobile number').optional(),

  // role: portal access level — INTERN gets limited access (no payroll, no org chart)
  // MANAGER gets team leave/attendance approvals; HR gets full employee management
  role: z.enum(['EMPLOYEE', 'INTERN', 'MANAGER', 'HR', 'ADMIN']).default('EMPLOYEE'),

  // employmentType: REQUIRED — drives EPF/ESI/PT eligibility, leave balance seeding,
  // and salary template selection. INTERN → stipend only; CONTRACT → typically exempt.
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'], {
    required_error: 'Employment type is required',
    invalid_type_error: 'Invalid employment type',
  }),

  // departmentId: REQUIRED — assigns team, affects leave policy and org chart placement
  departmentId: z.string().uuid('Select a valid department'),

  // designationId: REQUIRED — job title used on offer letters, payslips, and org chart
  designationId: z.string().uuid('Select a valid designation'),

  // managerId: optional — sets direct reporting line; routes leave/regularization approvals
  managerId: z.string().uuid().optional(),

  // officeLocationId: REQUIRED — determines geofence boundary for OFFICE attendance check-in
  officeLocationId: z.string().uuid('Select a valid office location'),

  // workMode: REQUIRED — determines attendance mode:
  //   OFFICE → geofence auto check-in, FIELD_SALES → GPS trail every 60s,
  //   PROJECT_SITE → photo check-in, REMOTE/HYBRID → manual
  workMode: z.enum(['OFFICE', 'HYBRID', 'FIELD_SALES', 'PROJECT_SITE', 'REMOTE'], {
    required_error: 'Work mode is required',
    invalid_type_error: 'Invalid work mode',
  }),

  // proposedJoiningDate: REQUIRED — transferred to Employee.joiningDate on acceptance;
  // payroll uses this for first-month pro-ration; leave accrual starts from this date
  proposedJoiningDate: z.string().min(1, 'Proposed joining date is required'),

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
