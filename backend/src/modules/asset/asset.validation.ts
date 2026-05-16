import { z } from 'zod';

const assetConditionEnum = z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'LOST']);

export const createAssetSchema = z.object({
  name: z.string().min(1, 'Asset name is required').max(200),
  assetCode: z.string().min(1, 'Asset code is required').max(50),
  category: z.enum(['LAPTOP', 'MOBILE', 'SIM_CARD', 'ACCESS_CARD', 'VISITING_CARD', 'MONITOR', 'OTHER']),
  brand: z.string().max(100).optional(),
  modelNumber: z.string().max(200).optional(),
  serialNumber: z.string().max(200).optional(),
  condition: assetConditionEnum.default('GOOD'),
  purchaseDate: z.string().optional(),
  purchaseCost: z.number().positive().optional(),
  warrantyExpiry: z.string().optional(),
  vendor: z.string().max(200).optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateAssetSchema = createAssetSchema.partial();

export const assignAssetSchema = z.object({
  assetId: z.string().uuid('Invalid asset ID'),
  employeeId: z.string().uuid('Invalid employee ID'),
  condition: assetConditionEnum.optional(),
  notes: z.string().max(2000).optional(),
});

export const returnAssetSchema = z.object({
  returnCondition: assetConditionEnum.optional(),
  returnNotes: z.string().max(2000).optional(),
});

export const exitChecklistItemSchema = z.object({
  itemId: z.string().uuid(),
  isReturned: z.boolean(),
  notes: z.string().max(2000).optional(),
});

const assetCategoryEnum = z.enum(['LAPTOP', 'MOBILE', 'SIM_CARD', 'ACCESS_CARD', 'VISITING_CARD', 'MONITOR', 'OTHER']);
const assetStatusEnum = z.enum(['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RETIRED']);

export const assetQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  category: assetCategoryEnum.optional(),
  status: assetStatusEnum.optional(),
  search: z.string().max(200).optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;
export type ReturnAssetInput = z.infer<typeof returnAssetSchema>;
export type ExitChecklistItemInput = z.infer<typeof exitChecklistItemSchema>;
export type AssetQuery = z.infer<typeof assetQuerySchema>;
