import { Worker, Job } from 'bullmq';
import { bullmqConnection, enqueueNotification, enqueueEmail } from '../queues.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { attendanceService } from '../../modules/attendance/attendance.service.js';
import { redis } from '../../lib/redis.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTToday(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${day}T00:00:00.000Z`);
}

function getISTYesterday(): Date {
  const todayUTC = getISTToday();
  return new Date(todayUTC.getTime() - 24 * 60 * 60 * 1000);
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
      employee: { select: { id: true, organizationId: true, userId: true } },
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
      const rawHours = Math.round(((autoCheckOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)) * 100) / 100;
      const fullDayHours = shift ? Number(shift.fullDayHours) : 8;
      const halfDayHours = shift ? Number(shift.halfDayHours) : 4;
      // Cap at 9h: employee forgot to checkout, don't credit OT or inflated hours
      const MAX_AUTO_HOURS = 9;
      const totalHours = Math.min(rawHours, MAX_AUTO_HOURS);
      const status = totalHours < halfDayHours ? 'HALF_DAY' : 'PRESENT';

      await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          checkOut: autoCheckOut,
          totalHours,
          status,
          source: 'SYSTEM_AUTO_CLOSE',
          notes: `${record.notes || ''} [Auto-closed: employee did not clock out. Set to shift end ${shift?.endTime || '18:00'}. Hours capped at ${MAX_AUTO_HOURS}h]`.trim(),
        },
      });

      // E7: Send in-app notification to employee
      if (record.employee.userId) {
        try {
          await enqueueNotification({
            userId: record.employee.userId,
            organizationId: record.employee.organizationId,
            type: 'ATTENDANCE',
            title: 'Auto clock-out applied',
            message: `You were automatically clocked out at ${autoCheckOut.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} (shift end). Please review your attendance if needed.`,
            link: '/attendance',
          });
        } catch (e) {
          // non-blocking
        }
      }

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

  const GAP_THRESHOLD_MINUTES = 30;

  for (const org of organizations) {
    try {
      const result = await attendanceService.detectAnomalies(org.id, dateStr);
      totalDetected += (result as any)?.created ?? 0;
    } catch (err) {
      logger.error(`[Attendance Cron] Anomaly detection failed for org ${org.id}:`, err);
    }

    // E12: GPS trail gap detection for FIELD_SALES employees
    try {
      const fieldRecords = await prisma.attendanceRecord.findMany({
        where: {
          date: yesterday,
          workMode: 'FIELD_SALES',
          employee: { organizationId: org.id, deletedAt: null },
        },
        select: { id: true, employeeId: true },
      });

      for (const record of fieldRecords) {
        try {
          const points = await prisma.gPSTrailPoint.findMany({
            where: { employeeId: record.employeeId, date: yesterday },
            orderBy: { timestamp: 'asc' },
          });

          for (let i = 1; i < points.length; i++) {
            const gapMs = new Date(points[i].timestamp).getTime() - new Date(points[i - 1].timestamp).getTime();
            const gapMin = gapMs / 60000;
            if (gapMin > GAP_THRESHOLD_MINUTES) {
              await prisma.attendanceAnomaly.upsert({
                where: { attendanceId_type: { attendanceId: record.id, type: 'GPS_GAP' } },
                create: {
                  attendanceId: record.id,
                  employeeId: record.employeeId,
                  organizationId: org.id,
                  date: yesterday,
                  type: 'GPS_GAP',
                  severity: 'MEDIUM',
                  description: `GPS signal gap of ${Math.round(gapMin)} min detected during shift`,
                  metadata: {
                    gapMinutes: Math.round(gapMin),
                    gapStartAt: new Date(points[i - 1].timestamp).toISOString(),
                    gapEndAt: new Date(points[i].timestamp).toISOString(),
                  },
                  resolution: 'PENDING',
                  autoDetected: true,
                },
                update: {},
              });
              totalDetected++;
              break; // One GPS_GAP anomaly per record is enough
            }
          }
        } catch (recordErr) {
          logger.error(`[Attendance Cron] GPS gap detection failed for record ${record.id}:`, recordErr);
        }
      }
    } catch (gpsErr) {
      logger.error(`[Attendance Cron] GPS gap detection failed for org ${org.id}:`, gpsErr);
    }
  }

  logger.info(`[Attendance Cron] Auto-detected ${totalDetected} anomalies for ${dateStr}.`);
  return { detected: totalDetected, date: dateStr };
}

