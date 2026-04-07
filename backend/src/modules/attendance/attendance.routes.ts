import { Router } from 'express';
import { attendanceController } from './attendance.controller.js';
import { authenticate, requirePermission, authorize } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';

const router = Router();
router.use(authenticate);

// Employee routes
router.post('/clock-in', (req, res, next) => attendanceController.clockIn(req, res, next));
router.post('/clock-out', (req, res, next) => attendanceController.clockOut(req, res, next));
router.get('/today', (req, res, next) => attendanceController.getTodayStatus(req, res, next));
router.get('/my', (req, res, next) => attendanceController.getMyAttendance(req, res, next));

// Break management
router.post('/break/start', (req, res, next) => attendanceController.startBreak(req, res, next));
router.post('/break/end', (req, res, next) => attendanceController.endBreak(req, res, next));

// Activity pulse (hybrid/WFH session tracking)
router.post('/activity-pulse', (req, res, next) => attendanceController.recordActivityPulse(req, res, next));

// GPS trail (field sales)
router.post('/gps-trail', (req, res, next) => attendanceController.storeGPSTrail(req, res, next));
router.get('/gps-trail/:employeeId/:date', requirePermission('attendance', 'read'), (req, res, next) =>
  attendanceController.getGPSTrail(req, res, next)
);

// Regularization
router.post('/regularization', (req, res, next) => attendanceController.submitRegularization(req, res, next));
router.patch(
  '/regularization/:id',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.handleRegularization(req, res, next)
);
// Pending regularizations (HR view)
router.get(
  '/regularizations/pending',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getPendingRegularizations(req, res, next)
);

// Hybrid schedule
router.get('/hybrid-schedule/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getHybridSchedule(req, res, next)
);
router.put('/hybrid-schedule/:employeeId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.setHybridSchedule(req, res, next)
);

// HR/Admin — get attendance for a specific employee
router.get(
  '/employee/:employeeId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getEmployeeAttendance(req, res, next)
);

// HR/Admin — mark attendance for an employee
router.post(
  '/mark',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.markAttendance(req, res, next)
);

// HR/Admin — attendance event logs for an employee on a date
router.get(
  '/logs/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getAttendanceLogs(req, res, next)
);

