import { z } from 'zod';

export const sendMessageSchema = z.object({
  to: z.string().min(10, 'Phone number required'),
  message: z.string().min(1, 'Message required').max(4096),
});

export const sendJobLinkSchema = z.object({
  phone: z.string().min(10, 'Phone number required'),
  candidateName: z.string().min(1).optional(),
  jobTitle: z.string().min(1, 'Job title required'),
  jobUrl: z.string().url().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendJobLinkInput = z.infer<typeof sendJobLinkSchema>;
