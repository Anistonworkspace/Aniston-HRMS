import { z } from 'zod';

export const registerWalkInSchema = z.object({
  jobOpeningId: z.string().uuid().optional(),
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(10).max(15),
  city: z.string().max(100).optional(),

  // KYC (URLs from uploaded files)
  aadhaarFrontUrl: z.string().optional(),
  aadhaarBackUrl: z.string().optional(),
  panCardUrl: z.string().optional(),
  selfieUrl: z.string().optional(),
  aadhaarNumber: z.string().max(16).optional(),
  panNumber: z.string().max(10).optional(),

  // OCR results
  ocrVerifiedName: z.string().optional(),
  ocrVerifiedDob: z.string().optional(),
  ocrVerifiedAddress: z.string().optional(),
  tamperDetected: z.boolean().default(false),
  tamperDetails: z.string().optional(),

  // Professional
  qualification: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  experienceYears: z.number().int().min(0).default(0),
  experienceMonths: z.number().int().min(0).max(11).default(0),
  isFresher: z.boolean().default(true),
  currentCompany: z.string().optional(),
  currentCtc: z.number().min(0).optional(),
  expectedCtc: z.number().min(0).optional(),
  noticePeriod: z.string().optional(),
  skills: z.array(z.string()).default([]),
  aboutMe: z.string().max(300).optional(),
  resumeUrl: z.string().optional(),
});

export const updateWalkInStatusSchema = z.object({
  status: z.enum(['WAITING', 'IN_INTERVIEW', 'ON_HOLD', 'SELECTED', 'REJECTED', 'COMPLETED', 'NO_SHOW']),
});

export const walkInQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  date: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

// Interview round schemas
export const addInterviewRoundSchema = z.object({
  roundName: z.string().min(1).max(100),
  interviewerName: z.string().max(100).optional(),
  interviewerId: z.string().uuid().optional(),
  scheduledAt: z.string().optional(), // ISO datetime
});

export const updateInterviewRoundSchema = z.object({
  interviewerName: z.string().max(100).optional(),
  interviewerId: z.string().uuid().optional(),
  scheduledAt: z.string().optional(),
  status: z.enum(['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  communication: z.number().int().min(1).max(10).optional(),
  technical: z.number().int().min(1).max(10).optional(),
  problemSolving: z.number().int().min(1).max(10).optional(),
  culturalFit: z.number().int().min(1).max(10).optional(),
  overallScore: z.number().int().min(1).max(10).optional(),
  remarks: z.string().max(2000).optional(),
  result: z.enum(['PASSED', 'FAILED', 'ON_HOLD']).optional(),
});

export const updateCandidateSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(10).max(15).optional(),
  city: z.string().max(100).optional(),
  qualification: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  experienceYears: z.number().int().min(0).optional(),
  experienceMonths: z.number().int().min(0).max(11).optional(),
  isFresher: z.boolean().optional(),
  currentCompany: z.string().optional(),
  currentCtc: z.number().min(0).optional(),
  expectedCtc: z.number().min(0).optional(),
  noticePeriod: z.string().optional(),
  skills: z.array(z.string()).optional(),
  aboutMe: z.string().max(300).optional(),
  totalRounds: z.number().int().min(1).max(10).optional(),
});

export type RegisterWalkInInput = z.infer<typeof registerWalkInSchema>;
export type WalkInQuery = z.infer<typeof walkInQuerySchema>;
