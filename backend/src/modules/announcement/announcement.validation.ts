import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(5),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  targetDepartments: z.array(z.string()).default([]),
  targetRoles: z.array(z.string()).default([]),
  expiresAt: z.string().optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

export const createSocialPostSchema = z.object({
  content: z.string().min(1),
  imageUrl: z.string().optional(),
  postType: z.enum(['GENERAL', 'ACHIEVEMENT', 'BIRTHDAY', 'ANNIVERSARY', 'WELCOME']).default('GENERAL'),
});

export const createSocialCommentSchema = z.object({
  content: z.string().min(1),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type CreateSocialPostInput = z.infer<typeof createSocialPostSchema>;
export type CreateSocialCommentInput = z.infer<typeof createSocialCommentSchema>;
