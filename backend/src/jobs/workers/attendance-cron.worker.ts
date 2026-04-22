import { Worker, Job } from 'bullmq';
import { bullmqConnection } from '../queues.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { attendanceService } from '../../modules/attendance/attendance.service.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTToday(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + IST_OFFSET_MS);
  ist.setHours(0, 0, 0, 0);
  return ist;
}

function getISTYesterday(): Date {
  const d = getISTToday();
  d.setDate(d.getDate() - 1);
  return d;
}

/**
 * Auto-close stale attendance records
 * Finds records where checkOut=null and date < today, sets checkOut to shift end time
 */
async function autoCloseStaleRecords() {
  const today = getISTToday();
  logger.info('[Attendance Cron] Running auto-close stale records...');

  const staleRecords = await prisma.attendanceRecord.findMany({
    where: {
      checkOut: null,
      checkIn: { not: null },
      date: { lt: today },
    },
    include: {
      employee: { select: { id: true, organizationId: true } },
    },
    take: 200, // process in batches
  });

  if (staleRecords.length === 0) {
    logger.info('[Attendance Cron] No stale records to close.');
    return { closed: 0 };
  }

  let closedCount = 0;

  for (const record of staleRecords) {
    try {
      // Get employee's shift for the record's date
      const recordDate = new Date(record.date);
      const shiftAssignment = await prisma.shiftAssignment.findFirst({
        where: {
          employeeId: record.employeeId,
          startDate: { lte: recordDate },
          OR: [{ endDate: null }, { endDate: { gte: recordDate } }],
        },
        include: { shift: true },
        orderBy: { startDate: 'desc' },
      });

      const shift = shiftAssignment?.shift;
      let autoCheckOut: Date;

      if (shift) {
        const [endH, endM] = shift.endTime.split(':').map(Number);
        autoCheckOut = new Date(record.date);
        autoCheckOut.setHours(endH, endM, 0, 0);
        // Handle overnight shifts
        if (endH < parseInt(shift.startTime.split(':')[0])) {
          autoCheckOut.setDate(autoCheckOut.getDate() + 1);
        }
      } else {
        // Default: 18:00 IST
        autoCheckOut = new Date(record.date);
        autoCheckOut.setHours(18, 0, 0, 0);
      }

      const checkIn = new Date(record.checkIn!);
      const totalHours = Math.round(((autoCheckOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)) * 100) / 100;
      const fullDayHours = shift ? Number(shift.fullDayHours) : 8;
      const halfDayHours = shift ? Number(shift.halfDayHours) : 4;
      const status = totalHours < halfDayHours ? 'HALF_DAY' : 'PRESENT';

      await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          checkOut: autoCheckOut,
          totalHours: Math.min(totalHours, fullDayHours), // cap at shift hours
          status,
          notes: `${record.notes || ''} [Auto-closed: employee did not clock out. Set to shift end ${shift?.endTime || '18:00'}]`.trim(),
        },
      });

      // Log the auto-close event
      await prisma.attendanceLog.create({
        data: {
          attendanceId: record.id,
          action: 'AUTO_CLOSE',
          timestamp: new Date(),
          notes: `Auto-closed stale record. CheckOut set to ${autoCheckOut.toISOString()}`,
        },
      });

      closedCount++;
    } catch (err) {
      logger.error(`[Attendance Cron] Failed to auto-close record ${record.id}:`, err);
    }
  }

  logger.info(`[Attendance Cron] Auto-closed ${closedCount} stale records.`);
  return { closed: closedCount };
}

/**
 * Auto-mark absent employees
 * For all active employees with no attendance record and no approved leave, create ABSENT record
 */
