import { z } from 'zod';

export const createPolicySchema = z.object({
  title: z.string().min(1),
  category: z.enum(['HR_GENERAL', 'LEAVE', 'HYBRID', 'WORK_MANAGEMENT', 'ESCALATION', 'IT', 'CODE_OF_CONDUCT', 'HEALTH_SAFETY']),
  content: z.string().min(10),
  targetAudience: z.object({
    departments: z.array(z.string()).optional(),
    roles: z.array(z.string()).optional(),
    workModes: z.array(z.string()).optional(),
  }).optional(),
  attachments: z.array(z.string()).default([]),
});

export const updatePolicySchema = createPolicySchema.partial();

export const policyQuerySchema = z.object({
  category: z.string().optional(),
});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type PolicyQuery = z.infer<typeof policyQuerySchema>;
