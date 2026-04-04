import { z } from 'zod';

export const createDesignationSchema = z.object({
  name: z.string().min(1, 'Designation name is required').max(100)
    .transform(v => v.trim().replace(/\s+/g, ' ')),
  code: z.string().max(20).optional()
    .transform(v => v?.trim().toUpperCase().replace(/\s+/g, '_')),
  level: z.number().int().min(1).max(20).optional(),
  levelBand: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  departmentId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateDesignationSchema = createDesignationSchema.partial();

export const searchDesignationSchema = z.object({
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().optional(),
});

export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;
export type SearchDesignationQuery = z.infer<typeof searchDesignationSchema>;