async function autoMarkAbsent() {
  const yesterday = getISTYesterday();
  logger.info(`[Attendance Cron] Running auto-mark absent for ${yesterday.toISOString().split('T')[0]}...`);

  const organizations = await prisma.organization.findMany({ select: { id: true } });
  let totalMarked = 0;

  for (const org of organizations) {
    try {
      // Get all active employees
      const employees = await prisma.employee.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          status: { in: ['ACTIVE', 'PROBATION'] },
          isSystemAccount: { not: true },
        },
        select: { id: true },
      });

      if (employees.length === 0) continue;

      const employeeIds = employees.map(e => e.id);

      // Get employees who already have attendance records for yesterday
      const existingRecords = await prisma.attendanceRecord.findMany({
        where: { employeeId: { in: employeeIds }, date: yesterday },
        select: { employeeId: true },
      });
      const hasRecordSet = new Set(existingRecords.map(r => r.employeeId));

      // Get employees on approved leave
      const onLeave = await prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
          startDate: { lte: yesterday },
          endDate: { gte: yesterday },
        },
        select: { employeeId: true },
      });
      const onLeaveSet = new Set(onLeave.map(l => l.employeeId));

      // Check holidays (include isHalfDay field)
      const holiday = await prisma.holiday.findFirst({
        where: { organizationId: org.id, date: yesterday },
        select: { name: true, isHalfDay: true, halfDaySession: true },
      });

      // Check if yesterday was a week-off day using org policy (fallback)
      const orgPolicy = await prisma.attendancePolicy.findUnique({ where: { organizationId: org.id } });
      const weekOffDaySet = new Set<number>(
        (orgPolicy?.weekOffDays as number[] | null)?.length
          ? (orgPolicy!.weekOffDays as number[])
          : [0]
      );

      // Fetch shift assignments for all employees to get per-shift weekOffDays and workMode
      const shiftAssignments = await prisma.shiftAssignment.findMany({
        where: {
          employeeId: { in: employeeIds },
          startDate: { lte: yesterday },
          OR: [{ endDate: null }, { endDate: { gte: yesterday } }],
        },
        include: { shift: { select: { weekOffDays: true, shiftType: true } } },
      });
      const empShiftMap = new Map<string, number[]>();
      const empWorkModeMap = new Map<string, string>();
      for (const sa of shiftAssignments) {
        const shiftWeekOff = sa.shift?.weekOffDays as number[] | null;
        if (shiftWeekOff?.length) empShiftMap.set(sa.employeeId, shiftWeekOff);
        const wm = sa.shift?.shiftType === 'FIELD' ? 'FIELD_SALES' : 'OFFICE';
        empWorkModeMap.set(sa.employeeId, wm);
      }

      // Create records for employees without attendance
      const toCreate: any[] = [];
      for (const empId of employeeIds) {
        if (hasRecordSet.has(empId)) continue; // already has record

        // Use per-shift weekOffDays if available, otherwise fall back to org policy
        const empWeekOffSet = empShiftMap.has(empId)
          ? new Set(empShiftMap.get(empId)!)
          : weekOffDaySet;
        const isWeekend = empWeekOffSet.has(yesterday.getDay());

        let status: string;
        let notes: string;

        if (holiday && !holiday.isHalfDay) {
          // Full-day holiday — mark all employees as HOLIDAY
          status = 'HOLIDAY';
          notes = `[Auto-marked: ${holiday.name}]`;
        } else if (isWeekend) {
          status = 'WEEKEND';
          notes = `[Auto-marked: ${yesterday.getDay() === 0 ? 'Sunday' : 'Saturday'}]`;
        } else if (onLeaveSet.has(empId)) {
          status = 'ON_LEAVE';
          notes = '[Auto-marked: on approved leave]';
        } else if (holiday?.isHalfDay) {
          // Present for a half-day holiday but no record — mark as HALF_DAY
          status = 'HALF_DAY';
          notes = `[Auto-marked: half-day holiday ${holiday.name}]`;
        } else {
          status = 'ABSENT';
          notes = '[Auto-marked absent by system]';
        }

        toCreate.push({
          employeeId: empId,
          date: yesterday,
          status,
          workMode: empWorkModeMap.get(empId) || 'OFFICE',
          source: 'MANUAL_HR',
          notes,
        });
      }

      if (toCreate.length > 0) {
        await prisma.attendanceRecord.createMany({
          data: toCreate,
          skipDuplicates: true, // safety: skip if unique constraint (employeeId, date) violated
        });
        totalMarked += toCreate.length;
      }
    } catch (err) {
      logger.error(`[Attendance Cron] Failed to auto-mark absent for org ${org.id}:`, err);
    }
  }

  logger.info(`[Attendance Cron] Auto-marked ${totalMarked} records.`);
  return { marked: totalMarked };
}

/**
 * Auto-detect anomalies for all orgs for yesterday
 * Runs at 00:15 IST after auto-close and auto-mark-absent have settled
 */
async function autoDetectAnomalies() {
  const yesterday = getISTYesterday();
  const dateStr = yesterday.toISOString().split('T')[0];
  logger.info(`[Attendance Cron] Running auto-detect anomalies for ${dateStr}...`);

  const organizations = await prisma.organization.findMany({ select: { id: true } });
  let totalDetected = 0;

  for (const org of organizations) {
    try {
      const result = await attendanceService.detectAnomalies(org.id, dateStr);
      totalDetected += (result as any)?.created ?? 0;
    } catch (err) {
      logger.error(`[Attendance Cron] Anomaly detection failed for org ${org.id}:`, err);
    }
  }

  logger.info(`[Attendance Cron] Auto-detected ${totalDetected} anomalies for ${dateStr}.`);
  return { detected: totalDetected, date: dateStr };
}

export function startAttendanceCronWorker() {
  const worker = new Worker(
    'attendance-cron',
    async (job: Job) => {
      switch (job.name) {
        case 'auto-close-stale':
          return autoCloseStaleRecords();
        case 'auto-mark-absent':
          return autoMarkAbsent();
        case 'auto-detect-anomalies':
          return autoDetectAnomalies();
        default:
          logger.warn(`[Attendance Cron] Unknown job name: ${job.name}`);
      }
    },
    { connection: bullmqConnection, concurrency: 1 }
  );

  worker.on('completed', (job) => {
    logger.info(`[Attendance Cron] Job ${job.name} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Attendance Cron] Job ${job?.name} failed:`, err);
  });

  logger.info('✅ Attendance cron worker started');
  return worker;
}
