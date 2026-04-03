import { z } from 'zod';

export const createSalaryTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(100),
  type: z.enum(['INTERN', 'FULL_TIME', 'CONTRACT', 'CUSTOM']),
  description: z.string().max(500).optional(),
  ctc: z.number().positive('CTC must be positive'),
  basic: z.number().positive('Basic must be positive'),
  hra: z.number().min(0),
  da: z.number().min(0).optional(),
  ta: z.number().min(0).optional(),
  medicalAllowance: z.number().min(0).optional(),
  specialAllowance: z.number().min(0).optional(),
  lta: z.number().min(0).optional(),
  performanceBonus: z.number().min(0).optional(),
  incomeTaxRegime: z.enum(['OLD_REGIME', 'NEW_REGIME']).optional(),
  components: z.array(z.object({
    name: z.string(),
    type: z.enum(['earning', 'deduction']),
    value: z.number(),
    isPercentage: z.boolean().optional(),
    percentage: z.number().optional(),
  })).optional(),
  statutoryConfig: z.record(z.any()).optional(),
  lockedFields: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
});

export const updateSalaryTemplateSchema = createSalaryTemplateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const applyTemplateSchema = z.object({
  templateId: z.string().uuid('Invalid template ID'),
  employeeIds: z.array(z.string().uuid()).min(1, 'At least one employee is required'),
  effectiveFrom: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date'),
  reason: z.string().min(1, 'Reason is required').max(500),
  overrides: z.record(z.number().min(0)).optional(),
  confirmOverwrite: z.boolean().optional(),
});

export const saveAsTemplateSchema = z.object({
  employeeId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum(['INTERN', 'FULL_TIME', 'CONTRACT', 'CUSTOM']),
  description: z.string().max(500).optional(),
  lockedFields: z.array(z.string()).optional(),
});
