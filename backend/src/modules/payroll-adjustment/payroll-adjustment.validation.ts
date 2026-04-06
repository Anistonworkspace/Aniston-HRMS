import { z } from 'zod';

export const createAdjustmentSchema = z.object({
  payrollRunId: z.string().uuid(),
  employeeId: z.string().uuid(),
  type: z.enum(['ARREARS', 'REIMBURSEMENT', 'BONUS', 'INCENTIVE', 'ADVANCE_DEDUCTION', 'LOAN_RECOVERY', 'OTHER']),
  componentName: z.string().min(1).max(100),
  amount: z.number().positive('Amount must be positive'),
  isDeduction: z.boolean(),
  reason: z.string().min(1).max(500),
});

export const bulkCreateAdjustmentSchema = z.object({
  payrollRunId: z.string().uuid(),
  adjustments: z.array(z.object({
    employeeId: z.string().uuid(),
    type: z.enum(['ARREARS', 'REIMBURSEMENT', 'BONUS', 'INCENTIVE', 'ADVANCE_DEDUCTION', 'LOAN_RECOVERY', 'OTHER']),
    componentName: z.string().min(1).max(100),
    amount: z.number().positive(),
    isDeduction: z.boolean(),
    reason: z.string().min(1).max(500),
  })).min(1),
});

export const approveAdjustmentSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});
