import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';

const BRAND = '4F46E5';
const GREEN = '059669';
const RED = 'DC2626';
const AMBER = 'D97706';
const BLUE = '2563EB';
const PURPLE = '7C3AED';
const GRAY = '6B7280';

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'D1FAE5',    // green-100
  ABSENT: 'FEE2E2',     // red-100
  HALF_DAY: 'FEF3C7',   // amber-100
  ON_LEAVE: 'EDE9FE',   // purple-100
  HOLIDAY: 'DBEAFE',    // blue-100
  WEEKEND: 'F3F4F6',    // gray-100
  WORK_FROM_HOME: 'CCFBF1', // teal-100
};

function styleHeaderRow(row: ExcelJS.Row, color: string = BRAND) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10, name: 'Calibri' };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: '000000' } } };
  });
  row.height = 30;
}

function fmtTime(date: Date | string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function fmtDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

// Returns today's date string in IST (YYYY-MM-DD) for accurate future-date detection.
function getISTTodayStr(): string {
  const n = new Date();
  const ist = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Generate colorful monthly attendance Excel for all employees
 */
export async function generateMonthlyAttendanceExcel(
  organizationId: string,
  month: number,
  year: number
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const daysInMonth = endDate.getDate();
  const monthName = startDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Fetch all employees
  const employees = await prisma.employee.findMany({
    where: { organizationId, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION'] }, isSystemAccount: { not: true } },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true,
      department: { select: { name: true } },
    },
    orderBy: [{ firstName: 'asc' }],
  });

  // Fetch attendance records for the month
  const records = await prisma.attendanceRecord.findMany({
    where: {
      employee: { organizationId, deletedAt: null },
      date: { gte: startDate, lte: endDate },
    },
    select: {
      employeeId: true, date: true, status: true, checkIn: true, checkOut: true,
      totalHours: true, geofenceViolation: true, workMode: true, lateMinutes: true,
    },
  });

  // Fetch holidays
  const holidays = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: startDate, lte: endDate } },
  });
  const holidayDates = new Set(holidays.map(h => new Date(h.date).toISOString().split('T')[0]));

  // Fetch org attendance policy for week-off days — used as fallback per employee
  const attendancePolicy = await prisma.attendancePolicy.findUnique({ where: { organizationId } });
  const orgWeekOffDays: number[] = (attendancePolicy?.weekOffDays as number[] | null)?.length
    ? (attendancePolicy!.weekOffDays as number[])
    : [0];
  // Org-level default set (used when employee has no shift assignment)
  const weekOffDaySet = new Set<number>(orgWeekOffDays);

  // Build per-employee weekOffDays from their active shift assignment
  const shiftAssignments = await prisma.shiftAssignment.findMany({
    where: {
      employeeId: { in: employees.map(e => e.id) },
      startDate: { lte: new Date(year, month, 0) },
      OR: [{ endDate: null }, { endDate: { gte: new Date(year, month - 1, 1) } }],
    },
    include: { shift: { select: { weekOffDays: true } } },
    orderBy: { startDate: 'desc' },
  });
  // Map employeeId → weekOffDaySet (most recent assignment wins)
  const empWeekOffMap = new Map<string, Set<number>>();
  for (const sa of shiftAssignments) {
    if (!empWeekOffMap.has(sa.employeeId)) {
      const wod = (sa.shift?.weekOffDays as number[] | null)?.length
        ? (sa.shift.weekOffDays as number[])
        : orgWeekOffDays;
      empWeekOffMap.set(sa.employeeId, new Set<number>(wod));
    }
  }

  // Build record map: employeeId → { dateStr → record }
  const recordMap = new Map<string, Map<string, any>>();
  for (const r of records) {
    if (!recordMap.has(r.employeeId)) recordMap.set(r.employeeId, new Map());
    const dateStr = new Date(r.date).toISOString().split('T')[0];
    recordMap.get(r.employeeId)!.set(dateStr, r);
  }

  // ===== SHEET 1: Monthly Summary =====
  const summarySheet = workbook.addWorksheet('Monthly Summary', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }],
  });

  // Title row
  const titleRow = summarySheet.addRow([`Attendance Report — ${monthName}`]);
  titleRow.font = { bold: true, size: 14, color: { argb: BRAND }, name: 'Calibri' };
  summarySheet.mergeCells(1, 1, 1, 9 + daysInMonth);
  titleRow.height = 35;

  // Header row
  const headers = ['#', 'Emp Code', 'Employee Name', 'Department'];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    const dayName = dt.toLocaleString('en-IN', { weekday: 'short' });
    headers.push(`${d}\n${dayName}`);
  }
  headers.push('Present', 'Late Days', 'Absent', 'Half Day', 'Leave', 'Holiday', 'WFH', 'Total Hours', 'Avg Hours');

  const headerRow = summarySheet.addRow(headers);
  styleHeaderRow(headerRow);

  // Set column widths
  summarySheet.getColumn(1).width = 5;
  summarySheet.getColumn(2).width = 12;
  summarySheet.getColumn(3).width = 22;
  summarySheet.getColumn(4).width = 16;
  for (let d = 1; d <= daysInMonth; d++) {
    summarySheet.getColumn(4 + d).width = 6;
  }
  for (let i = 0; i < 9; i++) {
    summarySheet.getColumn(5 + daysInMonth + i).width = 10;
  }

  const todayISTStr = getISTTodayStr();

  // Data rows
  employees.forEach((emp, idx) => {
    const empRecords = recordMap.get(emp.id) || new Map();
    const rowData: any[] = [idx + 1, emp.employeeCode, `${emp.firstName} ${emp.lastName}`, emp.department?.name || '-'];
    // Use employee's shift weekOffDays if available, else org default
    const empWodSet = empWeekOffMap.get(emp.id) ?? weekOffDaySet;

    let present = 0, absent = 0, halfDay = 0, onLeave = 0, holiday = 0, wfh = 0, totalHours = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      const record = empRecords.get(dateStr);
      const isHoliday = holidayDates.has(dateStr);
      const isFuture = dateStr > todayISTStr; // IST-aware: never mark today or past as future

      let cellValue = '';
      if (record) {
        switch (record.status) {
          case 'PRESENT': cellValue = 'P'; present++; totalHours += Number(record.totalHours || 0); break;
          case 'ABSENT': cellValue = 'A'; absent++; break;
          case 'HALF_DAY': cellValue = 'HD'; halfDay++; totalHours += Number(record.totalHours || 0); break;
          case 'ON_LEAVE': cellValue = 'L'; onLeave++; break;
          case 'WORK_FROM_HOME': cellValue = 'WFH'; wfh++; totalHours += Number(record.totalHours || 0); break;
          default: cellValue = record.status?.[0] || '-';
        }
      } else if (isHoliday) {
        cellValue = 'H'; holiday++;
      } else if (empWodSet.has(dayOfWeek)) {
        cellValue = 'W';
      } else if (!isFuture) {
        cellValue = 'A'; absent++;
      } else {
        cellValue = '';
      }
      rowData.push(cellValue);
    }

    const avgHours = present > 0 ? Math.round((totalHours / present) * 10) / 10 : 0;
    const monthRecords = [...empRecords.values()];
    const lateCount = monthRecords.filter(r => (r as any).lateMinutes > 0).length;
    rowData.push(present, lateCount, absent, halfDay, onLeave, holiday, wfh, Math.round(totalHours * 10) / 10, avgHours);

    const row = summarySheet.addRow(rowData);
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    row.font = { size: 9, name: 'Calibri' };

    // Color-code day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = row.getCell(4 + d);
      const val = String(cell.value || '');
      let bgColor = '';
      if (val === 'P') bgColor = STATUS_COLORS.PRESENT;
      else if (val === 'A') bgColor = STATUS_COLORS.ABSENT;
      else if (val === 'HD') bgColor = STATUS_COLORS.HALF_DAY;
      else if (val === 'L') bgColor = STATUS_COLORS.ON_LEAVE;
      else if (val === 'H') bgColor = STATUS_COLORS.HOLIDAY;
      else if (val === 'W') bgColor = STATUS_COLORS.WEEKEND;
      else if (val === 'WFH') bgColor = STATUS_COLORS.WORK_FROM_HOME;

      if (bgColor) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      }
      cell.font = { size: 8, bold: val === 'A', name: 'Calibri', color: { argb: val === 'A' ? RED : '000000' } };
    }

    // Color summary columns
    const presentCell = row.getCell(5 + daysInMonth);
    presentCell.font = { bold: true, color: { argb: GREEN }, size: 10 };
    const lateCell = row.getCell(6 + daysInMonth);
    lateCell.font = { bold: true, color: { argb: 'D97706' }, size: 10 };
    if (lateCount > 0) {
      lateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E2' } };
    }
    const absentCell = row.getCell(7 + daysInMonth);
    absentCell.font = { bold: true, color: { argb: RED }, size: 10 };

    // Alternate row shading
    if (idx % 2 === 1) {
      row.eachCell((cell, colNumber) => {
        if (colNumber <= 4 && !(cell.fill as any)?.fgColor) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F9FAFB' } };
        }
      });
    }
  });

  // Auto-filter
  summarySheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + employees.length, column: headers.length } };

  // Legend row
  const legendRow = summarySheet.addRow([]);
  summarySheet.addRow([]);
  const legendData = [
    { code: 'P', label: 'Present', color: STATUS_COLORS.PRESENT },
    { code: 'A', label: 'Absent', color: STATUS_COLORS.ABSENT },
    { code: 'HD', label: 'Half Day', color: STATUS_COLORS.HALF_DAY },
    { code: 'L', label: 'On Leave', color: STATUS_COLORS.ON_LEAVE },
    { code: 'H', label: 'Holiday', color: STATUS_COLORS.HOLIDAY },
    { code: 'W', label: 'Weekend', color: STATUS_COLORS.WEEKEND },
    { code: 'WFH', label: 'Work From Home', color: STATUS_COLORS.WORK_FROM_HOME },
  ];
  const lgRow = summarySheet.addRow(['Legend:', ...legendData.map(l => `${l.code} = ${l.label}`)]);
  lgRow.font = { size: 9, italic: true, color: { argb: GRAY } };

  // ===== SHEET 2: Detailed Records =====
  const detailSheet = workbook.addWorksheet('Detailed Records', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  detailSheet.columns = [
    { header: 'Emp Code', key: 'code', width: 12 },
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Department', key: 'dept', width: 16 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Day', key: 'day', width: 8 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Check In', key: 'checkIn', width: 12 },
    { header: 'Check Out', key: 'checkOut', width: 12 },
    { header: 'Total Hours', key: 'hours', width: 12 },
    { header: 'Work Mode', key: 'workMode', width: 14 },
    { header: 'Geofence', key: 'geofence', width: 12 },
  ];

  styleHeaderRow(detailSheet.getRow(1));

  for (const emp of employees) {
    const empRecords = recordMap.get(emp.id) || new Map();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dt = new Date(year, month - 1, d);
      const record = empRecords.get(dateStr);
      const dayName = dt.toLocaleString('en-IN', { weekday: 'short' });

      const row = detailSheet.addRow({
        code: emp.employeeCode,
        name: `${emp.firstName} ${emp.lastName}`,
        dept: emp.department?.name || '-',
        date: fmtDate(dt),
        day: dayName,
        status: record?.status || (holidayDates.has(dateStr) ? 'HOLIDAY' : (empWeekOffMap.get(emp.id) ?? weekOffDaySet).has(dt.getDay()) ? 'WEEKEND' : 'ABSENT'),
        checkIn: record?.checkIn ? fmtTime(record.checkIn) : '-',
        checkOut: record?.checkOut ? fmtTime(record.checkOut) : '-',
        hours: record?.totalHours ? Number(record.totalHours).toFixed(1) : '-',
        workMode: record?.workMode || '-',
        geofence: record?.geofenceViolation ? 'OUTSIDE' : record ? 'OK' : '-',
      });

      const statusVal = String(row.getCell('status').value);
      const bgColor = STATUS_COLORS[statusVal];
      if (bgColor) {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      }
      row.font = { size: 9, name: 'Calibri' };
    }
  }

  detailSheet.autoFilter = { from: 'A1', to: `K${1 + employees.length * daysInMonth}` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Generate attendance Excel for a single employee
 */
export async function generateEmployeeAttendanceExcel(
  employeeId: string,
  month: number,
  year: number
): Promise<Buffer> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      firstName: true, lastName: true, employeeCode: true,
      organizationId: true,
      department: { select: { name: true } },
    },
  });
  if (!employee) throw new Error('Employee not found');

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const monthName = startDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const [records, empHolidays, empPolicy] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: startDate, lte: endDate } },
      include: { breaks: true, logs: { orderBy: { timestamp: 'asc' } } },
      orderBy: { date: 'asc' },
    }),
    prisma.holiday.findMany({
      where: { organizationId: employee.organizationId, date: { gte: startDate, lte: endDate } },
    }),
    prisma.attendancePolicy.findUnique({ where: { organizationId: employee.organizationId } }),
  ]);

  const empHolidayDates = new Set(empHolidays.map(h => new Date(h.date).toISOString().split('T')[0]));
  const empWeekOffDaySet = new Set<number>(
    (empPolicy?.weekOffDays as number[] | null)?.length
      ? (empPolicy!.weekOffDays as number[])
      : [0]
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  const sheet = workbook.addWorksheet(`${employee.employeeCode} - ${monthName}`, {
    views: [{ state: 'frozen', ySplit: 3 }],
  });

  // Employee info header
  sheet.addRow([`${employee.firstName} ${employee.lastName} (${employee.employeeCode})`]);
  sheet.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  sheet.addRow([`Department: ${employee.department?.name || '-'}`, '', `Period: ${monthName}`]);
  sheet.getRow(2).font = { size: 10, color: { argb: GRAY } };

  const headers = ['Date', 'Day', 'Status', 'Check In', 'Check Out', 'Total Hours', 'Break Time', 'Work Mode', 'Notes'];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);

  sheet.columns = [
    { width: 14 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 14 }, { width: 30 },
  ];

  let totalPresent = 0, totalAbsent = 0, totalHours = 0;

  const daysInMonth = endDate.getDate();
  const recordMap = new Map(records.map(r => [new Date(r.date).toISOString().split('T')[0], r]));

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(year, month - 1, d);
    const record = recordMap.get(dateStr);
    const dayName = dt.toLocaleString('en-IN', { weekday: 'short' });

    const breakMins = record?.breaks?.reduce((sum: number, b: any) => sum + (b.durationMinutes || 0), 0) || 0;
    const status = record?.status || (
      empHolidayDates.has(dateStr) ? 'HOLIDAY' :
      empWeekOffDaySet.has(dt.getDay()) ? 'WEEKEND' :
      'ABSENT'
    );

    if (status === 'PRESENT' || status === 'WORK_FROM_HOME') { totalPresent++; totalHours += Number(record?.totalHours || 0); }
    if (status === 'ABSENT') totalAbsent++;

    const row = sheet.addRow([
      fmtDate(dt), dayName, status,
      record?.checkIn ? fmtTime(record.checkIn) : '-',
      record?.checkOut ? fmtTime(record.checkOut) : '-',
      record?.totalHours ? Number(record.totalHours).toFixed(1) : '-',
      breakMins > 0 ? `${breakMins}m` : '-',
      record?.workMode || '-',
      record?.notes || '',
    ]);

    const bgColor = STATUS_COLORS[status];
    if (bgColor) {
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    }
    row.font = { size: 9 };
  }

  // Summary
  sheet.addRow([]);
  const sumRow = sheet.addRow(['Summary', '', '', '', '', '', '', '']);
  sumRow.font = { bold: true, size: 11, color: { argb: BRAND } };
  sheet.addRow(['Present Days', totalPresent, '', 'Absent Days', totalAbsent, '', 'Total Hours', Math.round(totalHours * 10) / 10]);
  sheet.addRow(['Avg Hours/Day', totalPresent > 0 ? (totalHours / totalPresent).toFixed(1) : '0']);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
