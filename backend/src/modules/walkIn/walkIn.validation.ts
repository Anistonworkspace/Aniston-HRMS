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
  status: z.enum(['WAITING', 'IN_INTERVIEW', 'COMPLETED', 'NO_SHOW']),
});

export const walkInQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  date: z.string().optional(), // ISO date string for filtering by day
  search: z.string().optional(),
});

export type RegisterWalkInInput = z.infer<typeof registerWalkInSchema>;
export type WalkInQuery = z.infer<typeof walkInQuerySchema>;
