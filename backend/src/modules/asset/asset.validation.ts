import { z } from 'zod';

export const createAssetSchema = z.object({
  name: z.string().min(1, 'Asset name is required').max(200),
  assetCode: z.string().min(1, 'Asset code is required').max(50),
  category: z.enum(['LAPTOP', 'MOBILE', 'SIM_CARD', 'ACCESS_CARD', 'VISITING_CARD', 'MONITOR', 'OTHER']),
  serialNumber: z.string().max(200).optional(),
  purchaseDate: z.string().optional(),
  purchaseCost: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateAssetSchema = createAssetSchema.partial();

export const assignAssetSchema = z.object({
  assetId: z.string().uuid('Invalid asset ID'),
  employeeId: z.string().uuid('Invalid employee ID'),
  condition: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const assetQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  category: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;
export type AssetQuery = z.infer<typeof assetQuerySchema>;
