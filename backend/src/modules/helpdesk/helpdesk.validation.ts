import { z } from 'zod';

export const createTicketSchema = z.object({
  category: z.enum(['IT', 'HR', 'FINANCE', 'ADMIN', 'PAYROLL', 'LEAVE', 'OTHER']),
  subject: z.string().min(3),
  description: z.string().min(10),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  targetDept: z.enum(['HR', 'ADMIN']).default('HR'),
});

export const updateTicketSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED']).optional(),
  assignedTo: z.string().uuid().optional(),
  resolution: z.string().optional(),
});

export const addCommentSchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().default(false),
});

export const ticketQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  targetDept: z.enum(['HR', 'ADMIN', 'ALL']).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type TicketQuery = z.infer<typeof ticketQuerySchema>;