/**
 * Checks all employees with active GPS tracking (gps:active:* in Redis).
 * If their heartbeat key (gps:hb:*) has expired, they likely force-stopped the app.
 * Emails HR and removes the stale active-tracking key.
 */
async function gpsHeartbeatMonitor() {
  logger.info('[GPS Monitor] Running heartbeat check…');
  let alerted = 0;

  type GpsActivePayload = {
    orgId: string;
    employeeId: string;
    attendanceId?: string;
    name: string;
    employeeCode: string;
    alertSent: boolean;
    lastHeartbeatAt?: string;
    lastLatitude?: number;
    lastLongitude?: number;
    lastGpsPointAt?: string;
    checkInAt?: string;
    deviceManufacturer?: string;
    deviceBrand?: string;
    deviceModel?: string;
    sdkInt?: number;
  };

  // Scan all active tracking keys
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'gps:active:*', 'COUNT', 50);
    cursor = nextCursor;

    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;

      let data: GpsActivePayload;
      try { data = JSON.parse(raw); } catch { continue; }

      const hbKey = `gps:hb:${data.employeeId}`;
      const heartbeatAlive = await redis.exists(hbKey);

      // Resolve open GPS_HEARTBEAT_MISSED anomaly when heartbeat recovers
      if (heartbeatAlive && data.alertSent) {
        const today = new Date(new Date().toISOString().slice(0, 10));
        try {
          const existing = await prisma.attendanceAnomaly.findFirst({
            where: {
              employeeId: data.employeeId,
              type: 'GPS_HEARTBEAT_MISSED',
              date: today,
              resolution: 'PENDING',
            },
          });
          if (existing) {
            await prisma.attendanceAnomaly.update({
              where: { id: existing.id },
              data: {
                resolution: 'AUTO_RESOLVED',
                resolverRemarks: 'GPS tracking resumed — service restarted after force-stop',
                resolvedAt: new Date(),
                resolvedBy: 'system',
              },
            });
            logger.info(`[GPS Monitor] Resolved GPS_HEARTBEAT_MISSED anomaly for ${data.employeeCode}`);
          }
        } catch (resolveErr) {
          logger.warn('[GPS Monitor] Failed to resolve anomaly:', resolveErr);
        }
      }

      if (heartbeatAlive) continue; // heartbeat still valid — all good
      if (data.alertSent) continue; // already alerted for this session

      // Heartbeat expired → check if employee already checked out (Phase 5 — avoid false alerts)
      const today = new Date(new Date().toISOString().slice(0, 10));
      let attendanceId = data.attendanceId;
      try {
        const openRecord = await prisma.attendanceRecord.findFirst({
          where: {
            employeeId: data.employeeId,
            date: today,
            checkIn: { not: null },
            checkOut: null,
          },
          select: { id: true },
          orderBy: { checkIn: 'desc' },
        });
        if (!openRecord) {
          // Employee already checked out — stale Redis key, clean up
          logger.info(`[GPS Monitor] Employee ${data.employeeCode} already checked out — cleaning up stale Redis keys`);
          await redis.del(key, hbKey);
          continue;
        }
        attendanceId = openRecord.id;
      } catch { /* fall through to alert even if lookup fails */ }

      logger.info(`[GPS Monitor] Heartbeat expired for ${data.name} (${data.employeeCode}) — sending force-stop alert`);

      try {
        // Create GPS_HEARTBEAT_MISSED anomaly immediately so HR desktop shows it in real time (Phase 4)
        if (attendanceId) {
          await prisma.attendanceAnomaly.upsert({
            where: { attendanceId_type: { attendanceId, type: 'GPS_HEARTBEAT_MISSED' } },
            create: {
              attendanceId,
              employeeId: data.employeeId,
              organizationId: data.orgId,
              date: today,
              type: 'GPS_HEARTBEAT_MISSED',
              severity: 'HIGH',
              description: `GPS heartbeat missed — ${data.name} (${data.employeeCode}) app may have been force-stopped (no heartbeat for >15 min)`,
              metadata: {
                lastHeartbeatAt: data.lastHeartbeatAt ?? null,
                lastGpsPointAt:  data.lastGpsPointAt  ?? null,
                lastLatitude:    data.lastLatitude  ?? null,
                lastLongitude:   data.lastLongitude ?? null,
              },
            },
            update: {}, // don't overwrite if already exists from a previous run
          });
        }

        const [org, hrUsers, emp] = await Promise.all([
          prisma.organization.findUnique({ where: { id: data.orgId }, select: { name: true, adminNotificationEmail: true } }),
          prisma.user.findMany({
            where: { organizationId: data.orgId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, status: 'ACTIVE' },
            select: { email: true },
          }),
          prisma.employee.findUnique({
            where: { id: data.employeeId },
            select: { department: { select: { name: true } } },
          }),
        ]);

        const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
        const recipientSet = new Set<string>(hrUsers.map(u => u.email).filter(Boolean));
        if (org?.adminNotificationEmail) recipientSet.add(org.adminNotificationEmail);

        // Build last-known-location string for email body (Phase 6)
        const hasCoords = data.lastLatitude != null && data.lastLongitude != null;
        const coordsStr = hasCoords
          ? `${data.lastLatitude!.toFixed(6)}, ${data.lastLongitude!.toFixed(6)}`
          : 'Unknown';
        const lastPointStr = data.lastGpsPointAt
          ? new Date(data.lastGpsPointAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short', dateStyle: 'short' })
          : 'Unknown';
        const lastHbStr = data.lastHeartbeatAt
          ? new Date(data.lastHeartbeatAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short', dateStyle: 'short' })
          : 'Unknown';

        const checkInStr = data.checkInAt
          ? new Date(data.checkInAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short', dateStyle: 'short' })
          : 'Unknown';
        const deviceStr = [data.deviceManufacturer, data.deviceModel].filter(Boolean).join(' ') || '—';
        const sdkStr = data.sdkInt ? `Android API ${data.sdkInt}` : '—';

        for (const to of recipientSet) {
          await enqueueEmail({
            to,
            subject: `🚨 App Force-Stopped During GPS Tracking — ${data.name} (${data.employeeCode})`,
            template: 'gps-alert',
            context: {
              empName: data.name,
              empCode: data.employeeCode,
              dept: emp?.department?.name || '—',
              orgName: org?.name || 'Aniston Technologies',
              alertType: 'App Force-Stopped',
              alertDesc: `${data.name} force-stopped the Aniston HRMS app while GPS tracking was active (no heartbeat received for >15 minutes).`,
              lastHeartbeatAt: lastHbStr,
              lastGpsPointAt:  lastPointStr,
              lastCoordinates: coordsStr,
              checkInAt: checkInStr,
              device: deviceStr,
              sdkVersion: sdkStr,
              mapsUrl: hasCoords
                ? `https://www.google.com/maps?q=${data.lastLatitude},${data.lastLongitude}`
                : null,
              isRevoked: false,
              timestamp: now,
              dashboardUrl: 'https://hr.anistonav.com/attendance',
            },
          }).catch(() => {});
        }

        // Mark alert sent and update key so we don't spam on next run
        data.alertSent = true;
        await redis.set(key, JSON.stringify(data), 'EX', 3600); // expire in 1 hour
        alerted++;
      } catch (err) {
        logger.error(`[GPS Monitor] Failed to send alert for ${data.employeeId}:`, err);
      }
    }
  } while (cursor !== '0');

  logger.info(`[GPS Monitor] Done — alerted for ${alerted} employee(s).`);
  return { alerted };
}

