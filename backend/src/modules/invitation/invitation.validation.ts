import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email().optional(),
  mobileNumber: z.string().min(10).optional(),
}).refine(
  (data) => data.email || data.mobileNumber,
  { message: 'At least one of email or mobile number is required' }
);

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
