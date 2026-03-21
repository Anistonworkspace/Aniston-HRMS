import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { payrollService } from './payroll.service.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Salary structure
router.get('/salary-structure/:employeeId',
  requirePermission('payroll', 'read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const structure = await payrollService.getSalaryStructure(req.params.employeeId);
      res.json({ success: true, data: structure });
    } catch (err) { next(err); }
  }
);

const salaryStructureSchema = z.object({
  ctc: z.number().positive(),
  basic: z.number().positive(),
  hra: z.number().min(0),
  da: z.number().min(0).optional(),
  ta: z.number().min(0).optional(),
  medicalAllowance: z.number().min(0).optional(),
  specialAllowance: z.number().min(0).optional(),
  lta: z.number().min(0).optional(),
  incomeTaxRegime: z.enum(['OLD_REGIME', 'NEW_REGIME']).optional(),
});

router.post('/salary-structure/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = salaryStructureSchema.parse(req.body);
      const structure = await payrollService.upsertSalaryStructure(req.params.employeeId, data);
      res.json({ success: true, data: structure, message: 'Salary structure saved' });
    } catch (err) { next(err); }
  }
);

// Payroll runs
router.get('/runs',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const runs = await payrollService.getPayrollRuns(req.user!.organizationId);
      res.json({ success: true, data: runs });
    } catch (err) { next(err); }
  }
);

router.post('/runs',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { month, year } = z.object({
        month: z.number().int().min(1).max(12),
        year: z.number().int().min(2020).max(2030),
      }).parse(req.body);
      const run = await payrollService.createPayrollRun(month, year, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: run, message: 'Payroll run created' });
    } catch (err) { next(err); }
  }
);

router.post('/runs/:id/process',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await payrollService.processPayroll(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Payroll processed' });
    } catch (err) { next(err); }
  }
);

router.get('/runs/:id/records',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const records = await payrollService.getPayrollRecords(req.params.id);
      res.json({ success: true, data: records });
    } catch (err) { next(err); }
  }
);

// Employee's own payslips
router.get('/my-payslips', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user!.employeeId) {
      res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
      return;
    }
    const payslips = await payrollService.getMyPayslips(req.user!.employeeId);
    res.json({ success: true, data: payslips });
  } catch (err) { next(err); }
});

export { router as payrollRouter };
