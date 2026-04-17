import { z } from 'zod';

// ── Single salary component ────────────────────────────────────────
const salaryComponentSchema = z.object({
  name: z.string().min(1, 'Component name is required'),
  type: z.enum(['earning', 'deduction'], { required_error: 'Type must be "earning" or "deduction"' }),
  value: z.number().min(0, 'Value cannot be negative'),
  isPercentage: z.boolean(),
  percentage: z.number().min(0).max(100).optional(),
});

// ── Configurable statutory deductions ──────────────────────────────
const statutoryConfigSchema = z.object({
  epf: z.object({
    enabled: z.boolean(),
    employeePercent: z.number().min(0).max(100).optional(),
    employerPercent: z.number().min(0).max(100).optional(),
    basicCap: z.number().min(0).optional(),
  }).optional(),
  esi: z.object({
    enabled: z.boolean(),
    employeePercent: z.number().min(0).max(100).optional(),
    employerPercent: z.number().min(0).max(100).optional(),
    grossCap: z.number().min(0).optional(),
  }).optional(),
  pt: z.object({
    enabled: z.boolean(),
    slabs: z.array(z.object({
      min: z.number().min(0),
      max: z.number().min(0),
      amount: z.number().min(0),
    })).optional(),
  }).optional(),
}).optional();

// ── Dynamic salary structure schema ────────────────────────────────
// Accepts any numeric values — no percentage enforcement
export const salaryStructureSchema = z.object({
  ctcAnnual: z.number().positive('CTC must be positive'),
  components: z.array(salaryComponentSchema)
    .min(1, 'At least one earning component is required')
    .refine(
      (comps) => comps.some((c) => c.type === 'earning'),
      { message: 'At least one earning component is required' }
    )
    .refine(
      (comps) => {
        const totalEarnings = comps.filter(c => c.type === 'earning').reduce((s, c) => s + c.value, 0);
        const totalDeductions = comps.filter(c => c.type === 'deduction').reduce((s, c) => s + c.value, 0);
        return totalEarnings >= totalDeductions;
      },
      { message: 'Total earnings must be greater than or equal to total deductions' }
    ),
  incomeTaxRegime: z.enum(['OLD_REGIME', 'NEW_REGIME']).optional(),
  statutoryConfig: statutoryConfigSchema,
  // New fields for overwrite protection, effective date, and audit
  effectiveFrom: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date').optional(),
  reason: z.string().max(500).optional(),
  changeType: z.enum(['INITIAL', 'REVISION', 'PROMOTION', 'CORRECTION', 'TEMPLATE_APPLIED']).optional(),
  confirmOverwrite: z.boolean().optional(),
  isCustom: z.boolean().optional(),   // true = per-employee custom components; false = derived from org master at runtime
});

// ── Legacy salary structure schema (backward compat for bulk import) ──
export const legacySalaryStructureSchema = z.object({
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

// ── Payroll run ────────────────────────────────────────────────────
export const createPayrollRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2030),
});

// ── Amendment schema (fixed field mismatch) ────────────────────────
export const amendPayrollRecordSchema = z.object({
  grossSalary: z.number().min(0).optional(),
  netSalary: z.number().min(0).optional(),
  basic: z.number().min(0).optional(),
  hra: z.number().min(0).optional(),
  epfEmployee: z.number().min(0).optional(),
  esiEmployee: z.number().min(0).optional(),
  professionalTax: z.number().min(0).optional(),
  tds: z.number().min(0).optional(),
  lopDays: z.number().min(0).optional(), // Decimal — half-days (0.5) are valid
  lopDeduction: z.number().min(0).optional(),
  reason: z.string().min(1, 'Amendment reason is required'),
});

// ── Type exports ───────────────────────────────────────────────────
export type SalaryComponent = z.infer<typeof salaryComponentSchema>;
export type StatutoryConfig = z.infer<typeof statutoryConfigSchema>;
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;
export type AmendPayrollInput = z.infer<typeof amendPayrollRecordSchema>;
