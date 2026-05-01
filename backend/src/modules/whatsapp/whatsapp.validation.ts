import { z } from 'zod';

// Phone: 10-15 digits only, optionally prefixed with +
const phoneRegex = /^\+?[0-9]{10,15}$/;

export const sendMessageSchema = z.object({
  to: z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number too long')
    .regex(phoneRegex, 'Invalid phone number — digits only, 10-15 characters (e.g. 919876543210)'),
  message: z.string().min(1, 'Message is required').max(4096, 'Message too long (max 4096 chars)'),
  quotedMessageId: z.string().max(200).regex(/^[A-Za-z0-9_\-.:@]+$/, 'Invalid message ID format').optional(),
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
  chatId: z.string().min(1, 'Chat ID is required').max(200).regex(/^[a-zA-Z0-9@._\-+]+$/, 'Invalid chatId format'),
  caption: z.string().max(1024, 'Caption too long').optional(),
});

// =====================================================================
// CONTACT SCHEMAS
// =====================================================================

const WA_CONTACT_SOURCES = ['MANUAL', 'WHATSAPP_IMPORT', 'EMPLOYEE', 'ONBOARDING', 'APPLICATION'] as const;

export const createContactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  phone: z.string()
    .min(7, 'Phone number too short')
    .max(20, 'Phone number too long')
    .regex(/^\+?[0-9\s\-().]{7,20}$/, 'Invalid phone number format'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  notes: z.string().max(500, 'Notes too long').optional(),
  source: z.enum(WA_CONTACT_SOURCES).optional().default('MANUAL'),
  referenceId: z.string().optional(),
  referenceType: z.string().max(50).optional(),
});

export const updateContactSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().max(500).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendJobLinkInput = z.infer<typeof sendJobLinkSchema>;
export type SendToNumberInput = z.infer<typeof sendToNumberSchema>;
export type SendMediaInput = z.infer<typeof sendMediaSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
