import { z } from 'zod';

export const createDocumentSchema = z.object({
  employeeId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  type: z.enum([
    'AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENSE',
    'DEGREE_CERTIFICATE', 'TENTH_CERTIFICATE', 'TWELFTH_CERTIFICATE',
    'POST_GRADUATION_CERTIFICATE',
    'EXPERIENCE_LETTER', 'OFFER_LETTER_DOC', 'RELIEVING_LETTER',
    'BANK_STATEMENT', 'CANCELLED_CHEQUE', 'SALARY_SLIP_DOC',
    'RESIDENCE_PROOF', 'PROFESSIONAL_CERTIFICATION',
    'PHOTO', 'SIGNATURE', 'OTHER',
  ]),
  expiryDate: z.string().optional(),
});

export const verifyDocumentSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED', 'FLAGGED']),
  rejectionReason: z.string().optional(),
});

export const documentQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  employeeId: z.string().uuid().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type DocumentQuery = z.infer<typeof documentQuerySchema>;
