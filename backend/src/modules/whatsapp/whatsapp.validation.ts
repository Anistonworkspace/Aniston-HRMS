import { z } from 'zod';

// Phone: 10-15 digits only, optionally prefixed with +
const phoneRegex = /^\+?[0-9]{10,15}$/;

export const sendMessageSchema = z.object({
  to: z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number too long')
    .regex(phoneRegex, 'Invalid phone number — digits only, 10-15 characters (e.g. 919876543210)'),
  message: z.string().min(1, 'Message is required').max(4096, 'Message too long (max 4096 chars)'),
  quotedMessageId: z.string().optional(),
});

export const sendJobLinkSchema = z.object({
  phone: z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number too long')
    .regex(phoneRegex, 'Invalid phone number — digits only, 10-15 characters'),
  candidateName: z.string().min(1).max(100).optional(),
  jobTitle: z.string().min(1, 'Job title is required').max(200),
  jobUrl: z.string().url('Invalid URL format').optional(),
});

export const sendToNumberSchema = z.object({
  phone: z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number too long')
    .regex(phoneRegex, 'Invalid phone number — digits only, 10-15 characters'),
  message: z.string().min(1, 'Message is required').max(4096, 'Message too long (max 4096 chars)'),
});

export const sendMediaSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  caption: z.string().max(1024, 'Caption too long').optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendJobLinkInput = z.infer<typeof sendJobLinkSchema>;
export type SendToNumberInput = z.infer<typeof sendToNumberSchema>;
export type SendMediaInput = z.infer<typeof sendMediaSchema>;
