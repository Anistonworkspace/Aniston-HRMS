import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { payrollDeletionService } from './payroll-deletion.service.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// HR requests deletion of a payroll run
// POST /api/payroll-deletion-requests
router.post('/', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { payrollRunId, reason, notes } = req.body;
    if (!payrollRunId || !reason) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'payrollRunId and reason are required' } });
    }
    const result = await payrollDeletionService.createRequest(
      payrollRunId,
      req.user!.organizationId,
      req.user!.id,
      reason,
      notes,
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
});

// SuperAdmin lists all payroll deletion requests
// GET /api/payroll-deletion-requests
router.get('/', authorize(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { status } = req.query as any;
    const data = await payrollDeletionService.listRequests(req.user!.organizationId, status);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// SuperAdmin approves → deletes payroll run
// POST /api/payroll-deletion-requests/:id/approve
router.post('/:id/approve', authorize(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const result = await payrollDeletionService.approveRequest(
      req.params.id,
      req.user!.organizationId,
      req.user!.id,
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// SuperAdmin rejects
// POST /api/payroll-deletion-requests/:id/reject
router.post('/:id/reject', authorize(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    const result = await payrollDeletionService.rejectRequest(
      req.params.id,
      req.user!.organizationId,
      req.user!.id,
      rejectionReason,
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// SuperAdmin dismisses completed request
// DELETE /api/payroll-deletion-requests/:id
router.delete('/:id', authorize(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const result = await payrollDeletionService.dismissRequest(req.params.id, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export { router as payrollDeletionRouter };
