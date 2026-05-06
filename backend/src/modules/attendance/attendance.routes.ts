import { Router } from 'express';
import { attendanceController } from './attendance.controller.js';
import { authenticate, requirePermission, authorize, requireEmpPerm } from '../../middleware/auth.middleware.js';
import { Role } from '@aniston/shared';
import { uploadAttendancePhoto } from '../../middleware/upload.middleware.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';
import { BadRequestError } from '../../middleware/errorHandler.js';
import { compOffService } from './compoff.service.js';
import { enqueueNotification, enqueueEmail } from '../../jobs/queues.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Convert a UTC Date to its IST time-of-day expressed as total minutes since midnight */
function toISTMinutes(d: Date): number {
  const ist = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

const router = Router();
router.use(authenticate);

// Employee routes
router.post('/clock-in', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.clockIn(req, res, next));
router.post('/clock-out', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.clockOut(req, res, next));
router.post('/break/start', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.startBreak(req, res, next));
router.post('/break/end', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.endBreak(req, res, next));
router.get('/today', requireEmpPerm('canViewAttendanceHistory'), (req, res, next) => attendanceController.getTodayStatus(req, res, next));
router.get('/my', requireEmpPerm('canViewAttendanceHistory'), (req, res, next) => attendanceController.getMyAttendance(req, res, next));

// Activity pulse (hybrid/WFH session tracking)
router.post('/activity-pulse', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.recordActivityPulse(req, res, next));

// GPS trail (field sales)
router.post('/gps-trail', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.storeGPSTrail(req, res, next));
router.get('/gps-trail/:employeeId/:date', requirePermission('attendance', 'read'), (req, res, next) =>
  attendanceController.getGPSTrail(req, res, next)
);

// GPS consent (DPDP Act 2023 — field sales employees must consent before tracking)
router.post('/gps-consent', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.recordGPSConsent(req, res, next));
router.get('/gps-consent', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.getGPSConsentStatus(req, res, next));

// Geo Locations (named visit stops for field sales)
router.get('/geo-locations', authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getGeoLocations(req, res, next)
);
router.patch('/location-visits/:id/name', authenticate,
  (req, res, next) => attendanceController.updateLocationVisitName(req, res, next)
);
// Employee tags a stop manually from their current position during field tracking
router.post('/tag-stop', requireEmpPerm('canMarkAttendance'),
  (req, res, next) => attendanceController.tagStop(req, res, next)
);

// Regularization — management roles (SUPER_ADMIN, ADMIN, HR, MANAGER) cannot self-regularize
const blockManagementSelfReg = (req: any, res: any, next: any) => {
  const mgmtRoles = [Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER];
  if (mgmtRoles.includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Management accounts cannot submit regularization requests. Use the calendar to mark attendance for other employees.' },
    });
  }
  next();
};
router.post('/regularization', blockManagementSelfReg, requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.submitRegularization(req, res, next));
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
// All regularizations with filters (HR view)
router.get(
  '/regularizations',
  authorize(Role.SUPER_ADMIN, Role.ADMIN, Role.HR, Role.MANAGER),
  (req, res, next) => attendanceController.getRegularizations(req, res, next)
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

// Project site photo upload (returns URL to use in projectSiteCheckIn body)
router.post(
  '/project-site/upload-photo',
  authenticate,
  uploadAttendancePhoto.single('photo'),
  (req, res, next) => {
    try {
      if (!req.file) throw new BadRequestError('No photo uploaded');
      const photoUrl = storageService.buildUrl(StorageFolder.ATTENDANCE_PHOTOS, req.file.filename);
      res.json({ success: true, data: { photoUrl } });
    } catch (err) { next(err); }
  }
);

// Project site check-ins (standalone, separate from clock-in)
router.post('/project-site/check-in', requireEmpPerm('canMarkAttendance'), (req, res, next) => attendanceController.projectSiteCheckIn(req, res, next));
router.get('/project-site/my', requireEmpPerm('canViewAttendanceHistory'), (req, res, next) => attendanceController.getMyProjectSiteCheckIns(req, res, next));

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

    // Audit log for policy changes
    try {
      const { createAuditLog } = await import('../../utils/auditLogger.js');
      await createAuditLog({
        action: 'UPDATE',
        entity: 'AttendancePolicy',
        entityId: policy.id,
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
        newValue: { ...data, description: 'Attendance policy updated' },
      });
    } catch { /* audit log failure should not block policy save */ }

    res.json({ success: true, data: policy, message: 'Attendance policy updated' });
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
    where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] } },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  const records = await prisma.attendanceRecord.findMany({
    where: { employee: { organizationId }, date: { gte: start, lte: end } },
    select: { employeeId: true, status: true, totalHours: true, checkIn: true },
  });

  const holidays = await prisma.holiday.findMany({ where: { organizationId, date: { gte: start, lte: end } } });
  const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId } });
  const weekOffDays = new Set(policy?.weekOffDays || [0]);

  const holidayDates = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));

  // Cap end date to today in IST — prevents future dates from inflating LOP
  const _n = new Date();
  const _ist = new Date(_n.getTime() + _n.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const todayISTStr = `${_ist.getUTCFullYear()}-${String(_ist.getUTCMonth() + 1).padStart(2, '0')}-${String(_ist.getUTCDate()).padStart(2, '0')}`;
  const todayUTC = new Date(todayISTStr + 'T00:00:00.000Z');
  const lopEndDate = end < todayUTC ? end : todayUTC;

  // totalWorkingDays = full month (for display), lopWorkingDays = up to today (for LOP calc)
  let totalWorkingDays = 0;
  let lopWorkingDays = 0;
  const d = new Date(start);
  while (d <= end) {
    const dayStr = d.toISOString().split('T')[0];
    if (!weekOffDays.has(d.getDay()) && !holidayDates.has(dayStr)) {
      totalWorkingDays++;
      if (d <= lopEndDate) lopWorkingDays++;
    }
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
    const explicitAbsent = recs.filter(r => r.status === 'ABSENT').length;
    const halfDay = recs.filter(r => r.status === 'HALF_DAY').length;
    const onLeave = recs.filter(r => r.status === 'ON_LEAVE').length;
    const wfh = recs.filter(r => r.status === 'WORK_FROM_HOME').length;
    const totalHours = recs.reduce((s, r) => s + (Number(r.totalHours) || 0), 0);
    const effectivePresent = present + wfh + (halfDay * 0.5);
    // Days with no record (and not weekend/holiday) count as absent — matches LOP logic
    const implicitAbsent = Math.max(0, lopWorkingDays - effectivePresent - onLeave - explicitAbsent);
    const absent = explicitAbsent + Math.round(implicitAbsent);
    const [shiftStartH, shiftStartM] = (empShift?.startTime || '09:00').split(':').map(Number);
    const shiftStartMinutes = shiftStartH * 60 + shiftStartM;
    const graceMinutes = empShift?.graceMinutes || policy?.lateGraceMinutes || 15;
    const lateCount = recs.filter(r =>
      r.checkIn ? toISTMinutes(new Date(r.checkIn)) > (shiftStartMinutes + graceMinutes) : false
    ).length;
    let lopDays = Math.max(0, lopWorkingDays - effectivePresent - onLeave);

    let latePenaltyLOP = 0;
    // Shift-level settings take priority over org policy
    const effectiveLatePenaltyEnabled = empShift?.latePenaltyEnabled ?? policy?.latePenaltyEnabled ?? false;
    const effectiveLatePenaltyPerCount = Number(empShift?.latePenaltyPerCount ?? policy?.latePenaltyPerCount ?? 3);
    if (effectiveLatePenaltyEnabled && effectiveLatePenaltyPerCount > 0) {
      latePenaltyLOP = Math.floor(lateCount / effectiveLatePenaltyPerCount);
      lopDays += latePenaltyLOP;
    }

    const fullDayHrsForOT = Number(empShift?.fullDayHours || policy?.fullDayMinHours || 8);
    const halfDayHrsForOT = Number(empShift?.halfDayHours || policy?.halfDayMinHours || 4);
    const expectedHours = (present + wfh) * fullDayHrsForOT + halfDay * halfDayHrsForOT;
    const otHours = policy?.otEnabled ? Math.max(0, totalHours - expectedHours) : 0;

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

  return { month, year, totalWorkingDays, workingDaysElapsed: lopWorkingDays, holidays: holidays.length, employees: report };
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
router.get('/my/report', requireEmpPerm('canViewAttendanceHistory'), async (req, res, next) => {
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
    // Score: exclude approved leave days from denominator — leave is not absence
    const effectiveWorkingDays = Math.max(1, totalWorkingDays - onLeave);
    const score = Math.round(((present + halfDay * 0.5) / effectiveWorkingDays) * 100);

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
      return s + toISTMinutes(new Date(r.checkIn!));
    }, 0) / (records.filter(r => r.checkIn).length || 1);

    const [shiftStartH, shiftStartM] = (empShift?.startTime || '09:00').split(':').map(Number);
    const shiftStartMinutes = shiftStartH * 60 + shiftStartM;
    const graceMinutes = empShift?.graceMinutes || policy?.lateGraceMinutes || 15;
    const lateCount = records.filter(r => {
      if (!r.checkIn) return false;
      return toISTMinutes(new Date(r.checkIn)) > (shiftStartMinutes + graceMinutes);
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
// P2.7b: EMPLOYEE SELF-SERVICE EXCEL EXPORT
// =====================================================================
router.get('/my/report/export', requireEmpPerm('canViewAttendanceHistory'), async (req, res, next) => {
  try {
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { message: 'No employee profile' } }); return; }
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const { generateEmployeeAttendanceExcel } = await import('../../utils/attendanceExcelExporter.js');
    const buffer = await generateEmployeeAttendanceExcel(employeeId, month, year);
    const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'short' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="my-attendance-${monthName}-${year}.xlsx"`);
    res.send(buffer);
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
router.post('/overtime', requireEmpPerm('canMarkAttendance'), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { message: 'No employee profile' } }); return; }
    const { date, plannedHours, reason } = req.body;
    if (!date || !plannedHours || !reason) { res.status(400).json({ success: false, error: { message: 'date, plannedHours, and reason are required' } }); return; }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true, firstName: true, lastName: true, employeeCode: true },
    });
    const otReq = await prisma.overtimeRequest.create({
      data: { employeeId, date: new Date(date), plannedHours, reason, organizationId: employee!.organizationId },
    });
    // Notify HR/Manager about the overtime request
    try {
      const hrUsers = await prisma.user.findMany({
        where: { organizationId: employee!.organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'] }, status: 'ACTIVE' },
        select: { id: true },
      });
      const dateStr = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      for (const hr of hrUsers) {
        await enqueueNotification({
          userId: hr.id,
          organizationId: employee!.organizationId,
          type: 'OVERTIME_SUBMITTED',
          title: `Overtime Request — ${employee!.firstName} ${employee!.lastName}`,
          message: `${employee!.firstName} ${employee!.lastName} (${employee!.employeeCode}) submitted an overtime request for ${dateStr} (${plannedHours}h).`,
          link: '/attendance',
        }).catch(() => {});
      }
    } catch { /* non-blocking */ }
    res.status(201).json({ success: true, data: otReq, message: 'Overtime request submitted' });
  } catch (err) { next(err); }
});

router.get('/overtime/my', requireEmpPerm('canViewAttendanceHistory'), async (req, res, next) => {
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
      include: { employee: { select: { organizationId: true, user: { select: { id: true } } } } },
    });
    // Notify employee of the decision
    try {
      const empUserId = (updated as any).employee?.user?.id;
      const orgId = (updated as any).employee?.organizationId;
      if (empUserId && orgId) {
        await enqueueNotification({
          userId: empUserId,
          organizationId: orgId,
          type: 'OVERTIME_REVIEWED',
          title: `Overtime Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
          message: `Your overtime request was ${status.toLowerCase()}${remarks ? ': ' + remarks : '.'}`,
          link: '/attendance',
        }).catch(() => {});
      }
    } catch { /* non-blocking */ }
    res.json({ success: true, data: updated, message: `Overtime request ${status.toLowerCase()}` });
  } catch (err) { next(err); }
});

