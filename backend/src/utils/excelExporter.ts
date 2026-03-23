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
