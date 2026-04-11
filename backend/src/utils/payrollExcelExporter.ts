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
 * Generate attendance-salary summary Excel matching HR report format:
 * First Name | Provided L | Paid | Unpaid | Working Days | Salary Issued Days | Leaves Balance | Comments
 */
export async function generateAttendanceSalaryExcel(
  run: any,
  records: any[],
  leaveData: Array<{ employeeId: string; providedL: number; leavesBalance: number; paidLeaveDays: number }>,
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  const sheet = workbook.addWorksheet('Attendance Salary', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Title row
  sheet.addRow([`${orgName} — Attendance Salary Report — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, 8);
  sheet.getRow(1).height = 24;

  // Header row — light blue to match screenshot
  const LIGHT_BLUE = '1E3A8A';
  const headers = [
    'First name', 'Provided L', 'Paid', 'Unpaid',
    'Working Days', 'Salary Issued Days', 'Leaves Balance', 'Comments',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, LIGHT_BLUE);

  // Column widths
  [22, 12, 10, 10, 14, 18, 15, 30].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const leaveMap = new Map(leaveData.map((d) => [d.employeeId, d]));

  records.forEach((rec: any) => {
    const ld = leaveMap.get(rec.employeeId) || { providedL: 0, leavesBalance: 0, paidLeaveDays: 0 };
    const workingDays = Number(rec.workingDays || 0);
    const unpaid = Number(rec.lopDays || 0);
    const salaryIssuedDays = workingDays - unpaid;

    const row = sheet.addRow([
      rec.employee?.firstName || '',
      ld.providedL,
      ld.paidLeaveDays,
      unpaid,
      workingDays,
      salaryIssuedDays,
      ld.leavesBalance,
      '', // Comments — blank for HR to fill
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    // Left-align name
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    // Highlight unpaid (LOP) in red if > 0
    if (unpaid > 0) {
      row.getCell(4).font = { bold: true, color: { argb: RED }, size: 10 };
    }

    // Highlight paid leave in green if > 0
    if (ld.paidLeaveDays > 0) {
      row.getCell(3).font = { bold: true, color: { argb: GREEN }, size: 10 };
    }
  });

  // Totals row
  const dataRows = records.length;
  const totalsRow = sheet.addRow([
    'TOTAL', '', '', '', '', '', '', '',
  ]);
  totalsRow.font = { bold: true, size: 11 };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });

  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + dataRows, column: 8 } };

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
