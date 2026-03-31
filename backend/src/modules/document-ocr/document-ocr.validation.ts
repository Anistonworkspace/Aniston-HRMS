import { z } from 'zod';

export const updateOcrSchema = z.object({
  extractedName: z.string().optional(),
  extractedDob: z.string().optional(),
  extractedFatherName: z.string().optional(),
  extractedMotherName: z.string().optional(),
  extractedDocNumber: z.string().optional(),
  extractedGender: z.string().optional(),
  extractedAddress: z.string().optional(),
  hrNotes: z.string().optional(),
  ocrStatus: z.enum(['PENDING', 'REVIEWED', 'FLAGGED']).optional(),
});

export type UpdateOcrInput = z.infer<typeof updateOcrSchema>;