// =====================================================================
// COMP-OFF CREDITS
// =====================================================================
router.get('/comp-off/balance', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } }); return; }
    const balance = await compOffService.getBalance(employeeId, req.user!.organizationId);
    res.json({ success: true, data: { balance } });
  } catch (err) { next(err); }
});

router.get('/comp-off/credits', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } }); return; }
    const credits = await compOffService.getCredits(employeeId, req.user!.organizationId);
    res.json({ success: true, data: credits });
  } catch (err) { next(err); }
});

router.get('/comp-off/org', authenticate, requirePermission('attendance', 'read'), async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };
    const credits = await compOffService.listOrgCredits(req.user!.organizationId, status);
    res.json({ success: true, data: credits });
  } catch (err) { next(err); }
});

// HR grants a comp-off credit to an employee
router.post('/comp-off/grant', authenticate, requirePermission('attendance', 'update'), async (req, res, next) => {
  try {
    const { employeeId, earnedDate, hoursWorked, notes, expiryMonths } = req.body as {
      employeeId: string; earnedDate: string; hoursWorked: number; notes?: string; expiryMonths?: number;
    };
    if (!employeeId || !earnedDate || hoursWorked == null) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'employeeId, earnedDate and hoursWorked are required' } });
      return;
    }
    const credit = await compOffService.grantCredit({
      employeeId,
      organizationId: req.user!.organizationId,
      earnedDate: new Date(earnedDate),
      hoursWorked: Number(hoursWorked),
      notes,
      expiryMonths,
    });
    res.status(201).json({ success: true, data: credit });
  } catch (err) { next(err); }
});

