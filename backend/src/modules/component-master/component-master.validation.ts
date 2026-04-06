import { z } from 'zod';

export const createComponentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  code: z.string().min(1, 'Code is required').max(30).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase alphanumeric with underscores'),
  type: z.enum(['EARNING', 'DEDUCTION']),
  category: z.enum(['STANDARD', 'ALLOWANCE', 'BONUS', 'REIMBURSEMENT', 'STATUTORY', 'CUSTOM']).optional(),
  calculationRule: z.enum(['FIXED', 'PERCENTAGE_CTC', 'PERCENTAGE_BASIC', 'SLAB', 'FORMULA']).optional(),
  percentageOf: z.string().max(30).optional(),
  defaultValue: z.number().min(0).optional(),
  defaultPercentage: z.number().min(0).max(100).optional(),
  isTaxable: z.boolean().optional(),
  isStatutory: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  description: z.string().max(500).optional(),
});

export const updateComponentSchema = createComponentSchema.partial();

export const reorderComponentsSchema = z.object({
  components: z.array(z.object({
    id: z.string().uuid(),
    sortOrder: z.number().int().min(0),
  })),
});
