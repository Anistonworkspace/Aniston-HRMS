import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { aiService } from '../../services/ai.service.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import type { CreateTicketInput, TicketQuery } from './helpdesk.validation.js';

export class HelpdeskService {
  private async generateTicketCode(orgId: string): Promise<string> {
    const count = await prisma.ticket.count({ where: { organizationId: orgId } });
    return `TKT-${String(count + 1).padStart(4, '0')}`;
  }

  async getMyTickets(employeeId: string, organizationId: string, status?: string) {
    const where: any = { employeeId, employee: { organizationId } };
    if (status) where.status = status;

    return prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { comments: true } } },
    });
  }

  async getAllTickets(organizationId: string, query: TicketQuery) {
    const { page, limit, status } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };
    if (status) where.status = status;

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { firstName: true, lastName: true, employeeCode: true, avatar: true, department: { select: { name: true } } } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    return {
      data: tickets,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  async create(data: CreateTicketInput, employeeId: string, organizationId: string) {
    const ticketCode = await this.generateTicketCode(organizationId);
    const ticket = await prisma.ticket.create({
      data: {
        ...data,
        ticketCode,
        employeeId,
        status: 'OPEN',
        organizationId,
      },
    });
    await createAuditLog({ userId: employeeId, organizationId, entity: 'Ticket', entityId: ticket.id, action: 'CREATE', newValue: { subject: data.subject, category: data.category } });

    // Notify HR/Admin/SuperAdmin that a new ticket was raised
    try {
      const [employee, hrUsers] = await Promise.all([
        prisma.employee.findFirst({
          where: { id: employeeId },
          select: { firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
        }),
        prisma.user.findMany({
          where: {
            organizationId,
            role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] },
          },
          select: { email: true },
        }),
      ]);
      const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : 'An employee';
      for (const hrUser of hrUsers) {
        await enqueueEmail({
          to: hrUser.email,
          subject: `[${ticketCode}] New Support Ticket: ${data.subject}`,
          template: 'helpdesk-ticket-created',
          context: {
            ticketCode,
            subject: data.subject,
            description: data.description || '',
            category: data.category || '',
            priority: data.priority || 'MEDIUM',
            employeeName,
            employeeCode: employee?.employeeCode || '',
            department: employee?.department?.name || '',
            link: 'https://hr.anistonav.com/helpdesk',
          },
        });
      }
    } catch (err) {
      logger.error('Failed to send helpdesk ticket creation email', err);
    }

    return ticket;
  }

  async getById(id: string, organizationId: string) {
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true, avatar: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  }

  async update(id: string, data: { status?: string; assignedTo?: string; resolution?: string }, organizationId: string) {
    // Verify ticket belongs to this org
    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
      include: { employee: { select: { firstName: true, lastName: true, user: { select: { email: true } } } } },
    });
    if (!ticket) throw new NotFoundError('Ticket');

    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.assignedTo) updateData.assignedTo = data.assignedTo;
    if (data.resolution) updateData.resolution = data.resolution;
    if (data.status === 'RESOLVED') updateData.resolvedAt = new Date();

    const updated = await prisma.ticket.update({ where: { id }, data: updateData });
    await createAuditLog({ userId: id, organizationId, entity: 'Ticket', entityId: id, action: 'UPDATE', newValue: updateData });

    // Notify employee when their ticket status changes
    if (data.status && data.status !== ticket.status) {
      try {
        const employeeEmail = (ticket.employee as any)?.user?.email;
        if (employeeEmail) {
          const employeeName = `${(ticket.employee as any).firstName} ${(ticket.employee as any).lastName}`;
          await enqueueEmail({
            to: employeeEmail,
            subject: `[${ticket.ticketCode}] Your ticket has been ${data.status.toLowerCase()}`,
            template: 'helpdesk-ticket-updated',
            context: {
              ticketCode: ticket.ticketCode,
              subject: ticket.subject,
              newStatus: data.status,
              resolution: data.resolution || '',
              employeeName,
              link: 'https://hr.anistonav.com/helpdesk',
            },
          });
        }
      } catch (err) {
        logger.error('Failed to send helpdesk status update email', err);
      }
    }

    return updated;
  }

  async addComment(ticketId: string, authorId: string, content: string, isInternal: boolean, organizationId: string, authorRole?: string) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, organizationId },
      include: { employee: { select: { firstName: true, lastName: true, user: { select: { email: true } } } } },
    });
    if (!ticket) throw new NotFoundError('Ticket');

    const comment = await prisma.ticketComment.create({
      data: { ticketId, authorId, content, isInternal },
    });

    // Email notifications for non-internal comments only
    if (!isInternal) {
      try {
        const isHrSide = authorRole && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(authorRole);
        if (isHrSide) {
          // HR commented → notify the employee
          const employeeEmail = (ticket.employee as any)?.user?.email;
          if (employeeEmail) {
            const employeeName = `${(ticket.employee as any).firstName} ${(ticket.employee as any).lastName}`;
            await enqueueEmail({
              to: employeeEmail,
              subject: `[${ticket.ticketCode}] New reply on your support ticket`,
              template: 'helpdesk-ticket-updated',
              context: {
                ticketCode: ticket.ticketCode,
                subject: ticket.subject,
                newStatus: null,
                commentPreview: content.length > 200 ? content.substring(0, 200) + '…' : content,
                employeeName,
                link: 'https://hr.anistonav.com/helpdesk',
              },
            });
          }
        } else {
          // Employee commented → notify HR/Admin
          const hrUsers = await prisma.user.findMany({
            where: { organizationId, role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] } },
            select: { email: true },
          });
          const employeeName = ticket.employee
            ? `${(ticket.employee as any).firstName} ${(ticket.employee as any).lastName}`
            : 'An employee';
          for (const hrUser of hrUsers) {
            await enqueueEmail({
              to: hrUser.email,
              subject: `[${ticket.ticketCode}] Employee replied: ${ticket.subject}`,
              template: 'helpdesk-comment-received',
              context: {
                ticketCode: ticket.ticketCode,
                subject: ticket.subject,
                commentPreview: content.length > 200 ? content.substring(0, 200) + '…' : content,
                employeeName,
                link: 'https://hr.anistonav.com/helpdesk',
              },
            });
          }
        }
      } catch (err) {
        logger.error('Failed to send helpdesk comment email', err);
      }
    }

    return comment;
  }

  async analyzeTicket(ticketId: string, organizationId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError('Ticket');

    const systemPrompt = 'You are an IT helpdesk expert for an Indian technology company. Analyze this support ticket and provide: category classification, priority assessment, suggested resolution steps, and department routing. Return JSON: { category: string, priority: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", suggestedResolution: string, suggestedDepartment: string, tags: string[] }';
    const userPrompt = `Subject: ${ticket.subject}\nDescription: ${ticket.description || 'No description provided'}${ticket.category ? `\nCategory: ${ticket.category}` : ''}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt);
    if (!result.success) throw new BadRequestError(result.error || 'AI analysis failed');

    try {
      return JSON.parse(result.data!);
    } catch {
      return { rawResponse: result.data };
    }
  }

  async suggestResponse(ticketId: string, organizationId: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundError('Ticket');

    const systemPrompt = 'You are a helpful IT support agent. Based on this ticket and conversation history, suggest a professional response. Return JSON: { suggestedResponse: string, isResolvable: boolean, escalationNeeded: boolean }';
    const conversationHistory = ticket.comments.map(c => `[${c.isInternal ? 'Internal' : 'Reply'}]: ${c.content}`).join('\n');
    const userPrompt = `Subject: ${ticket.subject}\nDescription: ${ticket.description || 'No description provided'}${ticket.category ? `\nCategory: ${ticket.category}` : ''}${conversationHistory ? `\n\nConversation History:\n${conversationHistory}` : ''}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt);
    if (!result.success) throw new BadRequestError(result.error || 'AI suggestion failed');

    try {
      return JSON.parse(result.data!);
    } catch {
      return { rawResponse: result.data };
    }
  }
}

export const helpdeskService = new HelpdeskService();
