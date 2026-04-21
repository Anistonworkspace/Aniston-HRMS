import { Request, Response, NextFunction } from 'express';
import { reportService } from './report.service.js';
import { attendanceSummaryQuerySchema, leaveSummaryQuerySchema } from './report.validation.js';
import { generateEmployeeDirectoryExcel } from '../../utils/excelExporter.js';
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
