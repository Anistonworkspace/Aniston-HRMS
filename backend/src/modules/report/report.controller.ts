import { Request, Response, NextFunction } from 'express';
import { reportService } from './report.service.js';
import { attendanceSummaryQuerySchema, leaveSummaryQuerySchema, attendanceDetailQuerySchema, leaveDetailQuerySchema } from './report.validation.js';
import { generateEmployeeDirectoryExcel, generateAttendanceSummaryExcel, generateLeaveReportExcel } from '../../utils/excelExporter.js';
import {
  generateEpfChallanExcel,
  generateEsiReturnExcel,
  generateForm24QExcel,
} from '../../utils/payrollExcelExporter.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import { prisma } from '../../lib/prisma.js';

/** Fetch org name for use in Excel headers */
async function getOrgName(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  return org?.name || 'Organization';
}

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
      const includePending = req.query.includePendingRegularizations === 'true';
      const data = await reportService.getAttendanceSummary(
        req.user!.organizationId,
        { ...query, includePendingRegularizations: includePending }
      );
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

  async attendanceDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const query = attendanceDetailQuerySchema.parse(req.query);

      if (req.query.format === 'xlsx') {
        const result = await reportService.getAttendanceDetail(req.user!.organizationId, { ...query, limit: 10000, page: 1 });
        const excelData = result.records.map((r) => ({
          employeeName: `${r.employeeName} (${r.employeeCode})`,
          date: r.date,
          status: r.status,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          totalHours: r.totalHours,
        }));
        const buffer = await generateAttendanceSummaryExcel(excelData);
        const filename = `Attendance-Report-${query.from || 'all'}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        return;
      }

      const data = await reportService.getAttendanceDetail(req.user!.organizationId, query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async leaveDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const query = leaveDetailQuerySchema.parse(req.query);

      if (req.query.format === 'xlsx') {
        const result = await reportService.getLeaveDetail(req.user!.organizationId, { ...query, limit: 10000, page: 1 });
        const period = `${query.month ? `Month-${query.month}-` : ''}${query.year || new Date().getFullYear()}`;
        const buffer = await generateLeaveReportExcel(result.records, period);
        const filename = `Leave-Report-${period}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        return;
      }

      const data = await reportService.getLeaveDetail(req.user!.organizationId, query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  // ── Statutory Compliance Exports ─────────────────────────────────────────

  async epfChallan(req: Request, res: Response, next: NextFunction) {
    try {
      const { payrollRunId } = req.query;
      if (!payrollRunId || typeof payrollRunId !== 'string') {
        throw new BadRequestError('payrollRunId query parameter is required');
      }

      const { run, records } = await reportService.getEpfChallanData(
        payrollRunId,
        req.user!.organizationId
      );

      const orgName = await getOrgName(req.user!.organizationId);
      const buffer = await generateEpfChallanExcel(run, records, orgName);

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const filename = `EPF-ECR-${monthNames[run.month - 1]}-${run.year}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  }

  async esiReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const { payrollRunId } = req.query;
      if (!payrollRunId || typeof payrollRunId !== 'string') {
        throw new BadRequestError('payrollRunId query parameter is required');
      }

      const { run, records } = await reportService.getEsiReturnData(
        payrollRunId,
        req.user!.organizationId
      );

      const orgName = await getOrgName(req.user!.organizationId);
      const buffer = await generateEsiReturnExcel(run, records, orgName);

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const filename = `ESI-Return-${monthNames[run.month - 1]}-${run.year}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  }

  async form24Q(req: Request, res: Response, next: NextFunction) {
    try {
      const { financialYear, quarter } = req.query;
      if (!financialYear || typeof financialYear !== 'string') {
        throw new BadRequestError('financialYear query parameter is required (e.g. 2025-26)');
      }
      if (!quarter || typeof quarter !== 'string') {
        throw new BadRequestError('quarter query parameter is required (Q1, Q2, Q3, or Q4)');
      }

      const records = await reportService.getForm24QData(
        financialYear,
        quarter,
        req.user!.organizationId
      );

      const orgName = await getOrgName(req.user!.organizationId);
      const buffer = await generateForm24QExcel(records, orgName, financialYear, quarter);

      const filename = `Form-24Q-${quarter}-FY${financialYear}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  }
}

export const reportController = new ReportController();
