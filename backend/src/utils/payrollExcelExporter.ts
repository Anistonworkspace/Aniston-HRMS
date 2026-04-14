import ExcelJS from 'exceljs';

const BRAND = '4F46E5';
const GREEN = '059669';
const RED = 'DC2626';
const GRAY = '6B7280';

function styleHeaderRow(row: ExcelJS.Row, color: string = BRAND) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: '000000' } } };
  });
  row.height = 30;
}

function inr(value: number | null | undefined): string {
  if (value == null) return '₹0';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

/**
 * Generate colorful payroll Excel for a completed payroll run
 */
export async function generatePayrollExcel(
  run: any,
  records: any[],
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  // ===== SHEET 1: Payroll Summary =====
  const summarySheet = workbook.addWorksheet('Payroll Summary', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Title
  summarySheet.addRow([`${orgName} — Payroll Report`]);
  summarySheet.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  summarySheet.mergeCells(1, 1, 1, 16);
  summarySheet.addRow([`Period: ${periodLabel}`, '', `Status: ${run.status}`, '', `Processed: ${run.processedAt ? new Date(run.processedAt).toLocaleDateString('en-IN') : '-'}`]);
  summarySheet.getRow(2).font = { size: 10, color: { argb: GRAY } };

  const headers = [
    '#', 'Emp Code', 'Employee Name', 'Department',
    'Working Days', 'Present', 'LOP Days',
    'Basic', 'HRA', 'Other Earnings', 'Gross Salary',
    'EPF', 'ESI', 'Prof Tax', 'TDS', 'LOP Ded.',
    'Total Deductions', 'Net Salary',
  ];

  const headerRow = summarySheet.addRow(headers);
  styleHeaderRow(headerRow);

  // Set column widths
  [5, 12, 24, 16, 10, 8, 8, 12, 12, 12, 14, 10, 10, 8, 10, 10, 14, 14].forEach((w, i) => {
    summarySheet.getColumn(i + 1).width = w;
  });

  let totalGross = 0, totalNet = 0, totalDeductions = 0;

  records.forEach((rec: any, idx: number) => {
    const otherEarnings = rec.otherEarnings as any || {};
    const otherTotal = Number(otherEarnings.da || 0) + Number(otherEarnings.ta || 0) +
      Number(otherEarnings.medical || 0) + Number(otherEarnings.special || 0) + Number(otherEarnings.sundayBonus || 0);

    const totalDed = Number(rec.epfEmployee || 0) + Number(rec.esiEmployee || 0) +
      Number(rec.professionalTax || 0) + Number(rec.tds || 0) + Number(rec.lopDeduction || 0);

    totalGross += Number(rec.grossSalary || 0);
    totalNet += Number(rec.netSalary || 0);
    totalDeductions += totalDed;

    const row = summarySheet.addRow([
      idx + 1,
      rec.employee?.employeeCode || '-',
      `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`,
      rec.employee?.department?.name || '-',
      rec.workingDays || 0,
      rec.presentDays || 0,
      rec.lopDays || 0,
      Number(rec.basic || 0),
      Number(rec.hra || 0),
      otherTotal,
      Number(rec.grossSalary || 0),
      Number(rec.epfEmployee || 0),
      Number(rec.esiEmployee || 0),
      Number(rec.professionalTax || 0),
      Number(rec.tds || 0),
      Number(rec.lopDeduction || 0),
      totalDed,
      Number(rec.netSalary || 0),
    ]);

    row.font = { size: 9, name: 'Calibri' };
    row.alignment = { horizontal: 'center' };

    // Format currency columns
    for (const col of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      row.getCell(col).numFmt = '₹#,##0';
    }

    // Highlight net salary
    row.getCell(18).font = { bold: true, size: 10, color: { argb: GREEN } };

    // LOP highlight
    if (rec.lopDays > 0) {
      row.getCell(7).font = { bold: true, color: { argb: RED }, size: 9 };
      row.getCell(16).font = { bold: true, color: { argb: RED }, size: 9 };
    }

    if (idx % 2 === 1) {
      for (let c = 1; c <= 4; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
      }
    }
  });

  // Totals row
  const totalsRow = summarySheet.addRow([
    '', '', 'TOTAL', '',
    '', '', '',
    '', '', '', totalGross,
    '', '', '', '',
    '', totalDeductions, totalNet,
  ]);
  totalsRow.font = { bold: true, size: 11, name: 'Calibri' };
  totalsRow.getCell(11).numFmt = '₹#,##0';
  totalsRow.getCell(17).numFmt = '₹#,##0';
  totalsRow.getCell(18).numFmt = '₹#,##0';
  totalsRow.getCell(18).font = { bold: true, size: 12, color: { argb: GREEN } };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });

  summarySheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + records.length, column: headers.length } };

  // Protect summary sheet — read-only, password protected
  await summarySheet.protect('aniston@payroll', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
  });

  // ===== SHEET 2: Employer Cost =====
  const costSheet = workbook.addWorksheet('Employer Cost', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  costSheet.columns = [
    { header: 'Emp Code', key: 'code', width: 12 },
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Gross Salary', key: 'gross', width: 14 },
    { header: 'EPF (Employer)', key: 'epfEr', width: 14 },
    { header: 'ESI (Employer)', key: 'esiEr', width: 14 },
    { header: 'Total CTC/Month', key: 'ctc', width: 16 },
  ];
  styleHeaderRow(costSheet.getRow(1));

  records.forEach((rec: any) => {
    const empCost = Number(rec.grossSalary || 0) + Number(rec.epfEmployer || 0) + Number(rec.esiEmployer || 0);
    const row = costSheet.addRow({
      code: rec.employee?.employeeCode || '-',
      name: `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`,
      gross: Number(rec.grossSalary || 0),
      epfEr: Number(rec.epfEmployer || 0),
      esiEr: Number(rec.esiEmployer || 0),
      ctc: empCost,
    });
    row.font = { size: 9 };
    for (const col of [3, 4, 5, 6]) row.getCell(col).numFmt = '₹#,##0';
  });

  // Protect employer cost sheet
  await costSheet.protect('aniston@payroll', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate attendance-salary summary Excel.
 *
 * Column layout:
 *   Employee Name | Emp Code | Total Days (Mon–Sun) | Working Days (Mon–Sat) | Sundays (Paid Week-off)
 *   | Present Days | Paid Leave | Absent Days | Half Days | LOP / Unpaid Leaves | Total Paid Days | Comments
 *
 * Formula:
 *   Total Days       = Working Days (Mon–Sat) + Sundays
 *   Total Paid Days  = Total Days − LOP  (LOP already includes 0.5 per half-day)
 *   LOP              = Absent days not covered by paid leave / holidays (may be fractional due to half-days)
 */
export async function generateAttendanceSalaryExcel(
  run: any,
  records: any[],
  leaveData: Array<{ employeeId: string; providedL: number; leavesBalance: number; paidLeaveDays: number }>,
  attendanceDetails: Array<{ employeeId: string; presentCount: number; absentCount: number; halfDayCount: number }>,
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  // Total calendar days in month; Working Days stored in PayrollRecord excludes Sundays
  const totalDaysInMonth = new Date(run.year, run.month, 0).getDate();

  const NUM_COLS = 12;

  const sheet = workbook.addWorksheet('Attendance Salary', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Title row
  sheet.addRow([`${orgName} — Attendance Salary Report — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, NUM_COLS);
  sheet.getRow(1).height = 24;

  // Sub-heading: formula explanation
  sheet.addRow([`Total Paid Days = (Working Days + Sundays) − LOP  |  LOP = Absent days not covered by paid leave (0.5 per half-day)`]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, NUM_COLS);

  // Header row
  const DARK_BLUE = '1E3A8A';
  const headers = [
    'Employee Name',
    'Emp Code',
    'Total Days\n(Work+Sun)',
    'Working Days\n(Mon–Sat)',
    'Sundays\n(Paid Week-off)',
    'Present\nDays',
    'Paid Leave\nDays',
    'Absent\nDays',
    'Half\nDays',
    'LOP / Unpaid\nLeaves',
    'Total Paid\nDays',
    'Comments',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, DARK_BLUE);

  // Column widths
  [26, 13, 13, 14, 16, 12, 13, 12, 10, 14, 13, 28].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const leaveMap = new Map(leaveData.map((d) => [d.employeeId, d]));
  const attMap = new Map(attendanceDetails.map((d) => [d.employeeId, d]));

  let totWorkDays = 0, totSundays = 0, totTotal = 0, totPresent = 0;
  let totPaidLeave = 0, totAbsent = 0, totHalf = 0, totLop = 0, totPaidDays = 0;

  records.forEach((rec: any) => {
    const ld = leaveMap.get(rec.employeeId) || { providedL: 0, leavesBalance: 0, paidLeaveDays: 0 };
    const att = attMap.get(rec.employeeId) || { presentCount: 0, absentCount: 0, halfDayCount: 0 };

    const workingDays = Number(rec.workingDays || 0);        // Mon–Sat scheduled days
    const sundaysCount = totalDaysInMonth - workingDays;     // Sundays = total − Mon-Sat
    const totalDays = workingDays + sundaysCount;            // = totalDaysInMonth
    const lopDays = Number(rec.lopDays || 0);               // already includes 0.5/half-day
    const paidLeave = Number(ld.paidLeaveDays || 0);
    const absentDays = att.absentCount;
    const halfDays = att.halfDayCount;
    const presentDays = att.presentCount;                   // raw PRESENT attendance records
    // Total Paid Days = all scheduled days (including Sundays) − LOP deduction
    const totalPaidDays = Math.max(0, totalDays - lopDays);

    totWorkDays += workingDays;
    totSundays += sundaysCount;
    totTotal += totalDays;
    totPresent += presentDays;
    totPaidLeave += paidLeave;
    totAbsent += absentDays;
    totHalf += halfDays;
    totLop += lopDays;
    totPaidDays += totalPaidDays;

    const empName = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim();

    const row = sheet.addRow([
      empName,
      rec.employee?.employeeCode || '',
      totalDays,
      workingDays,
      sundaysCount,
      presentDays,
      paidLeave,
      absentDays,
      halfDays,
      lopDays,
      totalPaidDays,
      '', // Comments — blank for HR to fill
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    // LOP in red
    if (lopDays > 0) {
      row.getCell(10).font = { bold: true, color: { argb: RED }, size: 10 };
    }
    // Absent in red
    if (absentDays > 0) {
      row.getCell(8).font = { bold: true, color: { argb: RED }, size: 10 };
    }
    // Half days in orange
    if (halfDays > 0) {
      row.getCell(9).font = { bold: true, color: { argb: 'D97706' }, size: 10 };
    }
    // Paid leave in green
    if (paidLeave > 0) {
      row.getCell(7).font = { bold: true, color: { argb: GREEN }, size: 10 };
    }
    // Total paid days always bold green
    row.getCell(11).font = { bold: true, color: { argb: GREEN }, size: 10 };
    // Sundays in blue
    row.getCell(5).font = { color: { argb: BRAND }, size: 10 };
  });

  // Totals row
  const dataRows = records.length;
  const totalsRow = sheet.addRow([
    'TOTAL', '',
    totTotal, totWorkDays, totSundays,
    totPresent, totPaidLeave, totAbsent, totHalf, totLop,
    totPaidDays, '',
  ]);
  totalsRow.font = { bold: true, size: 11 };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });
  totalsRow.getCell(8).font = { bold: true, color: { argb: RED }, size: 11 };
  totalsRow.getCell(10).font = { bold: true, color: { argb: RED }, size: 11 };
  totalsRow.getCell(11).font = { bold: true, color: { argb: GREEN }, size: 11 };

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + dataRows, column: NUM_COLS } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate bank transfer Excel (NEFT/RTGS format) for salary disbursement
 */
export async function generateBankFileExcel(
  run: any,
  records: any[],
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  const sheet = workbook.addWorksheet('Bank Transfer', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Title
  sheet.addRow([`${orgName} — Salary Bank Transfer — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, 9);
  sheet.getRow(1).height = 24;

  const headers = [
    'Txn Type', 'Emp Code', 'Beneficiary Name',
    'Bank Account No', 'IFSC Code', 'Bank Name', 'Account Type',
    'Amount (₹)', 'Narration', 'Status',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, '065F46');

  [10, 12, 26, 20, 14, 22, 12, 14, 26, 22].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  let totalNet = 0;
  let readyCount = 0;
  let missingCount = 0;

  for (const rec of records as any[]) {
    const emp = rec.employee;
    const netPay = Number(rec.netSalary || 0);
    if (netPay <= 0) continue;

    const hasBank = !!(emp?.bankAccountNumber && emp?.ifscCode);
    const name = emp?.accountHolderName
      ? emp.accountHolderName
      : `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim();

    if (hasBank) readyCount++; else missingCount++;
    totalNet += netPay;

    const row = sheet.addRow([
      'NEFT',
      emp?.employeeCode || '',
      name,
      emp?.bankAccountNumber || '',
      emp?.ifscCode || '',
      emp?.bankName || '',
      emp?.accountType || '',
      netPay,
      `Salary ${shortMonths[run.month - 1]} ${run.year}`,
      hasBank ? 'READY' : 'MISSING — Fill manually',
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(8).numFmt = '₹#,##0.00';

    if (!hasBank) {
      // Highlight rows with missing bank details in light red
      for (let c = 1; c <= 10; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };
      }
      row.getCell(10).font = { bold: true, color: { argb: RED }, size: 10 };
    } else {
      row.getCell(10).font = { bold: true, color: { argb: GREEN }, size: 10 };
    }
  }

  // Summary row
  const summaryRow = sheet.addRow([
    '', '', `Total: ${readyCount + missingCount} employees`,
    '', '', '', '',
    totalNet,
    `Ready: ${readyCount} | Missing bank: ${missingCount}`,
    '',
  ]);
  summaryRow.font = { bold: true, size: 11 };
  summaryRow.getCell(8).numFmt = '₹#,##0.00';
  summaryRow.getCell(8).font = { bold: true, color: { argb: GREEN }, size: 12 };
  summaryRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } };
  });

  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + (records as any[]).length, column: 10 } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate downloadable payroll import template
 */
export async function generatePayrollTemplate(employees: any[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';

  const sheet = workbook.addWorksheet('Salary Data', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Instructions row
  sheet.addRow(['INSTRUCTIONS: Fill in the salary columns (yellow) for each employee. Do NOT modify Emp Code or Name. Upload this file back to import.']);
  sheet.getRow(1).font = { italic: true, size: 10, color: { argb: RED } };
  sheet.mergeCells(1, 1, 1, 14);

  const headers = [
    'Emp Code', 'Employee Name', 'Department',
    'CTC (Annual)', 'Basic', 'HRA', 'DA', 'TA',
    'Medical Allow.', 'Special Allow.', 'LTA',
    'Tax Regime', 'Performance Bonus', 'Notes',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  [12, 24, 16, 14, 12, 12, 10, 10, 12, 12, 10, 12, 14, 20].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  // Mark editable columns yellow
  for (let c = 4; c <= 13; c++) {
    headerRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FCD34D' } };
    headerRow.getCell(c).font = { bold: true, color: { argb: '000000' }, size: 10 };
  }

  // Add employee rows
  employees.forEach((emp: any) => {
    const sal = emp.salaryStructure;
    const row = sheet.addRow([
      emp.employeeCode,
      `${emp.firstName} ${emp.lastName}`,
      emp.department?.name || '-',
      sal ? Number(sal.ctc) : '',
      sal ? Number(sal.basic) : '',
      sal ? Number(sal.hra) : '',
      sal ? Number(sal.da || 0) : '',
      sal ? Number(sal.ta || 0) : '',
      sal ? Number(sal.medicalAllowance || 0) : '',
      sal ? Number(sal.specialAllowance || 0) : '',
      sal ? Number(sal.lta || 0) : '',
      sal?.incomeTaxRegime || 'NEW_REGIME',
      sal ? Number(sal.performanceBonus || 0) : '',
      '',
    ]);

    // Lock emp code and name columns (gray bg)
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E5E7EB' } };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E5E7EB' } };
    row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E5E7EB' } };

    // Yellow bg for editable cells
    for (let c = 4; c <= 13; c++) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7' } };
    }

    row.font = { size: 10 };
    for (const c of [4, 5, 6, 7, 8, 9, 10, 11, 13]) {
      row.getCell(c).numFmt = '#,##0';
    }
  });

  // Data validation for Tax Regime
  for (let r = 3; r <= 2 + employees.length; r++) {
    sheet.getCell(r, 12).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"NEW_REGIME,OLD_REGIME"'],
    };
  }

  sheet.autoFilter = { from: 'A2', to: `N${2 + employees.length}` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
