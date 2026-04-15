import { z } from 'zod';

export const systemLogQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(500).default(50),
  level:    z.enum(['error', 'warn', 'info', 'debug']).optional(),
  source:   z.string().max(100).optional(),
  search:   z.string().max(300).optional(),
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
  sort:     z.enum(['asc', 'desc']).default('desc'),
});

export type SystemLogQuery = z.infer<typeof systemLogQuerySchema>;