// Employee redeems a comp-off credit (links to a leave request)
router.post('/comp-off/redeem', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false, error: { code: 'NO_EMPLOYEE', message: 'No employee profile' } }); return; }
    const { leaveRequestId } = req.body as { leaveRequestId: string };
    if (!leaveRequestId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'leaveRequestId is required' } });
      return;
    }
    const credit = await compOffService.redeemCredit(employeeId, req.user!.organizationId, leaveRequestId);
    res.json({ success: true, data: credit });
  } catch (err) { next(err); }
});

// =====================================================================
// NATIVE GPS SERVICE SUPPORT
// =====================================================================

// Called by native Android service every 5 min — resets 16-min Redis TTL
// Backend detects force-stop when key expires without being refreshed
router.post('/gps-heartbeat', requireEmpPerm('canMarkAttendance'), async (req, res, next) => {
  try {
    const { redis } = await import('../../lib/redis.js');
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false }); return; }

    // Mark employee as actively tracked (no TTL — persists until stopped)
    const orgId = req.user!.organizationId;
    const emp = await (await import('../../lib/prisma.js')).prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    const payload = JSON.stringify({
      orgId,
      employeeId,
      name: emp ? `${emp.firstName} ${emp.lastName}` : employeeId,
      employeeCode: emp?.employeeCode || '',
      alertSent: false,
    });
    // gps:active key has NO TTL — only removed on explicit stop or after alert fires
    await redis.set(`gps:active:${employeeId}`, payload, 'NX'); // set only if not already set
    // Heartbeat key: 16-min TTL (3 missed × 5-min interval + 1-min buffer)
    await redis.setex(`gps:hb:${employeeId}`, 960, '1');

    res.json({ success: true });
  } catch (err) { next(err); }
});

