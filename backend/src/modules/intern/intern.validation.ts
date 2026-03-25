import { z } from 'zod';

export const createInternProfileSchema = z.object({
  collegeUniversity: z.string().max(200).optional(),
  course: z.string().max(200).optional(),
  specialization: z.string().max(200).optional(),
  internshipStartDate: z.string().min(1, 'Start date is required'),
  internshipEndDate: z.string().min(1, 'End date is required'),
  stipend: z.number().positive().optional(),
  mentorId: z.string().uuid().optional(),
  projectTitle: z.string().max(500).optional(),
});

export const updateInternProfileSchema = createInternProfileSchema.partial();

export const createAchievementLetterSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().min(1, 'Description is required').max(5000),
  issuedBy: z.string().min(1, 'Issued by is required').max(200),
});

export type CreateInternProfileInput = z.infer<typeof createInternProfileSchema>;
export type UpdateInternProfileInput = z.infer<typeof updateInternProfileSchema>;
export type CreateAchievementLetterInput = z.infer<typeof createAchievementLetterSchema>;
