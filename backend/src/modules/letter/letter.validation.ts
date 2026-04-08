import { z } from 'zod';

export const createLetterSchema = z.object({
  type: z.enum([
    'OFFER_LETTER', 'JOINING_LETTER', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER',
    'SALARY_SLIP_LETTER', 'PROMOTION_LETTER', 'WARNING_LETTER', 'APPRECIATION_LETTER', 'CUSTOM',
  ]),
  title: z.string().min(1),
  employeeId: z.string().uuid(),
  templateSlug: z.string().optional(),
  downloadAllowed: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  content: z.object({
    employeeName: z.string().optional(),
    designation: z.string().optional(),
    department: z.string().optional(),
    salary: z.string().optional(),
    joiningDate: z.string().optional(),
    lastWorkingDate: z.string().optional(),
    resignationDate: z.string().optional(),
    customFields: z.record(z.string()).optional(),
  }).optional(),
});

export const assignLetterSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
  downloadAllowed: z.boolean().optional(),
});

export const updateAssignmentSchema = z.object({
  downloadAllowed: z.boolean(),
});

export type CreateLetterInput = z.infer<typeof createLetterSchema>;
export type AssignLetterInput = z.infer<typeof assignLetterSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
