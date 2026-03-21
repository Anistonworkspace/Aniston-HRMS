import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(3).max(200),
  department: z.string().min(1),
  location: z.string().min(1),
  type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'RESEARCH']).default('FULL_TIME'),
  experience: z.string().optional(),
  salaryRange: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    currency: z.string().default('INR'),
  }).optional(),
  description: z.string().min(20),
  requirements: z.array(z.string()).default([]),
  openings: z.number().int().min(1).default(1),
  publishToNaukri: z.boolean().default(false),
  publishToWebsite: z.boolean().default(true),
});

export const updateJobSchema = createJobSchema.partial().extend({
  status: z.enum(['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED']).optional(),
});

export const createApplicationSchema = z.object({
  jobOpeningId: z.string().uuid(),
  candidateName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10),
  resumeUrl: z.string().min(1),
  coverLetter: z.string().optional(),
  source: z.enum(['PORTAL', 'NAUKRI', 'LINKEDIN', 'REFERENCE', 'CAMPUS', 'WALK_IN']).default('PORTAL'),
  isIntern: z.boolean().default(false),
});

export const moveStageSchema = z.object({
  status: z.enum([
    'APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW_1', 'INTERVIEW_2',
    'HR_ROUND', 'FINAL_ROUND', 'OFFER', 'OFFER_ACCEPTED', 'JOINED', 'REJECTED', 'WITHDRAWN',
  ]),
});

export const interviewScoreSchema = z.object({
  applicationId: z.string().uuid(),
  round: z.number().int().min(1),
  communicationScore: z.number().min(0).max(10).optional(),
  technicalScore: z.number().min(0).max(10).optional(),
  problemSolving: z.number().min(0).max(10).optional(),
  culturalFit: z.number().min(0).max(10).optional(),
  overallScore: z.number().min(0).max(10).optional(),
  notes: z.string().optional(),
  teamsRecordingUrl: z.string().optional(),
});

export const createOfferSchema = z.object({
  applicationId: z.string().uuid(),
  candidateEmail: z.string().email(),
  ctc: z.number().positive(),
  basicSalary: z.number().positive(),
  joiningDate: z.string().optional(),
});

export const jobQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  status: z.string().optional(),
  department: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type InterviewScoreInput = z.infer<typeof interviewScoreSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type JobQuery = z.infer<typeof jobQuerySchema>;
