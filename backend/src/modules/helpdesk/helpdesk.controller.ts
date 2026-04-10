import { Request, Response, NextFunction } from 'express';
import { helpdeskService } from './helpdesk.service.js';
import { createTicketSchema, updateTicketSchema, addCommentSchema, ticketQuerySchema } from './helpdesk.validation.js';

export class HelpdeskController {
  async getMyTickets(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } });
        return;
      }
      const status = req.query.status as string | undefined;
      const tickets = await helpdeskService.getMyTickets(req.user!.employeeId, req.user!.organizationId, status);
      res.json({ success: true, data: tickets });
    } catch (err) { next(err); }
  }

  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const query = ticketQuerySchema.parse(req.query);
      const result = await helpdeskService.getAllTickets(req.user!.organizationId, query);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } });
        return;
      }
      const data = createTicketSchema.parse(req.body);
      const ticket = await helpdeskService.create(data, req.user!.employeeId, req.user!.organizationId);
      res.status(201).json({ success: true, data: ticket, message: `Ticket ${ticket.ticketCode} created` });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const ticket = await helpdeskService.getById(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: ticket });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateTicketSchema.parse(req.body);
      const ticket = await helpdeskService.update(req.params.id, data, req.user!.organizationId);
      res.json({ success: true, data: ticket, message: `Ticket ${data.status?.toLowerCase() || 'updated'}` });
    } catch (err) { next(err); }
  }

  async addComment(req: Request, res: Response, next: NextFunction) {
    try {
      const { content, isInternal } = addCommentSchema.parse(req.body);
      const comment = await helpdeskService.addComment(req.params.id, req.user!.userId, content, isInternal, req.user!.organizationId);
      res.status(201).json({ success: true, data: comment });
    } catch (err) { next(err); }
  }
}

export const helpdeskController = new HelpdeskController();
