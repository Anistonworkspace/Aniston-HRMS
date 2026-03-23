import { z } from 'zod';

export const createDesignationSchema = z.object({
  name: z.string().min(1).max(100),
  level: z.number().int().min(1).max(20).optional(),
  description: z.string().optional(),
});

export const updateDesignationSchema = createDesignationSchema.partial();

export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
