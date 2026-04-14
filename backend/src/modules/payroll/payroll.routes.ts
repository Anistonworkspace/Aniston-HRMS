import { Router } from 'express';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { payrollController } from './payroll.controller.js';
import { payrollService } from './payroll.service.js';
import { amendPayrollRecordSchema, salaryStructureSchema } from './payroll.validation.js';

const router = Router();
router.use(authenticate);

// AI anomaly detection (must be before /:id routes)
router.post('/ai-anomaly-check/:runId', requirePermission('payroll', 'manage'), async (req, res, next) => {
  try {
    const result = await payrollService.detectAnomalies(req.params.runId, req.user!.organizationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ── PUT /employee/:id/salary — primary dynamic salary endpoint ────
router.put('/employee/:id/salary',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const data = salaryStructureSchema.parse(req.body);
      const result = await payrollService.upsertSalaryStructure(req.params.id, data, req.user!.organizationId, req.user!.userId);
      if ('requiresConfirmation' in result) {
        res.status(409).json({ success: false, data: result, error: { code: 'OVERWRITE_CONFIRMATION', message: result.message } });
        return;
      }
      res.json({ success: true, data: result, message: 'Salary structure saved' });
    } catch (err) { next(err); }
  }
);

// Salary structure (legacy + new — POST also accepts new format)
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

// Lock a completed payroll run
router.post('/runs/:id/lock',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  async (req, res, next) => {
    try {
      const result = await payrollService.lockPayrollRun(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: 'Payroll run locked' });
    } catch (err) { next(err); }
  }
);

// Unlock a locked payroll run (SUPER_ADMIN only)
router.post('/runs/:id/unlock',
  authorize(Role.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const result = await payrollService.unlockPayrollRun(req.params.id, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: 'Payroll run unlocked for corrections' });
    } catch (err) { next(err); }
  }
);

// Amend a payroll record
router.patch('/records/:id/amend',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const body = amendPayrollRecordSchema.parse(req.body);
      const result = await payrollService.amendPayrollRecord(
        req.params.id as string, body, req.user!.userId, req.user!.organizationId
      );
      res.json({ success: true, data: result, message: 'Payroll record amended' });
    } catch (err) { next(err); }
  }
);

// Get salary history for an employee
router.get('/salary-history/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const history = await payrollService.getSalaryHistory(req.params.employeeId as string, req.user!.organizationId);
      res.json({ success: true, data: history });
    } catch (err) { next(err); }
  }
);

// PDF salary slip download
router.get('/records/:id/pdf',
  (req, res, next) => payrollController.downloadSalarySlip(req, res, next)
);

// Excel export for a payroll run
router.get('/runs/:id/export',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const records = await payrollService.getPayrollRecords(req.params.id);
      const run = await payrollService.getPayrollRunById(req.params.id);
      const org = await (await import('../../lib/prisma.js')).prisma.organization.findUnique({
        where: { id: req.user!.organizationId }, select: { name: true },
      });
      const { generatePayrollExcel } = await import('../../utils/payrollExcelExporter.js');
      const buffer = await generatePayrollExcel(run, records, org?.name || 'Aniston Technologies LLP');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-${monthNames[run.month - 1]}-${run.year}.xlsx"`);
      res.send(buffer);
    } catch (err) { next(err); }
  }
);

