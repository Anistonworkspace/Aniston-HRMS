import { z } from 'zod';

export const salaryStructureSchema = z.object({
  ctc: z.number().positive(),
  basic: z.number().positive(),
  hra: z.number().min(0),
  da: z.number().min(0).optional(),
  ta: z.number().min(0).optional(),
  medicalAllowance: z.number().min(0).optional(),
  specialAllowance: z.number().min(0).optional(),
  lta: z.number().min(0).optional(),
  incomeTaxRegime: z.enum(['OLD_REGIME', 'NEW_REGIME']).optional(),
});

export const createPayrollRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2030),
});

export const amendPayrollRecordSchema = z.object({
  basicSalary: z.number().min(0).optional(),
  hra: z.number().min(0).optional(),
  da: z.number().min(0).optional(),
  ta: z.number().min(0).optional(),
  medicalAllowance: z.number().min(0).optional(),
  specialAllowance: z.number().min(0).optional(),
  lta: z.number().min(0).optional(),
  bonus: z.number().min(0).optional(),
  deductions: z.number().min(0).optional(),
  lop: z.number().int().min(0).optional(),
  reason: z.string().min(1, 'Amendment reason is required'),
});
