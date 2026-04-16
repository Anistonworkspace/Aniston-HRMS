import { z } from 'zod';

export const createReviewCycleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL']).default('QUARTERLY'),
  startDate: z.string(),
  endDate: z.string(),
});

export const updateReviewCycleSchema = z.object({
  status: z.string().min(1),
});

export const createGoalSchema = z.object({
  employeeId: z.string().uuid().optional(),
  reviewCycleId: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(['INDIVIDUAL', 'TEAM', 'COMPANY']).default('INDIVIDUAL'),
  targetValue: z.number().optional(),
  unit: z.string().optional(),
  weight: z.number().int().min(1).max(100).default(100),
  dueDate: z.string().optional(),
});

export const updateGoalSchema = z.object({
  status: z.string().optional(),
  currentValue: z.number().optional(),
});

export const createReviewSchema = z.object({
  employeeId: z.string().uuid(),
  reviewCycleId: z.string().uuid(),
  selfRating: z.number().min(1).max(5).optional(),
  selfComments: z.string().optional(),
  managerRating: z.number().min(1).max(5).optional(),
  managerComments: z.string().optional(),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
});

export const updateReviewSchema = z.object({
  managerRating: z.number().min(1).max(5).optional(),
  managerComments: z.string().optional(),
  overallRating: z.number().min(1).max(5).optional(),
  status: z.string().optional(),
  strengths: z.array(z.string()).optional(),
  improvements: z.array(z.string()).optional(),
});

export const goalQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
});

export const reviewQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
});

export type CreateReviewCycleInput = z.infer<typeof createReviewCycleSchema>;
export type UpdateReviewCycleInput = z.infer<typeof updateReviewCycleSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