// HR/Admin — Export attendance as Excel
router.get(
  '/export',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  async (req, res, next) => {
    try {
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const employeeId = req.query.employeeId as string;

      if (employeeId) {
        const { generateEmployeeAttendanceExcel } = await import('../../utils/attendanceExcelExporter.js');
        const buffer = await generateEmployeeAttendanceExcel(employeeId, month, year);
        const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'short' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-${employeeId}-${monthName}-${year}.xlsx"`);
        res.send(buffer);
      } else {
        const { generateMonthlyAttendanceExcel } = await import('../../utils/attendanceExcelExporter.js');
        const buffer = await generateMonthlyAttendanceExcel(req.user!.organizationId, month, year);
        const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'short' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="attendance-${monthName}-${year}.xlsx"`);
        res.send(buffer);
      }
    } catch (err) { next(err); }
  }
);

// Project site check-ins (standalone, separate from clock-in)
router.post('/project-site/check-in', (req, res, next) => attendanceController.projectSiteCheckIn(req, res, next));
router.get('/project-site/my', (req, res, next) => attendanceController.getMyProjectSiteCheckIns(req, res, next));

// Admin/HR view — all employees
router.get(
  '/all',
  requirePermission('attendance', 'read'),
  (req, res, next) => attendanceController.getAllAttendance(req, res, next)
);

// =====================================================================
// ENTERPRISE COMMAND CENTER ROUTES
// =====================================================================

// Command center KPI stats
router.get(
  '/command-center/stats',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getCommandCenterStats(req, res, next)
);

// Enhanced attendance list with enterprise filters
router.get(
  '/command-center/records',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getAllAttendanceEnhanced(req, res, next)
);

// Anomaly management
router.get(
  '/command-center/anomalies',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getAnomalies(req, res, next)
);
router.patch(
  '/command-center/anomalies/:id/resolve',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.resolveAnomaly(req, res, next)
);

// Live attendance board
router.get(
  '/command-center/live',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.getLiveBoard(req, res, next)
);

// Anomaly detection trigger
router.post(
  '/command-center/detect-anomalies',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR),
  (req, res, next) => attendanceController.detectAnomalies(req, res, next)
);

// Employee attendance detail (enriched)
router.get(
  '/command-center/employee/:employeeId/:date',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getEmployeeAttendanceDetail(req, res, next)
);

// =====================================================================
// P1.1: ATTENDANCE POLICY CONFIG
// =====================================================================
router.get('/policy', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    let policy = await prisma.attendancePolicy.findUnique({ where: { organizationId: req.user!.organizationId } });
    if (!policy) {
      policy = await prisma.attendancePolicy.create({ data: { organizationId: req.user!.organizationId } });
    }
    res.json({ success: true, data: policy });
  } catch (err) { next(err); }
});

router.put('/policy', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { attendancePolicySchema } = await import('./attendance.validation.js');
    const data = attendancePolicySchema.parse(req.body);
    delete (data as any).id; delete (data as any).organizationId; delete (data as any).createdAt; delete (data as any).updatedAt;
    const policy = await prisma.attendancePolicy.upsert({
      where: { organizationId: req.user!.organizationId },
      create: { ...data, organizationId: req.user!.organizationId },
      update: data,
    });
    res.json({ success: true, data: policy, message: 'Attendance policy updated' });
  } catch (err) { next(err); }
});

// =====================================================================
// P1.2: BULK ATTENDANCE UPLOAD
// =====================================================================
router.get('/bulk/template', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const ExcelJS = await import('exceljs');
    const employees = await prisma.employee.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null, isSystemAccount: { not: true } },
      select: { employeeCode: true, firstName: true, lastName: true, email: true },
      orderBy: { employeeCode: 'asc' },
    });
    const wb = new ExcelJS.default.Workbook();
    const ws = wb.addWorksheet('Attendance');
    ws.columns = [
      { header: 'Employee Code', key: 'code', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Date (YYYY-MM-DD)', key: 'date', width: 18 },
      { header: 'Check In (HH:MM)', key: 'checkIn', width: 18 },
      { header: 'Check Out (HH:MM)', key: 'checkOut', width: 18 },
      { header: 'Status (PRESENT/ABSENT/HALF_DAY/ON_LEAVE)', key: 'status', width: 40 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];
    employees.forEach(e => ws.addRow({ code: e.employeeCode, name: `${e.firstName} ${e.lastName}`, date: '', checkIn: '', checkOut: '', status: 'PRESENT', notes: '' }));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.post('/bulk/upload', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const rows = req.body.rows as Array<{ employeeCode: string; date: string; checkIn?: string; checkOut?: string; status: string; notes?: string; remarks?: string }>;
    if (!rows?.length) { res.status(400).json({ success: false, error: { message: 'No rows provided' } }); return; }

    const employees = await prisma.employee.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null },
      select: { id: true, employeeCode: true, workMode: true },
    });
    const empMap = new Map(employees.map(e => [e.employeeCode, e]));

    // Sanitize text fields to prevent CSV formula injection
    const sanitize = (val: string | undefined) => {
      if (!val) return val;
      return val.replace(/^[=+\-@\t\r]+/, '');
    };

    let created = 0, updated = 0, errors: string[] = [];
    for (const row of rows) {
      const noteValue = sanitize(row.notes || row.remarks);
      row.notes = noteValue;
      const emp = empMap.get(row.employeeCode);
      if (!emp) { errors.push(`Row ${row.employeeCode}: Employee not found`); continue; }
      if (!row.date) { errors.push(`Row ${row.employeeCode}: Date is required`); continue; }
      const date = new Date(row.date); date.setHours(0, 0, 0, 0);
      const checkIn = row.checkIn ? new Date(`${row.date}T${row.checkIn}:00+05:30`) : null;
      const checkOut = row.checkOut ? new Date(`${row.date}T${row.checkOut}:00+05:30`) : null;
      const totalHours = checkIn && checkOut ? (checkOut.getTime() - checkIn.getTime()) / 3600000 : null;

      try {
        await prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: emp.id, date } },
          create: { employeeId: emp.id, date, checkIn, checkOut, totalHours, status: row.status as any || 'PRESENT', workMode: emp.workMode as any || 'OFFICE', source: 'MANUAL_HR', notes: row.notes || '[Bulk upload]' },
          update: { checkIn, checkOut, totalHours, status: row.status as any || 'PRESENT', notes: row.notes || '[Bulk upload update]' },
        });
        created++;
      } catch (e: any) { errors.push(`Row ${row.employeeCode} ${row.date}: ${e.message}`); }
    }
    res.json({ success: true, data: { created, updated, errors, total: rows.length } });
  } catch (err) { next(err); }
});

// =====================================================================
// P1.3: MONTHLY REPORT — shared logic extracted for reuse by export
// =====================================================================
async function generateMonthlyReportData(organizationId: string, month: number, year: number) {
  const { prisma } = await import('../../lib/prisma.js');
  const start = new Date(year, month - 1, 1); start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 0); end.setHours(23, 59, 59, 999);

  const employees = await prisma.employee.findMany({
    where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION'] } },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { employee: { organizationId }, date: { gte: start, lte: end } },
    select: { employeeId: true, status: true, totalHours: true, checkIn: true },
  });

  const holidays = await prisma.holiday.findMany({ where: { organizationId, date: { gte: start, lte: end } } });
  const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId } });
  const weekOffDays = new Set(policy?.weekOffDays || [0]);

  const holidayDates = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
  let totalWorkingDays = 0;
  const d = new Date(start);
  while (d <= end) {
    const dayStr = d.toISOString().split('T')[0];
    if (!weekOffDays.has(d.getDay()) && !holidayDates.has(dayStr)) totalWorkingDays++;
    d.setDate(d.getDate() + 1);
  }

  const empRecordMap = new Map<string, any[]>();
  records.forEach(r => { if (!empRecordMap.has(r.employeeId)) empRecordMap.set(r.employeeId, []); empRecordMap.get(r.employeeId)!.push(r); });

  const shiftAssignments = await prisma.shiftAssignment.findMany({
    where: { employee: { organizationId }, endDate: null },
    include: { shift: true },
  });
  const empShiftMap = new Map<string, any>();
  shiftAssignments.forEach(a => empShiftMap.set(a.employeeId, a.shift));

  const report = employees.map(emp => {
    const recs = empRecordMap.get(emp.id) || [];
    const empShift = empShiftMap.get(emp.id);
    const present = recs.filter(r => r.status === 'PRESENT').length;
    const absent = recs.filter(r => r.status === 'ABSENT').length;
    const halfDay = recs.filter(r => r.status === 'HALF_DAY').length;
    const onLeave = recs.filter(r => r.status === 'ON_LEAVE').length;
    const wfh = recs.filter(r => r.status === 'WORK_FROM_HOME').length;
    const totalHours = recs.reduce((s, r) => s + (Number(r.totalHours) || 0), 0);
    const [shiftStartH, shiftStartM] = (empShift?.startTime || '09:00').split(':').map(Number);
    const shiftStartMinutes = shiftStartH * 60 + shiftStartM;
    const graceMinutes = empShift?.graceMinutes || policy?.lateGraceMinutes || 15;
    const lateCount = recs.filter(r => {
      if (!r.checkIn) return false;
      const ci = new Date(r.checkIn);
      const ciMinutes = ci.getHours() * 60 + ci.getMinutes();
      return ciMinutes > (shiftStartMinutes + graceMinutes);
    }).length;
    const effectivePresent = present + wfh + (halfDay * 0.5);
    let lopDays = Math.max(0, totalWorkingDays - effectivePresent - onLeave);

    let latePenaltyLOP = 0;
    if (policy?.latePenaltyEnabled && (policy?.latePenaltyPerCount || 0) > 0) {
      latePenaltyLOP = Math.floor(lateCount / policy.latePenaltyPerCount);
      lopDays += latePenaltyLOP;
    }

    const fullDayHrsForOT = Number(empShift?.fullDayHours || policy?.fullDayMinHours || 8);
    const otHours = policy?.otEnabled
      ? Math.max(0, totalHours - (present + wfh) * fullDayHrsForOT)
      : 0;

    return {
      employeeId: emp.id, employeeCode: emp.employeeCode, name: `${emp.firstName} ${emp.lastName}`,
      department: emp.department?.name || '—',
      totalWorkingDays, present, absent, halfDay, onLeave, wfh, lateCount,
      totalHours: Math.round(totalHours * 10) / 10,
      lopDays: Math.round(lopDays * 10) / 10,
      latePenaltyLOP,
      otHours: Math.round(otHours * 10) / 10,
      effectivePresent: Math.round(effectivePresent * 10) / 10,
    };
  });

  return { month, year, totalWorkingDays, holidays: holidays.length, employees: report };
}

router.get('/monthly-report', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const data = await generateMonthlyReportData(req.user!.organizationId, month, year);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/monthly-report/export', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR), async (req, res, next) => {
  try {
    const ExcelJS = await import('exceljs');
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const reportData = await generateMonthlyReportData(req.user!.organizationId, month, year);

    const wb = new ExcelJS.default.Workbook();
    const ws = wb.addWorksheet(`Attendance ${month}-${year}`);
    ws.columns = [
      { header: 'Employee Code', key: 'employeeCode', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Working Days', key: 'totalWorkingDays', width: 14 },
      { header: 'Present', key: 'present', width: 10 },
      { header: 'Absent', key: 'absent', width: 10 },
      { header: 'Half Day', key: 'halfDay', width: 10 },
      { header: 'On Leave', key: 'onLeave', width: 10 },
      { header: 'WFH', key: 'wfh', width: 8 },
      { header: 'Late Count', key: 'lateCount', width: 11 },
      { header: 'Total Hours', key: 'totalHours', width: 12 },
      { header: 'LOP Days', key: 'lopDays', width: 10 },
      { header: 'OT Hours', key: 'otHours', width: 10 },
    ];
    reportData.employees.forEach((e: any) => ws.addRow(e));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="monthly-report-${month}-${year}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// =====================================================================
// P2.7: EMPLOYEE SELF-SERVICE REPORT
// =====================================================================
router.get('/my/report', async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { message: 'No employee profile' } }); return; }
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const start = new Date(year, month - 1, 1); const end = new Date(year, month, 0);

    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });
    const holidays = await prisma.holiday.findMany({ where: { organizationId: req.user!.organizationId, date: { gte: start, lte: end } } });
    const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId: req.user!.organizationId } });

    // Get employee's shift for accurate late detection
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, endDate: null },
      include: { shift: true },
    });
    const empShift = shiftAssignment?.shift;
    const weekOffDays = new Set(policy?.weekOffDays || [0]);

    let totalWorkingDays = 0;
    const d = new Date(start);
    const holidayDates = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
    while (d <= end) {
      if (!weekOffDays.has(d.getDay()) && !holidayDates.has(d.toISOString().split('T')[0])) totalWorkingDays++;
      d.setDate(d.getDate() + 1);
    }

    const present = records.filter(r => r.status === 'PRESENT').length;
    const absent = records.filter(r => r.status === 'ABSENT').length;
    const halfDay = records.filter(r => r.status === 'HALF_DAY').length;
    const onLeave = records.filter(r => r.status === 'ON_LEAVE').length;
    const totalHours = records.reduce((s, r) => s + (Number(r.totalHours) || 0), 0);
    const score = totalWorkingDays > 0 ? Math.round(((present + (halfDay * 0.5)) / totalWorkingDays) * 100) : 0;

    // Streak calculation
    let currentStreak = 0, longestStreak = 0, streak = 0;
    const sorted = records.filter(r => r.status === 'PRESENT' || r.status === 'WORK_FROM_HOME').sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0) { streak = 1; } else {
        const diff = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86400000;
        streak = diff <= 2 ? streak + 1 : 1; // allow 1-day gap (weekend)
      }
      longestStreak = Math.max(longestStreak, streak);
    }
    // Current streak from end
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (i === sorted.length - 1) { currentStreak = 1; } else {
        const diff = (sorted[i + 1].date.getTime() - sorted[i].date.getTime()) / 86400000;
        if (diff <= 2) currentStreak++; else break;
      }
    }

    const avgCheckInMinutes = records.filter(r => r.checkIn).reduce((s, r) => {
      const ci = new Date(r.checkIn!);
      return s + ci.getHours() * 60 + ci.getMinutes();
    }, 0) / (records.filter(r => r.checkIn).length || 1);

    const [shiftStartH, shiftStartM] = (empShift?.startTime || '09:00').split(':').map(Number);
    const shiftStartMinutes = shiftStartH * 60 + shiftStartM;
    const graceMinutes = empShift?.graceMinutes || policy?.lateGraceMinutes || 15;
    const lateCount = records.filter(r => {
      if (!r.checkIn) return false;
      const ci = new Date(r.checkIn);
      return ci.getHours() * 60 + ci.getMinutes() > (shiftStartMinutes + graceMinutes);
    }).length;

    res.json({
      success: true, data: {
        month, year, totalWorkingDays, present, absent, halfDay, onLeave,
        totalHours: Math.round(totalHours * 10) / 10,
        score, currentStreak, longestStreak, lateCount,
        avgCheckInTime: `${String(Math.floor(avgCheckInMinutes / 60)).padStart(2, '0')}:${String(Math.round(avgCheckInMinutes % 60)).padStart(2, '0')}`,
        avgHoursPerDay: present > 0 ? Math.round((totalHours / present) * 10) / 10 : 0,
      },
    });
  } catch (err) { next(err); }
});

// =====================================================================
// P2.9: GEOFENCE MAP DATA FOR CHECK-IN
// =====================================================================
router.get('/check-in-map/:attendanceId', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const record = await prisma.attendanceRecord.findUnique({
      where: { id: req.params.attendanceId },
      include: { employee: { include: { officeLocation: { include: { geofence: true } } } } },
    });
    if (!record) { res.status(404).json({ success: false, error: { message: 'Record not found' } }); return; }

    const empLoc = record.checkInLocation as any;
    const officeLoc = record.employee?.officeLocation;
    const geofence = officeLoc?.geofence;

    res.json({
      success: true, data: {
        employeeLocation: empLoc ? { lat: empLoc.lat, lng: empLoc.lng, accuracy: empLoc.accuracy } : null,
        officeLocation: geofence?.coordinates ? { lat: (geofence.coordinates as any).lat, lng: (geofence.coordinates as any).lng, name: officeLoc?.name } : null,
        geofenceRadius: geofence?.radiusMeters || 200,
        isInside: !record.geofenceViolation,
      },
    });
  } catch (err) { next(err); }
});

// =====================================================================
// P2.10: OVERTIME REQUEST & APPROVAL
// =====================================================================
router.post('/overtime', async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { message: 'No employee profile' } }); return; }
    const { date, plannedHours, reason } = req.body;
    if (!date || !plannedHours || !reason) { res.status(400).json({ success: false, error: { message: 'date, plannedHours, and reason are required' } }); return; }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { organizationId: true } });
    const otReq = await prisma.overtimeRequest.create({
      data: { employeeId, date: new Date(date), plannedHours, reason, organizationId: employee!.organizationId },
    });
    res.status(201).json({ success: true, data: otReq, message: 'Overtime request submitted' });
  } catch (err) { next(err); }
});

router.get('/overtime/my', async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const employeeId = req.user!.employeeId;
    const requests = await prisma.overtimeRequest.findMany({
      where: { employeeId: employeeId || '', deletedAt: null },
      orderBy: { date: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: requests });
  } catch (err) { next(err); }
});

router.get('/overtime', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const requests = await prisma.overtimeRequest.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: null },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } } },
      orderBy: { date: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: requests });
  } catch (err) { next(err); }
});

router.patch('/overtime/:id', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { action, remarks } = req.body;
    const status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : null;
    if (!status) { res.status(400).json({ success: false, error: { message: 'action must be approve or reject' } }); return; }
    const updated = await prisma.overtimeRequest.update({
      where: { id: req.params.id },
      data: { status, approvedBy: req.user!.userId, approverRemarks: remarks || null, approvedAt: new Date() },
    });
    res.json({ success: true, data: updated, message: `Overtime request ${status.toLowerCase()}` });
  } catch (err) { next(err); }
});

export { router as attendanceRouter };
