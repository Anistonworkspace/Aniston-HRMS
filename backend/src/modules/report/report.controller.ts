import { Request, Response, NextFunction } from 'express';
import { reportService } from './report.service.js';
import { attendanceSummaryQuerySchema, leaveSummaryQuerySchema } from './report.validation.js';
import { generateEmployeeDirectoryExcel } from '../../utils/excelExporter.js';

export class ReportController {
  async headcount(req: Request, res: Response, next: NextFunction) {
    try {
      if (req.query.format === 'xlsx') {
        const employees = await reportService.getEmployeesForExcel(req.user!.organizationId);
        const buffer = await generateEmployeeDirectoryExcel(employees);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="employee-directory.xlsx"');
        res.send(buffer);
        return;
      }
      const data = await reportService.getHeadcount(req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async attendanceSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const query = attendanceSummaryQuerySchema.parse(req.query);
      const data = await reportService.getAttendanceSummary(req.user!.organizationId, query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async leaveSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const query = leaveSummaryQuerySchema.parse(req.query);
      const data = await reportService.getLeaveSummary(req.user!.organizationId, query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async payrollSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await reportService.getPayrollSummary(req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async recruitmentFunnel(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await reportService.getRecruitmentFunnel(req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export const reportController = new ReportController();