// Called by frontend/native service when tracking stops normally (clock-out)
router.post('/gps-tracking-stop', requireEmpPerm('canMarkAttendance'), async (req, res, next) => {
  try {
    const { redis } = await import('../../lib/redis.js');
    const employeeId = req.user!.employeeId;
    if (!employeeId) { res.status(400).json({ success: false }); return; }
    await redis.del(`gps:active:${employeeId}`, `gps:hb:${employeeId}`);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Called by frontend when employee revokes GPS permission during active tracking
router.post('/gps-alert', requireEmpPerm('canMarkAttendance'), async (req, res, next) => {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const { redis } = await import('../../lib/redis.js');
    const employeeId = req.user!.employeeId;
    const orgId = req.user!.organizationId;
    const alertType: string = req.body?.alertType || 'PERMISSION_REVOKED';

    if (!employeeId) { res.status(400).json({ success: false, error: { message: 'No employee profile' } }); return; }

    const [emp, org, hrUsers] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
      }),
      prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, adminNotificationEmail: true } }),
      prisma.user.findMany({
        where: { organizationId: orgId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, status: 'ACTIVE' },
        select: { email: true },
      }),
    ]);

    if (!emp) { res.status(404).json({ success: false, error: { message: 'Employee not found' } }); return; }

    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const empName = `${emp.firstName} ${emp.lastName}`;
    const dept = emp.department?.name || '—';
    const isRevoked = alertType === 'PERMISSION_REVOKED';

    const subject = isRevoked
      ? `⚠️ GPS Permission Revoked — ${empName} (${emp.employeeCode})`
      : `🚨 App Force-Stopped During GPS Tracking — ${empName} (${emp.employeeCode})`;

    const recipientSet = new Set<string>(hrUsers.map(u => u.email).filter(Boolean));
    if (org?.adminNotificationEmail) recipientSet.add(org.adminNotificationEmail);

    for (const to of recipientSet) {
      await enqueueEmail({
        to,
        subject,
        template: 'gps-alert',
        context: {
          empName, empCode: emp.employeeCode, dept,
          orgName: org?.name || 'Aniston Technologies',
          alertType: isRevoked ? 'GPS Permission Revoked' : 'App Force-Stopped',
          alertDesc: isRevoked
            ? `${empName} revoked location permission while GPS tracking was active.`
            : `${empName} force-stopped the Aniston HRMS app while GPS tracking was active (no heartbeat for >15 minutes).`,
          isRevoked,
          timestamp: now,
          dashboardUrl: 'https://hr.anistonav.com/attendance',
        },
      }).catch(() => {});
    }

    // Remove from active tracking state in Redis
    await redis.del(`gps:active:${employeeId}`, `gps:hb:${employeeId}`);

    res.json({ success: true, message: 'Alert sent to HR' });
  } catch (err) { next(err); }
});

export { router as attendanceRouter };
