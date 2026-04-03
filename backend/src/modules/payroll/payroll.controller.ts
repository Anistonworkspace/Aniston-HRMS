import { Request, Response, NextFunction } from 'express';
import { payrollService } from './payroll.service.js';
import { salaryVisibilityService } from './salary-visibility.service.js';
import { salaryStructureSchema, createPayrollRunSchema } from './payroll.validation.js';
import { generateSalarySlipPDF } from '../../utils/pdfGenerator.js';

export class PayrollController {
  async getSalaryStructure(req: Request, res: Response, next: NextFunction) {
    try {
      const structure = await payrollService.getSalaryStructure(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: structure });
    } catch (err) { next(err); }
  }

  async upsertSalaryStructure(req: Request, res: Response, next: NextFunction) {
    try {
      const data = salaryStructureSchema.parse(req.body);
      const result = await payrollService.upsertSalaryStructure(
        req.params.employeeId, data, req.user!.organizationId, req.user!.userId
      );
      // Overwrite protection: requires user to confirm
      if ('requiresConfirmation' in result) {
        res.status(409).json({ success: false, data: result, error: { code: 'OVERWRITE_CONFIRMATION', message: result.message } });
        return;
      }
      res.json({ success: true, data: result, message: 'Salary structure saved' });
    } catch (err) { next(err); }
  }

  async getPayrollRuns(req: Request, res: Response, next: NextFunction) {
    try {
      const runs = await payrollService.getPayrollRuns(req.user!.organizationId);
      res.json({ success: true, data: runs });
    } catch (err) { next(err); }
  }

  async createPayrollRun(req: Request, res: Response, next: NextFunction) {
    try {
      const { month, year } = createPayrollRunSchema.parse(req.body);
      const run = await payrollService.createPayrollRun(month, year, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: run, message: 'Payroll run created' });
    } catch (err) { next(err); }
  }

  async processPayroll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await payrollService.processPayroll(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Payroll processed' });
    } catch (err) { next(err); }
  }

  async getPayrollRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const records = await payrollService.getPayrollRecords(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: records });
    } catch (err) { next(err); }
  }

  async downloadSalarySlip(req: Request, res: Response, next: NextFunction) {
    try {
      const record = await payrollService.getPayrollRecordById(req.params.id, req.user!.organizationId);
      const isManagement = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user!.role);
      if (!isManagement && record.employeeId !== req.user!.employeeId) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to access this salary slip' } });
        return;
      }
      const pdfBuffer = await generateSalarySlipPDF(record);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const filename = `salary-slip-${record.employee.employeeCode}-${monthNames[record.payrollRun.month - 1]}-${record.payrollRun.year}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err) { next(err); }
  }

  async getMyPayslips(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user!.employeeId) {
        res.status(400).json({ success: false, data: null, error: { code: 'NO_EMPLOYEE', message: 'No employee profile linked' } });
        return;
      }
      const month = req.query.month ? Number(req.query.month) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const payslips = await payrollService.getMyPayslips(req.user!.employeeId, month, year);
      res.json({ success: true, data: payslips });
    } catch (err) { next(err); }
  }

  async getVisibilityRules(req: Request, res: Response, next: NextFunction) {
    try {
      const rules = await salaryVisibilityService.getVisibilityRules(req.user!.organizationId);
      res.json({ success: true, data: rules });
    } catch (err) { next(err); }
  }

  async setVisibilityRule(req: Request, res: Response, next: NextFunction) {
    try {
      const { employeeId, visibleToHR, visibleToManager, hiddenReason } = req.body;
      const rule = await salaryVisibilityService.setVisibilityRule(
        employeeId, { visibleToHR, visibleToManager, hiddenReason }, req.user!.userId
      );
      res.json({ success: true, data: rule, message: 'Visibility rule updated' });
    } catch (err) { next(err); }
  }

  async updateVisibilityRule(req: Request, res: Response, next: NextFunction) {
    try {
      const { visibleToHR, visibleToManager, hiddenReason } = req.body;
      const rule = await salaryVisibilityService.setVisibilityRule(
        req.params.employeeId, { visibleToHR, visibleToManager, hiddenReason }, req.user!.userId
      );
      res.json({ success: true, data: rule, message: 'Visibility rule updated' });
    } catch (err) { next(err); }
  }
}

export const payrollController = new PayrollController();
