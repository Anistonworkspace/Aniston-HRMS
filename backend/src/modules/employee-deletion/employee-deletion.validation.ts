import { z } from 'zod';

export const createDeletionRequestSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(1000, 'Reason too long'),
  notes: z.string().max(2000, 'Notes too long').optional(),
});

export const rejectDeletionRequestSchema = z.object({
  rejectionReason: z.string().min(3, 'Rejection reason is required').max(1000).optional(),
});

export const approveDeletionRequestSchema = z.object({
  confirmDelete: z.literal(true, {
    errorMap: () => ({ message: 'Must confirm deletion' }),
  }),
});

export type CreateDeletionRequestInput = z.infer<typeof createDeletionRequestSchema>;
export type RejectDeletionRequestInput = z.infer<typeof rejectDeletionRequestSchema>;
