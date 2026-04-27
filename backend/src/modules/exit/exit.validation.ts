import { z } from 'zod';

const dateStringSchema = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: 'Invalid date format' });

export const setLastWorkingDaySchema = z.object({
  lastWorkingDate: dateStringSchema,
});

export const addHandoverTaskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum(['TASK', 'DOCUMENT', 'KNOWLEDGE']).default('TASK'),
  assignedToId: z.string().uuid().optional(),
  dueDate: dateStringSchema.optional(),
});

export const updateHandoverTaskSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  category: z.enum(['TASK', 'DOCUMENT', 'KNOWLEDGE']).optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  isCompleted: z.boolean().optional(),
  dueDate: dateStringSchema.optional().nullable(),
  notes: z.string().max(500).optional(),
});

export const confirmAssetReturnSchema = z.object({
  employeeNotes: z.string().max(500).optional(),
});

// ── IT Offboarding ───────────────────────────────────────────────────────────

const IT_FIELDS = [
  'emailDisabled', 'ssoRevoked', 'vpnRevoked', 'githubRemoved',
  'jiraRemoved', 'slackRemoved', 'licensesReclaimed', 'deviceWiped',
] as const;

export type ITField = (typeof IT_FIELDS)[number];

export const updateITChecklistSchema = z.object({
  field: z.enum(IT_FIELDS),
  value: z.boolean(),
  notes: z.string().max(1000).optional(),
});

// ── Exit Interview ───────────────────────────────────────────────────────────

const EXIT_REASONS = [
  'BETTER_OPPORTUNITY', 'HIGHER_COMPENSATION', 'WORK_LIFE_BALANCE',
  'CAREER_GROWTH', 'MANAGEMENT_ISSUES', 'CULTURE_MISMATCH',
  'PERSONAL_REASONS', 'RELOCATION', 'HEALTH', 'HIGHER_EDUCATION',
  'RETIREMENT', 'OTHER',
] as const;

const ratingSchema = z.number().int().min(1).max(5).optional().nullable();

export const saveExitInterviewSchema = z.object({
  primaryReason: z.enum(EXIT_REASONS),
  otherReasonDetail: z.string().max(500).optional().nullable(),
  overallSatisfaction: ratingSchema,
  managementRating: ratingSchema,
  compensationRating: ratingSchema,
  cultureRating: ratingSchema,
  growthRating: ratingSchema,
  workLifeBalanceRating: ratingSchema,
  likedMost: z.string().max(2000).optional().nullable(),
  dislikedMost: z.string().max(2000).optional().nullable(),
  improvementSuggestions: z.string().max(2000).optional().nullable(),
  wouldRehire: z.boolean().optional().nullable(),
  additionalComments: z.string().max(2000).optional().nullable(),
  rehireEligible: z.boolean().optional().nullable(),
  rehireNotes: z.string().max(500).optional().nullable(),
  submit: z.boolean().default(false),
});

export const saveITNotesSchema = z.object({
  notes: z.string().max(1000),
});

export type SetLastWorkingDayInput = z.infer<typeof setLastWorkingDaySchema>;
export type AddHandoverTaskInput = z.infer<typeof addHandoverTaskSchema>;
export type UpdateHandoverTaskInput = z.infer<typeof updateHandoverTaskSchema>;
export type ConfirmAssetReturnInput = z.infer<typeof confirmAssetReturnSchema>;
export type UpdateITChecklistInput = z.infer<typeof updateITChecklistSchema>;
export type SaveITNotesInput = z.infer<typeof saveITNotesSchema>;
export type SaveExitInterviewInput = z.infer<typeof saveExitInterviewSchema>;
