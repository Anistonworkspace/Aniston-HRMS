import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { onboardingService } from './onboarding.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();

// HR: Create invite
router.post('/invite/:employeeId', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await onboardingService.createInvite(req.params.employeeId, req.user!.organizationId);
      res.status(201).json({ success: true, data: result, message: 'Onboarding invite created' });
    } catch (err) { next(err); }
  }
);

// HR: Get pending invites
router.get('/invites', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invites = await onboardingService.getPendingInvites(req.user!.organizationId);
      res.json({ success: true, data: invites });
    } catch (err) { next(err); }
  }
);

// PUBLIC: Get onboarding status (token-based, no auth)
router.get('/status/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await onboardingService.getStatus(req.params.token);
    res.json({ success: true, data: status });
  } catch (err) { next(err); }
});

// PUBLIC: Save step data
router.patch('/step/:token/:step', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const step = parseInt(req.params.step, 10);
    if (isNaN(step) || step < 1 || step > 7) {
      res.status(400).json({ success: false, data: null, error: { code: 'INVALID_STEP', message: 'Step must be 1-7' } });
      return;
    }
    const result = await onboardingService.saveStep(req.params.token, step, req.body);
    res.json({ success: true, data: result, message: `Step ${step} saved` });
  } catch (err) { next(err); }
});

// PUBLIC: Complete onboarding
router.post('/complete/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await onboardingService.complete(req.params.token);
    res.json({ success: true, data: result, message: result.message });
  } catch (err) { next(err); }
});

export { router as onboardingRouter };
