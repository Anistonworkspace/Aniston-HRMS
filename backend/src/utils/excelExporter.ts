import ExcelJS from 'exceljs';

interface EmployeeForExcel {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  department?: { name: string } | null;
  designation?: { name: string } | null;
  status: string;
  joiningDate: Date;
}

interface AttendanceForExcel {
  employeeName: string;
  date: Date | string;
  status: string;
  checkIn: Date | string | null;
  checkOut: Date | string | null;
  totalHours: number | null;
}

const BRAND_COLOR = '4F46E5';

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLOR } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: '000000' } },
    };
  });
  row.height = 28;
}

export async function generateEmployeeDirectoryExcel(employees: EmployeeForExcel[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Employee Directory', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Employee Code', key: 'code', width: 16 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Department', key: 'department', width: 22 },
    { header: 'Designation', key: 'designation', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Joining Date', key: 'joiningDate', width: 16 },
  ];

  styleHeaderRow(sheet.getRow(1));

  for (const emp of employees) {
    const row = sheet.addRow({
      code: emp.employeeCode,
      name: `${emp.firstName} ${emp.lastName}`,
      email: emp.email,
      department: emp.department?.name || 'Unassigned',
      designation: emp.designation?.name || 'Unassigned',
      status: emp.status,
      joiningDate: new Date(emp.joiningDate).toLocaleDateString('en-IN'),
    });

    // Alternate row shading
    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });
    }
  }

  // Auto-filter
  sheet.autoFilter = { from: 'A1', to: `G${employees.length + 1}` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateAttendanceSummaryExcel(data: AttendanceForExcel[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Attendance Summary', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Employee', key: 'employee', width: 28 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Check-in', key: 'checkIn', width: 14 },
    { header: 'Check-out', key: 'checkOut', width: 14 },
    { header: 'Hours', key: 'hours', width: 10 },
  ];

  styleHeaderRow(sheet.getRow(1));

  for (const record of data) {
    const row = sheet.addRow({
      employee: record.employeeName,
      date: record.date instanceof Date ? record.date.toLocaleDateString('en-IN') : record.date,
      status: record.status,
      checkIn: record.checkIn ? (record.checkIn instanceof Date ? record.checkIn.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : record.checkIn) : '-',
      checkOut: record.checkOut ? (record.checkOut instanceof Date ? record.checkOut.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : record.checkOut) : '-',
      hours: record.totalHours != null ? Number(record.totalHours).toFixed(1) : '-',
    });

    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });
    }
  }

  sheet.autoFilter = { from: 'A1', to: `F${data.length + 1}` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

interface LeaveForExcel {
  employeeCode: string;
  employeeName: string;
  department: string;
  leaveType: string;
  startDate: Date | string;
  endDate: Date | string;
  days: number;
  status: string;
  reason: string;
}

export async function generateLeaveReportExcel(data: LeaveForExcel[], period: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aniston HRMS';
  workbook.created = new Date();

  const sheetName = `Leave Report${period ? ` - ${period}` : ''}`.slice(0, 31); // Excel sheet name limit
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Employee Code', key: 'code', width: 16 },
    { header: 'Employee Name', key: 'name', width: 28 },
    { header: 'Department', key: 'department', width: 22 },
    { header: 'Leave Type', key: 'leaveType', width: 18 },
    { header: 'From', key: 'from', width: 14 },
    { header: 'To', key: 'to', width: 14 },
    { header: 'Days', key: 'days', width: 8 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Reason', key: 'reason', width: 40 },
  ];

  styleHeaderRow(sheet.getRow(1));

  const statusColors: Record<string, string> = {
    APPROVED: 'D1FAE5',
    PENDING: 'FEF3C7',
    REJECTED: 'FEE2E2',
  };

  for (const record of data) {
    const row = sheet.addRow({
      code: record.employeeCode,
      name: record.employeeName,
      department: record.department,
      leaveType: record.leaveType,
      from: record.startDate instanceof Date ? record.startDate.toLocaleDateString('en-IN') : record.startDate,
      to: record.endDate instanceof Date ? record.endDate.toLocaleDateString('en-IN') : record.endDate,
      days: record.days,
      status: record.status,
      reason: record.reason,
    });

    const bgColor = statusColors[record.status];
    if (bgColor) {
      const statusCell = row.getCell('status');
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    } else if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
      });
    }
  }

  sheet.autoFilter = { from: 'A1', to: `I${data.length + 1}` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
