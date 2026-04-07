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

      // Generate Excel
      const records = await payrollService.getPayrollRecords(req.params.id, req.user!.organizationId);
      const { generatePayrollExcel } = await import('../../utils/payrollExcelExporter.js');
      const excelBuffer = await generatePayrollExcel(run, records, org.name || 'Aniston Technologies LLP');

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;
      const filename = `payroll-report-${monthNames[run.month - 1]}-${run.year}.xlsx`;

      // Send email via nodemailer — decrypt SMTP password
      const nodemailer = await import('nodemailer');
      const { decrypt } = await import('../../utils/encryption.js');
      let smtpPass = emailSettings.pass;
      try { smtpPass = decrypt(emailSettings.pass); } catch { /* already plaintext (legacy) */ }
      const transporter = nodemailer.default.createTransport({
        host: emailSettings.host,
        port: emailSettings.port || 587,
        secure: emailSettings.port === 465,
        auth: { user: emailSettings.user, pass: smtpPass },
      });

      await transporter.sendMail({
        from: `"${emailSettings.fromName || 'Aniston HRMS'}" <${emailSettings.fromAddress || emailSettings.user}>`,
        to: org.payrollEmail,
        subject: `Payroll Report — ${periodLabel} | ${org.name}`,
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #4F46E5; padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 20px;">${org.name}</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Payroll Report</p>
            </div>
            <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
              <h2 style="color: #1e293b; font-size: 18px; margin-top: 0;">Payroll for ${periodLabel}</h2>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Employees Processed</td><td style="text-align: right; font-weight: bold; color: #1e293b;">${records.length}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-top: 1px solid #f1f5f9;">Total Gross</td><td style="text-align: right; font-weight: bold; color: #1e293b; border-top: 1px solid #f1f5f9;">₹${Number(run.totalGross || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-top: 1px solid #f1f5f9;">Total Deductions</td><td style="text-align: right; font-weight: bold; color: #dc2626; border-top: 1px solid #f1f5f9;">₹${Number(run.totalDeductions || 0).toLocaleString('en-IN')}</td></tr>
                <tr><td style="padding: 8px 0; color: #6b7280; font-size: 14px; border-top: 1px solid #f1f5f9;">Total Net Payable</td><td style="text-align: right; font-weight: bold; color: #059669; font-size: 16px; border-top: 1px solid #f1f5f9;">₹${Number(run.totalNet || 0).toLocaleString('en-IN')}</td></tr>
              </table>
              <p style="color: #6b7280; font-size: 13px;">The detailed payroll report is attached as an Excel file. Please handle this document with appropriate confidentiality.</p>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 16px 0;">
              <p style="color: #9ca3af; font-size: 11px;">This is an automated email from Aniston HRMS. Do not reply to this email.</p>
            </div>
          </div>
        `,
        attachments: [{
          filename,
          content: excelBuffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
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

// Bank transfer file (NEFT/RTGS format CSV)
router.get('/runs/:id/bank-file',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const records = await payrollService.getPayrollRecords(req.params.id, req.user!.organizationId);
      const run = await payrollService.getPayrollRunById(req.params.id);
      const { prisma } = await import('../../lib/prisma.js');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      // Fetch employee details — bank fields may not exist in schema yet
      const empIds = records.map((r: any) => r.employeeId);
      const employees = await prisma.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });
      const empMap = new Map(employees.map(e => [e.id, e]));

      // Generate CSV
      const lines: string[] = [];
      lines.push('Txn Type,Beneficiary Code,Beneficiary Name,Bank Account No,IFSC Code,Amount,Narration');

      for (const rec of records as any[]) {
        const emp = empMap.get(rec.employeeId);
        const name = `${rec.employee?.firstName || emp?.firstName || ''} ${rec.employee?.lastName || emp?.lastName || ''}`.trim();
        const netPay = Number(rec.netSalary || 0);
        if (netPay <= 0) continue;

        lines.push([
          'NEFT',
          rec.employee?.employeeCode || emp?.employeeCode || '',
          `"${name}"`,
          '', // Bank Account — to be filled by HR
          '', // IFSC Code — to be filled by HR
          netPay.toFixed(2),
          `"Salary ${monthNames[run.month - 1]} ${run.year}"`,
        ].join(','));
      }

      const csv = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="bank-transfer-${monthNames[run.month - 1]}-${run.year}.csv"`);
      res.send(csv);
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
