import { Request, Response, NextFunction } from 'express';
import { onboardingService } from './onboarding.service.js';

export class OnboardingController {
  async createInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await onboardingService.createInvite(req.params.employeeId, req.user!.organizationId);
      res.status(201).json({ success: true, data: result, message: 'Onboarding invite created' });
    } catch (err) { next(err); }
  }

  async getPendingInvites(req: Request, res: Response, next: NextFunction) {
    try {
      const invites = await onboardingService.getPendingInvites(req.user!.organizationId);
      res.json({ success: true, data: invites });
    } catch (err) { next(err); }
  }

  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await onboardingService.getStatus(req.params.token);
      res.json({ success: true, data: status });
    } catch (err) { next(err); }
  }

  async saveStep(req: Request, res: Response, next: NextFunction) {
    try {
      const step = parseInt(req.params.step, 10);
      if (isNaN(step) || step < 1 || step > 7) {
        res.status(400).json({ success: false, data: null, error: { code: 'INVALID_STEP', message: 'Step must be 1-7' } });
        return;
      }
      const result = await onboardingService.saveStep(req.params.token, step, req.body);
      res.json({ success: true, data: result, message: `Step ${step} saved` });
    } catch (err) { next(err); }
  }

  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await onboardingService.complete(req.params.token);
      res.json({ success: true, data: result, message: result.message });
    } catch (err) { next(err); }
  }
}

export const onboardingController = new OnboardingController();
