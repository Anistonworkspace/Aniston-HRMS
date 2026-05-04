import { z } from 'zod';

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone number must be at least 10 digits'),
  personalEmail: z.string().email().optional().or(z.literal('')),
  dateOfBirth: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
  bloodGroup: z.string().optional(),
  maritalStatus: z.string().optional(),
  // qualification: standardized value — drives KYC document cascade during onboarding
  qualification: z.enum(['TENTH', 'TWELFTH', 'DIPLOMA', 'GRADUATION', 'POST_GRADUATION', 'PHD']).optional(),
  departmentId: z.string().uuid().optional().nullable(),
  designationId: z.string().uuid().optional().nullable(),
  workMode: z.enum(['OFFICE', 'HYBRID', 'FIELD_SALES', 'PROJECT_SITE', 'REMOTE']).default('OFFICE'),
  // employmentType: affects EPF/ESI/PT eligibility, leave balance seeding, salary template
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).default('FULL_TIME'),
  // experienceLevel: determines required KYC documents (EXPERIENCED needs experience letter)
  experienceLevel: z.enum(['INTERN', 'FRESHER', 'EXPERIENCED']).optional(),
  officeLocationId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
  // joiningDate: contractual employment start — used for payroll pro-ration, leave accrual
  joiningDate: z.string().min(1, 'Joining date is required'),
  probationEndDate: z.string().optional(),
  ctc: z.number().positive().optional(),
  // address: current residential address (flat JSON: { line1, city, state, pincode })
  address: z.any().optional(),
  // permanentAddress: home address — stored separately, shown on profile
  permanentAddress: z.any().optional(),
  emergencyContact: z.object({
    name: z.string().min(1, 'Name required'),
    relationship: z.string().min(1, 'Relationship required'),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number').or(z.literal('')),
    email: z.string().email('Invalid email').optional().or(z.literal('')),
  }).optional(),
  bankAccountNumber: z.string().optional(),
  bankName: z.string().optional(),
  bankBranchName: z.string().optional().nullable(),
  ifscCode: z.string().optional(),
  accountHolderName: z.string().optional(),
  accountType: z.enum(['SAVINGS', 'CURRENT']).optional(),
  epfMemberId: z.string().optional().nullable(),
  epfUan: z.string().optional().nullable(),
  epfEnabled: z.boolean().optional(),
  epfExempt: z.boolean().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  // status: HR-only; determines leave type eligibility, attendance policy, payroll processing
  // INTERN → intern leave balances; PROBATION → probation leave rules; NOTICE_PERIOD → exit flow
  status: z.enum([
    'ONBOARDING', 'INTERN', 'PROBATION', 'ACTIVE', 'NOTICE_PERIOD',
    'SUSPENDED', 'INACTIVE', 'TERMINATED', 'ABSCONDED',
  ]).optional(),
  // HR-only fields
  onboardingDate: z.string().optional(),
  shiftId: z.string().uuid().optional().nullable(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'EMPLOYEE', 'INTERN', 'GUEST_INTERVIEWER']).optional(),
});

export const employeeQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(2000).default(10),
  search: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
  workMode: z.string().optional(),
  employmentType: z.string().optional(),
  onboardingStatus: z.enum(['complete', 'pending']).optional(),
  managerId: z.string().uuid().optional(),
  officeLocationId: z.string().uuid().optional(),
  joiningDateFrom: z.string().optional(),
  joiningDateTo: z.string().optional(),
  sortBy: z.enum(['createdAt', 'firstName', 'lastName', 'employeeCode', 'joiningDate', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const submitResignationSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  lastWorkingDate: z.string().min(1, 'Last working date is required'),
});

export const approveExitSchema = z.object({
  lastWorkingDate: z.string().optional(),
  notes: z.string().optional(),
});

export const initiateTerminationSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
  lastWorkingDate: z.string().min(1, 'Last working date is required'),
  notes: z.string().optional(),
});

export const exitQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(20),
  status: z.string().optional(),
  department: z.string().optional(),
});

export type SubmitResignationInput = z.infer<typeof submitResignationSchema>;
export type ApproveExitInput = z.infer<typeof approveExitSchema>;
export type InitiateTerminationInput = z.infer<typeof initiateTerminationSchema>;
export type ExitQuery = z.infer<typeof exitQuerySchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;
