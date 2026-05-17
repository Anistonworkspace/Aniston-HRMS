import { z } from 'zod';

export const createSavedLocationSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(50).max(2000).optional(),
  isImportant: z.boolean().optional(),
  category: z.string().max(50).optional(),
});

export const updateSavedLocationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().optional(),
  radiusMeters: z.number().int().min(50).max(2000).optional(),
  isImportant: z.boolean().optional(),
  category: z.string().max(50).optional(),
});
