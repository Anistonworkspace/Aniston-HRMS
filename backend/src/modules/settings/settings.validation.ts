import { z } from 'zod';

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  logo: z.string().optional(),
  timezone: z.string().optional(),
  fiscalYear: z.string().optional(),
  currency: z.string().optional(),
  address: z.any().optional(),
  settings: z.any().optional(),
});

export const createLocationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('India'),
  timezone: z.string().default('Asia/Kolkata'),
});

export const updateLocationSchema = createLocationSchema.partial();

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  entity: z.string().optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
