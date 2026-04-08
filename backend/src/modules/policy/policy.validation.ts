import { z } from 'zod';

export const createPolicySchema = z.object({
  title: z.string().min(1),
  downloadAllowed: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
});

export const updatePolicySchema = z.object({
  title: z.string().min(1).optional(),
  downloadAllowed: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
});

export const policyQuerySchema = z.object({});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type PolicyQuery = z.infer<typeof policyQuerySchema>;
