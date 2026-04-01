import { Request, Response, NextFunction } from 'express';
import { policyService } from './policy.service.js';
import { createPolicySchema, updatePolicySchema } from './policy.validation.js';

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
      const policy = await policyService.getById(req.params.id);
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
        { title: data.title },
        req.user!.organizationId,
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
      const policy = await policyService.update(req.params.id, data, file);
      res.json({ success: true, data: policy, message: 'Policy updated' });
    } catch (err) {
      next(err);
    }
  }

  async acknowledge(req: Request, res: Response, next: NextFunction) {
    try {
      const ack = await policyService.acknowledge(req.params.id, req.user!.employeeId);
      res.json({ success: true, data: ack, message: 'Policy acknowledged' });
    } catch (err) {
      next(err);
    }
  }
}

export const policyController = new PolicyController();
