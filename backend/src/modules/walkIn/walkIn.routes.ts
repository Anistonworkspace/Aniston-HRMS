import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { walkInService } from './walkIn.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { registerWalkInSchema, updateWalkInStatusSchema, walkInQuerySchema } from './walkIn.validation.js';

const router = Router();

// =====================
// PUBLIC ROUTES (No Auth)
// =====================

// Get open job openings for the kiosk dropdown
// Uses a default org ID for public access — in production, derive from subdomain/config
router.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // For public kiosk, use the first org or a configured default
    const orgId = (req.query.orgId as string) || process.env.DEFAULT_ORG_ID || '';
    const jobs = await walkInService.getOpenJobs(orgId);
    res.json({ success: true, data: jobs });
  } catch (err) { next(err); }
});

// Register a walk-in candidate (public kiosk)
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerWalkInSchema.parse(req.body);
    const orgId = (req.body.organizationId as string) || process.env.DEFAULT_ORG_ID || '';
    const candidate = await walkInService.register(data, orgId);
    res.status(201).json({
      success: true,
      data: candidate,
      message: `Registration complete! Your token: ${candidate.tokenNumber}`,
    });
  } catch (err) { next(err); }
});

// Get walk-in record by token number (public — for completion screen)
router.get('/token/:tokenNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const candidate = await walkInService.getByToken(req.params.tokenNumber);
    res.json({ success: true, data: candidate });
  } catch (err) { next(err); }
});

// =====================
// HR ROUTES (Auth Required)
// =====================

// Get today's walk-ins (HR dashboard)
router.get('/today', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = walkInQuerySchema.parse(req.query);
    const result = await walkInService.getTodayWalkIns(req.user!.organizationId, query);
    res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err) { next(err); }
});

// Get a specific walk-in record
router.get('/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const candidate = await walkInService.getById(req.params.id);
    res.json({ success: true, data: candidate });
  } catch (err) { next(err); }
});

// Update walk-in status
router.patch('/:id/status', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = updateWalkInStatusSchema.parse(req.body);
    const candidate = await walkInService.updateStatus(req.params.id, status);
    res.json({ success: true, data: candidate, message: `Status updated to ${status}` });
  } catch (err) { next(err); }
});

// Add HR notes
router.post('/:id/notes', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { notes } = req.body;
    const candidate = await walkInService.addHRNotes(req.params.id, notes);
    res.json({ success: true, data: candidate, message: 'Notes added' });
  } catch (err) { next(err); }
});

// Convert walk-in to full Application
router.patch('/:id/convert', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const application = await walkInService.convertToApplication(req.params.id);
    res.json({ success: true, data: application, message: 'Converted to application' });
  } catch (err) { next(err); }
});

// Delete a walk-in record
router.delete('/:id', authenticate, authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await walkInService.remove(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export { router as walkInRouter };