// Attendance salary summary Excel
// Columns: Employee Name | Emp Code | Total Days (Work+Sun) | Working Days | Sundays | Present | Paid Leave | Absent | Half Days | LOP | Total Paid Days | Comments
router.get('/runs/:id/attendance-export',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const run = await payrollService.getPayrollRunById(req.params.id);
      const records = await payrollService.getPayrollRecords(req.params.id);
      const { prisma } = await import('../../lib/prisma.js');

      const startOfMonth = new Date(run.year, run.month - 1, 1);
      const endOfMonth = new Date(run.year, run.month, 0);
      const empIds = (records as any[]).map((r: any) => r.employeeId);

      // Batch all DB queries in parallel instead of N+1
      const [leaveBalances, paidLeaveRequests, attendanceGroups] = await Promise.all([
        prisma.leaveBalance.findMany({
          where: { employeeId: { in: empIds }, year: run.year },
        }),
        prisma.leaveRequest.findMany({
          where: {
            employeeId: { in: empIds },
            status: 'APPROVED',
            startDate: { lte: endOfMonth },
            endDate: { gte: startOfMonth },
            leaveType: { isPaid: true },
          },
          select: { employeeId: true, days: true },
        }),
        // Group attendance by employeeId + status for efficient counting
        prisma.attendanceRecord.groupBy({
          by: ['employeeId', 'status'],
          where: { employeeId: { in: empIds }, date: { gte: startOfMonth, lte: endOfMonth } },
          _count: { _all: true },
        }),
      ]);

      // Build per-employee leave data
      const leaveData = empIds.map((empId: string) => {
        const balances = leaveBalances.filter((b: any) => b.employeeId === empId);
        const providedL = balances.reduce((s: number, b: any) => s + Number(b.allocated || 0), 0);
        const leavesBalance = balances.reduce((s: number, b: any) => {
          return s + Number(b.allocated || 0) + Number(b.carriedForward || 0) - Number(b.used || 0) - Number(b.pending || 0);
        }, 0);
        const paidLeaveDays = paidLeaveRequests
          .filter((lr: any) => lr.employeeId === empId)
          .reduce((s: number, lr: any) => s + Number(lr.days || 0), 0);
        return { employeeId: empId, providedL, leavesBalance, paidLeaveDays };
      });

      // Build per-employee attendance counts
      const attendanceDetails = empIds.map((empId: string) => {
        const empStats = (attendanceGroups as any[]).filter((s: any) => s.employeeId === empId);
        const presentCount = empStats.find((s: any) => s.status === 'PRESENT')?._count._all || 0;
        const absentCount = empStats.find((s: any) => s.status === 'ABSENT')?._count._all || 0;
        const halfDayCount = empStats.find((s: any) => s.status === 'HALF_DAY')?._count._all || 0;
        return { employeeId: empId, presentCount, absentCount, halfDayCount };
      });

      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId }, select: { name: true },
      });
      const { generateAttendanceSalaryExcel } = await import('../../utils/payrollExcelExporter.js');
      const buffer = await generateAttendanceSalaryExcel(run, records, leaveData, attendanceDetails, org?.name || 'Aniston Technologies LLP');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-salary-${monthNames[run.month - 1]}-${run.year}.xlsx"`);
      res.send(buffer);
    } catch (err) { next(err); }
  }
);

// Download salary template for bulk import
router.get('/template',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const employees = await prisma.employee.findMany({
        where: { organizationId: req.user!.organizationId, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION'] }, isSystemAccount: { not: true } },
        select: { employeeCode: true, firstName: true, lastName: true, department: { select: { name: true } }, salaryStructure: true },
        orderBy: { firstName: 'asc' },
      });
      const { generatePayrollTemplate } = await import('../../utils/payrollExcelExporter.js');
      const buffer = await generatePayrollTemplate(employees);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="salary-template.xlsx"');
      res.send(buffer);
    } catch (err) { next(err); }
  }
);

// Bulk import salary data from Excel
router.post('/import',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { uploadDocument } = await import('../../middleware/upload.middleware.js');
      uploadDocument.single('file')(req, res, async (err: any) => {
        if (err) return next(err);
        if (!req.file) {
          res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } });
          return;
        }
        try {
          const ExcelJS = (await import('exceljs')).default;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(req.file.buffer);
          const sheet = workbook.getWorksheet('Salary Data') || workbook.getWorksheet(1);
          if (!sheet) {
            res.status(400).json({ success: false, error: { code: 'INVALID_FILE', message: 'Could not find Salary Data sheet' } });
            return;
          }

          const { prisma } = await import('../../lib/prisma.js');
          let updated = 0, skipped = 0;
          const errors: string[] = [];
          const rowPromises: Promise<void>[] = [];

          sheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 2) return; // Skip header rows
            const empCode = String(row.getCell(1).value || '').trim();
            if (!empCode) return;
            rowPromises.push((async () => {
              try {
                const employee = await prisma.employee.findFirst({
                  where: { employeeCode: empCode, organizationId: req.user!.organizationId },
                });
                if (!employee) { skipped++; errors.push(`Row ${rowNumber}: Employee ${empCode} not found`); return; }

                const ctc = Number(row.getCell(4).value) || 0;
                const basic = Number(row.getCell(5).value) || 0;
                const hra = Number(row.getCell(6).value) || 0;
                if (!ctc || !basic) { skipped++; errors.push(`Row ${rowNumber}: Missing CTC or Basic for ${empCode}`); return; }

                await payrollService.upsertSalaryStructureLegacy(employee.id, {
                  ctc, basic, hra,
                  da: Number(row.getCell(7).value) || 0,
                  ta: Number(row.getCell(8).value) || 0,
                  medicalAllowance: Number(row.getCell(9).value) || 0,
                  specialAllowance: Number(row.getCell(10).value) || 0,
                  lta: Number(row.getCell(11).value) || 0,
                  incomeTaxRegime: String(row.getCell(12).value || 'NEW_REGIME'),
                });
                updated++;
              } catch (e: any) {
                skipped++;
                errors.push(`Row ${rowNumber}: ${e.message}`);
              }
            })());
          });

          await Promise.all(rowPromises);

          res.json({ success: true, data: { updated, skipped, errors: errors.slice(0, 20) }, message: `Imported ${updated} salary structures` });
        } catch (innerErr) { next(innerErr); }
      });
    } catch (err) { next(err); }
  }
);

