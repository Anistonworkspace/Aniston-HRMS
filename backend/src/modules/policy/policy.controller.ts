import { Request, Response, NextFunction } from 'express';
import { policyService } from './policy.service.js';
import { createPolicySchema, updatePolicySchema } from './policy.validation.js';
import { Role } from '@aniston/shared';

const ADMIN_ROLES: string[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR];

export class PolicyController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const policies = await policyService.list(req.user!.organizationId, req.user!.employeeId);
      res.json({ success: true, data: policies });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const policy = await policyService.getById(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: policy });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createPolicySchema.parse(req.body);
      const file = req.file;
      const policy = await policyService.create(
        data,
        req.user!.organizationId,
        req.user!.userId,
        file,
      );
      res.status(201).json({ success: true, data: policy, message: 'Policy created' });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updatePolicySchema.parse(req.body);
      const file = req.file;
      const policy = await policyService.update(
        req.params.id as string,
        req.user!.organizationId,
        req.user!.userId,
        data,
        file,
      );
      res.json({ success: true, data: policy, message: 'Policy updated' });
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await policyService.delete(req.params.id as string, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: null, message: 'Policy deleted' });
    } catch (err) {
      next(err);
    }
  }

  async acknowledge(req: Request, res: Response, next: NextFunction) {
    try {
      const ack = await policyService.acknowledge(req.params.id as string, req.user!.employeeId);
      res.json({ success: true, data: ack, message: 'Policy acknowledged' });
    } catch (err) {
      next(err);
    }
  }

  // Secure stream for viewer
  async stream(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = ADMIN_ROLES.includes(req.user!.role);
      const { buffer } = await policyService.streamFile(
        req.params.id as string,
        req.user!.organizationId,
        req.user!.employeeId,
        isAdmin,
      );

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  }

  // Controlled download
  async download(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = ADMIN_ROLES.includes(req.user!.role);
      const { buffer, fileName, downloadAllowed } = await policyService.streamFile(
        req.params.id as string,
        req.user!.organizationId,
        req.user!.employeeId,
        isAdmin,
      );

      if (!downloadAllowed) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Download not permitted for this policy' } });
        return;
      }

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      });
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  }
}

export const policyController = new PolicyController();
