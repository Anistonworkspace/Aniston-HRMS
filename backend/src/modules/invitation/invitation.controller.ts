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
      // Set refresh token as httpOnly cookie (same as login)
      if (result.refreshToken) {
        res.cookie('refreshToken', result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          path: '/',
        });
      }
      res.json({ success: true, data: result, message: 'Account created successfully' });
    } catch (err) {
      next(err);
    }
  }

  async bulkInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        emails: z.array(z.string()).min(1, 'At least one email is required'),
        role: z.enum(['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN']).optional().default('EMPLOYEE'),
        departmentId: z.string().uuid().optional(),
        designationId: z.string().uuid().optional(),
      }).parse(req.body);

      const result = await invitationService.createBulkInvitations(
        data.emails,
        req.user!.organizationId,
        req.user!.userId,
        { role: data.role, departmentId: data.departmentId, designationId: data.designationId }
      );

      res.status(201).json({
        success: true,
        data: result,
        message: `${result.sentCount} invitation${result.sentCount !== 1 ? 's' : ''} sent, ${result.skippedCount} skipped`,
      });
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

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await invitationService.deleteInvitation(
        req.params.id, req.user!.organizationId, req.user!.userId
      );
      res.json({ success: true, data: result, message: 'Invitation deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const invitationController = new InvitationController();
