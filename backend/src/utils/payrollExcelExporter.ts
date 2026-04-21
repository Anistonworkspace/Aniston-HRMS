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
  const xlsxPassword = `ANI-${monthNames[run.month - 1]}`;

  // ===== SHEET 1: Payroll Summary =====
  const summarySheet = workbook.addWorksheet('Payroll Summary', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  summarySheet.addRow([`${orgName} — Payroll Report`]);
  summarySheet.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  summarySheet.mergeCells(1, 1, 1, 17);

  summarySheet.addRow([
    `Period: ${periodLabel}`, '', `Status: ${run.status}`, '',
    `Processed: ${run.processedAt ? new Date(run.processedAt).toLocaleDateString('en-IN') : 'N/A'}`,
    '', `Employees: ${records.filter((r: any) => !r.employee?.isSystemAccount).length}`,
  ]);
  summarySheet.getRow(2).font = { size: 10, color: { argb: GRAY } };

  const headers = [
    '#', 'Emp Code', 'Employee Name', 'Department',
    'Working Days', 'Present', 'LOP Days',
    'Basic', 'Other Earnings', 'Gross Salary',
    'EPF (Emp)', 'ESI (Emp)', 'Prof Tax', 'TDS', 'LOP Ded.',
    'Total Deductions', 'Net Salary',
  ];

  const headerRow = summarySheet.addRow(headers);
  styleHeaderRow(headerRow);

  [5, 12, 24, 16, 11, 8, 8, 13, 13, 14, 11, 11, 9, 11, 11, 15, 14].forEach((w, i) => {
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

    // For custom-component employees, Basic cell shows blank when the employee
    // genuinely has no Basic component (earningsBreakdown exists but doesn't include it).
    const eb: Record<string, number> = rec.earningsBreakdown || {};
    const hasEb = Object.keys(eb).length > 0;
    const hasBasicComp = !hasEb || 'Basic' in eb || 'Basic Salary' in eb;
    const basicCell    = hasBasicComp ? n(rec.basic) : '';

    const row = summarySheet.addRow([
      idx + 1,
      t(rec.employee?.employeeCode),
      t(empName) === 'N/A' ? 'N/A' : empName,
      t(rec.employee?.department?.name),
      rec.workingDays ?? 'N/A',
      rec.presentDays ?? 'N/A',
      rec.lopDays ?? 0,
      basicCell,
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

    // Currency format for money columns (8-17)
    for (const col of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
      row.getCell(col).numFmt = '₹#,##0';
    }

    row.getCell(17).font = { bold: true, size: 10, color: { argb: GREEN } };

    if (n(rec.lopDays) > 0) {
      row.getCell(7).font  = { bold: true, color: { argb: RED }, size: 9 };
      row.getCell(15).font = { bold: true, color: { argb: RED }, size: 9 };
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
    '', '', totalGross,
    '', '', '', '', '',
    totalDeductions, totalNet,
  ]);
  totalsRow.font = { bold: true, size: 11, name: 'Calibri' };
  totalsRow.getCell(10).numFmt = '₹#,##0';
  totalsRow.getCell(16).numFmt = '₹#,##0';
  totalsRow.getCell(17).numFmt = '₹#,##0';
  totalsRow.getCell(17).font = { bold: true, size: 12, color: { argb: GREEN } };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });

  summarySheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + filteredRecords.length, column: headers.length },
  };

  // ── Legend: Column Guide ──────────────────────────────────────────────────
  summarySheet.addRow([]);
  const lgTitle = summarySheet.addRow(['📋  COLUMN GUIDE — What each column means']);
  summarySheet.mergeCells(lgTitle.number, 1, lgTitle.number, 17);
  lgTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  lgTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  lgTitle.height = 22;

  const colGuide: [string, string][] = [
    ['Working Days',      'Total Mon–Sat days in the month (Sundays not counted). Shorter if employee joined or left mid-month.'],
    ['Present',           'Days clocked in. Half-day = 0.5. Sundays worked appear as "Sunday Bonus" in Other Earnings.'],
    ['LOP Days',          'Loss of Pay days = Explicit ABSENT + Half-day×0.5 + Implicit no-show on working day + Unpaid leave.'],
    ['Basic',             'Pro-rated basic salary = (Annual CTC ÷ 12) × Basic% × (Emp Working Days ÷ Total Working Days).'],
    ['Other Earnings',    'Sum of all other earning components — HRA, DA, Sunday Bonus, adjustments, etc.'],
    ['Gross Salary',      'Basic + Other Earnings. This is before any deductions.'],
    ['EPF (Emp)',         'Employee EPF = 12% × Basic, capped at ₹1,800/month (Indian statutory ceiling: 12% × ₹15,000).'],
    ['ESI (Emp)',         'Employee ESI = 0.75% × Gross (only if Gross ≤ ₹21,000). Currently component-master driven (shown if configured).'],
    ['Prof Tax',          'Professional Tax per state slab. Currently component-master driven (shown if configured).'],
    ['TDS',               'Monthly TDS = Projected annual income tax ÷ remaining months in financial year.'],
    ['LOP Ded.',          'LOP Deduction = (Gross ÷ Working Days) × LOP Days. Capped so Net Salary never goes below ₹0.'],
    ['Total Deductions',  'EPF + ESI + Prof Tax + TDS + Custom Deductions + LOP Deduction.'],
    ['Net Salary',        'Gross Salary − Total Deductions. This is the amount transferred to the employee\'s bank account.'],
  ];

  for (const [col, desc] of colGuide) {
    const r = summarySheet.addRow(['', col, desc]);
    summarySheet.mergeCells(r.number, 3, r.number, 17);
    r.getCell(2).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '1E3A8A' } };
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    r.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(3).font = { size: 9, name: 'Calibri' };
    r.getCell(3).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  summarySheet.addRow([]);
  const fTitle = summarySheet.addRow(['🧮  PAYROLL FORMULA SUMMARY — How salary is calculated']);
  summarySheet.mergeCells(fTitle.number, 1, fTitle.number, 17);
  fTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  fTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '065F46' } };
  fTitle.height = 22;

  const formulas: string[] = [
    'Pro-ration Ratio  =  Employee Working Days ÷ Total Working Days in Month  (1.0 for full-month employees)',
    'Gross Salary  =  Each component value × Pro-ration Ratio  (e.g. Basic = Annual CTC × 50% ÷ 12 × Ratio)',
    'LOP Days  =  Explicit ABSENT + Half-day×0.5 + Working day with no attendance record + Unpaid ON_LEAVE record',
    'Daily Rate  =  Gross Salary ÷ Employee Working Days  (not Total Working Days)',
    'LOP Deduction  =  Daily Rate × LOP Days   [Capped so Net ≥ ₹0]',
    'EPF Employee  =  12% × Actual Basic   (capped at 12% × ₹15,000 = ₹1,800/month — Indian statutory)',
    'EPF Employer  =  12% × Actual Basic   (same cap — shown in Employer Cost sheet)',
    'Net Salary  =  Gross − EPF(Employee) − ESI(Employee) − Prof Tax − TDS − Custom Deductions − LOP Deduction',
    'Sunday Rule  =  Sundays are PAID weekly off. Only Mon–Sat absences count as LOP. Working on Sunday = extra bonus.',
    'Mid-month Joiner  =  Effective period starts from Onboarding Date. Working days and salary counted from that date only.',
    'Mid-month Exit  =  Effective period ends on Last Working Date. Salary prorated to that date.',
  ];

  for (const f of formulas) {
    const r = summarySheet.addRow(['→', '', f]);
    summarySheet.mergeCells(r.number, 2, r.number, 17);
    r.getCell(1).font = { bold: true, color: { argb: GREEN }, size: 11 };
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } };
    r.height = 18;
  }

  await summarySheet.protect(xlsxPassword, {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true,
  });

  // ===== SHEET 2: Earnings Breakdown =====
  const ebSheet = workbook.addWorksheet('Earnings Breakdown', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Collect all unique earning component names across all records (fully dynamic)
  const allCompNames = new Set<string>();
  filteredRecords.forEach((rec: any) => {
    const eb: Record<string, number> = rec.earningsBreakdown || {};
    Object.keys(eb).forEach(k => allCompNames.add(k));
  });
  // Only exclude internal metadata key — all real components (Basic, HRA, custom) are dynamic columns
  const compNames = [...allCompNames]
    .filter(k => k !== '_proRation')
    .sort((a, b) => {
      // Basic-named components always appear first
      const aIsBasic = a.toLowerCase().includes('basic');
      const bIsBasic = b.toLowerCase().includes('basic');
      if (aIsBasic && !bIsBasic) return -1;
      if (!aIsBasic && bIsBasic) return 1;
      return a.localeCompare(b);
    });

  ebSheet.columns = [
    { header: 'Emp Code', key: 'code', width: 12 },
    { header: 'Employee Name', key: 'name', width: 24 },
    ...compNames.map(c => ({ header: c, key: `eb_${c}`, width: 16 })),
    { header: 'Total Gross', key: 'gross', width: 14 },
    { header: 'Net Salary', key: 'net', width: 14 },
  ];
  styleHeaderRow(ebSheet.getRow(1));

  filteredRecords.forEach((rec: any) => {
    const eb: Record<string, number> = rec.earningsBreakdown || {};
    const rowData: any = {
      code: t(rec.employee?.employeeCode),
      name: `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A',
      gross: n(rec.grossSalary),
      net: n(rec.netSalary),
    };
    // Each component column: blank when this employee has no such component
    compNames.forEach(c => { rowData[`eb_${c}`] = c in eb ? n(eb[c]) : ''; });
    const row = ebSheet.addRow(rowData);
    row.font = { size: 9 };
    // Currency format for all numeric columns (starting from col 3)
    for (let col = 3; col <= ebSheet.columnCount; col++) {
      row.getCell(col).numFmt = '₹#,##0';
    }
    row.getCell(ebSheet.columnCount).font = { bold: true, color: { argb: GREEN }, size: 10 };
  });

  await ebSheet.protect(xlsxPassword, {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true,
  });

  // ===== SHEET 3: Deductions Breakdown =====
  const dedSheet = workbook.addWorksheet('Deductions Breakdown', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Collect all unique custom-deduction component names from deductionsBreakdown
  const allDedNames = new Set<string>();
  filteredRecords.forEach((rec: any) => {
    const db: Record<string, number> = rec.deductionsBreakdown || {};
    Object.keys(db).forEach(k => allDedNames.add(k));
  });
  const dedNames = [...allDedNames].sort();

  dedSheet.columns = [
    { header: 'Emp Code', key: 'code', width: 12 },
    { header: 'Employee Name', key: 'name', width: 24 },
    // Dynamic custom deduction columns
    ...dedNames.map(d => ({ header: d, key: `ded_${d}`, width: 16 })),
    // Statutory deductions (fixed columns)
    { header: 'EPF (Emp)', key: 'epfEe', width: 12 },
    { header: 'ESI (Emp)', key: 'esiEe', width: 12 },
    { header: 'Prof Tax', key: 'pt', width: 11 },
    { header: 'TDS', key: 'tds', width: 11 },
    { header: 'LOP Ded.', key: 'lop', width: 12 },
    { header: 'Total Deductions', key: 'totalDed', width: 16 },
    { header: 'Net Salary', key: 'net', width: 14 },
  ];
  styleHeaderRow(dedSheet.getRow(1), RED);

  filteredRecords.forEach((rec: any) => {
    const db: Record<string, number> = rec.deductionsBreakdown || {};
    const totalDed =
      n(rec.epfEmployee) + n(rec.esiEmployee) +
      n(rec.professionalTax) + n(rec.tds) + n(rec.lopDeduction) +
      dedNames.reduce((s, k) => s + n(db[k]), 0);

    const rowData: any = {
      code: t(rec.employee?.employeeCode),
      name: `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim() || 'N/A',
      epfEe: n(rec.epfEmployee),
      esiEe: n(rec.esiEmployee),
      pt: n(rec.professionalTax),
      tds: n(rec.tds),
      lop: n(rec.lopDeduction),
      totalDed,
      net: n(rec.netSalary),
    };
    // Custom deduction columns — blank when this employee has no such component
    dedNames.forEach(k => { rowData[`ded_${k}`] = k in db ? n(db[k]) : ''; });

    const row = dedSheet.addRow(rowData);
    row.font = { size: 9 };
    // Currency format for all numeric columns starting at col 3
    for (let col = 3; col <= dedSheet.columnCount; col++) {
      row.getCell(col).numFmt = '₹#,##0';
    }
    // Highlight total-deductions cell in red, net in green
    row.getCell(dedSheet.columnCount - 1).font = { bold: true, color: { argb: RED }, size: 10 };
    row.getCell(dedSheet.columnCount).font = { bold: true, color: { argb: GREEN }, size: 10 };
  });

  // ── Legend: Deductions explained ─────────────────────────────────────────
  dedSheet.addRow([]);
  const dedLgTitle = dedSheet.addRow(['📋  DEDUCTIONS GUIDE']);
  dedLgTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  dedLgTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
  const dedLgColCount = dedSheet.columnCount;
  if (dedLgColCount > 1) dedSheet.mergeCells(dedLgTitle.number, 1, dedLgTitle.number, dedLgColCount);
  dedLgTitle.height = 22;

  const dedGuide: [string, string][] = [
    ['EPF (Employee)',   '12% of Basic Salary, capped at ₹1,800/month (wage ceiling ₹15,000). Deducted from employee salary.'],
    ['EPF (Employer)',   '12% of Basic Salary (same cap). Paid BY the company — shown in Employer Cost sheet, not deducted from employee.'],
    ['ESI (Employee)',   '0.75% of Gross Salary. Applicable only if Gross ≤ ₹21,000/month. Currently component-master driven.'],
    ['Prof Tax',        'Professional Tax — state-specific slab. E.g. Maharashtra: ₹200/month for salary > ₹10,000. Currently component-master driven.'],
    ['TDS',             'Tax Deducted at Source. Computed monthly = Projected Annual Tax ÷ Remaining Months in Financial Year (Apr–Mar).'],
    ['LOP Ded.',        'Loss of Pay Deduction = (Gross ÷ Working Days) × LOP Days. Capped so employee never owes money to company.'],
    ['Custom Deductions','Any non-statutory components configured as DEDUCTION type in Settings → Salary Components.'],
  ];

  for (const [col, desc] of dedGuide) {
    const r = dedSheet.addRow([col, desc]);
    if (dedLgColCount > 1) dedSheet.mergeCells(r.number, 2, r.number, dedLgColCount);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: RED } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  await dedSheet.protect(xlsxPassword, {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true,
  });

  // ===== SHEET 4: Employer Cost =====
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

  await costSheet.protect(xlsxPassword, {
    selectLockedCells: true, selectUnlockedCells: true,
    autoFilter: true, sort: true,
  });

  // ===== SHEET 5: Formula Guide =====
  const guideSheet = workbook.addWorksheet('Formula Guide', {
    views: [{}],
  });

  guideSheet.getColumn(1).width = 30;
  guideSheet.getColumn(2).width = 80;

  const addGuideSection = (title: string, color: string, rows: [string, string][]) => {
    const titleRow = guideSheet.addRow([title]);
    guideSheet.mergeCells(titleRow.number, 1, titleRow.number, 2);
    titleRow.font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    titleRow.height = 24;
    for (const [label, value] of rows) {
      const r = guideSheet.addRow([label, value]);
      r.getCell(1).font = { bold: true, size: 9, name: 'Calibri' };
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      r.getCell(2).font = { size: 9, name: 'Calibri' };
      r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
      r.height = 20;
    }
    guideSheet.addRow([]);
  };

  const headingRow = guideSheet.addRow([`${orgName} — Payroll Formula Guide — ${periodLabel}`]);
  guideSheet.mergeCells(1, 1, 1, 2);
  headingRow.font = { bold: true, size: 14, color: { argb: BRAND } };
  headingRow.height = 28;
  guideSheet.addRow(['This sheet explains every formula and rule used to compute payroll. Share with HR for reference.']);
  guideSheet.mergeCells(2, 1, 2, 2);
  guideSheet.getRow(2).font = { italic: true, size: 10, color: { argb: GRAY } };
  guideSheet.addRow([]);

  addGuideSection('STEP 1 — PRO-RATION (Partial Month Salary)', BRAND, [
    ['Who gets pro-rated?', 'Employees who join or exit mid-month. Full-month employees get Pro-ration = 1.0.'],
    ['Pro-ration Ratio', 'Employee Working Days ÷ Total Working Days in Month'],
    ['Employee Working Days', 'Mon–Sat days from Onboarding Date (or Joining Date) to Last Working Date (or month end).'],
    ['Total Working Days', `Total Mon–Sat working days in the month, excluding org holidays. For ${periodLabel}: count of Mon–Sat days.`],
    ['Example', 'Employee joins Apr 16 → Effective days = Apr 16–30 (Mon–Sat only). If that = 13 days and April has 26 working days → Ratio = 13/26 = 0.50'],
    ['Gross after pro-ration', 'Each salary component value is multiplied by the Pro-ration Ratio before any deductions.'],
  ]);

  addGuideSection('STEP 2 — EARNINGS (Salary Components)', '065F46', [
    ['Basic Salary', 'Configured as % of CTC in Settings → Salary Components. E.g. 50% of ₹2,00,000/yr = ₹8,333/month (after ÷12).'],
    ['HRA', 'House Rent Allowance — % of Basic or fixed amount. Configured in component master.'],
    ['Custom Components', 'Any EARNING components HR added in Settings → Salary Components (DA, TA, Medical Allow., etc.).'],
    ['Gross Salary', 'Sum of ALL earning components after pro-ration.'],
    ['Daily Rate', 'Gross Salary ÷ Employee Working Days. Used for LOP calculation only.'],
    ['Sunday Bonus', 'If employee works on Sunday (paid day off), they earn 1 extra day\'s pay (Daily Rate × sundays worked).'],
    ['Adjustment (Earning)', 'One-off additions — bonus, incentive, arrear. Added to gross before deductions.'],
  ]);

  addGuideSection('STEP 3 — LOP (Loss of Pay Calculation)', RED, [
    ['What is LOP?', 'Salary deducted for days employee did not work and has no approved paid leave or holiday.'],
    ['Layer 1 — Explicit ABSENT', 'Attendance records marked ABSENT (not covered by paid leave or holiday) = 1 LOP day each.'],
    ['Layer 2 — Half Day', 'Attendance records marked HALF_DAY (not covered by paid leave) = 0.5 LOP day each.'],
    ['Layer 3 — Implicit no-show', 'Working days (Mon–Sat) within the effective period with NO attendance record at all = 1 LOP day each.'],
    ['Layer 4 — Unpaid ON_LEAVE', 'ON_LEAVE attendance not matched to an approved paid leave balance = 1 LOP day each.'],
    ['What is NOT LOP?', 'Sundays, Public holidays, Approved paid leave days — these never reduce salary.'],
    ['LOP Deduction Formula', 'LOP Deduction = Daily Rate × Total LOP Days'],
    ['LOP Cap', 'LOP is capped so Net Salary ≥ ₹0. Employee can never owe money to the company.'],
    ['Example', 'Gross ₹16,667 | Working Days 26 | LOP 10 → Daily Rate = ₹641 | LOP Ded = ₹6,411 | Net = ₹16,667 − ₹1,800(EPF) − ₹6,411 = ₹8,456'],
  ]);

  addGuideSection('STEP 4 — STATUTORY DEDUCTIONS (EPF, ESI, PT, TDS)', '78350F', [
    ['EPF Employee', '12% × Basic Salary. Statutory wage ceiling = ₹15,000 → Max EPF = 12% × ₹15,000 = ₹1,800/month.'],
    ['EPF Employer', '12% × Basic Salary (same cap). This is a company cost — does NOT reduce employee take-home. See Employer Cost sheet.'],
    ['When EPF < ₹1,800', 'If Basic < ₹15,000 (e.g. mid-month joiner with pro-rated basic), EPF = 12% × actual basic (no cap needed).'],
    ['ESI Employee', '0.75% × Gross Salary. Only applies if Gross ≤ ₹21,000/month. Currently component-master driven.'],
    ['ESI Employer', '3.25% × Gross Salary. Company cost. Currently component-master driven.'],
    ['Professional Tax', 'Fixed slab per state (e.g. Maharashtra ₹200/month for salary > ₹10,000). Currently component-master driven.'],
    ['TDS', 'Projected Annual Tax (based on CTC and regime) ÷ Remaining Financial Year Months. Re-projected each month.'],
    ['Tax Regime', 'Employee can choose OLD or NEW regime. Regime affects TDS computation only.'],
    ['Exemption Flags', 'HR can mark individual employees as EPF Exempt / ESI Exempt / PT Exempt on their profile.'],
  ]);

  addGuideSection('STEP 5 — FINAL CALCULATION', '4338CA', [
    ['Net Salary Formula', 'Net = Gross − EPF(Emp) − ESI(Emp) − Prof Tax − TDS − Custom Deductions − LOP Deduction'],
    ['Adjustment (Deduction)', 'One-off deductions (loan recovery, advance recovery) subtracted before LOP cap.'],
    ['Order of operations', '1. Compute Gross | 2. Compute all deductions except LOP | 3. Compute LOP (daily rate × LOP days) | 4. Cap LOP | 5. Net = Gross − all deductions'],
    ['Bank Transfer', 'Net Salary amount is what goes in the Bank Transfer sheet for NEFT/RTGS payment.'],
  ]);

  addGuideSection('ATTENDANCE RULES (Sunday & Holiday Policy)', '0369A1', [
    ['Working Days (Mon–Sat)', 'Your org is configured Mon–Sat. Only these days count for LOP or Present calculations.'],
    ['Sunday', 'PAID weekly off. Employee always gets paid for Sundays — no attendance needed. Sunday absence = no penalty.'],
    ['Sunday worked', 'If employee clocks in on Sunday, a Sunday Bonus (1 day pay) is added to earnings.'],
    ['Public Holiday', 'Org holidays (added in Settings → Holidays) are PAID off-days — not LOP, not deducted.'],
    ['Half Day', 'HALF_DAY attendance = 0.5 present day + 0.5 LOP. Covered if paired with half-day paid leave.'],
    ['Paid Leave', 'Approved leave requests against paid leave balance = no LOP deduction for those days.'],
    ['Unpaid Leave', 'Leave requests not backed by leave balance = ON_LEAVE attendance = LOP.'],
  ]);

  addGuideSection('EXCEL SHEET GUIDE', '374151', [
    ['Sheet 1 — Payroll Summary', 'Master view: all employees, all columns, totals. Use this for monthly review and sign-off.'],
    ['Sheet 2 — Earnings Breakdown', 'Per-employee breakdown of every earning component (Basic, HRA, custom components, bonuses).'],
    ['Sheet 3 — Deductions Breakdown', 'Per-employee breakdown of every deduction (EPF, ESI, PT, TDS, LOP, custom deductions).'],
    ['Sheet 4 — Employer Cost', 'Total company cost = Gross + Employer EPF + Employer ESI. Use for budget planning.'],
    ['Sheet 5 — Formula Guide', 'This sheet. Payroll methodology reference for HR and Finance.'],
    ['Password', `All sheets are password-protected. Password: ${xlsxPassword}`],
  ]);

  await guideSheet.protect(xlsxPassword, {
    selectLockedCells: true, selectUnlockedCells: true,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Export 2: Attendance Salary Excel ──────────────────────────────────────

/**
 * Generate attendance-salary summary Excel.
 *
 * Column layout (13 cols):
 *   Employee Name | Emp Code | Working Days (Mon–Sat) | Sundays (Paid) | Paid Holidays
 *   | Present Days | Half Days | Paid Leave | Absent / LOP Days | Total Paid Days
 *   | LOP Deduction Days | Formula Check | Comments
 *
 * Total Paid Days = Present + (Half × 0.5) + Paid Leave + Sundays + Paid Holidays
 * (additive formula — avoids rounding error caused by integer-stored lopDays)
 */
export async function generateAttendanceSalaryExcel(
  run: any,
  records: any[],
  leaveData: Array<{ employeeId: string; providedL: number; leavesBalance: number; paidLeaveDays: number }>,
  attendanceDetails: Array<{ employeeId: string; presentCount: number; absentCount: number; halfDayCount: number }>,
  orgHolidays: Array<{ date: Date | string }>,   // full month holiday list — filtered per employee below
  orgName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const periodLabel = `${monthNames[run.month - 1]} ${run.year}`;

  const NUM_COLS = 13;

  // Derive full-month paid-holiday count (for header display) and working-day numbers
  // from the orgHolidays array passed in.
  const WORKING_DAYS = new Set([1, 2, 3, 4, 5, 6]); // Mon–Sat; adjust if org differs
  const paidHolidaysFullMonth = orgHolidays.filter(h => {
    const dow = new Date(h.date).getDay();
    return dow !== 0; // exclude Sundays — those are paid week-offs, counted separately
  }).length;

  const sheet = workbook.addWorksheet('Attendance Salary', {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Title
  sheet.addRow([`${orgName} — Attendance Salary Report — ${periodLabel}`]);
  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND } };
  sheet.mergeCells(1, 1, 1, NUM_COLS);
  sheet.getRow(1).height = 24;

  sheet.addRow([
    `Total Paid Days = Present + Half×0.5 + Paid Leave + Sundays + Holidays  |  `
    + `LOP = working days with no attendance (not on leave / holiday)  |  `
    + `Period: ${periodLabel}  |  Paid Holidays this month: ${paidHolidaysFullMonth}`,
  ]);
  sheet.getRow(2).font = { italic: true, size: 9, color: { argb: GRAY } };
  sheet.mergeCells(2, 1, 2, NUM_COLS);

  const DARK_BLUE = '1E3A8A';
  const headers = [
    'Employee Name', 'Emp Code',
    'Working Days\n(Mon–Sat)', 'Sundays\n(Paid Week-off)', 'Paid\nHolidays',
    'Present\nDays', 'Half\nDays', 'Paid Leave\nDays',
    'Absent /\nLOP Days', 'Total Paid\nDays',
    'LOP Deduction\nDays (payroll)', 'Formula\nCheck', 'Comments',
  ];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, DARK_BLUE);

  [26, 13, 15, 16, 12, 12, 10, 13, 14, 13, 18, 14, 28].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const leaveMap = new Map(leaveData.map((d) => [d.employeeId, d]));
  const attMap   = new Map(attendanceDetails.map((d) => [d.employeeId, d]));

  let totWorkDays = 0, totSundays = 0, totHolidays = 0;
  let totPresent = 0, totHalf = 0, totPaidLeave = 0, totAbsent = 0;
  let totPaidDays = 0, totLopDedDays = 0;

  const attFilteredRecords = (records as any[]).filter((r: any) => !r.employee?.isSystemAccount);

  if (attFilteredRecords.length === 0) {
    const noDataRow = sheet.addRow(Array(NUM_COLS).fill('N/A'));
    (noDataRow.getCell(1) as any).value = 'No attendance/payroll records — process payroll first';
    noDataRow.font = { italic: true, color: { argb: GRAY }, size: 10 };
    noDataRow.getCell(1).alignment = { horizontal: 'left' };
  }

  attFilteredRecords.forEach((rec: any, rowIdx: number) => {
    const ld  = leaveMap.get(rec.employeeId) || { providedL: 0, leavesBalance: 0, paidLeaveDays: 0 };
    const att = attMap.get(rec.employeeId)   || { presentCount: 0, absentCount: 0, halfDayCount: 0 };

    const workingDays = n(rec.workingDays); // Mon-Sat days in employee's effective period

    // Compute effective period for this employee (mirrors payroll service logic)
    const startOfMonth = new Date(run.year, run.month - 1, 1);
    const endOfMonth   = new Date(run.year, run.month, 0);
    let effStart = new Date(startOfMonth);
    let effEnd   = new Date(endOfMonth);
    const joiningDate     = rec.employee?.joiningDate     ? new Date(rec.employee.joiningDate)     : null;
    const onboardingDate  = rec.employee?.onboardingDate  ? new Date(rec.employee.onboardingDate)  : null;
    const lastWorkingDate = rec.employee?.lastWorkingDate ? new Date(rec.employee.lastWorkingDate) : null;
    // Mirror payroll logic: use onboardingDate (HRMS date) for pro-ration, fall back to joiningDate
    const payrollStartDate = onboardingDate ?? joiningDate;
    if (payrollStartDate && payrollStartDate > startOfMonth && payrollStartDate <= endOfMonth) effStart = new Date(payrollStartDate);
    if (lastWorkingDate && lastWorkingDate >= startOfMonth && lastWorkingDate < endOfMonth) effEnd = new Date(lastWorkingDate);
    // Paid holidays scoped to this employee's effective period only.
    // A mid-month joiner (e.g. Apr 16) must NOT get credit for Apr 10 holiday.
    // Must be computed BEFORE sundaysCount so we can subtract holidays from the remainder.
    const paidHolidays = orgHolidays.filter(h => {
      const d = new Date(h.date);
      return d.getDay() !== 0 && d >= effStart && d <= effEnd;
    }).length;

    // Sundays = effectiveCalDays − workingDays(Mon-Sat excl. holidays) − paidHolidays.
    // Without subtracting paidHolidays, each holiday would be counted TWICE:
    // once inside sundaysCount (as a "non-working day") and once in paidHolidays.
    const effectiveCalDays = Math.round((effEnd.getTime() - effStart.getTime()) / 86400000) + 1;
    const sundaysCount = Math.max(0, effectiveCalDays - workingDays - paidHolidays);

    const presentDays  = n(rec.presentDays);  // from payroll record — includes 0.5 per half-day
    const halfDays     = att.halfDayCount;    // raw HALF_DAY record count (display only)
    const paidLeave    = n(ld.paidLeaveDays); // approved paid leave days
    const absentDays   = att.absentCount;     // explicit + implicit no-show LOP days
    const lopDedDays   = n(rec.lopDays);      // total LOP stored for payroll deduction

    // Total paid days: additive formula.
    // presentDays already includes 0.5 per half-day (stored by payroll service as a Decimal).
    // Do NOT add halfDays * 0.5 separately — that would double-count every half-day.
    const totalPaidDays = Math.max(0,
      presentDays + paidLeave + sundaysCount + paidHolidays
    );

    // Cross-check: present + paidLeave + LOP must equal working days.
    // presentDays already includes the half-day contribution (0.5 per half-day),
    // so again do NOT add halfDays * 0.5 here — it is already inside presentDays.
    const formulaCheck = presentDays + paidLeave + lopDedDays;
    const formulaOk    = Math.abs(formulaCheck - workingDays) <= 1
      ? '✓' : `Check: ${formulaCheck} vs ${workingDays}`;

    totWorkDays   += workingDays;
    totSundays    += sundaysCount;
    totHolidays   += paidHolidays;
    totPresent    += presentDays;
    totHalf       += halfDays;
    totPaidLeave  += paidLeave;
    totAbsent     += absentDays;
    totPaidDays   += totalPaidDays;
    totLopDedDays += lopDedDays;

    const empName = `${rec.employee?.firstName || ''} ${rec.employee?.lastName || ''}`.trim();

    const row = sheet.addRow([
      t(empName),
      t(rec.employee?.employeeCode),
      workingDays,
      sundaysCount,
      paidHolidays,
      presentDays,
      halfDays,
      paidLeave,
      absentDays,
      totalPaidDays,
      lopDedDays,
      formulaOk,
      '', // Comments — blank for HR to fill
    ]);

    row.font = { size: 10, name: 'Calibri' };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };

    // Col positions: WorkDays=3, Sundays=4, Holidays=5, Present=6, Half=7,
    //               PaidLeave=8, Absent=9, TotalPaid=10, LopDed=11, Check=12
    if (absentDays > 0) { row.getCell(9).font  = { bold: true, color: { argb: RED }, size: 10 }; }
    if (halfDays > 0)   { row.getCell(7).font  = { bold: true, color: { argb: 'D97706' }, size: 10 }; }
    if (paidLeave > 0)  { row.getCell(8).font  = { bold: true, color: { argb: GREEN }, size: 10 }; }
    if (paidHolidays > 0) { row.getCell(5).font = { bold: true, color: { argb: BRAND }, size: 10 }; }
    row.getCell(10).font = { bold: true, color: { argb: GREEN }, size: 10 };
    if (lopDedDays > 0) { row.getCell(11).font = { bold: true, color: { argb: RED }, size: 10 }; }
    row.getCell(4).font  = { color: { argb: BRAND }, size: 10 };

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
    `Total: ${attFilteredRecords.length} employees`, '',
    totWorkDays, totSundays, totHolidays,
    totPresent, totHalf, totPaidLeave, totAbsent,
    totPaidDays, totLopDedDays, '', '',
  ]);
  totalsRow.font = { bold: true, size: 11 };
  totalsRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
  });
  totalsRow.getCell(9).font  = { bold: true, color: { argb: RED },   size: 11 };
  totalsRow.getCell(10).font = { bold: true, color: { argb: GREEN }, size: 11 };
  totalsRow.getCell(11).font = { bold: true, color: { argb: RED },   size: 11 };

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + attFilteredRecords.length, column: NUM_COLS },
  };

  // ── Legend: Attendance column guide ─────────────────────────────────────
  sheet.addRow([]);
  const attLgTitle = sheet.addRow(['📋  ATTENDANCE COLUMN GUIDE — What each column means']);
  sheet.mergeCells(attLgTitle.number, 1, attLgTitle.number, NUM_COLS);
  attLgTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  attLgTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A8A' } };
  attLgTitle.height = 22;

  const attColGuide: [string, string][] = [
    ['Working Days (Mon–Sat)', 'Total Mon–Sat days in the employee\'s effective period. Shorter for mid-month joiners/exits. Sundays and holidays NOT included.'],
    ['Sundays (Paid Week-off)', 'Number of Sundays in the employee\'s effective period. Sundays are PAID — no attendance needed. Working on Sunday earns a bonus.'],
    ['Paid Holidays', 'Public holidays declared in Settings → Holidays, within the employee\'s effective period. Always paid — no LOP.'],
    ['Present Days', 'Days marked PRESENT in attendance. Half-day = 0.5. Does NOT include Sundays or holidays (those are auto-paid).'],
    ['Half Days', 'Raw count of HALF_DAY attendance records (for display). Each half-day = 0.5 in Present Days column.'],
    ['Paid Leave Days', 'Approved paid leave requests consumed from leave balance. These days are paid — not LOP.'],
    ['Absent / LOP Days', 'Days counted as Loss of Pay = Explicit ABSENT + Implicit no-show + Unpaid leave. Does not include Sundays or holidays.'],
    ['Total Paid Days', 'Present + Paid Leave + Sundays + Paid Holidays. This many days the employee earns salary for.'],
    ['LOP Deduction Days', 'Exact LOP days stored for payroll. Formula: LOP Ded = Daily Rate × this number.'],
    ['Formula Check', 'Verifies: Present + Paid Leave + LOP Days = Working Days. ✓ = balanced. Any other value = discrepancy.'],
    ['Comments', 'Blank column — HR can write notes for specific employees.'],
  ];

  const attLgCols = ['Column', 'Explanation'];
  const attLgHeaderRow = sheet.addRow(attLgCols);
  sheet.mergeCells(attLgHeaderRow.number, 2, attLgHeaderRow.number, NUM_COLS);
  attLgHeaderRow.font = { bold: true, size: 9, color: { argb: 'FFFFFF' } };
  attLgHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '374151' } };
  attLgHeaderRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '374151' } };
  attLgHeaderRow.height = 18;

  for (const [col, desc] of attColGuide) {
    const r = sheet.addRow([col, desc]);
    sheet.mergeCells(r.number, 2, r.number, NUM_COLS);
    r.getCell(1).font = { bold: true, size: 9, name: 'Calibri', color: { argb: '1E3A8A' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EFF6FF' } };
    r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.height = 20;
  }

  sheet.addRow([]);
  const attFormulaTitle = sheet.addRow(['🧮  KEY FORMULAS']);
  sheet.mergeCells(attFormulaTitle.number, 1, attFormulaTitle.number, NUM_COLS);
  attFormulaTitle.font = { bold: true, size: 11, color: { argb: 'FFFFFF' } };
  attFormulaTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  attFormulaTitle.height = 22;

  const attFormulas: string[] = [
    'Total Paid Days  =  Present Days + Paid Leave Days + Sundays + Paid Holidays',
    'LOP Days  =  Working Days − Present Days − Paid Leave Days   (must equal LOP Deduction Days)',
    'LOP Deduction  =  (Gross Salary ÷ Working Days) × LOP Days',
    'Formula Check  =  Present + Paid Leave + LOP = Working Days  →  ✓ means payroll is balanced',
    'Pro-ration  =  Working Days ÷ Total Month Working Days  (only for mid-month joiners/exits)',
  ];

  for (const f of attFormulas) {
    const r = sheet.addRow(['→', f]);
    sheet.mergeCells(r.number, 2, r.number, NUM_COLS);
    r.getCell(1).font = { bold: true, color: { argb: GREEN }, size: 11 };
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(2).font = { size: 9, name: 'Calibri' };
    r.getCell(2).alignment = { wrapText: true, horizontal: 'left', vertical: 'middle' };
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } };
    r.height = 18;
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
    const uan = t((rec.employee as any)?.epfUan || rec.employee?.panNumber || 'N/A');
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
