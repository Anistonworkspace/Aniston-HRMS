import { z } from 'zod';

export const createPolicySchema = z.object({
  title: z.string().min(1),
});

export const updatePolicySchema = z.object({
  title: z.string().min(1).optional(),
});

export const policyQuerySchema = z.object({});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type PolicyQuery = z.infer<typeof policyQuerySchema>;
