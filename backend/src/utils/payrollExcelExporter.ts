import ExcelJS from 'exceljs';

const BRAND = '4F46E5';
const GREEN = '059669';
const RED = 'DC2626';
const GRAY = '6B7280';

// ─── Helpers ────────────────────────────────────────────────────────────────

function styleHeaderRow(row: ExcelJS.Row, color: string = BRAND) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: '000000' } } };
  });
  row.height = 30;
}

/** Safe number — returns 0 for null/undefined/NaN */
function n(v: any): number {
  const num = Number(v);
  return isFinite(num) ? num : 0;
}

/** Safe text — returns 'N/A' for null/undefined/'', keeps valid strings */
function t(v: any): string {
  if (v === null || v === undefined || String(v).trim() === '') return 'N/A';
  return String(v).trim();
}

/** Format currency label (not used for numeric cells — only for text cells) */
function inrText(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

/**
 * Resolve "Other Earnings" total from a PayrollRecord.
 * Primary source: earningsBreakdown (canonical component-wise map from processPayroll).
 * Fallback: otherEarnings legacy keys.
 */
function resolveOtherEarningsTotal(rec: any): number {
  const eb: Record<string, number> = rec.earningsBreakdown || {};
  const oe: Record<string, number> = rec.otherEarnings || {};

  if (Object.keys(eb).length > 0) {
    // Sum everything except Basic and HRA (they're in dedicated columns)
    return Object.entries(eb)
      .filter(([k]) => k !== 'Basic' && k !== 'HRA')
      .reduce((s, [, v]) => s + n(v), 0);
  }

  // Fallback: legacy otherEarnings shorthand keys
  return (
    n(oe.da) + n(oe.ta) + n(oe.medical) + n(oe.special) +
    n(oe.lta) + n(oe.sundayBonus) + n(oe.adjustmentAdditions)
  );
}

/**
 * Resolve individual shorthand earning values for payslip breakdown.
 * Primary: earningsBreakdown; secondary: otherEarnings normalized keys.
 */
function resolveEarning(rec: any, ...names: string[]): number {
  const eb: Record<string, number> = rec.earningsBreakdown || {};
  const oe: Record<string, number> = rec.otherEarnings || {};

  // Try earningsBreakdown first (exact component name)
  for (const name of names) {
    if (eb[name] !== undefined) return n(eb[name]);
  }
  // Try otherEarnings shorthand
  for (const name of names) {
    const key = name.toLowerCase().replace(/\s+/g, '_');
    if (oe[key] !== undefined) return n(oe[key]);
    // Also try with no underscore (e.g. 'da', 'ta')
    if (oe[name.toLowerCase()] !== undefined) return n(oe[name.toLowerCase()]);
  }
  return 0;
}

// ─── Export 1: Full Payroll Excel ───────────────────────────────────────────

/**
 * Generate colorful payroll Excel for a completed payroll run.
 * Uses earningsBreakdown as primary source for all component values.
 */
export async function generatePayrollExcel(
  run: any,
  records: any[],
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  // ===== SHEET 1: Payroll Summary =====
  const summarySheet = workbook.addWorksheet('Payroll Summary', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  summarySheet.addRow([`${orgName} — Payroll Report`]);
  summarySheet.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  summarySheet.mergeCells(1, 1, 1, 18);

  summarySheet.addRow([
    `Period: ${periodLabel}`, '', `Status: ${run.status}`, '',
    `Processed: ${run.processedAt ? new Date(run.processedAt).toLocaleDateString('en-IN') : 'N/A'}`,
    '', `Employees: ${records.filter((r: any) => !r.employee?.isSystemAccount).length}`,
  ]);
  summarySheet.getRow(2).font = { size: 10, color: { argb: GRAY } };

  const headers = [
    '#', 'Emp Code', 'Employee Name', 'Department',
    'Working Days', 'Present', 'LOP Days',
    'Basic', 'HRA', 'Other Earnings', 'Gross Salary',
    'EPF (Emp)', 'ESI (Emp)', 'Prof Tax', 'TDS', 'LOP Ded.',
    'Total Deductions', 'Net Salary',
  ];

  const headerRow = summarySheet.addRow(headers);
  styleHeaderRow(headerRow);

  [5, 12, 24, 16, 11, 8, 8, 13, 13, 13, 14, 11, 11, 9, 11, 11, 15, 14].forEach((w, i) => {
    summarySheet.getColumn(i + 1).width = w;
  });

  let totalGross = 0, totalNet = 0, totalDeductions = 0;
  const filteredRecords = (records as any[]).filter((r: any) => !r.employee?.isSystemAccount);

  if (filteredRecords.length === 0) {
    const noDataRow = summarySheet.addRow([
      '—', 'N/A', 'No payroll records for this period — process payroll first',
      ...Array(15).fill('N/A'),
    ]);
    noDataRow.font = { italic: true, color: { argb: GRAY }, size: 10 };
    noDataRow.getCell(3).alignment = { horizontal: 'left' };
  }

  filteredRecords.forEach((rec: any, idx: number) => {
    const otherTotal = resolveOtherEarningsTotal(rec);

    const totalDed =
      n(rec.epfEmployee) + n(rec.esiEmployee) +
      n(rec.professionalTax) + n(rec.tds) + n(rec.lopDeduction);

    totalGross += n(rec.grossSalary);
    totalNet   += n(rec.netSalary);
    totalDeductions += totalDed;

    const empName = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim();

    const row = summarySheet.addRow([
      idx + 1,
      t(rec.employee?.employeeCode),
      t(empName) === 'N/A' ? 'N/A' : empName,
      t(rec.employee?.department?.name),
      rec.workingDays ?? 'N/A',
      rec.presentDays ?? 'N/A',
      rec.lopDays ?? 0,
      n(rec.basic),
      n(rec.hra),
      otherTotal,
      n(rec.grossSalary),
      n(rec.epfEmployee),
      n(rec.esiEmployee),
      n(rec.professionalTax),
      n(rec.tds),
      n(rec.lopDeduction),
      totalDed,
      n(rec.netSalary),
    ]);

    row.font = { size: 9, name: 'Calibri' };
    row.alignment = { horizontal: 'center' };

    // Currency format for money columns (8-18)
    for (const col of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      row.getCell(col).numFmt = '₹#,##0';
    }

    row.getCell(18).font = { bold: true, size: 10, color: { argb: GREEN } };

    if (n(rec.lopDays) > 0) {
      row.getCell(7).font  = { bold: true, color: { argb: RED }, size: 9 };
      row.getCell(16).font = { bold: true, color: { argb: RED }, size: 9 };
    }

    // Alternate row shading
    if (idx % 2 === 1) {
      for (let c = 1; c <= 4; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
      }
    }
  });

  // Totals row
  const totalsRow = summarySheet.addRow([
    '', '', 'TOTAL', '', '', '', '',
    '', '', '', totalGross,
    '', '', '', '', '',
    totalDeductions, totalNet,
  ]);
  totalsRow.font = { bold: true, size: 11, name: 'Calibri' };
  totalsRow.getCell(11).numFmt = '₹#,##0';
  totalsRow.getCell(17).numFmt = '₹#,##0';
  totalsRow.getCell(18).numFmt = '₹#,##0';
  totalsRow.getCell(18).font = { bold: true, size: 12, color: { argb: GREEN } };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });

  summarySheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + filteredRecords.length, column: headers.length },
  };

  await summarySheet.protect('aniston@payroll', {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true,
  });

  // ===== SHEET 2: Earnings Breakdown =====
  const ebSheet = workbook.addWorksheet('Earnings Breakdown', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Collect all unique component names across all records
  const allCompNames = new Set<string>();
  filteredRecords.forEach((rec: any) => {
    const eb: Record<string, number> = rec.earningsBreakdown || {};
    Object.keys(eb).forEach(k => allCompNames.add(k));
  });
  const compNames = [...allCompNames].filter(k => k !== 'Basic' && k !== 'HRA');

  ebSheet.columns = [
    { header: 'Emp Code', key: 'code', width: 12 },
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Basic', key: 'basic', width: 14 },
    { header: 'HRA', key: 'hra', width: 12 },
    ...compNames.map(c => ({ header: c, key: c, width: 16 })),
    { header: 'Total Gross', key: 'gross', width: 14 },
    { header: 'Net Salary', key: 'net', width: 14 },
  ];
  styleHeaderRow(ebSheet.getRow(1));

  filteredRecords.forEach((rec: any) => {
    const eb: Record<string, number> = rec.earningsBreakdown || {};
    const rowData: any = {
      code: t(rec.employee?.employeeCode),
      name: `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A',
      basic: n(rec.basic),
      hra: n(rec.hra),
      gross: n(rec.grossSalary),
      net: n(rec.netSalary),
    };
    compNames.forEach(c => { rowData[c] = n(eb[c]); });
    const row = ebSheet.addRow(rowData);
    row.font = { size: 9 };
    // Currency format for numeric columns (starting from col 3)
    for (let col = 3; col <= ebSheet.columnCount; col++) {
      row.getCell(col).numFmt = '₹#,##0';
    }
    row.getCell(ebSheet.columnCount).font = { bold: true, color: { argb: GREEN }, size: 10 };
  });

  // ===== SHEET 3: Employer Cost =====
  const costSheet = workbook.addWorksheet('Employer Cost', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  costSheet.columns = [
    { header: 'Emp Code', key: 'code', width: 12 },
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Gross Salary', key: 'gross', width: 14 },
    { header: 'EPF (Employer)', key: 'epfEr', width: 14 },
    { header: 'ESI (Employer)', key: 'esiEr', width: 14 },
    { header: 'Total Employer Cost', key: 'ctc', width: 18 },
  ];
  styleHeaderRow(costSheet.getRow(1));

  filteredRecords.forEach((rec: any) => {
    const empCost = n(rec.grossSalary) + n(rec.epfEmployer) + n(rec.esiEmployer);
    const row = costSheet.addRow({
      code: t(rec.employee?.employeeCode),
      name: `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A',
      gross: n(rec.grossSalary),
      epfEr: n(rec.epfEmployer),
      esiEr: n(rec.esiEmployer),
      ctc: empCost,
    });
    row.font = { size: 9 };
    for (const col of [3, 4, 5, 6]) row.getCell(col).numFmt = '₹#,##0';
    row.getCell(6).font = { bold: true, color: { argb: BRAND }, size: 10 };
  });

  await costSheet.protect('aniston@payroll', {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 2: Attendance Salary Excel ──────────────────────────────────────

/**
 * Generate attendance-salary summary Excel.
 *
 * Column layout:
 *   Employee Name | Emp Code | Total Days (Mon–Sun) | Working Days (Mon–Sat) | Sundays (Paid Week-off)
 *   | Present Days | Paid Leave | Absent Days | Half Days | LOP / Unpaid Leaves | Total Paid Days | Comments
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

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  const totalDaysInMonth = new Date(run.year, run.month, 0).getDate();
  const NUM_COLS = 12;

  const sheet = workbook.addWorksheet('Attendance Salary', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Title
  sheet.addRow([`${orgName} — Attendance Salary Report — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, NUM_COLS);
  sheet.getRow(1).height = 24;

  sheet.addRow([
    `Total Paid Days = (Working Days + Sundays) − LOP  |  LOP = Absent days not covered by paid leave (0.5 per half-day)  |  Period: ${periodLabel}`,
  ]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, NUM_COLS);

  const DARK_BLUE = '1E3A8A';
  const headers = [
    'Employee Name', 'Emp Code',
    'Total Days\n(Work+Sun)', 'Working Days\n(Mon–Sat)', 'Sundays\n(Paid Week-off)',
    'Present\nDays', 'Paid Leave\nDays', 'Absent\nDays', 'Half\nDays',
    'LOP / Unpaid\nLeaves', 'Total Paid\nDays', 'Comments',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, DARK_BLUE);

  [26, 13, 13, 14, 16, 12, 13, 12, 10, 14, 13, 28].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const leaveMap  = new Map(leaveData.map((d) => [d.employeeId, d]));
  const attMap    = new Map(attendanceDetails.map((d) => [d.employeeId, d]));

  let totWorkDays = 0, totSundays = 0, totTotal = 0, totPresent = 0;
  let totPaidLeave = 0, totAbsent = 0, totHalf = 0, totLop = 0, totPaidDays = 0;

  const attFilteredRecords = (records as any[]).filter((r: any) => !r.employee?.isSystemAccount);

  if (attFilteredRecords.length === 0) {
    const noDataRow = sheet.addRow([
      'No attendance/payroll records — process payroll first',
      'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A',
    ]);
    noDataRow.font = { italic: true, color: { argb: GRAY }, size: 10 };
    noDataRow.getCell(1).alignment = { horizontal: 'left' };
  }

  attFilteredRecords.forEach((rec: any, rowIdx: number) => {
    const ld  = leaveMap.get(rec.employeeId)  || { providedL: 0, leavesBalance: 0, paidLeaveDays: 0 };
    const att = attMap.get(rec.employeeId)    || { presentCount: 0, absentCount: 0, halfDayCount: 0 };

    const workingDays   = n(rec.workingDays);
    const sundaysCount  = totalDaysInMonth - workingDays;
    const totalDays     = workingDays + sundaysCount;    // = totalDaysInMonth
    const lopDays       = n(rec.lopDays);
    const paidLeave     = n(ld.paidLeaveDays);
    const absentDays    = att.absentCount;
    const halfDays      = att.halfDayCount;
    const presentDays   = att.presentCount;
    const totalPaidDays = Math.max(0, totalDays - lopDays);

    totWorkDays  += workingDays;
    totSundays   += sundaysCount;
    totTotal     += totalDays;
    totPresent   += presentDays;
    totPaidLeave += paidLeave;
    totAbsent    += absentDays;
    totHalf      += halfDays;
    totLop       += lopDays;
    totPaidDays  += totalPaidDays;

    const empName = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim();

    const row = sheet.addRow([
      t(empName),
      t(rec.employee?.employeeCode),
      totalDays,
      workingDays,
      sundaysCount,
      presentDays,
      paidLeave,
      absentDays,
      halfDays,
      lopDays,
      totalPaidDays,
      'N/A', // Comments — blank for HR to fill; N/A signals it's intentionally empty
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    if (lopDays > 0)   { row.getCell(10).font = { bold: true, color: { argb: RED }, size: 10 }; }
    if (absentDays > 0){ row.getCell(8).font  = { bold: true, color: { argb: RED }, size: 10 }; }
    if (halfDays > 0)  { row.getCell(9).font  = { bold: true, color: { argb: 'D97706' }, size: 10 }; }
    if (paidLeave > 0) { row.getCell(7).font  = { bold: true, color: { argb: GREEN }, size: 10 }; }
    row.getCell(11).font = { bold: true, color: { argb: GREEN }, size: 10 };
    row.getCell(5).font  = { color: { argb: BRAND }, size: 10 };

    // Alternate shading
    if (rowIdx % 2 === 1) {
      for (let c = 1; c <= NUM_COLS; c++) {
        if (!row.getCell(c).fill || (row.getCell(c).fill as any).type === 'none') {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
        }
      }
    }
  });

  // Totals row
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
  totalsRow.getCell(8).font  = { bold: true, color: { argb: RED },   size: 11 };
  totalsRow.getCell(10).font = { bold: true, color: { argb: RED },   size: 11 };
  totalsRow.getCell(11).font = { bold: true, color: { argb: GREEN }, size: 11 };

  // Correct autoFilter range using filtered record count
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + attFilteredRecords.length, column: NUM_COLS },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 3: Bank Transfer Excel ──────────────────────────────────────────

/**
 * Generate bank transfer Excel (NEFT/RTGS format) for salary disbursement.
 * Uses real bank details from employee profile. Missing fields shown as N/A.
 */
export async function generateBankFileExcel(
  run: any,
  records: any[],
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  const sheet = workbook.addWorksheet('Bank Transfer', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Title
  sheet.addRow([`${orgName} — Salary Bank Transfer — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, 10);
  sheet.getRow(1).height = 24;

  const headers = [
    'Txn Type', 'Emp Code', 'Beneficiary Name',
    'Bank Account No', 'IFSC Code', 'Bank Name', 'Account Type',
    'Amount (₹)', 'Narration', 'Status',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, '065F46');

  [10, 12, 26, 22, 14, 22, 12, 14, 26, 22].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  let totalNet   = 0;
  let readyCount = 0;
  let missingCount = 0;

  const bankFilteredRecords = (records as any[]).filter(
    (r: any) => !r.employee?.isSystemAccount && n(r.netSalary) > 0
  );

  if (bankFilteredRecords.length === 0) {
    const noDataRow = sheet.addRow([
      'N/A', 'N/A', 'No salary records — process payroll first',
      'N/A', 'N/A', 'N/A', 'N/A', 0, 'Process payroll first to generate bank transfer data', 'N/A',
    ]);
    noDataRow.font = { italic: true, color: { argb: GRAY }, size: 10 };
    noDataRow.getCell(3).alignment = { horizontal: 'left' };
  }

  for (const rec of bankFilteredRecords) {
    const emp    = rec.employee;
    const netPay = n(rec.netSalary);

    const hasBank = !!(emp?.bankAccountNumber && emp?.ifscCode);

    // Beneficiary name: prefer accountHolderName, fallback to employee name, then N/A
    const beneficiaryName =
      emp?.accountHolderName?.trim()
        || `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim()
        || 'N/A';

    if (hasBank) readyCount++; else missingCount++;
    totalNet += netPay;

    const row = sheet.addRow([
      'NEFT',
      t(emp?.employeeCode),
      beneficiaryName,
      hasBank ? emp.bankAccountNumber : 'N/A — Missing',
      hasBank ? t(emp.ifscCode) : 'N/A',
      t(emp?.bankName),
      t(emp?.accountType),
      netPay,
      `Salary ${shortMonths[run.month - 1]} ${run.year}`,
      hasBank ? 'READY' : 'MISSING — Fill bank details in employee profile',
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(8).numFmt = '₹#,##0.00';

    if (!hasBank) {
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
    `Ready: ${readyCount} | Missing bank details: ${missingCount}`,
    '',
  ]);
  summaryRow.font = { bold: true, size: 11 };
  summaryRow.getCell(8).numFmt = '₹#,##0.00';
  summaryRow.getCell(8).font  = { bold: true, color: { argb: GREEN }, size: 12 };
  summaryRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } };
  });

  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2 + bankFilteredRecords.length, column: 10 },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 4: Payroll Import Template ──────────────────────────────────────

/**
 * Generate downloadable payroll import template with existing employee data pre-filled.
 */
export async function generatePayrollTemplate(employees: any[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';

  const sheet = workbook.addWorksheet('Salary Data', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  sheet.addRow([
    'INSTRUCTIONS: Fill in the salary columns (yellow) for each employee. ' +
    'Do NOT modify Emp Code or Name. Upload this file back to import.',
  ]);
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

  employees.forEach((emp: any) => {
    const sal = emp.salaryStructure;
    const row = sheet.addRow([
      emp.employeeCode,
      `${emp.firstName} ${emp.lastName}`,
      emp.department?.name || 'N/A',
      sal ? n(sal.ctc) : '',
      sal ? n(sal.basic) : '',
      sal ? n(sal.hra) : '',
      sal ? n(sal.da || 0) : '',
      sal ? n(sal.ta || 0) : '',
      sal ? n(sal.medicalAllowance || 0) : '',
      sal ? n(sal.specialAllowance || 0) : '',
      sal ? n(sal.lta || 0) : '',
      sal?.incomeTaxRegime || 'NEW_REGIME',
      sal ? n(sal.performanceBonus || 0) : '',
      '',
    ]);

    // Lock non-editable columns (gray)
    for (const c of [1, 2, 3]) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E5E7EB' } };
    }
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
