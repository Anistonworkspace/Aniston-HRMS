import { z } from 'zod';

export const updateBrandingSchema = z.object({
  companyName: z.string().max(200).optional(),
  companyAddress: z.string().max(500).optional(),
});

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