// Send payroll report to accounts email
router.post('/runs/:id/send-email',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const { prisma } = await import('../../lib/prisma.js');
      const run = await payrollService.getPayrollRunById(req.params.id);
      if (!['COMPLETED', 'LOCKED'].includes(run.status)) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Payroll must be completed or locked to send email' } });
        return;
      }

      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId },
        select: { name: true, payrollEmail: true, settings: true },
      });

      if (!org?.payrollEmail) {
        res.status(400).json({ success: false, error: { code: 'NO_PAYROLL_EMAIL', message: 'Payroll email not configured. Go to Settings → Email Configuration to add an accounts email.' } });
        return;
      }

      const emailSettings = (org.settings as any)?.email;
      if (!emailSettings?.host || !emailSettings?.user || !emailSettings?.pass) {
        res.status(400).json({ success: false, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'SMTP email not configured. Go to Settings → Email Configuration.' } });
        return;
      }

      // Fetch records once, reuse for all 3 exports
      const records = await payrollService.getPayrollRecords(req.params.id, req.user!.organizationId);

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;
      const shortPeriod = `${shortMonths[run.month - 1]}-${run.year}`;

      const {
        generatePayrollExcel,
        generateAttendanceSalaryExcel,
        generateBankFileExcel,
      } = await import('../../utils/payrollExcelExporter.js');

      // Generate all 3 Excel files in parallel
      const startOfMonth = new Date(run.year, run.month - 1, 1);
      const endOfMonth = new Date(run.year, run.month, 0);
      const empIds = (records as any[]).map((r: any) => r.employeeId);

      const [leaveBalances, paidLeaveRequests, attendanceGroups] = await Promise.all([
        prisma.leaveBalance.findMany({ where: { employeeId: { in: empIds }, year: run.year } }),
        prisma.leaveRequest.findMany({
          where: {
            employeeId: { in: empIds }, status: 'APPROVED',
            startDate: { lte: endOfMonth }, endDate: { gte: startOfMonth },
            leaveType: { isPaid: true },
          },
          select: { employeeId: true, days: true },
        }),
        prisma.attendanceRecord.groupBy({
          by: ['employeeId', 'status'],
          where: { employeeId: { in: empIds }, date: { gte: startOfMonth, lte: endOfMonth } },
          _count: { _all: true },
        }),
      ]);

      const leaveData = empIds.map((empId: string) => {
        const balances = leaveBalances.filter((b: any) => b.employeeId === empId);
        const providedL = balances.reduce((s: number, b: any) => s + Number(b.allocated || 0), 0);
        const leavesBalance = balances.reduce((s: number, b: any) =>
          s + Number(b.allocated || 0) + Number(b.carriedForward || 0) - Number(b.used || 0) - Number(b.pending || 0), 0);
        const paidLeaveDays = paidLeaveRequests
          .filter((lr: any) => lr.employeeId === empId)
          .reduce((s: number, lr: any) => s + Number(lr.days || 0), 0);
        return { employeeId: empId, providedL, leavesBalance, paidLeaveDays };
      });

      const attendanceDetails = empIds.map((empId: string) => {
        const empStats = (attendanceGroups as any[]).filter((s: any) => s.employeeId === empId);
        return {
          employeeId: empId,
          presentCount: empStats.find((s: any) => s.status === 'PRESENT')?._count._all || 0,
          absentCount: empStats.find((s: any) => s.status === 'ABSENT')?._count._all || 0,
          halfDayCount: empStats.find((s: any) => s.status === 'HALF_DAY')?._count._all || 0,
        };
      });

      const [payrollBuffer, attendanceBuffer, bankBuffer] = await Promise.all([
        generatePayrollExcel(run, records, org.name || 'Aniston Technologies LLP'),
        generateAttendanceSalaryExcel(run, records, leaveData, attendanceDetails, org.name || 'Aniston Technologies LLP'),
        generateBankFileExcel(run, records, org.name || 'Aniston Technologies LLP'),
      ]);

      const filename = `payroll-report-${shortPeriod}.xlsx`;

      // Send email via nodemailer — decrypt SMTP password
      const nodemailer = await import('nodemailer');
      const { decrypt } = await import('../../utils/encryption.js');
      let smtpPass = emailSettings.pass;
      try { smtpPass = decrypt(emailSettings.pass); } catch { /* already plaintext (legacy) */ }

      const escHtml = (text: any): string => {
        if (text == null) return '';
        const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
      };

      const transporter = nodemailer.default.createTransport({
        host: emailSettings.host,
        port: emailSettings.port || 587,
        secure: emailSettings.port === 465,
        auth: { user: emailSettings.user, pass: smtpPass },
        tls: { ciphers: 'SSLv3' },
      });

      const safeOrgName = escHtml(org.name || 'Aniston Technologies LLP');
      const safePeriod = escHtml(periodLabel);

      await transporter.sendMail({
        from: `"${emailSettings.fromName || 'Aniston HRMS'}" <${emailSettings.fromAddress || emailSettings.user}>`,
        to: org.payrollEmail,
        subject: `Payroll Report — ${periodLabel} | ${org.name}`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #4F46E5; padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 20px;">${safeOrgName}</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Payroll Report</p>
            </div>
            <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
              <h2 style="color: #1e293b; font-size: 18px; margin-top: 0;">Payroll for ${safePeriod}</h2>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;" role="presentation">
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Employees Processed</td><td style="text-align: right; font-weight: bold; color: #1e293b;">${records.length}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-top: 1px solid #f1f5f9;">Total Gross</td><td style="text-align: right; font-weight: bold; color: #1e293b; border-top: 1px solid #f1f5f9;">&#8377;${Number(run.totalGross || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-top: 1px solid #f1f5f9;">Total Deductions</td><td style="text-align: right; font-weight: bold; color: #dc2626; border-top: 1px solid #f1f5f9;">&#8377;${Number(run.totalDeductions || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-top: 1px solid #f1f5f9;">Total Net Payable</td><td style="text-align: right; font-weight: bold; color: #059669; font-size: 16px; border-top: 1px solid #f1f5f9;">&#8377;${Number(run.totalNet || 0).toLocaleString('en-IN')}</td></tr>
              </table>
              <p style="color: #374151; font-size: 13px; font-weight: 600; margin-bottom: 8px;">3 files attached:</p>
              <ul style="margin: 0 0 16px; padding-left: 20px; color: #6b7280; font-size: 13px; line-height: 1.8;">
                <li><strong style="color: #059669;">payroll-report-${escHtml(shortPeriod)}.xlsx</strong> — Full payroll report with statutory deductions</li>
                <li><strong style="color: #4F46E5;">attendance-salary-${escHtml(shortPeriod)}.xlsx</strong> — Attendance summary: present / leave / LOP / paid days</li>
                <li><strong style="color: #065F46;">bank-transfer-${escHtml(shortPeriod)}.xlsx</strong> — NEFT bank transfer file for salary disbursement</li>
              </ul>
              <p style="color: #6b7280; font-size: 13px;">Please handle these documents with appropriate confidentiality.</p>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 16px 0;">
              <p style="color: #9ca3af; font-size: 11px;">This is an automated email from Aniston HRMS. Do not reply to this email.</p>
            </div>
          </div>
        `,
        attachments: [
          {
            filename,
            content: payrollBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          {
            filename: `attendance-salary-${shortPeriod}.xlsx`,
            content: attendanceBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          {
            filename: `bank-transfer-${shortPeriod}.xlsx`,
            content: bankBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });

      // Audit log
      const { createAuditLog } = await import('../../utils/auditLogger.js');
      await createAuditLog({
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
        entity: 'PayrollRun',
        entityId: req.params.id,
        action: 'UPDATE',
        newValue: { action: 'SENT_EMAIL', to: org.payrollEmail, period: periodLabel },
      });

      res.json({ success: true, data: { sentTo: org.payrollEmail, period: periodLabel }, message: `Payroll report sent to ${org.payrollEmail}` });
    } catch (err) { next(err); }
  }
);

// Bank transfer file (NEFT/RTGS format Excel)
router.get('/runs/:id/bank-file',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const records = await payrollService.getPayrollRecords(req.params.id, req.user!.organizationId);
      const run = await payrollService.getPayrollRunById(req.params.id);
      const { prisma } = await import('../../lib/prisma.js');
      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId }, select: { name: true },
      });
      const { generateBankFileExcel } = await import('../../utils/payrollExcelExporter.js');
      const buffer = await generateBankFileExcel(run, records, org?.name || 'Aniston Technologies LLP');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="bank-transfer-${monthNames[run.month - 1]}-${run.year}.xlsx"`);
      res.send(buffer);
    } catch (err) { next(err); }
  }
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
