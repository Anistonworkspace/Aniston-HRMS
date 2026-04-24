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
 *
 * Primary: grossSalary − basic − hra (both stored as dedicated numeric columns,
 *   so this is always accurate regardless of what names the salary components carry).
 *
 * Fallback A: earningsBreakdown with an extended exclusion set that covers both the
 *   short codes ("Basic", "HRA") and the full component-master names
 *   ("Basic Salary", "House Rent Allowance").
 *
 * Fallback B: legacy otherEarnings shorthand keys for very old records.
 */
function resolveOtherEarningsTotal(rec: any): number {
  const gross = n(rec.grossSalary);
  const basic = n(rec.basic);
  const hra   = n(rec.hra);

  // Primary — most reliable: stored gross already includes sunday bonus + adj additions
  if (gross > 0 && (basic > 0 || hra > 0)) {
    return Math.max(0, gross - basic - hra);
  }

  // Fallback A — earningsBreakdown with complete exclusion list
  const eb: Record<string, number> = rec.earningsBreakdown || {};
  if (Object.keys(eb).length > 0) {
    // Component master uses full names; UI sometimes stores short codes — exclude both forms.
    const SKIP = new Set([
      'Basic', 'Basic Salary', 'basic', 'basic salary',
      'HRA',   'House Rent Allowance', 'hra', 'house rent allowance',
    ]);
    return Object.entries(eb)
      .filter(([k]) => !SKIP.has(k))
      .reduce((s, [, v]) => s + n(v), 0);
  }

  // Fallback B — legacy otherEarnings shorthand keys
  const oe: Record<string, number> = rec.otherEarnings || {};
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
 * Generate payroll Excel with 19 fixed columns.
 * Columns: Employee Name | Department | Working Days | Present | Week-off | Paid Leave
 *   | Absent(LOP) | Half Day(LOP) | EPF(Employee) | Basic Salary | HRA
 *   | Conveyance Allowance | Medical Allowance | Special Allowance
 *   | Total Deductions | Net Salary | Bank Account Name | Account Number | IFSC Code
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

  const filteredRecords = (records as any[]).filter((r: any) => !r.employee?.isSystemAccount);

  const NUM_COLS = 19;
  const sheet = workbook.addWorksheet('Payroll', { views: [{ state: 'frozen', ySplit: 3 }] });

  // Row 1: title
  sheet.addRow([`${orgName} — Payroll Report — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, NUM_COLS);
  sheet.getRow(1).height = 28;

  // Row 2: meta
  sheet.addRow([
    `Period: ${periodLabel}`,
    '', `Status: ${run.status}`,
    '', `Processed: ${run.processedAt ? new Date(run.processedAt).toLocaleDateString('en-IN') : 'N/A'}`,
    '', `Employees: ${filteredRecords.length}`,
  ]);
  sheet.getRow(2).font = { size: 10, color: { argb: GRAY } };

  // Row 3: headers
  const headers = [
    'Employee Name', 'Department',
    'Working Days', 'Present', 'Week-off', 'Paid Leave', 'Absent\n(LOP)', 'Half Day\n(LOP)',
    'EPF\n(Employee)',
    'Basic Salary', 'HRA', 'Conveyance\nAllowance', 'Medical\nAllowance', 'Special\nAllowance',
    'Total\nDeductions', 'Net Salary',
    'Bank Account Name', 'Account Number', 'IFSC Code',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  const colWidths = [26, 16, 13, 10, 10, 11, 11, 11, 12, 14, 13, 16, 14, 14, 14, 14, 24, 20, 14];
  colWidths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  if (filteredRecords.length === 0) {
    const nd = sheet.addRow(['No payroll records — process payroll first', ...Array(NUM_COLS - 1).fill('')]);
    nd.font = { italic: true, color: { argb: GRAY }, size: 10 };
  }

  let totBasic = 0, totHra = 0, totConv = 0, totMed = 0, totSpec = 0;
  let totEpf = 0, totDed = 0, totNet = 0;

  filteredRecords.forEach((rec: any, idx: number) => {
    const eb: Record<string, number> = rec.earningsBreakdown || {};
    const emp = rec.employee;

    // Component values from earningsBreakdown — blank string if component not assigned
    const basicVal = resolveEarning(rec, 'Basic Salary', 'Basic', 'basic', 'BASIC');
    const hraVal   = resolveEarning(rec, 'HRA', 'House Rent Allowance', 'hra');
    const convVal  = resolveEarning(rec, 'Conveyance Allowance', 'Conveyance', 'conveyance_allow', 'CONVEYANCE_ALLOW');
    const medVal   = resolveEarning(rec, 'Medical Allowance', 'Medical', 'medical_allow', 'MEDICAL_ALLOW');
    const specVal  = resolveEarning(rec, 'Special Allowance', 'Special', 'special_allow', 'SPECIAL_ALLOW');

    const epfVal = n(rec.epfEmployee);
    const totalDed = n(rec.lopDeduction) + epfVal +
      Object.entries(rec.deductionsBreakdown || {}).reduce((s: number, [, v]: [string, any]) => s + n(v), 0);

    totBasic += basicVal; totHra += hraVal; totConv += convVal;
    totMed += medVal; totSpec += specVal;
    totEpf += epfVal; totDed += totalDed; totNet += n(rec.netSalary);

    const beneficiaryName =
      emp?.accountHolderName?.trim() ||
      `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() || '';

    const row = sheet.addRow([
      `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() || 'N/A',
      t(emp?.department?.name),
      n(rec.workingDays),
      n(rec.presentDays),
      n(rec.weekOffDays),
      n(rec.paidLeaveDays),
      n(rec.absentLop),
      n(rec.halfDayLop),
      epfVal > 0 ? epfVal : '',
      basicVal > 0 ? basicVal : 0,
      hraVal   > 0 ? hraVal   : 0,
      convVal  > 0 ? convVal  : 0,
      medVal   > 0 ? medVal   : 0,
      specVal  > 0 ? specVal  : 0,
      totalDed,
      n(rec.netSalary),
      t(beneficiaryName),
      t(emp?.bankAccountNumber),
      t(emp?.ifscCode),
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(17).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(18).alignment = { horizontal: 'left', vertical: 'middle' };

    // Currency format for money columns 9–16
    for (let c = 9; c <= 16; c++) row.getCell(c).numFmt = '₹#,##0';

    row.getCell(16).font = { bold: true, color: { argb: GREEN }, size: 10 };
    if (n(rec.absentLop) > 0) row.getCell(7).font  = { bold: true, color: { argb: RED }, size: 10 };
    if (n(rec.halfDayLop) > 0) row.getCell(8).font = { bold: true, color: { argb: 'D97706' }, size: 10 };
    if (epfVal > 0) row.getCell(9).font = { color: { argb: GRAY }, size: 10 };

    if (idx % 2 === 1) {
      for (let c = 1; c <= NUM_COLS; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
      }
    }
  });

  // Totals row
  const totVals = Array(NUM_COLS).fill('');
  totVals[0] = `Total: ${filteredRecords.length} employees`;
  totVals[8]  = totEpf;
  totVals[9]  = totBasic;
  totVals[10] = totHra;
  totVals[11] = totConv;
  totVals[12] = totMed;
  totVals[13] = totSpec;
  totVals[14] = totDed;
  totVals[15] = totNet;
  const totRow = sheet.addRow(totVals);
  totRow.font = { bold: true, size: 11, name: 'Calibri' };
  totRow.getCell(1).alignment = { horizontal: 'left' };
  for (let c = 9; c <= 16; c++) {
    totRow.getCell(c).numFmt = '₹#,##0';
  }
  totRow.getCell(16).font = { bold: true, color: { argb: GREEN }, size: 12 };
  totRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + filteredRecords.length, column: NUM_COLS } };

  // ── Instructions section ─────────────────────────────────────────────────
  sheet.addRow([]);
  const instrTitle = sheet.addRow(['PAYROLL CALCULATION INSTRUCTIONS']);
  sheet.mergeCells(instrTitle.number, 1, instrTitle.number, NUM_COLS);
  instrTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  instrTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  instrTitle.height = 22;

  const instructions: [string, string][] = [
    ['Working Days',       'Total working days in the period per employee\'s shift. Starts from employee\'s joining date. Mid-month joiners have fewer working days.'],
    ['Present',           'Days clocked in. Half-day = 0.5. Sundays and holidays are not counted here (they are paid separately).'],
    ['Week-off',          'Paid weekly off-days (e.g. Sundays) in the employee\'s effective period. These days are always paid — no attendance needed.'],
    ['Paid Leave',        'Approved paid leave days consumed from leave balance. These are paid — no LOP deduction.'],
    ['Absent (LOP)',      'Days counted as Loss of Pay = Explicit absences + working days with no attendance record + unpaid leave.'],
    ['Half Day (LOP)',    'Half-day LOP records (each = 0.5 day deduction from salary).'],
    ['EPF (Employee)',    '12% of Basic Salary — deducted only if the employee has an EPF component in their salary structure. Blank = no EPF for this employee.'],
    ['Salary Components', 'Basic, HRA, Conveyance, Medical, Special are pro-rated percentages of CTC. Values are 0 if the component is not assigned to the employee\'s salary structure.'],
    ['Total Deductions',  'EPF (if applicable) + LOP Deduction + any other deduction components in the salary structure.'],
    ['Net Salary',        'Net = Gross Salary − Total Deductions. This is the amount transferred to the bank.'],
    ['Gross Salary',      'Sum of all earning components (Basic + HRA + Conveyance + Medical + Special + any custom earnings). Adjusted for pro-ration.'],
    ['LOP Deduction',     'LOP Deduction = (Gross ÷ Working Days) × (Absent LOP + Half Day LOP × 0.5). Capped so Net ≥ ₹0.'],
    ['Pro-ration',        'For mid-month joiners: salary is proportional to the number of working days from joining date to month end.'],
    ['Bank Details',      'Bank Account Name, Account Number, IFSC Code are fetched from the employee\'s profile. Update them in Employee → Edit Profile before processing bank transfer.'],
  ];

  const instrLgRow = sheet.addRow(['Column / Field', 'Explanation']);
  sheet.mergeCells(instrLgRow.number, 2, instrLgRow.number, NUM_COLS);
  instrLgRow.getCell(1).font = { bold: true, size: 9, color: { argb: 'FFFFFF' } };
  instrLgRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '374151' } };
  instrLgRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '374151' } };

  for (const [col, desc] of instructions) {
    const r = sheet.addRow([col, desc]);
    sheet.mergeCells(r.number, 2, r.number, NUM_COLS);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '1E3A8A' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 2: Attendance Salary Excel ──────────────────────────────────────

/**
 * Generate attendance summary Excel (9 columns) for the payroll run.
 * All data is sourced from stored PayrollRecord fields — no extra parameters needed.
 * Columns: Employee Name | Emp Code | Working Days | Sundays/Week-offs | Paid Holidays
 *   | Present | Half Day(LOP) | Absent(LOP) | Total Present Paid Days
 */
export async function generateAttendanceSalaryExcel(
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

  const NUM_COLS = 9;
  const attRecords = (records as any[]).filter((r: any) => !r.employee?.isSystemAccount);

  const sheet = workbook.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 3 }] });

  // Title
  sheet.addRow([`${orgName} — Attendance Report — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, NUM_COLS);
  sheet.getRow(1).height = 24;

  sheet.addRow([
    `Total Present Paid Days = Present + Sundays/Week-offs + Paid Holidays + Paid Leave  |  `
    + `Period: ${periodLabel}`,
  ]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, NUM_COLS);

  const attHeaders = [
    'Employee Name', 'Emp Code',
    'Working Days', 'Sundays/\nWeek-offs', 'Paid\nHolidays',
    'Present', 'Half Day\n(LOP)', 'Absent\n(LOP)',
    'Total Present\nPaid Days',
  ];
  const attHeaderRow = sheet.addRow(attHeaders);
  styleHeaderRow(attHeaderRow, '1E3A8A');

  [26, 13, 13, 14, 12, 10, 12, 11, 16].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  if (attRecords.length === 0) {
    const nd = sheet.addRow(['No records — process payroll first', ...Array(NUM_COLS - 1).fill('')]);
    nd.font = { italic: true, color: { argb: GRAY }, size: 10 };
  }

  let tWorkDays = 0, tWeekOff = 0, tHolidays = 0, tPresent = 0;
  let tHalfLop = 0, tAbsentLop = 0, tPaidLeave = 0, tTotalPaid = 0;

  attRecords.forEach((rec: any, idx: number) => {
    const emp = rec.employee;
    const workingDays = n(rec.workingDays);
    const weekOffDays = n(rec.weekOffDays);
    const paidHolidays = n(rec.paidHolidays);
    const presentDays = n(rec.presentDays);
    const halfDayLop = n(rec.halfDayLop);
    const absentLop = n(rec.absentLop);
    const paidLeaveDays = n(rec.paidLeaveDays);
    // Total Present Paid Days = present + weekoffs + holidays + paid leave
    // Note: presentDays already includes 0.5 per half-day
    const totalPaidDays = presentDays + weekOffDays + paidHolidays + paidLeaveDays;

    tWorkDays  += workingDays;
    tWeekOff   += weekOffDays;
    tHolidays  += paidHolidays;
    tPresent   += presentDays;
    tHalfLop   += halfDayLop;
    tAbsentLop += absentLop;
    tPaidLeave += paidLeaveDays;
    tTotalPaid += totalPaidDays;

    const empName = `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim();
    const row = sheet.addRow([
      t(empName),
      t(emp?.employeeCode),
      workingDays,
      weekOffDays,
      paidHolidays,
      presentDays,
      halfDayLop,
      absentLop,
      totalPaidDays,
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    row.getCell(9).font = { bold: true, color: { argb: GREEN }, size: 10 };
    if (absentLop > 0)  row.getCell(8).font = { bold: true, color: { argb: RED }, size: 10 };
    if (halfDayLop > 0) row.getCell(7).font = { bold: true, color: { argb: 'D97706' }, size: 10 };
    if (paidHolidays > 0) row.getCell(5).font = { bold: true, color: { argb: BRAND }, size: 10 };
    row.getCell(4).font = { color: { argb: BRAND }, size: 10 };

    if (idx % 2 === 1) {
      for (let c = 1; c <= NUM_COLS; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
      }
    }
  });

  // Totals row
  const totRow = sheet.addRow([
    `Total: ${attRecords.length} employees`, '',
    tWorkDays, tWeekOff, tHolidays,
    tPresent, tHalfLop, tAbsentLop, tTotalPaid,
  ]);
  totRow.font = { bold: true, size: 11 };
  totRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });
  totRow.getCell(9).font  = { bold: true, color: { argb: GREEN }, size: 11 };
  totRow.getCell(8).font  = { bold: true, color: { argb: RED },   size: 11 };

  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + attRecords.length, column: NUM_COLS } };

  // ── Instructions ─────────────────────────────────────────────────────────
  sheet.addRow([]);
  const instrTitle = sheet.addRow(['ATTENDANCE COLUMN GUIDE']);
  sheet.mergeCells(instrTitle.number, 1, instrTitle.number, NUM_COLS);
  instrTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  instrTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A8A' } };
  instrTitle.height = 22;

  const attGuide: [string, string][] = [
    ['Working Days',        'Total Mon–Sat days in the employee\'s effective period. Starts from joining date. Shorter for mid-month joiners.'],
    ['Sundays/Week-offs',  'Paid weekly off-days (e.g. Sundays). Always paid — no attendance needed. Counted in Total Paid Days.'],
    ['Paid Holidays',       'Public holidays declared in Settings → Holidays within the employee\'s effective period. Always paid.'],
    ['Present',             'Days actually clocked in. Half-day = 0.5. Does NOT include Sundays, holidays, or paid leave.'],
    ['Half Day (LOP)',      'Count of half-day LOP records. Each = 0.5 day deduction. Shown separately for clarity.'],
    ['Absent (LOP)',        'Full-day LOP records = Explicit absences + working days with no attendance + unpaid leave.'],
    ['Total Present Paid Days', 'Present + Sundays/Week-offs + Paid Holidays + Paid Leave. This is the total days for which salary is paid.'],
    ['Formula Check',       'Working Days = Present + Absent(LOP) + Half Day(LOP)×0.5 + Paid Leave + any carry-over days.'],
  ];

  const instrHdr = sheet.addRow(['Column', 'Explanation']);
  sheet.mergeCells(instrHdr.number, 2, instrHdr.number, NUM_COLS);
  instrHdr.getCell(1).font = { bold: true, size: 9, color: { argb: 'FFFFFF' } };
  instrHdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '374151' } };
  instrHdr.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '374151' } };

  for (const [col, desc] of attGuide) {
    const r = sheet.addRow([col, desc]);
    sheet.mergeCells(r.number, 2, r.number, NUM_COLS);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '1E3A8A' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

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

// ─── Export 4: EPF ECR Challan ──────────────────────────────────────────────

/**
 * Generate EPF ECR (Employee Contribution Register) Excel challan.
 * Format matches EPFO ECR text-file column spec, exported as Excel for review.
 *
 * Columns (EPFO ECR spec):
 *   SRNO | UAN | MEMBER_NAME | GROSS_WAGES | EPF_WAGES | EPS_WAGES | EDLI_WAGES
 *   | EPF_CONTR_REMITTED | EPS_CONTR_REMITTED | EPF_EPS_DIFF_REMITTED
 *   | NCP_DAYS | REFUND_OF_ADVANCES
 */
export async function generateEpfChallanExcel(
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

  const sheet = workbook.addWorksheet('EPF ECR Challan', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Title block
  sheet.addRow([`${orgName} — EPF ECR Challan — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, 12);
  sheet.getRow(1).height = 24;

  sheet.addRow([
    `EPFO ECR Format  |  Period: ${periodLabel}  |  `
    + 'UAN = Universal Account Number (use PAN if UAN not registered)  |  '
    + 'EPF/EPS Wages capped at ₹15,000',
  ]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, 12);

  const headers = [
    'SRNO', 'UAN', 'MEMBER_NAME', 'GROSS_WAGES',
    'EPF_WAGES', 'EPS_WAGES', 'EDLI_WAGES',
    'EPF_CONTR_REMITTED', 'EPS_CONTR_REMITTED', 'EPF_EPS_DIFF_REMITTED',
    'NCP_DAYS', 'REFUND_OF_ADVANCES',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, '1D4ED8'); // deep blue for EPF

  [7, 18, 28, 14, 12, 12, 12, 18, 18, 20, 11, 18].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const filteredRecords = (records as any[]).filter(
    (r: any) => !r.employee?.isSystemAccount
  );

  const EPF_WAGE_CAP = 15000;
  const EPS_WAGE_CAP = 15000; // EPS also capped at 15,000

  let srno = 0;
  let totalEpfContr = 0;
  let totalEpsContr = 0;

  filteredRecords.forEach((rec: any) => {
    srno++;
    const grossWages   = n(rec.grossSalary);
    const epfWages     = Math.min(n(rec.basic), EPF_WAGE_CAP);
    const epsWages     = Math.min(epfWages, EPS_WAGE_CAP);
    const edliWages    = epfWages; // EDLI = same as EPF wages

    // EPF contribution = 12% of EPF wages
    const epfContr     = Math.round(epfWages * 12 / 100);
    // EPS contribution = 8.33% of EPS wages (employer's EPS portion; max ₹1,250)
    const epsContr     = Math.min(Math.round(epsWages * 8.33 / 100), 1250);
    // EPF–EPS difference = employer EPF minus EPS portion (goes into EPF proper)
    const epfEpsDiff   = Math.max(0, epfContr - epsContr);
    const ncpDays      = n(rec.lopDays);

    totalEpfContr += epfContr;
    totalEpsContr += epsContr;

    // UAN: use stored UAN if present, else fall back to PAN (EPFO allows PAN-based filing)
    const uan = t(rec.employee?.epfUan || rec.employee?.panNumber || 'N/A');
    const memberName = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A';

    const row = sheet.addRow([
      srno,
      uan,
      memberName,
      grossWages,
      epfWages,
      epsWages,
      edliWages,
      epfContr,
      epsContr,
      epfEpsDiff,
      ncpDays,
      0, // REFUND_OF_ADVANCES — always 0 (manual override for returns)
    ]);

    row.font = { size: 9, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    // Currency format for wage/contribution columns
    for (const col of [4, 5, 6, 7, 8, 9, 10]) {
      row.getCell(col).numFmt = '₹#,##0';
    }

    if (ncpDays > 0) {
      row.getCell(11).font = { bold: true, color: { argb: RED }, size: 9 };
    }
    if (uan === 'N/A') {
      row.getCell(2).font = { color: { argb: RED }, size: 9, italic: true };
    }

    if (srno % 2 === 0) {
      for (let c = 1; c <= 12; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
      }
    }
  });

  // Totals row
  const totalsRow = sheet.addRow([
    '', `TOTAL: ${srno} members`, '',
    '', '', '', '',
    totalEpfContr, totalEpsContr, totalEpfContr - totalEpsContr,
    '', '',
  ]);
  totalsRow.font = { bold: true, size: 11, name: 'Calibri' };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DBEAFE' } };
  });
  totalsRow.getCell(8).numFmt = '₹#,##0';
  totalsRow.getCell(9).numFmt = '₹#,##0';
  totalsRow.getCell(10).numFmt = '₹#,##0';
  totalsRow.getCell(8).font = { bold: true, color: { argb: '1D4ED8' }, size: 11 };

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + filteredRecords.length, column: 12 },
  };

  // Notes section
  sheet.addRow([]);
  const notesTitle = sheet.addRow(['NOTES — EPF ECR Filing Instructions']);
  sheet.mergeCells(notesTitle.number, 1, notesTitle.number, 12);
  notesTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  notesTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1D4ED8' } };
  notesTitle.height = 22;

  const notes: [string, string][] = [
    ['UAN', 'Universal Account Number — employees must register UAN on EPFO portal. If blank, use PAN until UAN is available.'],
    ['EPF_WAGES', 'Basic salary capped at ₹15,000. This is the wage base for 12% EPF computation.'],
    ['EPS_WAGES', 'EPS (Employees Pension Scheme) wage base — also capped at ₹15,000.'],
    ['EDLI_WAGES', 'EDLI (Employees Deposit Linked Insurance) — same as EPF wages.'],
    ['EPF_CONTR_REMITTED', '12% of EPF wages. This is the employer\'s total EPF contribution per member.'],
    ['EPS_CONTR_REMITTED', '8.33% of EPS wages (max ₹1,250/month). This goes to the pension scheme.'],
    ['EPF_EPS_DIFF_REMITTED', 'EPF contribution − EPS contribution. This remainder goes to EPF accumulation.'],
    ['NCP_DAYS', 'Non-Contributing Period (LOP days). Affects pension computation.'],
    ['Filing', 'Upload this data to EPFO Unified Portal → ECR Upload after verifying all UANs.'],
  ];

  for (const [col, desc] of notes) {
    const r = sheet.addRow([col, desc]);
    sheet.mergeCells(r.number, 2, r.number, 12);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '1D4ED8' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 5: ESI Return ────────────────────────────────────────────────────

/**
 * Generate ESI contribution return Excel.
 * Columns: IP_NO | NAME | GROSS_WAGES | TOTAL_WAGES_ESI | EMPLOYEE_SHARE | EMPLOYER_SHARE
 *
 * ESI only applies to employees with Gross <= ₹21,000/month.
 * Employee share: 0.75%, Employer share: 3.25%.
 */
export async function generateEsiReturnExcel(
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

  const sheet = workbook.addWorksheet('ESI Return', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  sheet.addRow([`${orgName} — ESI Contribution Return — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: '047857' } };
  sheet.mergeCells(1, 1, 1, 7);
  sheet.getRow(1).height = 24;

  sheet.addRow([
    `ESIC Format  |  Period: ${periodLabel}  |  `
    + 'Applicable only for Gross Salary ≤ ₹21,000/month  |  '
    + 'Employee: 0.75%  |  Employer: 3.25%',
  ]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, 7);

  const headers = [
    'SRNO', 'IP_NO', 'NAME', 'GROSS_WAGES',
    'TOTAL_WAGES_ESI', 'EMPLOYEE_SHARE', 'EMPLOYER_SHARE',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, '047857'); // emerald green for ESI

  [7, 20, 28, 14, 16, 15, 15].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const ESI_GROSS_CAP = 21000;
  const ESI_EE_RATE   = 0.0075; // 0.75%
  const ESI_ER_RATE   = 0.0325; // 3.25%

  const filteredRecords = (records as any[]).filter(
    (r: any) => !r.employee?.isSystemAccount
  );

  // Separate ESI-applicable vs non-applicable employees
  const esiRecords = filteredRecords.filter(
    (r: any) => n(r.grossSalary) <= ESI_GROSS_CAP
  );
  const nonEsiRecords = filteredRecords.filter(
    (r: any) => n(r.grossSalary) > ESI_GROSS_CAP
  );

  let srno = 0;
  let totalEsiWages = 0;
  let totalEeShare = 0;
  let totalErShare = 0;

  esiRecords.forEach((rec: any) => {
    srno++;
    const grossWages  = n(rec.grossSalary);
    const esiWages    = grossWages; // ESI computed on actual gross (no cap since we pre-filtered)
    const eeShare     = Math.round(esiWages * ESI_EE_RATE);
    const erShare     = Math.round(esiWages * ESI_ER_RATE);

    totalEsiWages += esiWages;
    totalEeShare  += eeShare;
    totalErShare  += erShare;

    // IP_NO: ESIC Insurance Policy number — stored on employee if available, else use employeeCode
    const ipNo = t((rec.employee as any)?.esiIpNumber || rec.employee?.employeeCode);
    const name = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A';

    const row = sheet.addRow([
      srno,
      ipNo,
      name,
      grossWages,
      esiWages,
      eeShare,
      erShare,
    ]);

    row.font = { size: 9, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    for (const col of [4, 5, 6, 7]) {
      row.getCell(col).numFmt = '₹#,##0';
    }

    if (srno % 2 === 0) {
      for (let c = 1; c <= 7; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } };
      }
    }
  });

  // Totals row
  const totalsRow = sheet.addRow([
    '', `TOTAL: ${srno} employees`, '',
    '', totalEsiWages, totalEeShare, totalErShare,
  ]);
  totalsRow.font = { bold: true, size: 11 };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1FAE5' } };
  });
  totalsRow.getCell(5).numFmt = '₹#,##0';
  totalsRow.getCell(6).numFmt = '₹#,##0';
  totalsRow.getCell(7).numFmt = '₹#,##0';
  totalsRow.getCell(7).font = { bold: true, color: { argb: '047857' }, size: 11 };

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + esiRecords.length, column: 7 },
  };

  // Non-applicable section
  if (nonEsiRecords.length > 0) {
    sheet.addRow([]);
    const exclTitle = sheet.addRow([
      `EXCLUDED — ${nonEsiRecords.length} employee(s) with Gross > ₹21,000 (ESI not applicable)`,
    ]);
    sheet.mergeCells(exclTitle.number, 1, exclTitle.number, 7);
    exclTitle.font = { bold: true, size: 10, color: { argb: GRAY } };
    exclTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
    exclTitle.height = 20;

    nonEsiRecords.forEach((rec: any, idx: number) => {
      const name = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A';
      const excRow = sheet.addRow([
        idx + 1,
        t(rec.employee?.employeeCode),
        name,
        n(rec.grossSalary),
        'N/A — Gross > ₹21,000', '', '',
      ]);
      excRow.font = { size: 9, color: { argb: GRAY }, italic: true };
      excRow.getCell(4).numFmt = '₹#,##0';
    });
  }

  // Notes section
  sheet.addRow([]);
  const notesTitle = sheet.addRow(['NOTES — ESI Return Filing Instructions']);
  sheet.mergeCells(notesTitle.number, 1, notesTitle.number, 7);
  notesTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  notesTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '047857' } };
  notesTitle.height = 22;

  const notes: [string, string][] = [
    ['IP_NO', 'Insurance Policy Number — ESIC registration number. Use employee code until ESIC registration is done.'],
    ['GROSS_WAGES', 'Total gross salary for the contribution period. ESI applies if Gross ≤ ₹21,000/month.'],
    ['TOTAL_WAGES_ESI', 'Gross wages on which ESI is calculated (same as Gross here since pre-filtered).'],
    ['EMPLOYEE_SHARE', '0.75% of ESI wages — deducted from employee salary.'],
    ['EMPLOYER_SHARE', '3.25% of ESI wages — paid by the company.'],
    ['Total Contribution', 'Employee (0.75%) + Employer (3.25%) = 4% total to be remitted to ESIC.'],
    ['Filing', 'Log in to ESIC portal → Contribution → File Monthly Contribution → upload or enter these values.'],
    ['Due Date', 'ESI contribution is due by the 15th of the following month.'],
  ];

  for (const [col, desc] of notes) {
    const r = sheet.addRow([col, desc]);
    sheet.mergeCells(r.number, 2, r.number, 7);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '047857' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 6: Form 24Q (TDS Summary) ───────────────────────────────────────

/**
 * Generate Form 24Q TDS return summary Excel for a financial year quarter.
 * Columns: PAN | NAME | TOTAL_INCOME | TDS_DEDUCTED | SURCHARGE | EDUCATION_CESS
 */
export async function generateForm24QExcel(
  records: any[],  // PayrollRecord[] covering the quarter (may span multiple runs)
  orgName: string,
  financialYear: string, // e.g. "2025-26"
  quarter: string,        // e.g. "Q1"
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const QUARTER_MONTHS: Record<string, string> = {
    Q1: 'Apr–Jun', Q2: 'Jul–Sep', Q3: 'Oct–Dec', Q4: 'Jan–Mar',
  };
  const quarterLabel = `${quarter} (${QUARTER_MONTHS[quarter] || quarter}) FY ${financialYear}`;

  const sheet = workbook.addWorksheet('Form 24Q', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  sheet.addRow([`${orgName} — Form 24Q TDS Return Summary — ${quarterLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: '7C3AED' } };
  sheet.mergeCells(1, 1, 1, 8);
  sheet.getRow(1).height = 24;

  sheet.addRow([
    `TDS Return Format  |  Quarter: ${quarterLabel}  |  `
    + 'TDS = Tax Deducted at Source from salary. File quarterly via TRACES / TIN NSDL.',
  ]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, 8);

  const headers = [
    'SRNO', 'PAN', 'EMPLOYEE_NAME', 'TOTAL_INCOME_QUARTER',
    'TDS_DEDUCTED', 'SURCHARGE', 'EDUCATION_CESS', 'TOTAL_TAX_DEPOSITED',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, '7C3AED'); // purple for TDS

  [7, 16, 28, 20, 16, 14, 14, 20].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  // Aggregate per employee across all payroll records in the quarter
  const empMap = new Map<string, {
    name: string; pan: string; totalIncome: number; totalTds: number;
  }>();

  (records as any[]).filter((r: any) => !r.employee?.isSystemAccount).forEach((rec: any) => {
    const empId = rec.employeeId as string;
    const name = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A';
    const pan  = t(rec.employee?.panNumber || 'N/A');

    if (!empMap.has(empId)) {
      empMap.set(empId, { name, pan, totalIncome: 0, totalTds: 0 });
    }
    const entry = empMap.get(empId)!;
    entry.totalIncome += n(rec.grossSalary);
    entry.totalTds    += n(rec.tds);
  });

  let srno = 0;
  let grandIncome = 0;
  let grandTds    = 0;

  empMap.forEach((entry) => {
    srno++;
    // Surcharge: 10% of TDS if projected annual income > ₹50L (simplified — show 0 if no surcharge flag)
    const surcharge   = 0; // Surcharge computed during TDS calculation; show 0 here unless stored
    // Education Cess: 4% of (TDS + Surcharge)
    const eduCess     = Math.round((entry.totalTds + surcharge) * 0.04);
    const totalTaxDep = entry.totalTds + surcharge + eduCess;

    grandIncome += entry.totalIncome;
    grandTds    += totalTaxDep;

    const row = sheet.addRow([
      srno,
      entry.pan,
      entry.name,
      entry.totalIncome,
      entry.totalTds,
      surcharge,
      eduCess,
      totalTaxDep,
    ]);

    row.font = { size: 9, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    for (const col of [4, 5, 6, 7, 8]) {
      row.getCell(col).numFmt = '₹#,##0';
    }

    if (entry.pan === 'N/A') {
      row.getCell(2).font = { color: { argb: RED }, size: 9, italic: true };
    }

    if (srno % 2 === 0) {
      for (let c = 1; c <= 8; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F5F3FF' } };
      }
    }
  });

  // Totals row
  const totalsRow = sheet.addRow([
    '', `TOTAL: ${srno} employees`, '',
    grandIncome, grandTds, '', '', grandTds,
  ]);
  totalsRow.font = { bold: true, size: 11 };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EDE9FE' } };
  });
  totalsRow.getCell(4).numFmt = '₹#,##0';
  totalsRow.getCell(5).numFmt = '₹#,##0';
  totalsRow.getCell(8).numFmt = '₹#,##0';
  totalsRow.getCell(8).font = { bold: true, color: { argb: '7C3AED' }, size: 11 };

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + srno, column: 8 },
  };

  // Notes section
  sheet.addRow([]);
  const notesTitle = sheet.addRow(['NOTES — Form 24Q TDS Return Filing Instructions']);
  sheet.mergeCells(notesTitle.number, 1, notesTitle.number, 8);
  notesTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  notesTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '7C3AED' } };
  notesTitle.height = 22;

  const notes: [string, string][] = [
    ['PAN', 'Permanent Account Number — mandatory for TDS filing. Employees without PAN attract higher TDS (20% flat rate).'],
    ['TOTAL_INCOME_QUARTER', 'Sum of gross salary paid during the quarter. Used for income projection.'],
    ['TDS_DEDUCTED', 'Total TDS deducted from employee salary during the quarter.'],
    ['SURCHARGE', '10% of TDS for income > ₹50 Lakh/year. Currently shown as 0 — override manually if applicable.'],
    ['EDUCATION_CESS', '4% of (TDS + Surcharge). Also called "Health & Education Cess" under new tax regime.'],
    ['TOTAL_TAX_DEPOSITED', 'TDS + Surcharge + Education Cess. This is the amount remitted to Income Tax Dept via challan.'],
    ['Due Dates', 'Q1: 31 Jul | Q2: 31 Oct | Q3: 31 Jan | Q4: 31 May'],
    ['Filing', 'Prepare Form 24Q using TRACES/RPU software. This Excel is a summary reference — use RPU for actual e-filing.'],
    ['Challan', 'Deposit TDS via Challan 281 at bank or online (TIN NSDL). Reference CIN while filing 24Q.'],
  ];

  for (const [col, desc] of notes) {
    const r = sheet.addRow([col, desc]);
    sheet.mergeCells(r.number, 2, r.number, 8);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '7C3AED' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F5F3FF' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 7: Payroll Import Template ──────────────────────────────────────

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
