import { Router } from 'express';
import { reportController } from './report.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(requirePermission('report', 'read'));

router.get('/headcount', (req, res, next) =>
  reportController.headcount(req, res, next)
);

router.get('/attendance-summary', (req, res, next) =>
  reportController.attendanceSummary(req, res, next)
);

router.get('/leave-summary', (req, res, next) =>
  reportController.leaveSummary(req, res, next)
);

router.get('/payroll-summary', (req, res, next) =>
  reportController.payrollSummary(req, res, next)
);

router.get('/recruitment-funnel', (req, res, next) =>
  reportController.recruitmentFunnel(req, res, next)
);

// Statutory compliance exports
router.get('/epf-challan', (req, res, next) =>
  reportController.epfChallan(req, res, next)
);

router.get('/esi-return', (req, res, next) =>
  reportController.esiReturn(req, res, next)
);

router.get('/form-24q', (req, res, next) =>
  reportController.form24Q(req, res, next)
);

export { router as reportRouter };
