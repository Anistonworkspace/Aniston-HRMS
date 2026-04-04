import { z } from 'zod';

export const createDepartmentSchema = z.object({
  name: z.string().min(1, 'Department name is required').max(100)
    .transform(v => v.trim().replace(/\s+/g, ' ')),
  code: z.string().max(20).optional()
    .transform(v => v?.trim().toUpperCase().replace(/\s+/g, '_')),
  description: z.string().max(500).optional(),
  headId: z.string().uuid().optional().nullable(),
  parentDepartmentId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const searchDepartmentSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type SearchDepartmentQuery = z.infer<typeof searchDepartmentSchema>;