/**
 * Shift-end checkout reminder
 * Runs every 15 min. For each org, finds employees whose shift ended 15 min ago
 * and who are still clocked in (checkOut=null). Sends an in-app push notification.
 */
async function shiftEndCheckoutReminder() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istNow = new Date(utc + IST_OFFSET_MS);
  const currentISTMinutes = istNow.getHours() * 60 + istNow.getMinutes();

  // Only run between 16:00 and 23:59 IST (shifts end in this window, no point running at 3am)
  if (istNow.getHours() < 16) return { reminded: 0 };

  const today = getISTToday();
  logger.info(`[Shift Reminder] Running shift-end checkout reminder at IST ${istNow.toTimeString().slice(0, 5)}…`);

  // Find all open attendance records for today that have not checked out
  const openRecords = await prisma.attendanceRecord.findMany({
    where: {
      date: today,
      checkIn: { not: null },
      checkOut: null,
    },
    include: {
      employee: {
        select: {
          id: true,
          organizationId: true,
          userId: true,
          shiftAssignments: {
            where: {
              startDate: { lte: today },
              OR: [{ endDate: null }, { endDate: { gte: today } }],
            },
            include: { shift: { select: { endTime: true, name: true } } },
            orderBy: { startDate: 'desc' },
            take: 1,
          },
        },
      },
    },
    take: 500,
  });

  let reminded = 0;
  for (const record of openRecords) {
    try {
      const shift = record.employee.shiftAssignments?.[0]?.shift;
      if (!shift) continue;
      const [endH, endM] = shift.endTime.split(':').map(Number);
      const shiftEndMinutes = endH * 60 + endM;
      // Check if shift ended 10–30 minutes ago (narrow window to avoid repeat toasts)
      const minutesSinceEnd = currentISTMinutes - shiftEndMinutes;
      if (minutesSinceEnd < 10 || minutesSinceEnd > 30) continue;

      // Deduplicate: only send once per employee per shift-end using Redis
      const dedupKey = `shift-reminder:${record.employeeId}:${today.toISOString().split('T')[0]}`;
      const alreadySent = await redis.exists(dedupKey);
      if (alreadySent) continue;
      await redis.set(dedupKey, '1', 'EX', 3600); // expire in 1h

      if (record.employee.userId) {
        await enqueueNotification({
          userId: record.employee.userId,
          organizationId: record.employee.organizationId,
          type: 'ATTENDANCE',
          title: 'Don\'t forget to check out!',
          message: `Your shift (${shift.name}) ended at ${shift.endTime}. Please clock out to complete your attendance for today.`,
          link: '/attendance',
        });
        reminded++;
      }
    } catch (err) {
      logger.error(`[Shift Reminder] Failed for record ${record.id}:`, err);
    }
  }

  logger.info(`[Shift Reminder] Sent ${reminded} checkout reminders.`);
  return { reminded };
}

