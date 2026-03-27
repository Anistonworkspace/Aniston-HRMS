import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { invitationService } from './invitation.service.js';
import { createInvitationSchema } from './invitation.validation.js';

export class InvitationController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createInvitationSchema.parse(req.body);
      const result = await invitationService.createInvitation(
        data, req.user!.organizationId, req.user!.userId
      );
      res.status(201).json({ success: true, data: result, message: 'Invitation sent' });
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
      }).parse(req.query);
      const result = await invitationService.listInvitations(req.user!.organizationId, page, limit);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) {
      next(err);
    }
  }

  async validate(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await invitationService.validateToken(req.params.token);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().min(10).optional().default(''),
        password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase, and a number'),
      }).parse(req.body);
      const result = await invitationService.completeInvitation(req.params.token, data);
      res.json({ success: true, data: result, message: 'Account created successfully' });
    } catch (err) {
      next(err);
    }
  }

  async resend(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await invitationService.resendInvitation(
        req.params.id, req.user!.organizationId, req.user!.userId
      );
      res.json({ success: true, data: result, message: 'Invitation resent' });
    } catch (err) {
      next(err);
    }
  }
}

export const invitationController = new InvitationController();
