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
  departmentId: z.string().uuid().optional().nullable(),
  designationId: z.string().uuid().optional().nullable(),
  workMode: z.enum(['OFFICE', 'HYBRID', 'FIELD_SALES', 'PROJECT_SITE', 'REMOTE']).default('OFFICE'),
  officeLocationId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
  joiningDate: z.string().min(1, 'Joining date is required'),
  probationEndDate: z.string().optional(),
  ctc: z.number().positive().optional(),
  address: z.object({
    current: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      pincode: z.string(),
      country: z.string().default('India'),
    }).optional(),
    permanent: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      pincode: z.string(),
      country: z.string().default('India'),
    }).optional(),
  }).optional(),
  emergencyContact: z.object({
    name: z.string(),
    relationship: z.string(),
    phone: z.string(),
    email: z.string().email().optional(),
  }).optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const employeeQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  department: z.string().optional(),
  status: z.string().optional(),
  workMode: z.string().optional(),
  sortBy: z.string().default('createdAt'),
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
  limit: z.coerce.number().min(1).max(100).default(20),
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