/**
 * Purge GPS trail data older than 90 days.
 * Runs weekly on Sunday at 02:00 IST to keep DB lean.
 */
async function purgeOldGPSTrailData() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utc + IST_OFFSET_MS);
  const cutoffDate = new Date(ist.getTime() - 90 * 24 * 60 * 60 * 1000);
  const cutoffStr = `${cutoffDate.getUTCFullYear()}-${String(cutoffDate.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getUTCDate()).padStart(2, '0')}T00:00:00.000Z`;
  const cutoff = new Date(cutoffStr);

  logger.info(`[GPS Purge] Purging GPS trail data older than ${cutoff.toISOString().split('T')[0]}…`);

  try {
    const trailResult = await prisma.gPSTrailPoint.deleteMany({
      where: { date: { lt: cutoff } },
    });
    const visitResult = await prisma.locationVisit.deleteMany({
      where: { arrivalTime: { lt: cutoff } },
    });
    logger.info(`[GPS Purge] Deleted ${trailResult.count} GPS points, ${visitResult.count} location visits.`);
    return { points: trailResult.count, visits: visitResult.count };
  } catch (err) {
    logger.error('[GPS Purge] Failed:', err);
    return { points: 0, visits: 0 };
  }
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
        case 'gps-heartbeat-monitor':
          return gpsHeartbeatMonitor();
        case 'shift-end-reminder':
          return shiftEndCheckoutReminder();
        case 'purge-gps-trail':
          return purgeOldGPSTrailData();
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
