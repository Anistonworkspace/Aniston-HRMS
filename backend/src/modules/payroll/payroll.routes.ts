import { Router } from 'express';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { payrollController } from './payroll.controller.js';
import { payrollService } from './payroll.service.js';

const router = Router();
router.use(authenticate);

// AI anomaly detection (must be before /:id routes)
router.post('/ai-anomaly-check/:runId', authenticate, requirePermission('payroll', 'manage'), async (req, res, next) => {
  try {
    const result = await payrollService.detectAnomalies(req.params.runId, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Salary structure
router.get('/salary-structure/:employeeId',
  requirePermission('payroll', 'read'),
  (req, res, next) => payrollController.getSalaryStructure(req, res, next)
);

router.post('/salary-structure/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollController.upsertSalaryStructure(req, res, next)
);

// Payroll runs
router.get('/runs',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollController.getPayrollRuns(req, res, next)
);

router.post('/runs',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollController.createPayrollRun(req, res, next)
);

router.post('/runs/:id/process',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollController.processPayroll(req, res, next)
);

router.get('/runs/:id/records',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => payrollController.getPayrollRecords(req, res, next)
);

// PDF salary slip download
router.get('/records/:id/pdf',
  authenticate,
  (req, res, next) => payrollController.downloadSalarySlip(req, res, next)
);

// Employee's own payslips
router.get('/my-payslips',
  (req, res, next) => payrollController.getMyPayslips(req, res, next)
);

// Salary visibility rules (SuperAdmin only)
router.get('/visibility-rules',
  authorize(Role.SUPER_ADMIN),
  (req, res, next) => payrollController.getVisibilityRules(req, res, next)
);

router.post('/visibility-rules',
  authorize(Role.SUPER_ADMIN),
  (req, res, next) => payrollController.setVisibilityRule(req, res, next)
);

router.patch('/visibility-rules/:employeeId',
  authorize(Role.SUPER_ADMIN),
  (req, res, next) => payrollController.updateVisibilityRule(req, res, next)
);

export { router as payrollRouter };
