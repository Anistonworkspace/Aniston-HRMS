import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import type { CreateTicketInput, TicketQuery } from './helpdesk.validation.js';

export class HelpdeskService {
  private async generateTicketCode(orgId: string): Promise<string> {
    const count = await prisma.ticket.count({ where: { organizationId: orgId } });
    return `TKT-${String(count + 1).padStart(4, '0')}`;
  }

  async getMyTickets(employeeId: string, status?: string) {
    const where: any = { employeeId };
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
    return prisma.ticket.create({
      data: {
        ...data,
        ticketCode,
        employeeId,
        status: 'OPEN',
        organizationId,
      },
    });
  }

  async getById(id: string) {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true, avatar: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundError('Ticket');
    return ticket;
  }

  async update(id: string, data: { status?: string; assignedTo?: string; resolution?: string }) {
    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.assignedTo) updateData.assignedTo = data.assignedTo;
    if (data.resolution) updateData.resolution = data.resolution;
    if (data.status === 'RESOLVED') updateData.resolvedAt = new Date();

    return prisma.ticket.update({ where: { id }, data: updateData });
  }

  async addComment(ticketId: string, authorId: string, content: string, isInternal: boolean) {
    return prisma.ticketComment.create({
      data: { ticketId, authorId, content, isInternal },
    });
  }
}

export const helpdeskService = new HelpdeskService();
