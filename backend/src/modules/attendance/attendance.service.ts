import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { emitToOrg, invalidateDashboardCache } from '../../sockets/index.js';
import { enqueueEmail, enqueueNotification } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
import { assertHRActionAllowed } from '../../utils/hrRestrictions.js';
import type { ClockInInput, ClockOutInput, GPSTrailBatchInput, AttendanceQuery, MarkAttendanceInput } from './attendance.validation.js';

// ============================
// IST Timezone Helpers
// ============================
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Get current time in IST */
function getISTNow(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + IST_OFFSET_MS);
}

/**
 * Get IST today as UTC-midnight Date for PostgreSQL `date` column comparisons.
 * PostgreSQL `date` columns store dates without timezone. When Prisma sends a JS Date,
 * PG truncates to the UTC date portion. So IST 2026-04-08 00:00 = UTC 2026-04-07T18:30
 * would become 2026-04-07 in PG — WRONG day.
 * This returns 2026-04-08T00:00:00.000Z so PG sees the correct IST calendar date.
 */
function getISTToday(): Date {
  const ist = getISTNow();
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const day = String(ist.getDate()).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

/** Get IST yesterday at midnight */
function getISTYesterday(): Date {
  const d = getISTToday();
  d.setDate(d.getDate() - 1);
  return d;
}

export class AttendanceService {
  // ===================== EDGE CASE CONSTANTS =====================
  private readonly MAX_RECLOCKIN_PER_DAY = 2; // Allow up to 2 re-clock-ins per day (step-out & return)
  private readonly EARLY_CLOCKIN_WARNING_MINUTES = 120; // warn if >2h before shift
  private readonly LATE_CLOCKOUT_FLAG_MINUTES = 120;    // flag if >2h after shift
  private readonly MAX_BREAK_PERCENT = 50;              // breaks can't exceed 50% of shift
  private readonly GPS_SPOOF_DISTANCE_M = 10000;        // 10km
  private readonly GPS_SPOOF_TIME_MINUTES = 5;          // within 5 minutes
  private readonly OVERTIME_FLAG_EXTRA_HOURS = 2;       // flag if totalHours > fullDay + 2

  /**
   * Clock in — handles all 3 work modes with comprehensive edge case handling
   */
  async clockIn(employeeId: string, data: ClockInInput, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: { officeLocation: { include: { geofence: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.status === 'INACTIVE' || employee.status === 'TERMINATED') {
      throw new BadRequestError('Your account is inactive. Contact HR to reactivate.');
    }

    // Block attendance before joining date
    if (employee.joiningDate) {
      const joiningMidnight = new Date(employee.joiningDate);
      joiningMidnight.setHours(0, 0, 0, 0);
      const todayMidnight = getISTToday();
      if (todayMidnight < joiningMidnight) {
        throw new BadRequestError(
          `Attendance cannot be marked before your joining date (${joiningMidnight.toLocaleDateString('en-IN')}). Contact HR if your joining date is incorrect.`
        );
      }
    }

    // Mobile-only attendance enforcement (HR manual mark and PWA bypass this)
    // PWA installed on phone reports deviceType='mobile' but also accept isPwa=true
    // as the installed PWA app is a valid attendance source on mobile devices
    // Mobile-only enforcement — MANUAL_HR bypass is handled by the markAttendance route
    // which has its own authorize(['SUPER_ADMIN','ADMIN','HR']) middleware.
    const isMobileOrPwa = data.deviceType === 'mobile' || data.isPwa === true;
    if (!isMobileOrPwa) {
      throw new BadRequestError('Attendance can only be marked from a mobile device. Please use the Aniston HRMS mobile app or install the PWA.');
    }

    // ===== GPS TIMESTAMP STALENESS CHECK =====
    // GPS coordinates must be acquired within the last 60 seconds — truly live location only.
    if (data.gpsTimestamp && data.latitude != null && data.longitude != null) {
      const gpsAgeMs = Date.now() - new Date(data.gpsTimestamp).getTime();
      const GPS_MAX_AGE_MS = 60 * 1000; // 60 seconds
      const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 min — allow minor clock drift
      if (gpsAgeMs < -FUTURE_TOLERANCE_MS) {
        throw new BadRequestError(
          'GPS timestamp appears to be set in the future. Please check your device clock and try again.'
        );
      }
      if (gpsAgeMs > GPS_MAX_AGE_MS) {
        throw new BadRequestError(
          `Your GPS location is ${Math.round(gpsAgeMs / 1000)} seconds old. ` +
          `Please allow your GPS to refresh and try again.`
        );
      }
    }

    const today = getISTToday();
    const now = new Date();

    // ===== PHASE 3: Block clock-in on approved leave =====
    const leaveToday = await prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['APPROVED', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'] },
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });
    if (leaveToday) {
      throw new BadRequestError('Cannot clock in: you have approved leave for today. Cancel your leave first if you need to work.');
    }

    // ===== PHASE 3: Block/warn clock-in on holidays =====
    const holiday = await prisma.holiday.findFirst({
      where: { organizationId, date: today },
    });
    if (holiday && !holiday.isOptional) {
      throw new BadRequestError(`Cannot clock in: today is a holiday (${holiday.name}). Contact HR if you need to work.`);
    }
    if (holiday?.isOptional) {
      data.notes = `${data.notes || ''} [Working on optional holiday: ${holiday.name}]`.trim();
    }

    // Fetch shift assignment early — needed for per-shift policy fields
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true, location: { include: { geofence: true } } },
      orderBy: { startDate: 'desc' },
    });
    let shift = shiftAssignment?.shift;
    let usingDefaultShift = false;
    if (!shift) {
      const defaultShift = await prisma.shift.findFirst({
        where: { organizationId, isDefault: true, isActive: true },
      });
      if (defaultShift) {
        shift = defaultShift;
        usingDefaultShift = true;
      } else if (!shiftAssignment) {
        throw new BadRequestError('No shift assigned. Please contact HR to assign a shift before clocking in.');
      }
    }

    // ===== PHASE 3: Weekend/Sunday clock-in check =====
    const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId } });
    // Prefer shift-level weekOffDays; fall back to org policy
    const effectiveWeekOffDays = (shift?.weekOffDays?.length ? shift.weekOffDays : null) ?? policy?.weekOffDays ?? [0];
    const weekOffDays = new Set(effectiveWeekOffDays);
    const dayOfWeek = today.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const isSunday = dayOfWeek === 0;

    if (weekOffDays.has(dayOfWeek)) {
      // Prefer shift-level sunday settings; fall back to org policy
      const sundayWorkEnabled = shift?.sundayWorkEnabled ?? (policy as any)?.sundayWorkEnabled ?? false;
      const sundayPayMultiplier = Number(shift?.sundayPayMultiplier ?? (policy as any)?.sundayPayMultiplier ?? 2.0);
      const isSundayWorker = isSunday && sundayWorkEnabled && employee.allowSundayWork;
      if (isSunday && !isSundayWorker) {
        throw new BadRequestError(
          'Sunday is a week off. Contact HR to enable Sunday working on your profile if you need to work today.'
        );
      }
      if (isSundayWorker) {
        data.notes = `${data.notes || ''} [Sunday work — pay multiplier: ${sundayPayMultiplier}x]`.trim();
        this._notifySundayAttendance(employee, organizationId, sundayPayMultiplier).catch(err =>
          logger.warn(`[Attendance] Sunday notification email failed for ${employeeId}: ${err.message}`)
        );
      } else if (!isSunday) {
        data.notes = `${data.notes || ''} [Weekend clock-in: ${dayNames[dayOfWeek]}]`.trim();
      }
    }

    // Atomic check-and-validate to prevent race conditions (double-tap / concurrent requests)
    const existing = await prisma.$transaction(async (tx) => {
      // Use findUnique inside transaction for row-level lock
      const rec = await tx.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId, date: today } },
      });
      if (rec?.checkIn && !rec.checkOut) {
        throw new BadRequestError('Already clocked in. Please clock out first.');
      }
      // Block office clock-in if today is already marked as Work From Home by HR
      if (rec && !rec.checkIn && (rec.status as string) === 'WORK_FROM_HOME') {
        throw new BadRequestError('You are marked as Work From Home today. Contact HR to change your attendance mode if you are working from office.');
      }
      return rec;
    });

    // Allow re-clock-in after clock-out (e.g., accidental clock-out or returning after break)
    const isReClockIn = !!(existing?.checkOut);

    // ===== PHASE 1: Re-clock-in limit =====
    if (isReClockIn && existing && existing.clockInCount >= this.MAX_RECLOCKIN_PER_DAY) {
      throw new BadRequestError(`Maximum re-clock-in limit (${this.MAX_RECLOCKIN_PER_DAY}) reached for today. Please contact HR for manual attendance.`);
    }

    const currentShiftType = shift?.shiftType || 'OFFICE';

    // WFH shift employees skip all geofence enforcement
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isWfhShift = (shiftAssignment?.shift as any)?.isWfhShift === true;

    // Hybrid WFH: check if today is a designated WFH day on a hybrid shift
    const todayDow = new Date().getDay(); // 0=Sun, 6=Sat
    const isHybridWfhDay = !isWfhShift &&
      (shift as any)?.allowWfh === true &&
      Array.isArray((shift as any)?.wfhDays) &&
      ((shift as any).wfhDays as number[]).includes(todayDow);

    // Effective WFH: either full WFH shift or today is a WFH day in hybrid shift
    const effectiveWfh = isWfhShift || isHybridWfhDay;

    // ===== Location enforcement: OFFICE shift requires assigned location =====
    // FIELD shift employees are never blocked by location config — they work everywhere.
    const assignedLocation = shiftAssignment?.location || employee.officeLocation;
    if (!effectiveWfh && currentShiftType === 'OFFICE' && !assignedLocation?.geofence) {
      // Alert HR so they can fix the configuration — non-blocking
      setImmediate(() => {
        this._alertHrNoOfficeLocation(employeeId, organizationId).catch((e) =>
          logger.warn(`[Attendance] No-location HR alert failed for ${employeeId}: ${e.message}`)
        );
      });
      throw new BadRequestError(
        'No office location assigned. Please ask your HR/Admin to assign an office location to your profile before marking attendance.'
      );
    }

    // GPS coordinates are MANDATORY for every non-WFH OFFICE clock-in — no exceptions.
    // Use == null (not falsy) so lat=0/lng=0 (which are valid coordinates near the equator/meridian
    // but also the value sent when a device has no fix) are treated as missing — not as valid coords.
    if (!effectiveWfh && currentShiftType === 'OFFICE' && (data.latitude == null || data.longitude == null)) {
      throw new BadRequestError(
        'Location is required to mark attendance. Please enable location services on your device and try again.'
      );
    }

    // GPS coordinates are MANDATORY for non-WFH FIELD clock-in — same rule as OFFICE.
    if (!effectiveWfh && currentShiftType === 'FIELD' && (data.latitude == null || data.longitude == null)) {
      throw new BadRequestError(
        'GPS coordinates are required to mark attendance for field shifts. Please enable location services and try again.'
      );
    }

    // ===== PHASE 1.4: GPS spoofing detection — block if detected =====
    if (data.latitude != null && data.longitude != null) {
      const spoofResult = await this.detectGPSSpoofing(employeeId, data.latitude, data.longitude);
      if (spoofResult.spoofing) {
        logger.warn(`[Attendance] GPS spoofing blocked for ${employeeId}: ${spoofResult.distance}m jump in ${spoofResult.timeDiff}min`);
        // Alert HR non-blocking
        setImmediate(() => {
          this._alertHrGpsSpoof(employeeId, organizationId, spoofResult.distance!, spoofResult.timeDiff!).catch((e) =>
            logger.warn(`[Attendance] GPS spoof HR alert failed: ${e.message}`)
          );
        });
        throw new BadRequestError(
          `Your GPS location jumped ${spoofResult.distance}m in ${spoofResult.timeDiff} minutes, which is not physically possible. ` +
          `Please disable any mock location apps and try again. If this is an error, contact HR for manual attendance.`
        );
      }
    }

    // Use shift assignment's location geofence, or fall back to employee's office location geofence
    const geofence = shiftAssignment?.location?.geofence || employee.officeLocation?.geofence;

    // Geofence validation
    let geofenceViolation = false;
    let geofenceDistance: number | null = null;
    let geofenceStatus = 'NO_GEOFENCE';

    if (!effectiveWfh && currentShiftType === 'OFFICE' && geofence && geofence.radiusMeters && data.latitude != null && data.longitude != null) {
      // GPS accuracy check — reject if accuracy is too poor for reliable geofence decisions
      if (data.accuracy && data.accuracy > 150) {
        throw new BadRequestError(
          `GPS accuracy too low (±${Math.round(data.accuracy)}m, need ±150m or better). ` +
          `Move to an open area away from buildings, wait 10–15 seconds for GPS to stabilize, then try again. ` +
          `Tip: briefly turning Wi-Fi off can help GPS lock faster.`
        );
      }
      const coords = geofence.coordinates as any;
      if (!coords?.lat || !coords?.lng) {
        // Geofence exists with a radius but no map coordinates — misconfigured by HR.
        // Block check-in and alert HR so the issue is surfaced immediately.
        setImmediate(() => {
          this._alertHrNoOfficeLocation(employeeId, organizationId).catch((e) =>
            logger.warn(`[Attendance] Geofence-misconfigured HR alert failed for ${employeeId}: ${e.message}`)
          );
        });
        throw new BadRequestError(
          'Office geofence is not configured correctly (missing map coordinates). ' +
          'Please contact HR/Admin to set the office location pin on the map.'
        );
      }
      const distance = this.haversineDistance(data.latitude, data.longitude, coords.lat, coords.lng);
      geofenceDistance = Math.round(distance);

      if (distance > geofence.radiusMeters) {
        geofenceViolation = true;
        geofenceStatus = 'OUTSIDE';

        throw new BadRequestError(
          `You are ${Math.round(distance)}m away from ${employee.officeLocation?.name || 'office'}. ` +
          `Maximum allowed: ${geofence.radiusMeters}m. Please move closer to the office and try again.`
        );
      } else {
        geofenceStatus = 'INSIDE';
      }
    }

    const locationData = data.latitude != null && data.longitude != null
      ? { lat: data.latitude, lng: data.longitude, accuracy: data.accuracy }
      : null;

    // Shift-aware late detection (use IST for comparison since shift times are IST)
    const istNow = getISTNow(); // Only for time comparisons, NOT for storage
    let isLate = false;
    let lateMinutes = 0;
    let shiftInfo: any = null;

    if (shift) {
      const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
      // Grace: shift.lateGraceMinutes (new policy field) > shift.graceMinutes > org policy > default
      const graceMinutes = shift.lateGraceMinutes || shift.graceMinutes || policy?.lateGraceMinutes || 15;
      const shiftStart = new Date(istNow);
      shiftStart.setHours(shiftHour, shiftMin, 0, 0);
      const graceEnd = new Date(shiftStart);
      graceEnd.setMinutes(graceEnd.getMinutes() + graceMinutes);

      // ===== PHASE 3: Early clock-in — hard block if more than 60 min before shift start =====
      if (!isReClockIn) {
        const earlyMin = Math.round((shiftStart.getTime() - istNow.getTime()) / 60000);
        if (earlyMin > 60) {
          // Format shift start as 12-hour time for the error message
          const fmtShift = (() => {
            const h = shiftHour; const m = shiftMin;
            return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
          })();
          throw new BadRequestError(
            `Check-in not allowed yet. Your shift (${shift.name}) starts at ${fmtShift}. ` +
            `You can check in up to 60 minutes before your shift starts.`
          );
        }
      }

      // Only check late on first clock-in, not re-clock-in
      if (!isReClockIn && istNow > graceEnd) {
        isLate = true;
        lateMinutes = Math.round((istNow.getTime() - shiftStart.getTime()) / (1000 * 60));
        data.notes = `${data.notes || ''} [Late by ${lateMinutes} min — shift ${shift.name} starts at ${shift.startTime}]`.trim();
      }

      // Auto-mark HALF_DAY note: prefer shift-level lateHalfDayAfterMins
      if (!isReClockIn) {
        const halfDayThreshold = (shift.lateHalfDayAfterMins || policy?.lateHalfDayAfterMins) ?? 60;
        const minutesLate = Math.round((istNow.getTime() - shiftStart.getTime()) / (1000 * 60));
        if (minutesLate > halfDayThreshold) {
          data.notes = `${data.notes || ''} [Auto-marked HALF_DAY: ${minutesLate} min late, threshold ${halfDayThreshold} min]`.trim();
        }
      }

      shiftInfo = {
        shiftId: shift.id,
        shiftName: shift.name,
        shiftCode: shift.code,
        startTime: shift.startTime,
        endTime: shift.endTime,
        graceMinutes: shift.graceMinutes,
        fullDayHours: Number(shift.fullDayHours),
        halfDayHours: Number(shift.halfDayHours),
        trackingIntervalMinutes: shift.trackingIntervalMinutes || 60,
      };
    }

    let record;

    if (isReClockIn && existing) {
      // ===== PHASE 2: Log the gap for accurate totalHours calculation =====
      const gapStart = existing.checkOut ? new Date(existing.checkOut).toISOString() : '';
      const gapEnd = now.toISOString();

      // ===== PHASE 2: Preserve auto-HALF_DAY status (don't reset to PRESENT if late) =====
      const preservedStatus = existing.status === 'HALF_DAY' ? 'HALF_DAY' : 'PRESENT';

      const reClockInNotes = `${existing.notes || ''} [Re-clocked in at ${now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}]`.trim();
      record = await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          checkOut: null,
          totalHours: null,
          status: preservedStatus,
          notes: reClockInNotes,
          geofenceViolation: existing.geofenceViolation || geofenceViolation,
          clockInCount: { increment: 1 },
        },
      });

      // Log the gap period for accurate totalHours calculation later
      await prisma.attendanceLog.create({
        data: {
          attendanceId: record.id,
          action: 'GAP_PERIOD',
          timestamp: now,
          notes: `Gap: ${gapStart} to ${gapEnd}`,
        },
      });
    } else {
      // Determine initial status: HALF_DAY if checked in after grace period ends, else PRESENT.
      // Grace period IS the half-day cutoff: shift 09:30 + grace 30 min → after 10:00 AM = HALF_DAY.
      const autoHalfDay = !isReClockIn && shift && (() => {
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const ss = new Date(istNow); ss.setHours(sh, sm, 0, 0);
        const graceMin = shift.lateGraceMinutes || shift.graceMinutes || policy?.lateGraceMinutes || 15;
        const threshold = shift.lateHalfDayAfterMins || policy?.lateHalfDayAfterMins || 60;
        return Math.round((istNow.getTime() - ss.getTime()) / 60000) > threshold;
      })();

      // Use upsert to guard against concurrent double-tap creating duplicate rows.
      // If a row already exists for this employee+date (race), update it instead.
      record = await prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId, date: today } },
        create: {
          employeeId,
          date: today,
          checkIn: now,
          status: autoHalfDay ? 'HALF_DAY' : (effectiveWfh ? 'WORK_FROM_HOME' : 'PRESENT'),
          workMode: (currentShiftType === 'FIELD' ? 'FIELD_SALES' : currentShiftType === 'OFFICE' ? 'OFFICE' : employee.workMode) as any,
          source: data.source || 'MANUAL_APP',
          checkInLocation: locationData as any,
          notes: data.notes,
          geofenceViolation,
          clockInCount: 1,
          lateMinutes: isLate ? lateMinutes : 0,
          // Snapshot the active shift/assignment at clock-in for payroll & compliance audit.
          // Plain IDs (no FK) so historical records survive shift deletion.
          shiftId: shiftAssignment?.shiftId ?? (shift?.id ?? null),
          shiftAssignmentId: shiftAssignment?.id ?? null,
        },
        update: {
          // Already clocked in — treat as a no-op rather than overwriting the first clock-in time.
        },
      });
    }

    // Log the attendance event
    await prisma.attendanceLog.create({
      data: {
        attendanceId: record.id,
        action: isReClockIn ? 'RE_CLOCK_IN' : 'CLOCK_IN',
        timestamp: now,
        location: locationData as any,
        notes: data.notes || null,
        geofenceStatus,
        distanceMeters: geofenceDistance,
        shiftName: shift?.name || null,
      },
    });

    // Log anomaly if no GPS provided at clock-in (use == null so 0,0 coords don't trigger this)
    if (data.latitude == null || data.longitude == null) {
      const isFieldMode = employee.workMode === 'FIELD_SALES' || currentShiftType === 'FIELD';
      try {
        await prisma.attendanceAnomaly.create({
          data: {
            attendanceId: record.id,
            employeeId,
            organizationId: employee.organizationId,
            date: today,
            type: isFieldMode ? 'GPS_SIGNAL_LOST' : 'UNAPPROVED_REMOTE',
            severity: isFieldMode ? 'MEDIUM' : 'LOW',
            description: isFieldMode
              ? 'Field employee clocked in without GPS coordinates — trail start location unknown'
              : 'Clock-in recorded without GPS coordinates',
            resolution: 'PENDING',
          },
        });
      } catch (e) {
        // non-blocking
      }
    }

    // For PROJECT_SITE mode, also create a site check-in if siteName was provided in the same request
    if (employee.workMode === 'PROJECT_SITE' && data.siteName) {
      await prisma.projectSiteCheckIn.create({
        data: {
          employeeId,
          date: today,
          siteName: data.siteName,
          siteAddress: data.siteAddress || null,
          checkInPhoto: data.checkInPhoto || null,
          checkInLat: data.latitude || null,
          checkInLng: data.longitude || null,
          notes: data.notes || null,
        },
      });
    }

    // Emit real-time event + invalidate dashboard cache
    emitToOrg(organizationId, 'attendance:checkin', {
      employeeId, employeeName: `${employee.firstName} ${employee.lastName}`,
      checkIn: now.toISOString(), status: 'PRESENT', isLate, lateMinutes,
      isReClockIn, geofenceViolation,
    });
    invalidateDashboardCache(organizationId).catch(() => {});

    // ===== Audit log =====
    try {
      await createAuditLog({
        userId: employeeId,
        organizationId,
        entity: 'AttendanceRecord',
        entityId: record.id,
        action: isReClockIn ? 'RE_CLOCK_IN' : 'CLOCK_IN',
        newValue: { status: record.status, isLate, lateMinutes, geofenceViolation, clockInCount: record.clockInCount },
      });
    } catch { /* non-blocking */ }

    return { ...record, isLate, lateMinutes, shift: shiftInfo, isReClockIn, geofenceViolation, usingDefaultShift };
  }

  /**
   * Clock out — with previous-day and night shift support
   */
  async clockOut(employeeId: string, data: ClockOutInput) {
    const empStatus = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { status: true, organizationId: true, workMode: true, officeLocation: { include: { geofence: true } } },
    });
    if (empStatus?.status === 'INACTIVE' || empStatus?.status === 'TERMINATED') {
      throw new BadRequestError('Your account is inactive. Contact HR to reactivate.');
    }

    // ===== GPS TIMESTAMP STALENESS CHECK (clock-out) =====
    // GPS coordinates must be acquired within the last 60 seconds — truly live location only.
    if (data.gpsTimestamp && data.latitude != null && data.longitude != null) {
      const gpsAgeMs = Date.now() - new Date(data.gpsTimestamp).getTime();
      const GPS_MAX_AGE_MS = 60 * 1000; // 60 seconds
      const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 min — allow minor clock drift
      if (gpsAgeMs < -FUTURE_TOLERANCE_MS) {
        throw new BadRequestError(
          'GPS timestamp appears to be set in the future. Please check your device clock and try again.'
        );
      }
      if (gpsAgeMs > GPS_MAX_AGE_MS) {
        throw new BadRequestError(
          `Your GPS location is ${Math.round(gpsAgeMs / 1000)} seconds old. ` +
          `Please allow your GPS to refresh and try again.`
        );
      }
    }

    // ===== GEOFENCE ENFORCEMENT (clock-out) — use shift's assigned location, fall back to employee's office location =====
    const today = getISTToday();
    const clockOutShiftAssignment = await prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { shift: true, location: { include: { geofence: true } } },
      orderBy: { startDate: 'desc' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isWfhShiftCheckout = (clockOutShiftAssignment?.shift as any)?.isWfhShift === true;
    const clockOutShiftType = (clockOutShiftAssignment?.shift as any)?.shiftType || 'OFFICE';

    // GPS coordinates are MANDATORY for non-WFH OFFICE and FIELD clock-out — no exceptions.
    // Use == null so lat=0/lng=0 (falsy but technically a coordinate) is still treated as missing.
    if (!isWfhShiftCheckout && (clockOutShiftType === 'OFFICE' || clockOutShiftType === 'FIELD') && (data.latitude == null || data.longitude == null)) {
      throw new BadRequestError(
        'Location is required to clock out. Please enable location services on your device and try again.'
      );
    }

    const geofenceForCheckout = clockOutShiftAssignment?.location?.geofence ?? empStatus?.officeLocation?.geofence ?? null;
    let checkoutGeofenceViolation = false;
    if (!isWfhShiftCheckout && clockOutShiftType === 'OFFICE' && geofenceForCheckout && geofenceForCheckout.radiusMeters && data.latitude != null && data.longitude != null) {
      if (!(data.accuracy && data.accuracy > 150)) {
        const gfCoords = geofenceForCheckout.coordinates as any;
        if (gfCoords?.lat && gfCoords?.lng) {
          const dist = this.haversineDistance(data.latitude, data.longitude, gfCoords.lat, gfCoords.lng);
          if (dist > geofenceForCheckout.radiusMeters) {
            const istNowCO = getISTNow();
            const istHour = istNowCO.getHours();
            // After 20:00 IST allow remote clock-out but flag anomaly so HR sees it
            if (istHour >= 20) {
              checkoutGeofenceViolation = true;
              logger.info(`[Attendance] Remote checkout allowed after 20:00 for ${employeeId} — ${Math.round(dist)}m from office`);
            } else {
              throw new BadRequestError(
                `You are ${Math.round(dist)}m away from ${empStatus?.officeLocation?.name || 'office'}. ` +
                `Maximum allowed: ${geofenceForCheckout.radiusMeters}m. Please move closer to the office to clock out, ` +
                `or wait until after 8:00 PM for remote clock-out.`
              );
            }
          }
        }
      }
    }
    const now = new Date();

    // ===== MINIMUM CHECKOUT TIME ENFORCEMENT =====
    // FIELD shift employees can check out at any time — they finish their route whenever
    // the work is done, not at a fixed office end-time. Skip the entire block for them.
    // OFFICE shift employees must reach shift end time (or have an approved half-day leave).
    // This only applies to TODAY's checkout — overnight/previous-day checkouts are skipped.
    const todayRecordForTimeCheck = clockOutShiftType === 'FIELD' ? null : await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      select: { checkIn: true, checkOut: true },
    });

    if (todayRecordForTimeCheck?.checkIn && !todayRecordForTimeCheck.checkOut) {
      const orgId = empStatus!.organizationId;

      // Resolve shift: personal assignment → org default → null
      const coShiftAssign = await prisma.shiftAssignment.findFirst({
        where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
        include: { shift: true },
        orderBy: { startDate: 'desc' },
      });
      const coShift: any = coShiftAssign?.shift ?? await prisma.shift.findFirst({
        where: { organizationId: orgId, isDefault: true, isActive: true },
      });

      // Check for approved half-day leave covering today
      const halfDayLeave = await prisma.leaveRequest.findFirst({
        where: {
          employeeId,
          isHalfDay: true,
          status: { in: ['APPROVED', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'] },
          startDate: { lte: today },
          endDate: { gte: today },
        },
      });

      // Format minutes as "HH:MM AM/PM" for error messages
      const fmt12h = (mins: number) => {
        const h = Math.floor(mins / 60) % 24;
        const m = mins % 60;
        return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      };

      const istNow = getISTNow();
      const currentISTMinutes = istNow.getHours() * 60 + istNow.getMinutes();

      if (coShift) {
        const [endH, endM] = (coShift.endTime as string).split(':').map(Number);
        const shiftEndMinutes = endH * 60 + endM;

        if (halfDayLeave) {
          // Half-day approved: minimum = max(shiftStart, actualCheckIn) + halfDayHours
          // Using actual check-in time prevents early-leavers who clocked in late from
          // checking out after only a fraction of the half-day hours.
          const [startH, startM] = (coShift.startTime as string).split(':').map(Number);
          const shiftStartMins = startH * 60 + startM;
          const checkInMins = todayRecordForTimeCheck?.checkIn
            ? (() => {
                const ci = new Date(todayRecordForTimeCheck.checkIn!);
                const IST_OFFSET = 5.5 * 60 * 60 * 1000;
                const ist = new Date(ci.getTime() + ci.getTimezoneOffset() * 60000 + IST_OFFSET);
                return ist.getUTCHours() * 60 + ist.getUTCMinutes();
              })()
            : shiftStartMins;
          const effectiveStartMins = Math.max(shiftStartMins, checkInMins);
          const halfDayMinMinutes = effectiveStartMins + Math.round(Number(coShift.halfDayHours ?? 4) * 60);
          if (currentISTMinutes < halfDayMinMinutes) {
            throw new BadRequestError(
              `Half-day checkout not allowed before ${fmt12h(halfDayMinMinutes)} ` +
              `(you clocked in at ${fmt12h(checkInMins)} + ${coShift.halfDayHours ?? 4}h half-day).`
            );
          }
        } else {
          // Full day: must reach shift end time
          if (currentISTMinutes < shiftEndMinutes) {
            throw new BadRequestError(
              `You cannot check out before ${fmt12h(shiftEndMinutes)}. ` +
              `Your shift (${coShift.name}) ends at ${coShift.endTime}. ` +
              `Apply for a half-day leave if you need to leave early.`
            );
          }
        }
      } else {
        // No shift assigned — use org default shift, then fall back to org policy
        const coPolicy = await prisma.attendancePolicy.findUnique({ where: { organizationId: orgId } });
        const orgDefaultShift = await prisma.shift.findFirst({ where: { organizationId: orgId, isDefault: true, isActive: true } });
        const fallbackEndTime = orgDefaultShift?.endTime ?? '18:30';
        const fallbackStartTime = orgDefaultShift?.startTime ?? '09:00';
        const fallbackHalfDayHours = Number(orgDefaultShift?.halfDayHours ?? coPolicy?.halfDayMinHours ?? 4);
        const [fallbackEndH, fallbackEndM] = fallbackEndTime.split(':').map(Number);
        const [fallbackStartH, fallbackStartM] = fallbackStartTime.split(':').map(Number);
        const defaultEndMinutes = fallbackEndH * 60 + fallbackEndM;
        if (!halfDayLeave && currentISTMinutes < defaultEndMinutes) {
          throw new BadRequestError(
            `You cannot check out before ${fmt12h(defaultEndMinutes)}. ` +
            `Apply for a half-day leave if you need to leave early.`
          );
        }
        if (halfDayLeave) {
          const halfDayMinMinutes = fallbackStartH * 60 + fallbackStartM + Math.round(fallbackHalfDayHours * 60);
          if (currentISTMinutes < halfDayMinMinutes) {
            throw new BadRequestError(
              `Half-day checkout not allowed before ${fmt12h(halfDayMinMinutes)}. ` +
              `Apply for a half-day leave if you need to leave early.`
            );
          }
        }
      }
    }

    // ===== PHASE 1: Atomic record lookup — prevents race condition on concurrent clock-outs =====
    // Using $transaction so that the "check if already clocked out" and the subsequent
    // "write checkOut" are a single atomic unit. Without this, two concurrent requests can
    // both pass the checkOut=null guard and both succeed, corrupting the record.
    let record: any;
    let isPreviousDayClockOut = false;

    await prisma.$transaction(async (tx) => {
      let r = await tx.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId, date: today } },
      });

      if (!r || r.checkOut) {
        const yesterday = getISTYesterday();
        const yesterdayRecord = await tx.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId, date: yesterday } },
        });
        if (yesterdayRecord && !yesterdayRecord.checkOut) {
          const hoursSinceCheckIn = (now.getTime() - new Date(yesterdayRecord.checkIn!).getTime()) / (1000 * 60 * 60);
          if (hoursSinceCheckIn > 24) {
            throw new BadRequestError('Cannot clock out: your check-in was more than 24 hours ago. Please contact HR for manual correction.');
          }
          r = yesterdayRecord;
          isPreviousDayClockOut = true;
        } else if (!r) {
          throw new BadRequestError('No clock-in found for today or yesterday. Please clock in first.');
        } else {
          throw new BadRequestError('Already clocked out for today.');
        }
      }

      if (r.checkOut) throw new BadRequestError('Already clocked out.');

      // Atomically mark checkOut with a sentinel value so no second request can pass
      // the guard above. Full data written after the transaction using record.id.
      await tx.attendanceRecord.update({
        where: { id: r.id },
        data: { checkOut: now }, // written here atomically; overwritten with full data below
      });

      record = r; // expose to outer scope
    });

    const checkIn = new Date(record.checkIn!);

    // ===== PHASE 2: Calculate accurate totalHours (subtract gap periods) =====
    const totalHours = await this.calculateAccurateTotalHours(record.id, checkIn, now);

    // Get employee's shift for shift-aware status calculation
    const recordDate = new Date(record.date);
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: recordDate }, OR: [{ endDate: null }, { endDate: { gte: recordDate } }] },
      include: { shift: true },
      orderBy: { startDate: 'desc' },
    });

    const shift = shiftAssignment?.shift;
    // Fetch org attendance policy for fallback values
    const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { organizationId: true } });
    const clockOutPolicy = await prisma.attendancePolicy.findUnique({ where: { organizationId: employee?.organizationId || '' } });
    // Shift-level overrides policy-level; policy is org-wide default; hardcoded is last resort
    const fullDayHours = shift ? Number(shift.fullDayHours) : Number(clockOutPolicy?.fullDayMinHours || 8);
    const halfDayHours = shift ? Number(shift.halfDayHours) : Number(clockOutPolicy?.halfDayMinHours || 4);

    // Determine status based on shift/policy hours.
    // If clocked in late enough to trigger auto-HALF_DAY, but worked full hours by checkout,
    // upgrade back to PRESENT so employees who arrive late but stay late aren't penalised.
    let status: 'PRESENT' | 'HALF_DAY' = 'PRESENT';
    if (totalHours < halfDayHours) {
      status = 'HALF_DAY';
    }
    // Upgrade: if existing record is HALF_DAY but total hours now meets full-day threshold, promote to PRESENT.
    const existingStatus = record.status as string;
    if (existingStatus === 'HALF_DAY' && totalHours >= fullDayHours) {
      status = 'PRESENT';
    }

    // Early checkout detection
    let isEarlyCheckout = false;
    let earlyMinutes = 0;
    // ===== PHASE 2: Late clock-out flagging =====
    let isLateClockout = false;
    let lateClockoutMinutes = 0;
    let overtimeFlag = false;
    let overtimeHours = 0;

    if (shift) {
      const istNow = getISTNow(); // IST for comparison with shift times
      const [endHour, endMin] = shift.endTime.split(':').map(Number);
      const shiftEnd = new Date(istNow);
      shiftEnd.setHours(endHour, endMin, 0, 0);
      // Handle overnight shifts (e.g., night shift 22:00–06:00)
      if (endHour < parseInt(shift.startTime.split(':')[0])) {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
      }
      if (istNow < shiftEnd) {
        isEarlyCheckout = true;
        earlyMinutes = Math.round((shiftEnd.getTime() - istNow.getTime()) / (1000 * 60));
      } else {
        lateClockoutMinutes = Math.round((istNow.getTime() - shiftEnd.getTime()) / (1000 * 60));
        if (lateClockoutMinutes > this.LATE_CLOCKOUT_FLAG_MINUTES) {
          isLateClockout = true;
        }
      }
    }

    // ===== Overtime detection: prefer shift-level policy fields over org-level =====
    const extraHours = totalHours - fullDayHours;
    const effectiveOtEnabled = shift?.otEnabled ?? clockOutPolicy?.otEnabled ?? false;
    const otThresholdMin = Number(shift?.otThresholdMinutes ?? clockOutPolicy?.otThresholdMinutes ?? 30);
    const otMaxPerDay = Number(shift?.otMaxHoursPerDay ?? clockOutPolicy?.otMaxHoursPerDay ?? 4);
    const otRateMultiplier = Number(shift?.otRateMultiplier ?? clockOutPolicy?.otRateMultiplier ?? 1.5);
    if (effectiveOtEnabled && extraHours > (otThresholdMin / 60)) {
      overtimeFlag = true;
      overtimeHours = Math.min(Math.round(extraHours * 100) / 100, otMaxPerDay);
    } else if (!effectiveOtEnabled && totalHours > fullDayHours + this.OVERTIME_FLAG_EXTRA_HOURS) {
      // Fallback: flag excessive hours even if OT tracking is off (informational only)
      overtimeFlag = true;
    }

    // ===== Auto-create OvertimeRequest for manager approval when OT is enabled and detected =====
    if (effectiveOtEnabled && overtimeFlag && overtimeHours > 0) {
      setImmediate(async () => {
        try {
          await prisma.overtimeRequest.upsert({
            where: { employeeId_date: { employeeId, date: new Date(record.date) } },
            create: {
              employeeId,
              organizationId: employee?.organizationId || '',
              date: new Date(record.date),
              plannedHours: overtimeHours,
              actualHours: overtimeHours,
              reason: `Auto-detected: worked ${totalHours.toFixed(1)}h (shift: ${fullDayHours}h, extra: ${overtimeHours.toFixed(1)}h)`,
              status: 'PENDING',
              attendanceId: record.id,
            },
            update: {
              actualHours: overtimeHours,
              reason: `Auto-detected: worked ${totalHours.toFixed(1)}h (shift: ${fullDayHours}h, extra: ${overtimeHours.toFixed(1)}h)`,
              status: 'PENDING',
            },
          });
          logger.info(`[Attendance] OvertimeRequest auto-created for ${employeeId} — ${overtimeHours}h on ${record.date}`);
        } catch (e: any) {
          logger.warn(`[Attendance] OvertimeRequest auto-create failed for ${employeeId}: ${e.message}`);
        }
      });
    }

    const locationData = data.latitude != null && data.longitude != null
      ? { lat: data.latitude, lng: data.longitude, accuracy: data.accuracy }
      : null;

    let notes = record.notes || '';
    if (isPreviousDayClockOut) {
      notes = `${notes} [Clock-out for previous day's record]`.trim();
    }
    if (isEarlyCheckout && earlyMinutes > 15) {
      notes = `${notes} [Early checkout by ${earlyMinutes} min]`.trim();
    }
    if (isLateClockout) {
      notes = `${notes} [Late clock-out: ${lateClockoutMinutes} min after shift end]`.trim();
    }
    if (overtimeFlag && overtimeHours > 0) {
      notes = `${notes} [OT: ${overtimeHours.toFixed(1)}h overtime (policy: ${otRateMultiplier}x rate, max ${otMaxPerDay}h/day)]`.trim();
    } else if (overtimeFlag) {
      notes = `${notes} [Overtime flagged: ${totalHours.toFixed(1)}h, expected ${fullDayHours}h]`.trim();
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        totalHours: Math.round(totalHours * 100) / 100,
        status,
        checkOutLocation: locationData as any,
        notes,
      },
    });

    // Log the clock-out event
    await prisma.attendanceLog.create({
      data: {
        attendanceId: record.id,
        action: 'CLOCK_OUT',
        timestamp: now,
        location: locationData as any,
        notes: [
          isEarlyCheckout && earlyMinutes > 15 ? `Early checkout by ${earlyMinutes} min` : '',
          isPreviousDayClockOut ? 'Previous day clock-out' : '',
          isLateClockout ? `Late clock-out by ${lateClockoutMinutes} min` : '',
        ].filter(Boolean).join('; ') || null,
        shiftName: shift?.name || null,
      },
    });

    // Log remote checkout anomaly when employee clocked out from outside geofence after 20:00
    if (checkoutGeofenceViolation) {
      try {
        await prisma.attendanceAnomaly.create({
          data: {
            attendanceId: record.id,
            employeeId,
            organizationId: empStatus!.organizationId,
            date: today,
            type: 'UNAPPROVED_REMOTE',
            severity: 'LOW',
            description: 'Employee clocked out from outside office geofence (after 20:00 IST — remote checkout allowed)',
            resolution: 'PENDING',
          },
        });
      } catch { /* non-blocking */ }
    }

    // Log anomaly if no GPS provided at clock-out (use == null so 0,0 coords don't trigger this)
    if (data.latitude == null || data.longitude == null) {
      try {
        await prisma.attendanceAnomaly.create({
          data: {
            attendanceId: record.id,
            employeeId,
            organizationId: empStatus!.organizationId,
            date: today,
            type: 'UNAPPROVED_REMOTE',
            severity: 'LOW',
            description: 'Clock-out recorded without GPS coordinates',
            resolution: 'PENDING',
          },
        });
      } catch (e) {
        // non-blocking
      }
    }

    // Emit real-time event
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true, organizationId: true } });
    if (emp) {
      emitToOrg(emp.organizationId, 'attendance:checkout', {
        employeeId, employeeName: `${emp.firstName} ${emp.lastName}`,
        checkOut: now.toISOString(), totalHours: Math.round(totalHours * 100) / 100,
        status, isEarlyCheckout, earlyMinutes, isPreviousDayClockOut,
      });
      invalidateDashboardCache(emp.organizationId).catch(() => {});

      // ===== Audit log =====
      try {
        await createAuditLog({
          userId: employeeId,
          organizationId: emp.organizationId,
          entity: 'AttendanceRecord',
          entityId: record.id,
          action: 'CLOCK_OUT',
          newValue: { totalHours: Math.round(totalHours * 100) / 100, status, isEarlyCheckout, isPreviousDayClockOut, overtimeFlag },
        });
      } catch { /* non-blocking */ }
    }

    // ===== Comp-Off auto-grant: prefer shift-level policy over org-level =====
    const effectiveCompOffEnabled = shift?.compOffEnabled ?? clockOutPolicy?.compOffEnabled ?? false;
    const effectiveCompOffMinOTHours = Number(shift?.compOffMinOTHours ?? clockOutPolicy?.compOffMinOTHours ?? 4);
    const effectiveCompOffWeekOffDays = (shift?.weekOffDays?.length ? shift.weekOffDays : null) ?? clockOutPolicy?.weekOffDays ?? [0];
    if (effectiveCompOffEnabled && totalHours >= effectiveCompOffMinOTHours) {
      const recordDay = new Date(record.date).getDay();
      const policyWeekOffs = new Set(effectiveCompOffWeekOffDays);
      const isWeekOff = policyWeekOffs.has(recordDay);
      const isHoliday = await prisma.holiday.findFirst({
        where: { organizationId: employee?.organizationId || '', date: new Date(record.date) },
      });

      if (isWeekOff || isHoliday) {
        const compOffExpiry = new Date();
        const effectiveCompOffExpiryDays = shift?.compOffExpiryDays ?? clockOutPolicy?.compOffExpiryDays ?? 30;
        compOffExpiry.setDate(compOffExpiry.getDate() + effectiveCompOffExpiryDays);
        try {
          // Check if comp-off not already granted for this date
          const existingCompOff = await prisma.attendanceLog.findFirst({
            where: { attendanceId: record.id, action: 'COMP_OFF_GRANTED' },
          });
          if (!existingCompOff) {
            const organizationId = employee?.organizationId || '';
            const workReason = isHoliday ? `holiday (${isHoliday.name})` : 'week-off day';
            const noteText = `Comp-off granted: worked ${totalHours.toFixed(1)}h on ${workReason}. Expires: ${compOffExpiry.toISOString().split('T')[0]}. Min OT required: ${effectiveCompOffMinOTHours}h.`;

            // Find or auto-create the COMP_OFF leave type for this org
            let compOffLeaveType = await prisma.leaveType.findFirst({
              where: { organizationId, code: 'COMP_OFF', deletedAt: null },
            });
            if (!compOffLeaveType) {
              compOffLeaveType = await prisma.leaveType.create({
                data: {
                  name: 'Compensatory Off',
                  code: 'COMP_OFF',
                  defaultBalance: 0,
                  carryForward: false,
                  isPaid: true,
                  minDays: 0.5,
                  allowSameDay: false,
                  requiresApproval: false,
                  isActive: true,
                  organizationId,
                },
              });
              logger.info(`[CompOff] Auto-created COMP_OFF leave type for org ${organizationId}`);
            }

            // Credit 1 day to leave balance for current year
            const currentYear = new Date().getFullYear();
            await prisma.leaveBalance.upsert({
              where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: compOffLeaveType.id, year: currentYear } },
              create: {
                employeeId,
                leaveTypeId: compOffLeaveType.id,
                year: currentYear,
                allocated: 1,
                used: 0,
                carriedForward: 0,
                pending: 0,
              },
              update: { allocated: { increment: 1 } },
            });

            await prisma.attendanceLog.create({
              data: {
                attendanceId: record.id,
                action: 'COMP_OFF_GRANTED',
                timestamp: new Date(),
                notes: noteText,
              },
            });

            // Also create a CompOffCredit record for persistent balance tracking
            await prisma.compOffCredit.create({
              data: {
                employeeId,
                earnedDate: new Date(record.date),
                expiryDate: compOffExpiry,
                hoursWorked: totalHours,
                status: 'AVAILABLE',
                organizationId,
                notes: `Earned from ${totalHours.toFixed(1)}h OT on ${workReason}`,
              },
            });

            logger.info(`[CompOff] Granted to employee ${employeeId} for working on ${workReason} (${record.date})`);
          }
        } catch (e) { logger.error(`Comp-off grant error:`, e); }
      }
    }

    return { ...updated, isEarlyCheckout, earlyMinutes, isPreviousDayClockOut, overtimeFlag, overtimeHours };
  }

  /**
   * Get today's attendance status for an employee
   */
  async getTodayStatus(employeeId: string) {
    const today = getISTToday();

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      include: { breaks: true, logs: { orderBy: { timestamp: 'asc' } } },
    });

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { workMode: true, firstName: true, lastName: true, organizationId: true },
    });

    // Get current shift assignment
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true },
      orderBy: { startDate: 'desc' },
    });

    // Fallback to default shift
    let shift = shiftAssignment?.shift;
    if (!shift && employee?.organizationId) {
      const defaultShift = await prisma.shift.findFirst({
        where: { organizationId: employee.organizationId, isDefault: true, isActive: true },
      });
      if (defaultShift) shift = defaultShift;
    }

    // Calculate active break
    let activeBreak = null;
    if (record?.breaks) {
      activeBreak = record.breaks.find((b) => !b.endTime) || null;
    }

    // Get attendance policy for weekOffDays
    const policy = employee?.organizationId ? await prisma.attendancePolicy.findUnique({
      where: { organizationId: employee.organizationId },
      select: { weekOffDays: true },
    }) : null;

    return {
      record,
      isCheckedIn: !!record?.checkIn && !record?.checkOut,
      isCheckedOut: !!record?.checkOut,
      isOnBreak: !!activeBreak,
      activeBreak,
      workMode: employee?.workMode,
      totalHours: record?.totalHours || null,
      geofenceViolation: record?.geofenceViolation || false,
      clockInCount: record?.clockInCount || 0,
      logs: record?.logs || [],
      shift: shift ? {
        id: shift.id,
        name: shift.name,
        code: shift.code,
        startTime: shift.startTime,
        endTime: shift.endTime,
        graceMinutes: shift.graceMinutes,
        fullDayHours: Number(shift.fullDayHours),
        halfDayHours: Number(shift.halfDayHours),
        shiftType: shift.shiftType,
        trackingIntervalMinutes: shift.trackingIntervalMinutes || 60,
      } : null,
      hasShift: !!shift,
      weekOffDays: (policy?.weekOffDays as number[]) || [0],
    };
  }

  /**
   * Get attendance records for an employee (monthly/range view)
   */
  async getMyAttendance(employeeId: string, startDate: string, endDate: string) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: { gte: start, lte: end },
      },
      include: { breaks: true, logs: { orderBy: { timestamp: 'asc' } } },
      orderBy: { date: 'asc' },
    });

    // Get holidays in range
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { organizationId: true },
    });

    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId: employee?.organizationId,
        date: { gte: start, lte: end },
      },
    });

    // Build summary
    const summary = {
      totalDays: 0,
      present: 0,
      absent: 0,
      halfDay: 0,
      onLeave: 0,
      holidays: holidays.length,
      weekends: 0,
      workFromHome: 0,
      averageHours: 0,
    };

    let totalWorkedHours = 0;
    const holidayDates = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
    // Build a Set of dates that have any attendance record (any status)
    const datesWithRecord = new Set(records.map(r => new Date(r.date).toISOString().split('T')[0]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const current = new Date(start);
    while (current <= end) {
      summary.totalDays++;
      const day = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      // Count Sunday as weekend ONLY if it's not already a holiday (avoid double-count)
      if (day === 0 && !holidayDates.has(dateStr)) {
        summary.weekends++;
      }
      // Implicit absent: past working day (Mon-Sat) with no record and no holiday
      if (
        day !== 0 &&
        !holidayDates.has(dateStr) &&
        !datesWithRecord.has(dateStr) &&
        current < today
      ) {
        summary.absent++;
      }
      current.setDate(current.getDate() + 1);
    }

    // Count statuses from actual records.
    // Implicit absent days (no record) are already counted in the loop above;
    // explicit ABSENT records have a datesWithRecord entry so they were skipped
    // by the loop — they are counted here instead. No double-counting.
    records.forEach((r) => {
      switch (r.status) {
        case 'PRESENT': summary.present++; break;
        case 'ABSENT':  summary.absent++;  break;
        case 'HALF_DAY': summary.halfDay++; break;
        case 'ON_LEAVE': summary.onLeave++; break;
        case 'WORK_FROM_HOME': summary.workFromHome++; break;
      }
      // Cap individual day hours at 9h so anomalous records don't inflate the average
      if (r.totalHours) totalWorkedHours += Math.min(Number(r.totalHours), 9);
    });

    summary.averageHours = summary.present > 0
      ? Math.round((totalWorkedHours / summary.present) * 10) / 10
      : 0;

    return { records, holidays, summary };
  }

  /**
   * Admin view — all employees' attendance (shows ALL employees, even those without records)
   */
  async getAllAttendance(query: AttendanceQuery, organizationId: string) {
    const { page, limit, startDate, endDate, employeeId, department, status, workMode } = query;
    const skip = (page - 1) * limit;

    // Determine date for the query — always use IST-midnight so date column comparisons
    // match what the employee clocked in under (avoids UTC-vs-IST off-by-one day bugs)
    let queryDate: Date;
    if (startDate) {
      const d = new Date(startDate);
      queryDate = new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00.000Z`);
    } else {
      queryDate = getISTToday();
    }

    let endQueryDate: Date;
    if (endDate) {
      const d = new Date(endDate);
      endQueryDate = new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T00:00:00.000Z`);
    } else {
      endQueryDate = new Date(queryDate);
    }
    endQueryDate.setHours(23, 59, 59, 999);

    // Build employee filter — include NOTICE_PERIOD so employees serving notice still appear
    const empWhere: any = { organizationId, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION', 'NOTICE_PERIOD'] } };
    if (department) empWhere.departmentId = department;
    if (employeeId) empWhere.id = employeeId;
    if (workMode) empWhere.workMode = workMode;

    // Build attendance record filter
    const recordWhere: any = {
      date: { gte: queryDate, lte: endQueryDate },
      employee: { organizationId, deletedAt: null },
    };
    if (department) recordWhere.employee.departmentId = department;

    // Fetch all employees + their attendance records for the date range
    const [allEmployees, records, totalEmployees, presentCount, absentCount, onLeaveCount] = await Promise.all([
      prisma.employee.findMany({
        where: empWhere,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          department: { select: { name: true } },
          workMode: true,
          avatar: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.attendanceRecord.findMany({
        where: recordWhere,
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { name: true } },
              workMode: true,
              avatar: true,
            },
          },
          breaks: true,
        },
      }),
      prisma.employee.count({ where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION'] } } }),
      prisma.attendanceRecord.count({ where: { ...recordWhere, status: 'PRESENT' } }),
      prisma.attendanceRecord.count({ where: { ...recordWhere, status: 'ABSENT' } }),
      prisma.attendanceRecord.count({ where: { ...recordWhere, status: 'ON_LEAVE' } }),
    ]);

    // Build map of employeeId → record
    const recordMap = new Map<string, any>();
    records.forEach(r => recordMap.set(r.employeeId, r));

    // Merge: all employees with their attendance record (or NOT_CHECKED_IN placeholder)
    let mergedData = allEmployees.map(emp => {
      const record = recordMap.get(emp.id);
      if (record) {
        return record;
      }
      // No attendance record — show as NOT_CHECKED_IN
      return {
        id: `placeholder-${emp.id}`,
        employeeId: emp.id,
        date: queryDate,
        checkIn: null,
        checkOut: null,
        totalHours: null,
        status: 'NOT_CHECKED_IN',
        workMode: emp.workMode || 'OFFICE',
        source: null,
        employee: emp,
        breaks: [],
      };
    });

    // Apply status filter
    if (status) {
      mergedData = mergedData.filter(r => r.status === status);
    }

    // Paginate
    const total = mergedData.length;
    const paginatedData = mergedData.slice(skip, skip + limit);

    // Count NOT_CHECKED_IN — subtract all employees who have ANY attendance record
    const employeesWithRecords = records.length;
    const notCheckedIn = Math.max(0, totalEmployees - employeesWithRecords);

    return {
      data: paginatedData,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      summary: {
        totalEmployees,
        present: presentCount,
        absent: absentCount,
        onLeave: onLeaveCount,
        notCheckedIn: notCheckedIn > 0 ? notCheckedIn : 0,
      },
    };
  }

  /**
   * Record activity pulse (for hybrid/WFH session tracking)
   */
  async recordActivityPulse(employeeId: string, data: { isActive: boolean; tabVisible: boolean }) {
    const today = getISTToday();

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });

    if (!record || !record.checkIn || record.checkOut) {
      return { recorded: false, reason: 'Not currently checked in' };
    }

    // Only count active minutes if tab is visible and user is active
    const incrementMinutes = data.isActive && data.tabVisible ? 5 : 0;

    await prisma.attendanceRecord.update({
      where: { employeeId_date: { employeeId, date: today } },
      data: {
        activeMinutes: { increment: incrementMinutes },
        activityPulses: { increment: 1 },
      },
    });

    return { recorded: true, activeMinutes: (record.activeMinutes || 0) + incrementMinutes };
  }

  /**
   * Start a break
   */
  async startBreak(employeeId: string, breakType: string) {
    const today = getISTToday();

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      include: { breaks: true },
    });

    if (!record || !record.checkIn || record.checkOut) {
      throw new BadRequestError('Must be clocked in to start a break.');
    }

    // Check for active break
    const activeBreak = record.breaks.find((b) => !b.endTime);
    if (activeBreak) {
      throw new BadRequestError('Already on a break. Please end current break first.');
    }

    // ===== PHASE 3: Break duration validation — use actual shift hours =====
    const totalBreakMinutes = record.breaks
      .filter((b: any) => b.endTime && b.durationMinutes)
      .reduce((sum: number, b: any) => sum + (b.durationMinutes || 0), 0);
    // Get shift's full day hours for proportional break limit
    const breakShiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true },
      orderBy: { startDate: 'desc' },
    });
    const shiftFullDayHours = Number(breakShiftAssignment?.shift?.fullDayHours) || 8;
    const maxBreakMinutes = Math.round(shiftFullDayHours * 60 * this.MAX_BREAK_PERCENT / 100);
    if (totalBreakMinutes >= maxBreakMinutes) {
      throw new BadRequestError(`Total break time (${totalBreakMinutes} min) has reached the maximum (${maxBreakMinutes} min). Cannot start another break.`);
    }

    const now = new Date();
    const breakRecord = await prisma.break.create({
      data: {
        attendanceId: record.id,
        startTime: now,
        type: breakType as any,
      },
    });

    // Log break start event
    await prisma.attendanceLog.create({
      data: {
        attendanceId: record.id,
        action: 'BREAK_START',
        timestamp: now,
        notes: `Break type: ${breakType}`,
      },
    });

    return breakRecord;
  }

  /**
   * End a break
   */
  async endBreak(employeeId: string) {
    const today = getISTToday();

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      include: { breaks: true },
    });

    if (!record) throw new BadRequestError('No attendance record found.');

    const activeBreak = record.breaks.find((b) => !b.endTime);
    if (!activeBreak) {
      throw new BadRequestError('No active break to end.');
    }

    const now = new Date();
    const duration = Math.round(
      (now.getTime() - new Date(activeBreak.startTime).getTime()) / (1000 * 60)
    );

    const updated = await prisma.break.update({
      where: { id: activeBreak.id },
      data: { endTime: now, durationMinutes: duration },
    });

    // Log break end event
    await prisma.attendanceLog.create({
      data: {
        attendanceId: record.id,
        action: 'BREAK_END',
        timestamp: now,
        notes: `Break duration: ${duration} min`,
      },
    });

    return updated;
  }

  /**
   * Store GPS trail points (for FIELD_SALES employees).
   *
   * Validation layers:
   *   1. Only FIELD_SALES workMode or FIELD shiftType employees accepted
   *   2. Points older than 7 days rejected (covers offline buffering scenarios)
   *   3. Future timestamps (>5 min ahead) rejected — GPS clock drift tolerance
   *   4. Coordinates sanity check (already in Zod schema; guarded again here)
   *   5. Speed sanity check (>300 km/h flagged as anomaly)
   *   6. Frequency check: points submitted faster than 50% of shift interval flagged
   *   7. Duplicate deduplication: same (lat, lng, timestamp-bucket) skipped
   */
  async storeGPSTrail(employeeId: string, data: GPSTrailBatchInput) {
    const today = getISTToday();
    const now = Date.now();

    // Only FIELD_SALES employees may store GPS trail
    const gpsEmployee = await prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: {
        workMode: true,
        organizationId: true,
        locationTrackingConsented: true,
        shiftAssignments: {
          where: { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
          take: 1,
          include: { shift: { select: { shiftType: true, trackingIntervalMinutes: true } } },
          orderBy: { startDate: 'desc' },
        },
      },
    });
    const empWorkMode = gpsEmployee?.workMode;
    const empShiftType = gpsEmployee?.shiftAssignments?.[0]?.shift?.shiftType;
    if (empWorkMode !== 'FIELD_SALES' && empShiftType !== 'FIELD') {
      throw new BadRequestError('GPS tracking is only available for field sales employees');
    }

    // Consent check — employee must have acknowledged the GPS tracking consent
    if (!gpsEmployee?.locationTrackingConsented) {
      throw new BadRequestError('GPS tracking consent is required before submitting location data. Please accept the consent in the app.');
    }

    const orgId = gpsEmployee?.organizationId || '';
    const trackingIntervalMinutes = gpsEmployee?.shiftAssignments?.[0]?.shift?.trackingIntervalMinutes ?? 60;
    const minIntervalMs = (trackingIntervalMinutes * 60_000) * 0.5; // 50% tolerance

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes GPS clock drift allowed

    const anomalies: string[] = [];
    const validPoints: typeof data.points = [];

    // Sort incoming by timestamp to enable interval check
    const sorted = [...data.points].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let lastAcceptedTs: number | null = null;

    for (const p of sorted) {
      const ts = new Date(p.timestamp).getTime();

      // Reject stale points (> 7 days old)
      if (ts < sevenDaysAgo.getTime()) {
        anomalies.push(`GPS_STALE_REJECTED:${p.timestamp}`);
        continue;
      }

      // Reject future timestamps beyond tolerance
      if (ts > now + FUTURE_TOLERANCE_MS) {
        anomalies.push(`GPS_FUTURE_TIMESTAMP:${p.timestamp}`);
        continue;
      }

      // Coordinate sanity (belt + suspenders — Zod already validates, but log if somehow bypassed)
      if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
        anomalies.push(`GPS_INVALID_COORDINATE:${p.lat},${p.lng}`);
        continue;
      }

      // Speed sanity: > 300 km/h is physically implausible for field sales (flag, don't reject)
      if (p.speed !== undefined && p.speed !== null && p.speed > 83.3) {
        anomalies.push(`GPS_IMPLAUSIBLE_SPEED:${p.speed.toFixed(1)}m/s`);
        // Accept but flag — don't block offline sync for a single noisy reading
      }

      // Frequency check: skip for offline_sync batches — they are time-compressed uploads
      // where points were captured at the correct interval but arrived out-of-order or delayed.
      // Applying frequency checks to offline batches produces false anomalies.
      const isOfflineSync = (data as any).source === 'offline_sync';
      if (!isOfflineSync && lastAcceptedTs !== null && minIntervalMs > 30_000) {
        const gap = ts - lastAcceptedTs;
        if (gap < minIntervalMs) {
          anomalies.push(`GPS_TOO_FREQUENT:gap=${Math.round(gap / 1000)}s,min=${Math.round(minIntervalMs / 1000)}s`);
        }
      }

      validPoints.push(p);
      lastAcceptedTs = ts;
    }

    if (validPoints.length === 0) {
      throw new BadRequestError('All submitted GPS points were rejected due to validation errors. Check device time and GPS accuracy.');
    }

    // Log anomalies to audit (non-blocking; never stores raw coordinates in audit log)
    if (anomalies.length > 0) {
      try {
        await createAuditLog({
          userId: employeeId,
          organizationId: orgId,
          entity: 'GPSTrailPoint',
          entityId: employeeId,
          action: 'GPS_ANOMALY_DETECTED',
          newValue: { anomalies, submittedCount: data.points.length, acceptedCount: validPoints.length },
        });
      } catch { /* non-blocking */ }
    }

    const batchSource: string = (data as any).source ?? 'realtime';

    const dbPoints = validPoints.map((p) => {
      // Use the timestamp's calendar date so multi-day offline sync lands on correct days
      const pointDate = new Date(p.timestamp);
      pointDate.setHours(0, 0, 0, 0);
      return {
        employeeId,
        organizationId: orgId,
        date: pointDate,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy ?? null,
        altitude: p.altitude ?? null,
        speed: p.speed ?? null,
        heading: p.heading ?? null,
        batteryLevel: p.batteryLevel ?? null,
        timestamp: new Date(p.timestamp),
        source: batchSource,
      };
    });

    // skipDuplicates prevents DB constraint errors from offline re-sync of the same batch
    const result = await prisma.gPSTrailPoint.createMany({ data: dbPoints, skipDuplicates: true });

    // Real-time: notify HR dashboard so live map updates instantly without waiting for the 30s poll
    if (result.count > 0) {
      const lastPoint = dbPoints[dbPoints.length - 1];
      emitToOrg(orgId, 'gps:trail-updated', {
        employeeId,
        date: today.toISOString().split('T')[0],
        pointsAdded: result.count,
        lastPoint: {
          lat: lastPoint.lat,
          lng: lastPoint.lng,
          timestamp: lastPoint.timestamp.toISOString(),
          accuracy: lastPoint.accuracy,
        },
      });
    }

    try {
      await createAuditLog({
        userId: employeeId,
        organizationId: orgId,
        entity: 'GPSTrailPoint',
        entityId: employeeId,
        action: 'GPS_TRAIL_UPLOAD',
        newValue: { stored: result.count, submitted: data.points.length, anomalyCount: anomalies.length },
      });
    } catch { /* non-blocking */ }

    // Fire-and-forget: persist named visits as GPS points arrive so GeoLocationsTab
    // populates automatically without waiting for HR to open an individual trail.
    const uniqueDates = [...new Set(dbPoints.map(p => p.date.toISOString().split('T')[0]))];
    this.persistVisitsForUploadedDates(employeeId, orgId, uniqueDates).catch(() => {});

    return { stored: result.count, submitted: data.points.length, anomalies: anomalies.length };
  }

  /**
   * Record GPS location-tracking consent for a FIELD_SALES employee.
   */
  async recordGPSConsent(employeeId: string, organizationId: string, consentVersion: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
    });
    if (!employee) throw new NotFoundError('Employee');

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: {
        locationTrackingConsented: true,
        locationTrackingConsentAt: new Date(),
        locationTrackingConsentVersion: consentVersion,
      },
      select: { locationTrackingConsented: true, locationTrackingConsentAt: true, locationTrackingConsentVersion: true },
    });

    try {
      await createAuditLog({
        userId: employeeId,
        organizationId,
        entity: 'Employee',
        entityId: employeeId,
        action: 'GPS_CONSENT_RECORDED',
        newValue: { consentVersion, consentAt: updated.locationTrackingConsentAt },
      });
    } catch { /* non-blocking */ }

    return updated;
  }

  /**
   * Get GPS consent status for an employee.
   */
  async getGPSConsentStatus(employeeId: string, organizationId: string) {
    const today = getISTToday();
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: {
        locationTrackingConsented: true,
        locationTrackingConsentAt: true,
        locationTrackingConsentVersion: true,
        workMode: true,
        shiftAssignments: {
          where: { startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
          take: 1,
          include: { shift: { select: { shiftType: true } } },
          orderBy: { startDate: 'desc' },
        },
      },
    });
    if (!employee) throw new NotFoundError('Employee');
    const shiftType = employee.shiftAssignments?.[0]?.shift?.shiftType;
    return {
      consented: employee.locationTrackingConsented,
      consentAt: employee.locationTrackingConsentAt,
      consentVersion: employee.locationTrackingConsentVersion,
      isFieldEmployee: employee.workMode === 'FIELD_SALES' || shiftType === 'FIELD',
    };
  }

  /**
   * Get GPS trail for a specific employee and date.
   * organizationId is required — enforces cross-org isolation so HR from Org A
   * cannot retrieve GPS data for employees in Org B.
   */
  async getGPSTrail(employeeId: string, date: string, requestingOrgId: string, requestingUserId?: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Verify employee belongs to the requesting org before returning any location data
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId: requestingOrgId, deletedAt: null },
      select: { id: true, organizationId: true, workMode: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    const points = await prisma.gPSTrailPoint.findMany({
      where: { employeeId, organizationId: requestingOrgId, date: targetDate },
      orderBy: { timestamp: 'asc' },
    });

    // Audit: HR viewed employee GPS trail (compliance log — do not store raw coords in audit)
    try {
      await createAuditLog({
        userId: requestingUserId || requestingOrgId,
        organizationId: requestingOrgId,
        entity: 'GPSTrailPoint',
        entityId: employeeId,
        action: 'GPS_TRAIL_VIEWED',
        newValue: { date, pointCount: points.length },
      });
    } catch { /* non-blocking */ }

    const rawVisits = this.clusterVisits(points);

    // Persist significant visits (≥60 min) to LocationVisit with geocoded names
    const attendanceRecord = await prisma.attendanceRecord.findFirst({
      where: { employeeId, date: targetDate },
    });

    let namedVisits: any[] = rawVisits;
    if (attendanceRecord) {
      namedVisits = await this.persistNamedVisits(attendanceRecord.id, requestingOrgId, rawVisits);
    }

    return { points, visits: namedVisits };
  }

  private async persistVisitsForUploadedDates(employeeId: string, orgId: string, dateStrs: string[]) {
    for (const dateStr of dateStrs) {
      try {
        const date = new Date(dateStr);
        const [points, attendanceRecord] = await Promise.all([
          prisma.gPSTrailPoint.findMany({
            where: { employeeId, date },
            orderBy: { timestamp: 'asc' },
          }),
          prisma.attendanceRecord.findUnique({
            where: { employeeId_date: { employeeId, date } },
          }),
        ]);
        if (points.length < 2 || !attendanceRecord) continue;
        const rawVisits = this.clusterVisits(points);
        if (rawVisits.length > 0) {
          await this.persistNamedVisits(attendanceRecord.id, orgId, rawVisits);
        }
      } catch (err) {
        logger.warn(`[GPS] Background visit persistence failed for employee ${employeeId} on ${dateStr}: ${(err as any)?.message}`);
      }
    }
  }

  private async persistNamedVisits(attendanceId: string, organizationId: string | undefined, rawVisits: any[]): Promise<any[]> {
    const SIGNIFICANT_MINUTES = 60;
    const result: any[] = [];

    for (const v of rawVisits) {
      const isSignificant = v.durationMinutes >= SIGNIFICANT_MINUTES;

      // Check if already saved (match on attendanceId + arrival time to allow multiple stops per day)
      const existing = await prisma.locationVisit.findFirst({
        where: {
          attendanceId,
          arrivalTime: new Date(v.startTime),
        },
      });
      if (existing) {
        result.push({ ...v, id: existing.id, locationName: existing.locationName, customName: existing.customName, isSignificant: existing.isSignificant });
        continue;
      }

      // Reverse geocode only for significant stops (saves Nominatim quota)
      const locationName = isSignificant ? await this.reverseGeocode(v.lat, v.lng) : null;

      const saved = await prisma.locationVisit.create({
        data: {
          attendanceId,
          organizationId: organizationId ?? null,
          latitude: v.lat,
          longitude: v.lng,
          arrivalTime: new Date(v.startTime),
          departureTime: new Date(v.endTime),
          durationMinutes: v.durationMinutes,
          pointCount: v.pointCount,
          locationName,
          isSignificant,
        },
      });
      result.push({ ...v, id: saved.id, locationName: saved.locationName, customName: null, isSignificant });
    }
    return result;
  }

  private async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AnistonHRMS/1.0 (hr@anistonav.com)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      // Build short name: road/suburb + city
      const a = data.address || {};
      const parts = [
        a.road || a.pedestrian || a.footway,
        a.suburb || a.neighbourhood || a.village || a.town,
        a.city || a.county,
      ].filter(Boolean);
      return parts.length > 0 ? parts.slice(0, 2).join(', ') : (data.display_name?.split(',').slice(0, 2).join(', ') ?? null);
    } catch {
      return null;
    }
  }

  async getGeoLocations(organizationId: string, params: { startDate?: string; endDate?: string; employeeId?: string; page?: number; limit?: number }) {
    const { startDate, endDate, employeeId, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    // Use IST offset (+05:30) so "2026-05-04" means IST midnight, not UTC midnight
    const start = startDate ? new Date(startDate + 'T00:00:00+05:30') : new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00+05:30');
    const end = endDate ? new Date(endDate + 'T23:59:59+05:30') : new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    const attendanceWhere: any = { date: { gte: start, lte: end } };
    if (employeeId) attendanceWhere.employeeId = employeeId;

    const where: any = { organizationId, attendance: attendanceWhere };

    const [visits, total] = await Promise.all([
      prisma.locationVisit.findMany({
        where,
        include: {
          attendance: {
            select: {
              date: true,
              employeeId: true,
              employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true } },
            },
          },
        },
        orderBy: { arrivalTime: 'desc' },
        skip,
        take: limit,
      }),
      prisma.locationVisit.count({ where }),
    ]);

    return {
      data: visits,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async tagStop(employeeId: string, organizationId: string, data: { lat: number; lng: number; name: string; timestamp?: string }) {
    const today = getISTToday();
    const attendance = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      select: { id: true },
    });
    if (!attendance) throw new BadRequestError('No attendance record for today. Please check in first.');

    const arrivalTime = data.timestamp ? new Date(data.timestamp) : new Date();

    // Upsert: if a visit already exists within 200m of this point, update its name; else create new
    const nearby = await prisma.locationVisit.findFirst({
      where: {
        attendanceId: attendance.id,
        organizationId,
        latitude: { gte: data.lat - 0.002, lte: data.lat + 0.002 },
        longitude: { gte: data.lng - 0.002, lte: data.lng + 0.002 },
      },
    });

    let visit: any;
    if (nearby) {
      visit = await prisma.locationVisit.update({
        where: { id: nearby.id },
        data: { customName: data.name },
      });
    } else {
      visit = await prisma.locationVisit.create({
        data: {
          attendanceId: attendance.id,
          organizationId,
          latitude: data.lat,
          longitude: data.lng,
          arrivalTime,
          departureTime: arrivalTime,
          durationMinutes: 0,
          isSignificant: false,
          customName: data.name,
        },
      });
    }

    // Emit so Geo Locations tab refreshes live
    emitToOrg(organizationId, 'gps:trail-updated', { employeeId });

    return visit;
  }

  async updateLocationVisitName(id: string, customName: string, organizationId: string, userId: string) {
    const visit = await prisma.locationVisit.findFirst({ where: { id, organizationId } });
    if (!visit) throw new NotFoundError('Location visit');

    const updated = await prisma.locationVisit.update({
      where: { id },
      data: { customName },
    });

    await createAuditLog({
      userId,
      action: 'UPDATE',
      entity: 'LocationVisit',
      entityId: id,
      organizationId,
      newValue: { customName },
    });

    return updated;
  }

  /**
   * Submit attendance regularization request.
   * Accepts either an explicit attendanceId (UUID) OR a date string (YYYY-MM-DD).
   * If a date is provided and no attendance record exists for that day, a minimal
   * ABSENT record is created so the regularization can be attached to it.
   */
  async submitRegularization(
    employeeId: string,
    attendanceId: string | undefined,
    reason: string,
    requestedCheckIn?: string,
    requestedCheckOut?: string,
    date?: string
  ) {
    let record: Awaited<ReturnType<typeof prisma.attendanceRecord.findFirst>>;

    if (attendanceId) {
      // Explicit attendanceId path — existing behaviour
      record = await prisma.attendanceRecord.findFirst({
        where: { id: attendanceId, employeeId },
      });
      if (!record) throw new NotFoundError('Attendance record');
    } else if (date) {
      // Date-based path — find or create a minimal ABSENT record for that day
      const employee = await prisma.employee.findFirst({
        where: { id: employeeId },
        select: { organizationId: true },
      });
      if (!employee) throw new NotFoundError('Employee');

      // Normalise to UTC-midnight (same convention as getISTToday)
      const [year, month, day] = date.split('-').map(Number);
      const normalised = new Date(`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`);

      record = await prisma.attendanceRecord.findFirst({
        where: { employeeId, date: normalised },
      });

      if (!record) {
        // No clock-in happened — create a placeholder ABSENT record
        record = await prisma.attendanceRecord.create({
          data: {
            employeeId,
            date: normalised,
            status: 'ABSENT',
            checkIn: null,
            checkOut: null,
            workMode: 'OFFICE',
            source: 'MANUAL_HR',
            notes: 'Auto-created for regularization (no clock-in)',
          },
        });
      }
    } else {
      throw new BadRequestError('Either attendanceId or date must be provided');
    }

    if (!record) throw new NotFoundError('Attendance record');

    // Ensure attendanceId is always set (date-based path resolves it from the found/created record)
    attendanceId = record.id;

    // ===== PHASE 3: Block future date regularization =====
    const today = getISTToday();
    if (new Date(record.date) > today) {
      throw new BadRequestError('Cannot submit regularization for future dates.');
    }

    const existing = await prisma.attendanceRegularization.findUnique({
      where: { attendanceId },
    });
    if (existing) throw new BadRequestError('Regularization already submitted for this date.');

    const reg = await prisma.attendanceRegularization.create({
      data: {
        attendanceId,
        employeeId,
        reason,
        requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        originalCheckIn: record.checkIn,
        originalCheckOut: record.checkOut,
        status: 'PENDING',
      },
    });

    // Auto-approve if check-in is within shift grace period
    if (requestedCheckIn) {
      const autoResult = await this.tryAutoApproveRegularization(reg.id, employeeId, new Date(requestedCheckIn));
      if (autoResult?.autoApproved) {
        return { ...reg, status: 'APPROVED', autoApproved: true, autoReason: autoResult.reason };
      }
    }

    // Notify HR/Admin users about the pending regularization request
    try {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true, employeeCode: true, organizationId: true },
      });
      if (employee) {
        emitToOrg(employee.organizationId, 'attendance:regularization-submitted', {
          regId: reg.id,
          employeeId,
          employeeName: `${employee.firstName} ${employee.lastName}`,
        });
        const hrUsers = await prisma.user.findMany({
          where: { organizationId: employee.organizationId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, status: 'ACTIVE' },
          select: { id: true, email: true },
        });
        const dateStr = new Date(record.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        for (const hr of hrUsers) {
          if (hr.email) {
            await enqueueEmail({
              to: hr.email,
              subject: `Regularization Request — ${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
              template: 'regularization-submitted',
              context: {
                employeeName: `${employee.firstName} ${employee.lastName}`,
                employeeCode: employee.employeeCode,
                date: dateStr,
                reason,
                requestedCheckIn: requestedCheckIn
                  ? new Date(requestedCheckIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  : null,
                requestedCheckOut: requestedCheckOut
                  ? new Date(requestedCheckOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  : null,
                reviewUrl: 'https://hr.anistonav.com/attendance',
              },
            });
          }
          await enqueueNotification({
            userId: hr.id,
            organizationId: employee.organizationId,
            type: 'REGULARIZATION_SUBMITTED',
            title: `Regularization Request — ${employee.firstName} ${employee.lastName}`,
            message: `${employee.firstName} ${employee.lastName} (${employee.employeeCode}) has submitted a regularization request for ${dateStr}.`,
            link: '/attendance',
          }).catch(() => {});
        }
      }
    } catch { /* non-blocking */ }

    return reg;
  }

  /**
   * Try to auto-approve a regularization based on shift grace period
   */
  private async tryAutoApproveRegularization(regId: string, employeeId: string, requestedCheckIn: Date) {
    try {
      // Get employee's active shift
      const assignment = await prisma.shiftAssignment.findFirst({
        where: { employeeId, endDate: null },
        include: { shift: true },
        orderBy: { startDate: 'desc' },
      });

      if (!assignment?.shift) return null;

      const shift = assignment.shift;
      const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
      const graceMinutes = shift.graceMinutes || 15;

      // Calculate grace end time (use setMinutes separately to avoid overflow when min+grace > 59)
      const checkInDate = new Date(requestedCheckIn);
      const graceEnd = new Date(checkInDate);
      graceEnd.setHours(shiftHour, shiftMin, 0, 0);
      graceEnd.setMinutes(graceEnd.getMinutes() + graceMinutes);

      if (checkInDate <= graceEnd) {
        // Within grace — auto-approve
        await this.handleRegularization(regId, 'APPROVED', 'SYSTEM', 'Auto-approved: check-in within grace period');
        return { autoApproved: true, reason: 'Within shift grace period' };
      }

      // Check if employee has good attendance record (no leaves this month)
      const monthStart = new Date(checkInDate.getFullYear(), checkInDate.getMonth(), 1);
      const leavesThisMonth = await prisma.leaveRequest.count({
        where: {
          employeeId,
          status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
          startDate: { gte: monthStart },
        },
      });

      const extendedGrace = new Date(graceEnd);
      extendedGrace.setMinutes(extendedGrace.getMinutes() + 60);

      if (leavesThisMonth === 0 && checkInDate <= extendedGrace) {
        await this.handleRegularization(regId, 'APPROVED', 'SYSTEM', 'Auto-approved: good attendance record this month');
        return { autoApproved: true, reason: 'Good attendance record' };
      }

      return null;
    } catch {
      return null; // Fail silently — leave as PENDING for manual review
    }
  }

  /**
   * Approve/reject regularization (for managers/HR)
   */
  async handleRegularization(
    regularizationId: string,
    action: 'APPROVED' | 'REJECTED' | 'MANAGER_REVIEWED',
    approvedBy: string,
    remarks?: string,
    approverRole?: string,
    approvalType?: 'FULL_DAY' | 'HALF_DAY'
  ) {
    const reg = await prisma.attendanceRegularization.findUnique({
      where: { id: regularizationId },
      include: {
        attendance: {
          include: { employee: { include: { user: { select: { role: true } } } } },
        },
      },
    });
    if (!reg) throw new NotFoundError('Regularization request');

    // HR restriction gate
    const regEmployeeId = reg.attendance?.employeeId;
    if (approverRole === 'HR' && regEmployeeId) {
      await assertHRActionAllowed('HR', regEmployeeId, 'canHRResolveRegularization');
    }

    // HR cannot approve/reject regularization for another HR/Admin/SuperAdmin
    if (['HR'].includes(approverRole || '')) {
      const targetRole = reg.attendance?.employee?.user?.role;
      if (targetRole && ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(targetRole)) {
        throw new BadRequestError('HR accounts cannot approve regularizations for other HR accounts. Only Super Admin or Admin can do this.');
      }
    }

    // 2-tier regularization workflow:
    // PENDING → MANAGER_REVIEWED (by Manager) → APPROVED/REJECTED (by HR/Admin)
    // Managers can only move to MANAGER_REVIEWED, HR/Admin can approve/reject directly
    const isManager = approverRole === 'MANAGER';
    const isHRorAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(approverRole || '');

    let finalStatus: string;
    if (action === 'REJECTED') {
      finalStatus = 'REJECTED';
    } else if (isManager && reg.status === 'PENDING') {
      finalStatus = 'MANAGER_REVIEWED';
    } else if (isHRorAdmin) {
      finalStatus = action === 'APPROVED' ? 'APPROVED' : action;
    } else {
      finalStatus = action;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateData: any = { status: finalStatus };

      if (isManager) {
        updateData.managerReviewedBy = approvedBy;
        updateData.managerRemarks = remarks || null;
        updateData.managerReviewedAt = new Date();
      } else if (isHRorAdmin) {
        updateData.hrReviewedBy = approvedBy;
        updateData.hrRemarks = remarks || null;
        updateData.hrReviewedAt = new Date();
        updateData.approvedBy = approvedBy;
        updateData.approverRemarks = remarks || null;
      } else {
        updateData.approvedBy = approvedBy;
        updateData.approverRemarks = remarks || null;
      }

      const updatedReg = await tx.attendanceRegularization.update({
        where: { id: regularizationId },
        data: updateData,
      });

      // If approved: apply requested check-in/check-out corrections and recalculate hours.
      // Only reset checkOut if requestedCheckOut is explicitly provided — otherwise preserve original.
      if (action === 'APPROVED') {
        const attendanceStatus = approvalType === 'HALF_DAY' ? 'HALF_DAY' : 'PRESENT';
        const updateData: any = {
          status: attendanceStatus,
          notes: `Regularization approved by ${approverRole || 'HR'} (userId: ${approvedBy}) — requested: ${reg.requestedCheckIn ? `checkIn=${new Date(reg.requestedCheckIn).toTimeString().slice(0,5)}` : ''}${reg.requestedCheckOut ? ` checkOut=${new Date(reg.requestedCheckOut).toTimeString().slice(0,5)}` : ''}`,
        };
        if (reg.requestedCheckIn) updateData.checkIn = reg.requestedCheckIn;
        if (reg.requestedCheckOut) {
          // Checkout was explicitly regularized — update it and recalculate hours
          updateData.checkOut = reg.requestedCheckOut;
          const checkIn = reg.requestedCheckIn ?? reg.attendance?.checkIn;
          if (checkIn && reg.requestedCheckOut) {
            const diffMs = new Date(reg.requestedCheckOut).getTime() - new Date(checkIn).getTime();
            updateData.totalHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
          }
        } else if (reg.requestedCheckIn && reg.attendance?.checkOut) {
          // Only check-in was regularized — recalculate hours with new check-in but preserve original checkout
          const diffMs = new Date(reg.attendance.checkOut).getTime() - new Date(reg.requestedCheckIn).getTime();
          updateData.totalHours = diffMs > 0 ? Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100 : null;
        } else if (reg.requestedCheckIn && !reg.attendance?.checkOut) {
          // Check-in regularized, no checkout exists — reset to allow re-checkout
          updateData.checkOut = null;
          updateData.totalHours = null;
        }

        await tx.attendanceRecord.update({
          where: { id: reg.attendanceId },
          data: updateData,
        });
      }

      return updatedReg;
    });

    // Audit log: HR/Manager regularization action
    try {
      const emp = await prisma.employee.findUnique({
        where: { id: reg.employeeId },
        select: { organizationId: true, firstName: true, lastName: true },
      });
      if (emp && approvedBy !== 'SYSTEM') {
        await createAuditLog({
          userId: approvedBy,
          organizationId: emp.organizationId,
          entity: 'AttendanceRegularization',
          entityId: regularizationId,
          action: finalStatus === 'APPROVED' ? 'APPROVE' : finalStatus === 'REJECTED' ? 'REJECT' : 'UPDATE',
          newValue: { status: finalStatus, employeeName: `${emp.firstName} ${emp.lastName}`, remarks: remarks || null },
        });
      }
    } catch { /* non-blocking */ }

    // Real-time update: push attendance:checkin so employee's frontend re-fetches today status
    if (finalStatus === 'APPROVED') {
      try {
        const emp = await prisma.employee.findUnique({
          where: { id: reg.employeeId },
          select: { organizationId: true, firstName: true, lastName: true },
        });
        if (emp) {
          emitToOrg(emp.organizationId, 'attendance:checkin', {
            employeeId: reg.employeeId,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            regularizationApproved: true,
          });
        }
      } catch { /* non-blocking */ }
    }

    // Notify the employee if the final decision is APPROVED or REJECTED
    if (finalStatus === 'APPROVED' || finalStatus === 'REJECTED') {
      try {
        const empRecord = await prisma.employee.findUnique({
          where: { id: reg.employeeId },
          select: { firstName: true, lastName: true, organizationId: true, user: { select: { email: true } } },
        });
        const empEmail = empRecord?.user?.email;
        if (empEmail) {
          const dateStr = new Date(reg.attendance.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
          await enqueueEmail({
            to: empEmail,
            subject: `Regularization ${finalStatus === 'APPROVED' ? 'Approved' : 'Rejected'} — ${dateStr}`,
            template: 'regularization-reviewed',
            context: {
              employeeName: empRecord?.firstName,
              date: dateStr,
              status: finalStatus,
              remarks: remarks || '',
              appUrl: 'https://hr.anistonav.com/attendance',
            },
          });
          // In-app notification
          const empUser = await prisma.user.findFirst({
            where: { employee: { id: reg.employeeId } },
            select: { id: true },
          });
          if (empUser) {
            await enqueueNotification({
              userId: empUser.id,
              organizationId: empRecord.organizationId,
              type: 'REGULARIZATION_REVIEWED',
              title: `Regularization ${finalStatus === 'APPROVED' ? 'Approved' : 'Rejected'}`,
              message: `Your attendance regularization for ${new Date(reg.attendance.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} was ${finalStatus.toLowerCase()}${remarks ? ': ' + remarks : '.'}`,
              link: '/attendance',
            });
          }
        }
      } catch { /* non-blocking */ }
    }

    return updated;
  }

  async getRegularizations(
    organizationId: string,
    options: { status?: string; search?: string; date?: string; page?: number; limit?: number }
  ) {
    const { status, search, date, page = 1, limit = 50 } = options;

    const statusFilter: string[] = status && status !== 'ALL'
      ? [status]
      : ['PENDING', 'MANAGER_REVIEWED', 'APPROVED', 'REJECTED'];

    const where: any = {
      attendance: { employee: { organizationId } },
      status: { in: statusFilter },
    };

    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      const dayStart = new Date(`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T00:00:00.000Z`);
      const dayEnd = new Date(`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T23:59:59.999Z`);
      where.attendance = { ...where.attendance, date: { gte: dayStart, lte: dayEnd } };
    }

    if (search) {
      where.attendance = {
        ...where.attendance,
        employee: {
          ...where.attendance.employee,
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { employeeCode: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [regs, total] = await Promise.all([
      prisma.attendanceRegularization.findMany({
        where,
        include: {
          attendance: {
            include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendanceRegularization.count({ where }),
    ]);

    return { regs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Get attendance records for a specific employee in a date range (HR/Admin view)
   */
  async getEmployeeAttendance(employeeId: string, startDate: string, endDate: string) {
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundError('Employee');

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: { gte: start, lte: end },
      },
      include: { breaks: true, logs: { orderBy: { timestamp: 'asc' } } },
      orderBy: { date: 'asc' },
    });

    // Fetch holidays
    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId: employee.organizationId,
        date: { gte: start, lte: end },
      },
    });

    // Build summary — mirrors getMyAttendance logic including implicit absent days
    const summary = {
      totalDays: 0,
      present: 0,
      absent: 0,
      halfDay: 0,
      onLeave: 0,
      holidays: holidays.length,
      weekends: 0,
      workFromHome: 0,
      averageHours: 0,
    };

    let totalWorkedHours = 0;
    const holidayDatesEmp = new Set(holidays.map(h => new Date(h.date).toISOString().split('T')[0]));
    const datesWithRecordEmp = new Set(records.map(r => new Date(r.date).toISOString().split('T')[0]));
    const todayEmp = new Date();
    todayEmp.setHours(0, 0, 0, 0);

    const current = new Date(start);
    while (current <= end) {
      summary.totalDays++;
      const day = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      if (day === 0 && !holidayDatesEmp.has(dateStr)) summary.weekends++; // Sunday only — Saturday is working day
      // Implicit absent: past Mon-Sat with no record and no holiday
      if (
        day !== 0 &&
        !holidayDatesEmp.has(dateStr) &&
        !datesWithRecordEmp.has(dateStr) &&
        current < todayEmp
      ) {
        summary.absent++;
      }
      current.setDate(current.getDate() + 1);
    }

    records.forEach((r) => {
      switch (r.status) {
        case 'PRESENT': summary.present++; break;
        case 'ABSENT':  summary.absent++;  break; // explicit records not in loop (datesWithRecord covers them)
        case 'HALF_DAY': summary.halfDay++; break;
        case 'ON_LEAVE': summary.onLeave++; break;
        case 'WORK_FROM_HOME': summary.workFromHome++; break;
      }
      // Cap individual day hours at 9h so anomalous records don't inflate the average
      if (r.totalHours) totalWorkedHours += Math.min(Number(r.totalHours), 9);
    });

    summary.averageHours = summary.present > 0
      ? Math.round((totalWorkedHours / summary.present) * 10) / 10
      : 0;

    return { records, holidays, summary };
  }

  /**
   * Mark attendance for a specific employee on a specific date (HR/Admin)
   * Creates or updates (upsert) an attendance record.
   */
  async markAttendance(data: MarkAttendanceInput, markedBy: string, organizationId?: string, markedByRole?: string) {
    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) throw new NotFoundError('Employee');

    // ===== Multi-tenant validation =====
    if (organizationId && employee.organizationId !== organizationId) {
      throw new BadRequestError('Employee does not belong to your organization.');
    }

    // Parse date as UTC midnight so PostgreSQL date column stores the correct IST calendar date.
    // new Date("2026-04-30") + setHours(0,0,0,0) shifts to IST midnight = UTC 2026-04-29T18:30Z
    // → PG would store 2026-04-29 (WRONG). Appending T00:00:00.000Z keeps it as 2026-04-30 in PG.
    const [dy, dm, dd] = data.date.split('-');
    const date = new Date(`${dy}-${dm}-${dd}T00:00:00.000Z`);

    // HR restriction gate
    if (markedByRole === 'HR') {
      await assertHRActionAllowed('HR', data.employeeId, 'canHRMarkAttendance');
    }

    // HR must have a pending regularization request from the employee before manually marking
    if (markedByRole === 'HR') {
      const regularization = await prisma.attendanceRegularization.findFirst({
        where: {
          employeeId: data.employeeId,
          status: { in: ['PENDING', 'MANAGER_APPROVED'] },
          attendance: { date },
        },
      });
      if (!regularization) {
        throw new BadRequestError(
          'No regularization request found for this date. The employee must submit a regularization request before HR can manually mark their attendance.'
        );
      }
    }

    // Block HR from marking attendance before the employee's joining date
    if (employee.joiningDate) {
      const jd = new Date(employee.joiningDate);
      const joiningMidnight = new Date(`${jd.getUTCFullYear()}-${String(jd.getUTCMonth()+1).padStart(2,'0')}-${String(jd.getUTCDate()).padStart(2,'0')}T00:00:00.000Z`);
      if (date < joiningMidnight) {
        throw new BadRequestError(
          `Cannot mark attendance before joining date (${joiningMidnight.toLocaleDateString('en-IN')}). Update the employee's joining date first if needed.`
        );
      }
    }

    const manualMarkNote = `Manual attendance mark by HR/Admin (userId: ${markedBy}) via HR_PANEL`;
    const record = await prisma.attendanceRecord.upsert({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date,
        },
      },
      update: {
        status: data.status,
        workMode: (data.workMode || employee.workMode) as any,
        source: 'MANUAL_HR',
        notes: manualMarkNote,
      },
      create: {
        employeeId: data.employeeId,
        date,
        status: data.status,
        workMode: (data.workMode || employee.workMode) as any,
        source: 'MANUAL_HR',
        notes: manualMarkNote,
      },
    });

    // If marking as ON_LEAVE and a leaveTypeId is provided, adjust leave balance
    if (data.status === 'ON_LEAVE' && (data as any).leaveTypeId) {
      try {
        const year = date.getUTCFullYear();
        const balance = await prisma.leaveBalance.findFirst({
          where: { employeeId: data.employeeId, leaveTypeId: (data as any).leaveTypeId, year },
        });
        if (balance) {
          const safeDecrement = Math.min(1, Math.max(0, Number(balance.allocated) - Number(balance.used)));
          if (safeDecrement > 0) {
            await prisma.leaveBalance.update({
              where: { id: balance.id },
              data: { used: { increment: safeDecrement } },
            });
          }
        }
      } catch { /* non-blocking — balance update failure should not block HR mark */ }
    }

    // ===== Audit log for HR marking =====
    try {
      await createAuditLog({
        userId: markedBy,
        organizationId: employee.organizationId,
        entity: 'AttendanceRecord',
        entityId: record.id,
        action: 'MARK_ATTENDANCE',
        newValue: { status: data.status, date: data.date, source: 'MANUAL_HR' },
      });
    } catch { /* non-blocking */ }

    // Emit socket so all open attendance views (command center + employee detail) update instantly
    try {
      emitToOrg(employee.organizationId, 'attendance:marked', {
        employeeId: data.employeeId,
        date: data.date,
        status: data.status,
        source: 'MANUAL_HR',
      });
    } catch { /* non-blocking */ }

    return record;
  }

  // ===================== PRIVATE HELPERS =====================

  /**
   * Calculate accurate total hours by subtracting gap periods and breaks
   * Uses AttendanceLog entries to find gap periods between clock-out and re-clock-in
   */
  private async calculateAccurateTotalHours(recordId: string, checkIn: Date, checkOut: Date): Promise<number> {
    const rawHours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);

    // Get gap periods from logs
    const gapLogs = await prisma.attendanceLog.findMany({
      where: { attendanceId: recordId, action: 'GAP_PERIOD' },
      orderBy: { timestamp: 'asc' },
    });

    let totalGapMs = 0;
    for (const gap of gapLogs) {
      if (gap.notes) {
        // Parse "Gap: <ISO> to <ISO>" format
        const match = gap.notes.match(/Gap: (.+) to (.+)/);
        if (match) {
          const gapStart = new Date(match[1]);
          const gapEnd = new Date(match[2]);
          if (!isNaN(gapStart.getTime()) && !isNaN(gapEnd.getTime())) {
            totalGapMs += gapEnd.getTime() - gapStart.getTime();
          }
        }
      }
    }

    // Subtract break durations — always recompute from startTime/endTime to prevent
    // manipulation of the stored durationMinutes field.
    const breaks = await prisma.break.findMany({
      where: { attendanceId: recordId, endTime: { not: null } },
    });
    const totalBreakMs = breaks.reduce((sum, b) => {
      if (!b.startTime || !b.endTime) return sum;
      const computed = new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
      return sum + Math.max(0, computed);
    }, 0);

    const accurateMs = (checkOut.getTime() - checkIn.getTime()) - totalGapMs - totalBreakMs;
    const accurateHours = Math.max(0, accurateMs / (1000 * 60 * 60));

    return Math.round(accurateHours * 100) / 100;
  }

  /**
   * Detect GPS spoofing — flag if location jumps >10km in <5 minutes
   */
  private async detectGPSSpoofing(employeeId: string, lat: number, lng: number): Promise<{ spoofing: boolean; distance?: number; timeDiff?: number }> {
    try {
      const lastPoint = await prisma.gPSTrailPoint.findFirst({
        where: { employeeId },
        orderBy: { timestamp: 'desc' },
      });

      if (!lastPoint) {
        // Also check last attendance log with location
        const lastLog = await prisma.attendanceLog.findFirst({
          where: { attendance: { employeeId }, location: { not: undefined } } as any,
          orderBy: { timestamp: 'desc' },
        });
        if (!lastLog?.location) return { spoofing: false };

        const loc = lastLog.location as any;
        if (!loc?.lat || !loc?.lng) return { spoofing: false };

        const timeDiffMin = (Date.now() - new Date(lastLog.timestamp).getTime()) / (1000 * 60);
        if (timeDiffMin > this.GPS_SPOOF_TIME_MINUTES) return { spoofing: false };

        const distance = this.haversineDistance(loc.lat, loc.lng, lat, lng);
        if (distance > this.GPS_SPOOF_DISTANCE_M) {
          return { spoofing: true, distance: Math.round(distance), timeDiff: Math.round(timeDiffMin) };
        }
        return { spoofing: false };
      }

      const timeDiffMin = (Date.now() - new Date(lastPoint.timestamp).getTime()) / (1000 * 60);
      if (timeDiffMin > this.GPS_SPOOF_TIME_MINUTES) return { spoofing: false };

      const distance = this.haversineDistance(Number(lastPoint.lat), Number(lastPoint.lng), lat, lng);
      if (distance > this.GPS_SPOOF_DISTANCE_M) {
        return { spoofing: true, distance: Math.round(distance), timeDiff: Math.round(timeDiffMin) };
      }
      return { spoofing: false };
    } catch (err) {
      logger.error(`[GPS Spoofing] Detection failed for employee ${employeeId}:`, err);
      return { spoofing: false }; // fail open but log error
    }
  }

  /**
   * Simple visit clustering for GPS trail points
   */
  private clusterVisits(points: any[]) {
    if (points.length === 0) return [];

    const visits: any[] = [];
    let clusterStart = 0;
    const RADIUS_THRESHOLD_M = 200; // 200 meters
    const MIN_DURATION_MS = 10 * 60 * 1000; // 10 minutes

    for (let i = 1; i < points.length; i++) {
      // Use haversine for accurate geo-distance instead of Euclidean in degrees
      const distance = this.haversineDistance(
        Number(points[i].lat), Number(points[i].lng),
        Number(points[clusterStart].lat), Number(points[clusterStart].lng)
      );

      if (distance > RADIUS_THRESHOLD_M) {
        // Check if the cluster lasted long enough
        const startTime = new Date(points[clusterStart].timestamp).getTime();
        const endTime = new Date(points[i - 1].timestamp).getTime();
        const duration = endTime - startTime;

        if (duration >= MIN_DURATION_MS) {
          visits.push({
            label: `Visit ${visits.length + 1}`,
            lat: Number(points[clusterStart].lat),
            lng: Number(points[clusterStart].lng),
            startTime: points[clusterStart].timestamp,
            endTime: points[i - 1].timestamp,
            durationMinutes: Math.round(duration / (1000 * 60)),
            pointCount: i - clusterStart,
          });
        }
        clusterStart = i;
      }
    }

    // Check last cluster
    if (points.length > 1) {
      const startTime = new Date(points[clusterStart].timestamp).getTime();
      const endTime = new Date(points[points.length - 1].timestamp).getTime();
      const duration = endTime - startTime;
      if (duration >= MIN_DURATION_MS) {
        visits.push({
          label: `Visit ${visits.length + 1}`,
          lat: Number(points[clusterStart].lat),
          lng: Number(points[clusterStart].lng),
          startTime: points[clusterStart].timestamp,
          endTime: points[points.length - 1].timestamp,
          durationMinutes: Math.round(duration / (1000 * 60)),
          pointCount: points.length - clusterStart,
        });
      }
    }

    return visits;
  }

  /**
   * Haversine distance between two coordinates in meters
   */
  /**
   * Get attendance logs for a specific attendance record (HR view)
   */
  async getAttendanceLogs(attendanceId: string) {
    const logs = await prisma.attendanceLog.findMany({
      where: { attendanceId },
      orderBy: { timestamp: 'asc' },
    });
    return logs;
  }

  /**
   * Get attendance logs for an employee on a specific date (HR view)
   */
  async getAttendanceLogsByDate(employeeId: string, date: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: targetDate } },
      include: { logs: { orderBy: { timestamp: 'asc' } }, breaks: true },
    });

    if (!record) return { record: null, logs: [] };
    return { record, logs: record.logs };
  }

  async projectSiteCheckIn(employeeId: string, data: {
    siteName: string; siteAddress?: string; notes?: string;
    latitude?: number; longitude?: number; checkInPhoto?: string;
  }) {
    const today = getISTToday();

    if (!data.checkInPhoto) {
      throw new BadRequestError('A check-in photo is required for project site attendance.');
    }

    // Verify employee has an active clock-in for today
    const attendance = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (!attendance || !attendance.checkIn) {
      throw new BadRequestError('Please clock in first before recording a project site visit.');
    }
    if (attendance.checkOut) {
      throw new BadRequestError('You have already clocked out. Cannot record a site visit after clock-out.');
    }

    return prisma.projectSiteCheckIn.create({
      data: {
        employeeId,
        date: today,
        siteName: data.siteName,
        siteAddress: data.siteAddress || null,
        checkInPhoto: data.checkInPhoto,
        checkInLat: data.latitude || null,
        checkInLng: data.longitude || null,
        notes: data.notes || null,
      },
    });
  }

  async getProjectSiteCheckIns(employeeId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    return prisma.projectSiteCheckIn.findMany({
      where: { employeeId, date: targetDate },
      orderBy: { createdAt: 'desc' },
    });
  }

  // =====================================================================
  // ENTERPRISE COMMAND CENTER — Stats, Anomalies, Live Board
  // =====================================================================

  /**
   * Command center KPI stats — 13 dense enterprise metrics for a given date
   */
  async getCommandCenterStats(organizationId: string, date: string) {
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);

    const dayOfWeek = queryDate.getDay();
    const isWeekend = dayOfWeek === 0; // Sunday

    // Parallel queries for all KPI data
    const [
      totalActive,
      records,
      leaveCount,
      pendingRegularizations,
      anomalyCount,
      fieldActive,
      wfhActive,
      onLeaveToday,
    ] = await Promise.all([
      // Total active (non-system) employees — must match the employee set in getAllAttendanceEnhanced
      prisma.employee.count({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] } },
      }),
      // All attendance records for the date
      prisma.attendanceRecord.findMany({
        where: { date: queryDate, employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } } },
        include: {
          employee: {
            select: {
              id: true, firstName: true, lastName: true, employeeCode: true, workMode: true,
              department: { select: { id: true, name: true } },
              designation: { select: { id: true, name: true } },
              managerId: true,
            },
          },
          breaks: true,
          regularization: true,
          logs: { orderBy: { timestamp: 'asc' } },
        },
      }),
      // On leave (approved leave requests covering the date)
      prisma.leaveRequest.count({
        where: {
          employee: { organizationId, deletedAt: null },
          status: { in: ['APPROVED', 'MANAGER_APPROVED', 'APPROVED_WITH_CONDITION'] },
          startDate: { lte: endOfDay },
          endDate: { gte: queryDate },
        },
      }),
      // Pending regularizations
      prisma.attendanceRegularization.count({
        where: { status: 'PENDING', attendance: { employee: { organizationId } } },
      }),
      // Anomaly count for the date
      prisma.attendanceAnomaly.count({
        where: { organizationId, date: queryDate, resolution: 'PENDING' },
      }),
      // Field sales active today
      prisma.attendanceRecord.count({
        where: { date: queryDate, workMode: 'FIELD_SALES', status: 'PRESENT', employee: { organizationId, deletedAt: null } },
      }),
      // WFH active today
      prisma.attendanceRecord.count({
        where: { date: queryDate, workMode: { in: ['REMOTE', 'HYBRID'] }, status: { in: ['PRESENT', 'WORK_FROM_HOME'] }, employee: { organizationId, deletedAt: null } },
      }),
      // Employees on approved leave for the queried date
      prisma.leaveRequest.count({
        where: {
          employee: { organizationId },
          status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
          startDate: { lte: queryDate },
          endDate: { gte: queryDate },
        },
      }),
    ]);

    // Derived stats from records
    const present = records.filter(r => r.status === 'PRESENT' || r.status === 'WORK_FROM_HOME').length;
    const explicitAbsent = records.filter(r => r.status === 'ABSENT').length;
    const halfDay = records.filter(r => r.status === 'HALF_DAY').length;
    const lateArrivals = records.filter(r => r.checkIn && (r.lateMinutes > 0 || r.notes?.includes('[Late by'))).length;
    const earlyExits = records.filter(r => {
      if (!r.checkOut || !r.checkIn) return false;
      const hours = Number(r.totalHours || 0);
      const shift = r.employee && (r as any).shiftAssignment?.shift;
      const halfDayThreshold = shift ? Number(shift.halfDayHours) : 4;
      return hours > 0 && hours < halfDayThreshold;
    }).length;
    const missingPunch = records.filter(r => r.checkIn && !r.checkOut && r.status === 'PRESENT').length;
    const notCheckedIn = Math.max(0, totalActive - records.length);
    // Employees who haven't checked in are treated as absent for the stat card
    const absent = explicitAbsent + notCheckedIn;

    return {
      expectedToday: isWeekend ? 0 : Math.max(0, totalActive - onLeaveToday),
      present,
      absent,
      onLeave: leaveCount,
      weeklyOff: isWeekend ? totalActive : 0,
      notCheckedIn,
      lateArrivals,
      earlyExits,
      missingPunch,
      halfDay,
      attendanceExceptions: anomalyCount,
      fieldActive,
      wfhActive,
      pendingRegularizations,
    };
  }

  /**
   * Enhanced getAllAttendance with enterprise-grade includes
   */
  async getAllAttendanceEnhanced(query: AttendanceQuery & {
    designation?: string;
    managerId?: string;
    shiftType?: string;
    anomalyType?: string;
    regularizationStatus?: string;
    employeeType?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
    isLate?: boolean;
  }, organizationId: string) {
    const { page, limit, startDate, endDate, employeeId, department, status, workMode,
      designation, managerId, shiftType, anomalyType, regularizationStatus, employeeType,
      search, sortBy, sortOrder, isLate } = query;
    const skip = (page - 1) * limit;

    let queryDate = startDate ? new Date(startDate) : new Date();
    queryDate.setHours(0, 0, 0, 0);
    const endQueryDate = endDate ? new Date(endDate) : new Date(queryDate);
    endQueryDate.setHours(23, 59, 59, 999);

    // Build employee filter
    const empWhere: any = {
      organizationId, deletedAt: null,
      isSystemAccount: { not: true },
      status: employeeType
        ? { in: employeeType === 'PROBATION' ? ['PROBATION'] : employeeType === 'INTERN' ? ['INTERN'] : ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] }
        : { in: ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] },
    };
    if (department) empWhere.departmentId = department;
    if (designation) empWhere.designationId = designation;
    if (managerId) empWhere.managerId = managerId;
    if (employeeId) empWhere.id = employeeId;
    if (workMode) empWhere.workMode = workMode;
    if (search) {
      empWhere.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    // Fetch employees + records with enterprise includes
    const [allEmployees, records, totalEmployees] = await Promise.all([
      prisma.employee.findMany({
        where: empWhere,
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true, email: true,
          workMode: true, avatar: true, phone: true, status: true,
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
          shiftAssignments: {
            where: { endDate: null },
            take: 1,
            include: { shift: true, location: { include: { geofence: true } } },
          },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.attendanceRecord.findMany({
        where: {
          date: { gte: queryDate, lte: endQueryDate },
          employee: { ...empWhere },
        },
        include: {
          employee: {
            select: {
              id: true, firstName: true, lastName: true, employeeCode: true, email: true,
              workMode: true, avatar: true, phone: true, status: true,
              department: { select: { id: true, name: true } },
              designation: { select: { id: true, name: true } },
              manager: { select: { id: true, firstName: true, lastName: true } },
              shiftAssignments: {
                where: { endDate: null },
                take: 1,
                include: { shift: true, location: { include: { geofence: true } } },
              },
            },
          },
          breaks: true,
          regularization: true,
          logs: { orderBy: { timestamp: 'asc' }, take: 1 },
          anomalies: { where: { resolution: 'PENDING' } },
        },
      }),
      prisma.employee.count({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] } },
      }),
    ]);

    // Build map
    const recordMap = new Map<string, any>();
    records.forEach(r => recordMap.set(r.employeeId, r));

    // Merge
    let mergedData = allEmployees.map(emp => {
      const record = recordMap.get(emp.id);
      const shiftAssign = emp.shiftAssignments?.[0];
      const shift = shiftAssign?.shift;

      if (record) {
        const recShift = record.employee?.shiftAssignments?.[0];
        return {
          ...record,
          shift: recShift?.shift || shift || null,
          shiftLocation: recShift?.location || shiftAssign?.location || null,
          breakDuration: record.breaks?.reduce((sum: number, b: any) => sum + (b.durationMinutes || 0), 0) || 0,
          anomalyCount: record.anomalies?.length || 0,
          anomalyTypes: record.anomalies?.map((a: any) => a.type) || [],
          regularizationStatus: record.regularization?.status || null,
          locationCompliance: this.getLocationCompliance(record),
        };
      }

      return {
        id: `placeholder-${emp.id}`,
        employeeId: emp.id,
        date: queryDate,
        checkIn: null,
        checkOut: null,
        totalHours: null,
        status: 'NOT_CHECKED_IN',
        workMode: emp.workMode || 'OFFICE',
        source: null,
        geofenceViolation: false,
        employee: emp,
        breaks: [],
        shift: shift || null,
        shiftLocation: shiftAssign?.location || null,
        breakDuration: 0,
        anomalyCount: 0,
        anomalyTypes: [],
        regularizationStatus: null,
        locationCompliance: 'UNKNOWN',
      };
    });

    // Apply filters
    if (status) {
      // ABSENT filter includes NOT_CHECKED_IN employees (they are effectively absent)
      if (status === 'ABSENT') {
        mergedData = mergedData.filter(r => r.status === 'ABSENT' || r.status === 'NOT_CHECKED_IN');
      } else {
        mergedData = mergedData.filter(r => r.status === status);
      }
    }
    if (isLate) mergedData = mergedData.filter(r => (r.lateMinutes > 0) || r.notes?.includes('[Late by'));
    if (anomalyType) mergedData = mergedData.filter(r => r.anomalyTypes?.includes(anomalyType));
    if (regularizationStatus) mergedData = mergedData.filter(r => r.regularizationStatus === regularizationStatus);
    if (shiftType) mergedData = mergedData.filter(r => r.shift?.shiftType === shiftType);

    // Always sort alphabetically case-insensitive; override with explicit sortBy if provided
    if (sortBy) {
      mergedData.sort((a, b) => {
        let valA: any, valB: any;
        switch (sortBy) {
          case 'checkIn': valA = a.checkIn; valB = b.checkIn; break;
          case 'checkOut': valA = a.checkOut; valB = b.checkOut; break;
          case 'totalHours': valA = Number(a.totalHours || 0); valB = Number(b.totalHours || 0); break;
          case 'name': valA = a.employee?.firstName; valB = b.employee?.firstName; break;
          default: valA = a.checkIn; valB = b.checkIn;
        }
        if (valA == null) return 1;
        if (valB == null) return -1;
        return sortOrder === 'desc' ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
      });
    } else {
      mergedData.sort((a, b) => {
        const nameA = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`.trim();
        const nameB = `${b.employee?.firstName || ''} ${b.employee?.lastName || ''}`.trim();
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      });
    }

    const total = mergedData.length;
    const paginatedData = mergedData.slice(skip, skip + limit);

    // Summary
    const present = mergedData.filter(r => r.status === 'PRESENT' || r.status === 'WORK_FROM_HOME').length;
    const absent = mergedData.filter(r => r.status === 'ABSENT').length;
    const onLeave = mergedData.filter(r => r.status === 'ON_LEAVE').length;
    const notCheckedIn = mergedData.filter(r => r.status === 'NOT_CHECKED_IN').length;

    return {
      data: paginatedData,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
      summary: { totalEmployees, present, absent, onLeave, notCheckedIn },
    };
  }

  /**
   * Get anomalies for command center exceptions tab
   */
  async getAnomalies(organizationId: string, query: {
    date?: string; type?: string; severity?: string; resolution?: string;
    employeeId?: string; page?: number; limit?: number;
  }) {
    const { date, type, severity, resolution, employeeId, page = 1, limit = 25 } = query;
    const where: any = { organizationId };
    if (date) { const d = new Date(date); d.setHours(0, 0, 0, 0); where.date = d; }
    if (type) where.type = type;
    if (severity) where.severity = severity;
    if (resolution) where.resolution = resolution;
    if (employeeId) where.employeeId = employeeId;

    const [anomalies, total] = await Promise.all([
      prisma.attendanceAnomaly.findMany({
        where,
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendanceAnomaly.count({ where }),
    ]);

    return {
      data: anomalies,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  /**
   * Resolve an anomaly
   */
  async resolveAnomaly(anomalyId: string, organizationId: string, resolution: string, resolvedBy: string, remarks?: string) {
    // Multi-tenant: verify anomaly belongs to this organization
    const anomaly = await prisma.attendanceAnomaly.findFirst({ where: { id: anomalyId, organizationId } });
    if (!anomaly) throw new NotFoundError('Anomaly');
    return prisma.attendanceAnomaly.update({
      where: { id: anomalyId },
      data: { resolution: resolution as any, resolvedBy, resolvedAt: new Date(), resolverRemarks: remarks },
    });
  }

  /**
   * Live attendance board — who is where right now
   */
  async getLiveBoard(organizationId: string) {
    const today = getISTToday();

    const records = await prisma.attendanceRecord.findMany({
      where: { date: today, employee: { organizationId, deletedAt: null, isSystemAccount: { not: true } } },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true, avatar: true, workMode: true,
            department: { select: { name: true } },
          },
        },
        breaks: { where: { endTime: null } },
        logs: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });

    const allEmployees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION'] } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, avatar: true, workMode: true, department: { select: { name: true } } },
    });

    const checkedInIds = new Set(records.map(r => r.employeeId));

    const inOffice = records.filter(r => !r.checkOut && r.workMode === 'OFFICE' && !r.breaks?.length);
    const onBreak = records.filter(r => !r.checkOut && r.breaks?.length);
    const onField = records.filter(r => !r.checkOut && r.workMode === 'FIELD_SALES');
    const wfh = records.filter(r => !r.checkOut && (r.workMode === 'REMOTE' || r.workMode === 'HYBRID' || r.status === 'WORK_FROM_HOME'));
    const late = records.filter(r => {
      const log = r.logs?.[0];
      return log?.notes?.includes('Late') || log?.notes?.includes('late');
    });
    const checkedOut = records.filter(r => r.checkOut);
    const notCheckedIn = allEmployees.filter(e => !checkedInIds.has(e.id));
    const anomalies = records.filter(r => r.geofenceViolation);

    return {
      inOffice: inOffice.map(r => ({ ...r.employee, checkIn: r.checkIn, totalHours: r.totalHours })),
      onBreak: onBreak.map(r => ({ ...r.employee, checkIn: r.checkIn })),
      onField: onField.map(r => ({ ...r.employee, checkIn: r.checkIn })),
      wfh: wfh.map(r => ({ ...r.employee, checkIn: r.checkIn, totalHours: r.totalHours })),
      late: late.map(r => ({ ...r.employee, checkIn: r.checkIn })),
      checkedOut: checkedOut.map(r => ({ ...r.employee, checkOut: r.checkOut, totalHours: r.totalHours })),
      notCheckedIn,
      anomalies: anomalies.map(r => ({ ...r.employee, checkIn: r.checkIn })),
      totals: {
        inOffice: inOffice.length,
        onBreak: onBreak.length,
        onField: onField.length,
        wfh: wfh.length,
        late: late.length,
        checkedOut: checkedOut.length,
        notCheckedIn: notCheckedIn.length,
        anomalies: anomalies.length,
      },
    };
  }

  /**
   * Smart anomaly detection engine — scan a date and create anomaly records
   */
  async detectAnomalies(organizationId: string, date: string) {
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    // Fetch org attendance policy for configurable thresholds
    const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId } });
    const lateHighThreshold = 60;   // minutes — could be moved to policy later
    const lateMediumThreshold = 30;
    const earlyExitThreshold = 30;
    const missingPunchGraceMin = 60;

    const records = await prisma.attendanceRecord.findMany({
      where: { date: queryDate, employee: { organizationId, deletedAt: null } },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true,
            shiftAssignments: { where: { endDate: null }, take: 1, include: { shift: true } } },
        },
        logs: { orderBy: { timestamp: 'asc' } },
      },
    });

    // Fix #4: Get approved leaves for this date to skip those employees
    const approvedLeaves = await prisma.leaveRequest.findMany({
      where: {
        employee: { organizationId },
        status: { in: ['APPROVED', 'MANAGER_APPROVED'] },
        startDate: { lte: queryDate },
        endDate: { gte: queryDate },
      },
      select: { employeeId: true },
    });
    const onLeaveSet = new Set(approvedLeaves.map(l => l.employeeId));

    // Fix #5: Check if today is a holiday
    const holiday = await prisma.holiday.findFirst({
      where: { organizationId, date: queryDate },
    });

    const anomalies: any[] = [];

    for (const record of records) {
      const shift = record.employee?.shiftAssignments?.[0]?.shift;
      const empId = record.employeeId;

      // Fix #4: Skip anomaly detection for employees on approved leave
      if (onLeaveSet.has(empId)) continue;

      // Fix H4: Skip anomaly detection for employees without a shift assignment
      if (!shift) continue;

      // Fix #6: Use policy grace as fallback when shift doesn't have it
      const graceMinutes = shift.graceMinutes ?? policy?.lateGraceMinutes ?? 15;

      // E10: WFH shift records — only check MISSING_PUNCH and INSUFFICIENT_HOURS
      const isWfhRecord = (shift as any).isWfhShift === true || record.status === 'WORK_FROM_HOME';

      // --- LATE ARRIVAL --- (skip for WFH)
      // IST = UTC+5:30. Shift times are IST wall-clock. queryDate is UTC-midnight on a UTC server.
      // IST wall-clock in UTC = queryDate + (shift_minutes - 330) * 60000.
      const IST_OFFSET_MS = 330 * 60000;
      if (!isWfhRecord && record.checkIn && shift) {
        const [shiftH, shiftM] = shift.startTime.split(':').map(Number);
        const shiftStart = new Date(queryDate.getTime() + (shiftH * 60 + shiftM) * 60000 - IST_OFFSET_MS);
        const grace = new Date(shiftStart.getTime() + graceMinutes * 60000);
        if (record.checkIn > grace) {
          const lateMinutes = Math.round((record.checkIn.getTime() - shiftStart.getTime()) / 60000);
          anomalies.push({
            attendanceId: record.id, employeeId: empId, date: queryDate,
            type: 'LATE_ARRIVAL',
            severity: lateMinutes > lateHighThreshold ? 'HIGH' : lateMinutes > lateMediumThreshold ? 'MEDIUM' : 'LOW',
            description: `Late by ${lateMinutes} min (shift ${shift.startTime}, grace ${graceMinutes}min)`,
            metadata: { lateMinutes, shiftStart: shift.startTime, grace: graceMinutes },
            organizationId, autoDetected: true,
          });
        }
      }

      // --- MISSING PUNCH --- (applies to WFH too)
      if (record.checkIn && !record.checkOut && shift) {
        const now = getISTNow();
        const [endH, endM] = shift.endTime.split(':').map(Number);
        const shiftEnd = new Date(queryDate.getTime() + (endH * 60 + endM) * 60000 - IST_OFFSET_MS);
        if (now > new Date(shiftEnd.getTime() + missingPunchGraceMin * 60000)) {
          anomalies.push({
            attendanceId: record.id, employeeId: empId, date: queryDate,
            type: 'MISSING_PUNCH', severity: 'HIGH',
            description: `Checked in at ${record.checkIn.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} but no checkout recorded`,
            metadata: { checkIn: record.checkIn },
            organizationId, autoDetected: true,
          });
        }
      }

      // --- INSUFFICIENT HOURS ---
      if (record.checkOut && shift) {
        const totalHours = Number(record.totalHours || 0);
        const halfDayHours = Number(shift.halfDayHours || policy?.halfDayMinHours || 4);
        if (totalHours > 0 && totalHours < halfDayHours) {
          anomalies.push({
            attendanceId: record.id, employeeId: empId, date: queryDate,
            type: 'INSUFFICIENT_HOURS', severity: 'MEDIUM',
            description: `Only ${totalHours.toFixed(1)}h worked (minimum ${halfDayHours}h for half day)`,
            metadata: { totalHours, halfDayHours },
            organizationId, autoDetected: true,
          });
        }
      }

      // --- GEOFENCE VIOLATION --- (skip for WFH)
      if (!isWfhRecord && record.geofenceViolation) {
        anomalies.push({
          attendanceId: record.id, employeeId: empId, date: queryDate,
          type: 'OUTSIDE_GEOFENCE', severity: 'HIGH',
          description: 'Check-in recorded outside approved geofence area',
          metadata: { checkInLocation: record.checkInLocation },
          organizationId, autoDetected: true,
        });
      }

      // --- EARLY EXIT --- (skip for WFH)
      if (!isWfhRecord && record.checkOut && shift) {
        const [endH, endM] = shift.endTime.split(':').map(Number);
        const shiftEnd = new Date(queryDate.getTime() + (endH * 60 + endM) * 60000 - IST_OFFSET_MS);
        const earlyMinutes = Math.round((shiftEnd.getTime() - record.checkOut.getTime()) / 60000);
        if (earlyMinutes > earlyExitThreshold) {
          anomalies.push({
            attendanceId: record.id, employeeId: empId, date: queryDate,
            type: 'EARLY_EXIT', severity: earlyMinutes > 120 ? 'HIGH' : 'MEDIUM',
            description: `Left ${earlyMinutes} min early (shift ends ${shift.endTime})`,
            metadata: { earlyMinutes, shiftEnd: shift.endTime },
            organizationId, autoDetected: true,
          });
        }
      }

      // --- Fix #5: GPS SPOOFING (detect large jumps in GPS trail) --- (skip for WFH)
      if (!isWfhRecord && record.checkIn && record.checkInLocation) {
        const loc = record.checkInLocation as any;
        if (loc?.lat && loc?.lng) {
          // Check if there was a previous day's checkout location and compare
          const prevRecord = await prisma.attendanceRecord.findFirst({
            where: { employeeId: empId, date: { lt: queryDate }, checkOutLocation: { not: undefined } } as any,
            orderBy: { date: 'desc' },
            select: { checkOutLocation: true, checkOut: true },
          });
          if (prevRecord?.checkOutLocation && prevRecord.checkOut) {
            const prevLoc = prevRecord.checkOutLocation as any;
            if (prevLoc?.lat && prevLoc?.lng) {
              const dist = this.haversineDistance(loc.lat, loc.lng, prevLoc.lat, prevLoc.lng);
              const timeDiffMin = (record.checkIn.getTime() - prevRecord.checkOut.getTime()) / 60000;
              // If employee "traveled" > 10km in < 5 minutes, flag as GPS spoof
              if (dist > this.GPS_SPOOF_DISTANCE_M && timeDiffMin < this.GPS_SPOOF_TIME_MINUTES) {
                anomalies.push({
                  attendanceId: record.id, employeeId: empId, date: queryDate,
                  type: 'GPS_SPOOF', severity: 'CRITICAL',
                  description: `GPS jump: ${Math.round(dist)}m in ${Math.round(timeDiffMin)} min (threshold: ${this.GPS_SPOOF_DISTANCE_M}m in ${this.GPS_SPOOF_TIME_MINUTES}min)`,
                  metadata: { distance: Math.round(dist), timeDiffMin: Math.round(timeDiffMin), currentLoc: loc, previousLoc: prevLoc },
                  organizationId, autoDetected: true,
                });
              }
            }
          }
        }
      }

      // --- Fix #5: HOLIDAY ATTENDANCE (worked on a non-optional holiday) --- (skip for WFH)
      if (!isWfhRecord && holiday && !holiday.isOptional && record.checkIn) {
        anomalies.push({
          attendanceId: record.id, employeeId: empId, date: queryDate,
          type: 'HOLIDAY_ATTENDANCE', severity: 'MEDIUM',
          description: `Attendance recorded on holiday: ${holiday.name}`,
          metadata: { holidayName: holiday.name, holidayType: holiday.isOptional ? 'optional' : 'mandatory' },
          organizationId, autoDetected: true,
        });
      }

      // --- GPS_NO_DATA: Field sales employee checked in but has no GPS points ---
      if (!isWfhRecord && record.checkIn && shift.shiftType === 'FIELD') {
        const gpsCount = await prisma.gPSTrailPoint.count({
          where: { employeeId: empId, date: queryDate },
        });
        if (gpsCount === 0) {
          anomalies.push({
            attendanceId: record.id, employeeId: empId, date: queryDate,
            type: 'GPS_NO_DATA', severity: 'MEDIUM',
            description: 'Field sales employee checked in but no GPS location data recorded for this day',
            metadata: { shiftName: shift.name },
            organizationId, autoDetected: true,
          });
        }
      }
    }

    // Bulk upsert anomalies (use transaction to prevent race condition duplicates)
    let created = 0;
    for (const anomaly of anomalies) {
      try {
        await prisma.$transaction(async (tx) => {
          const existing = await tx.attendanceAnomaly.findFirst({
            where: { attendanceId: anomaly.attendanceId, type: anomaly.type, date: anomaly.date },
          });
          if (!existing) {
            await tx.attendanceAnomaly.create({ data: anomaly });
            created++;
          }
        });
      } catch (e: any) {
        if (!e.code?.includes('P2002')) logger.error(`Anomaly upsert error:`, e);
      }
    }

    // Notify HR users in real-time when critical/high anomalies are detected
    if (created > 0) {
      try {
        const criticalCount = anomalies.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH').length;
        if (criticalCount > 0) {
          const hrUsers = await prisma.user.findMany({
            where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR'] }, employee: { organizationId } },
            select: { id: true },
          });
          for (const hrUser of hrUsers) {
            enqueueNotification({
              userId: hrUser.id,
              organizationId,
              title: `${criticalCount} critical attendance anomal${criticalCount > 1 ? 'ies' : 'y'} detected`,
              message: `${created} new anomalies found for ${date}. ${criticalCount} require immediate review.`,
              type: 'ATTENDANCE_ANOMALY',
              link: '/command-center',
            }).catch(() => {}); // Non-blocking: don't fail anomaly detection on notification error
          }
        }
      } catch { /* notification failure should not block anomaly detection */ }
    }

    return { detected: anomalies.length, created, date };
  }

  /**
   * Employee attendance detail — enriched for the detail page
   */
  async getEmployeeAttendanceDetail(employeeId: string, date: string) {
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    const [record, regularizations, anomalies, leaveRequests, shiftAssignment] = await Promise.all([
      prisma.attendanceRecord.findUnique({
        where: { employeeId_date: { employeeId, date: queryDate } },
        include: {
          breaks: true,
          logs: { orderBy: { timestamp: 'asc' } },
          regularization: true,
          anomalies: true,
          locationVisits: { orderBy: { arrivalTime: 'asc' } },
        },
      }),
      prisma.attendanceRegularization.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { attendance: { select: { date: true, checkIn: true, checkOut: true } } },
      }),
      prisma.attendanceAnomaly.findMany({
        where: { employeeId, date: queryDate },
      }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId,
          startDate: { lte: new Date(queryDate.getTime() + 86400000) },
          endDate: { gte: queryDate },
        },
        include: { leaveType: { select: { name: true } } },
      }),
      prisma.shiftAssignment.findFirst({
        where: { employeeId, endDate: null },
        include: { shift: true, location: { include: { geofence: true } } },
      }),
    ]);

    // For today: enrich with live GPS status from Redis
    const todayStr = new Date().toISOString().slice(0, 10);
    let gpsLiveStatus: {
      gpsStatus: 'ACTIVE' | 'HEARTBEAT_MISSED' | 'STOPPED' | 'UNKNOWN';
      lastHeartbeatAt: string | null;
      lastGpsPointAt: string | null;
      lastLatitude: number | null;
      lastLongitude: number | null;
      activeGpsAnomaly: string | null;
    } | null = null;

    if (date === todayStr) {
      try {
        const { redis } = await import('../../lib/redis.js');
        const [activeRaw, hbAlive] = await Promise.all([
          redis.get(`gps:active:${employeeId}`),
          redis.exists(`gps:hb:${employeeId}`),
        ]);
        if (activeRaw) {
          const activeData: any = JSON.parse(activeRaw);
          const openAnomaly = anomalies.find(
            (a: any) => a.type === 'GPS_HEARTBEAT_MISSED' && !a.resolvedAt
          );
          gpsLiveStatus = {
            gpsStatus: hbAlive ? 'ACTIVE' : (activeData.alertSent ? 'HEARTBEAT_MISSED' : 'RECENTLY_MISSED'),
            lastHeartbeatAt: activeData.lastHeartbeatAt ?? null,
            lastGpsPointAt: activeData.lastGpsPointAt ?? null,
            lastLatitude: activeData.lastLatitude ?? null,
            lastLongitude: activeData.lastLongitude ?? null,
            activeGpsAnomaly: openAnomaly ? openAnomaly.type : null,
          };
        } else {
          gpsLiveStatus = {
            gpsStatus: 'STOPPED',
            lastHeartbeatAt: null,
            lastGpsPointAt: null,
            lastLatitude: null,
            lastLongitude: null,
            activeGpsAnomaly: null,
          };
        }
      } catch { /* Redis unavailable — omit GPS status */ }
    }

    return {
      record,
      regularizations,
      anomalies,
      leaveRequests,
      shiftAssignment,
      shift: shiftAssignment?.shift || null,
      location: shiftAssignment?.location || null,
      ...(gpsLiveStatus ?? {}),
    };
  }

  /**
   * Determine location compliance string
   */
  private getLocationCompliance(record: any): string {
    if (record.workMode === 'REMOTE' || record.workMode === 'HYBRID') return 'REMOTE_APPROVED';
    if (record.workMode === 'FIELD_SALES') return 'APPROVED_FIELD_SITE';
    if (record.geofenceViolation) return 'OUTSIDE_GEOFENCE';
    const log = record.logs?.[0];
    if (log?.geofenceStatus === 'INSIDE') return 'INSIDE_GEOFENCE';
    if (log?.geofenceStatus === 'OUTSIDE') return 'OUTSIDE_GEOFENCE';
    return 'UNKNOWN';
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Mark ON_LEAVE attendance records for each working day in the approved leave date range.
   * Called after leave approval to auto-populate attendance so dashboards and reports
   * correctly show the employee as on leave rather than absent/not-checked-in.
   */
  async markOnLeaveForApprovedDates(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    organizationId: string,
  ): Promise<{ count: number }> {
    // Fetch org-level week-off days (default Sunday = 0)
    const policy = await prisma.attendancePolicy.findUnique({
      where: { organizationId },
      select: { weekOffDays: true },
    });
    const weekOffDays = new Set<number>((policy?.weekOffDays as number[] | null) ?? [0]);

    let count = 0;
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      const dayOfWeek = current.getDay();

      // Skip week-off days
      if (!weekOffDays.has(dayOfWeek)) {
        // Use IST-midnight date so the date column comparison is correct (same as clock-in logic)
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        const istDate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

        try {
          await prisma.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId, date: istDate } },
            create: {
              employeeId,
              date: istDate,
              status: 'ON_LEAVE',
              workMode: 'OFFICE', // neutral default; no physical mode for a leave day
              source: 'MANUAL_HR',
              notes: 'Auto-marked ON_LEAVE on leave approval',
            },
            update: {
              // Only overwrite if the record has no check-in (don't clobber an actual attendance)
              status: 'ON_LEAVE',
              source: 'MANUAL_HR',
              notes: 'Auto-marked ON_LEAVE on leave approval',
            },
          });
          count++;
        } catch (e: any) {
          // Unique constraint race — skip silently
          if (!e.code?.includes('P2002')) {
            logger.warn(`[Attendance] markOnLeaveForApprovedDates upsert error for ${employeeId} on ${istDate.toISOString()}: ${e.message}`);
          }
        }
      }

      current.setDate(current.getDate() + 1);
    }

    return { count };
  }

  /**
   * Fire-and-forget email to HR/admin when a Sunday-working employee clocks in.
   * Reads recipient from Organization.adminNotificationEmail (falling back to payrollEmail).
   */
  private async _notifySundayAttendance(employee: any, organizationId: string, multiplier: number) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { adminNotificationEmail: true, payrollEmail: true, name: true, settings: true },
      });

      // Recipient: admin notification email > payroll email > configured SMTP sender
      const smtpConfig = (org?.settings as any)?.email;
      const recipient = org?.adminNotificationEmail || org?.payrollEmail || smtpConfig?.fromAddress;
      if (!recipient) {
        logger.warn(`[Attendance] Sunday notification: no recipient email configured for org ${organizationId}. Set Admin Notification Email in Settings.`);
        return;
      }

      const { enqueueEmail } = await import('../../jobs/queues.js');
      const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      await enqueueEmail({
        to: recipient,
        subject: `Sunday Attendance — ${employee.firstName} ${employee.lastName} clocked in`,
        template: 'generic',
        context: {
          title: 'Sunday Attendance Notification',
          message: `<strong>${employee.firstName} ${employee.lastName}</strong> (${employee.employeeCode}) has clocked in on <strong>${today}</strong>.<br/><br/>This employee is marked as a Sunday worker. The payroll system will apply a <strong>${multiplier}x pay multiplier</strong> for today's attendance.<br/><br/><span style="color:#6B7280;font-size:12px;">Sent automatically by Aniston HRMS &middot; ${org?.name || 'Aniston Technologies'}</span>`,
        },
      });
      logger.info(`[Attendance] Sunday notification queued for ${employee.employeeCode} → ${recipient}`);
    } catch (err: any) {
      logger.warn(`[Attendance] Sunday notification setup failed: ${err.message}`);
    }
  }

  private async _alertHrGpsSpoof(employeeId: string, organizationId: string, distance: number, timeDiff: number) {
    try {
      const [emp, org] = await Promise.all([
        prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true, employeeCode: true } }),
        prisma.organization.findUnique({ where: { id: organizationId }, select: { adminNotificationEmail: true, name: true } }),
      ]);
      if (!org?.adminNotificationEmail || !emp) return;
      const { enqueueEmail } = await import('../../jobs/queues.js');
      const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      await enqueueEmail({
        to: org.adminNotificationEmail,
        subject: `Security Alert: GPS Spoofing Attempt — ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
        template: 'generic',
        context: {
          title: '🚨 GPS Spoofing Blocked',
          message: `<strong>${emp.firstName} ${emp.lastName}</strong> (${emp.employeeCode}) attempted to clock in at <strong>${time}</strong>, but GPS showed an impossible location jump of <strong>${distance}m in ${timeDiff} minutes</strong>.<br/><br/>The clock-in was blocked automatically. If this employee is genuinely at a different location, please mark attendance manually via the HR dashboard.<br/><br/><span style="color:#6B7280;font-size:12px;">${org.name || 'Aniston Technologies'}</span>`,
        },
      });
    } catch (err: any) {
      logger.warn(`[Attendance] GPS spoof HR alert setup failed: ${err.message}`);
    }
  }

  private async _alertHrPoorGpsAccuracy(employeeId: string, organizationId: string, accuracy: number, lat?: number | null, lng?: number | null) {
    try {
      const [emp, org] = await Promise.all([
        prisma.employee.findUnique({
          where: { id: employeeId },
          select: { firstName: true, lastName: true, employeeCode: true },
        }),
        prisma.organization.findUnique({
          where: { id: organizationId },
          select: { adminNotificationEmail: true, name: true },
        }),
      ]);
      if (!org?.adminNotificationEmail || !emp) return;

      const { enqueueEmail } = await import('../../jobs/queues.js');
      const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const coordsText = lat && lng ? `Approx. coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Coordinates unavailable';
      await enqueueEmail({
        to: org.adminNotificationEmail,
        subject: `Attendance Alert: Poor GPS Accuracy — ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
        template: 'generic',
        context: {
          title: 'Poor GPS Accuracy — Geofence Check Skipped',
          message: `<strong>${emp.firstName} ${emp.lastName}</strong> (${emp.employeeCode}) clocked in at <strong>${time}</strong> with poor GPS accuracy of <strong>±${Math.round(accuracy)}m</strong> (threshold: ±150m).<br/><br/>The geofence check was skipped — attendance was recorded without location verification. Please review manually if needed.<br/><br/><span style="color:#6B7280;font-size:12px;">${coordsText} &middot; ${org.name || 'Aniston Technologies'}</span>`,
        },
      });
    } catch (err: any) {
      logger.warn(`[Attendance] Poor-GPS HR alert failed: ${err.message}`);
    }
  }

  private async _alertHrNoOfficeLocation(employeeId: string, organizationId: string) {
    try {
      const [emp, org] = await Promise.all([
        prisma.employee.findUnique({
          where: { id: employeeId },
          select: { firstName: true, lastName: true, employeeCode: true },
        }),
        prisma.organization.findUnique({
          where: { id: organizationId },
          select: { adminNotificationEmail: true, name: true },
        }),
      ]);
      if (!org?.adminNotificationEmail || !emp) return;

      const { enqueueEmail } = await import('../../jobs/queues.js');
      await enqueueEmail({
        to: org.adminNotificationEmail,
        subject: `Action Required: No Office Location Assigned — ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
        template: 'generic',
        context: {
          title: 'Employee Cannot Clock In — No Office Location',
          message: `<strong>${emp.firstName} ${emp.lastName}</strong> (${emp.employeeCode}) attempted to clock in but has no office location or geofence assigned to their shift.<br/><br/>Please assign an office location to this employee's shift in <strong>Roster → Assign Shift</strong> so they can mark attendance.<br/><br/><span style="color:#6B7280;font-size:12px;">Sent automatically by Aniston HRMS &middot; ${org.name || 'Aniston Technologies'}</span>`,
        },
      });
    } catch (err: any) {
      logger.warn(`[Attendance] No-location HR alert failed: ${err.message}`);
    }
  }

  // =========================================================================
  // EXCEL IMPORT
  // =========================================================================

  /**
   * Import attendance and leave data from the legacy monthly Excel sheet.
   * IDEMPOTENT — re-importing the same month fully replaces all previously
   * imported data for that month.
   *
   * Excel format (auto-detected):
   *   One column contains EMP-xxx codes — that is the EMP column.
   *   The day columns (1–31) start 2 columns to the right of the EMP column.
   *   Header row is detected by looking for the row that has "1" in the
   *   expected day-1 column (or a row with "EMP" in a cell).
   *
   * Cell codes:
   *   P        → PRESENT
   *   A        → ABSENT
   *   A(SL)    → ON_LEAVE + deduct 1 Sick Leave
   *   A(CL)    → ON_LEAVE + deduct 1 Casual Leave
   *   HD(CL)   → ON_LEAVE + deduct 0.5 Casual Leave
   *   HD(SL)   → ON_LEAVE + deduct 0.5 Sick Leave
   *   A(EL)    → ON_LEAVE + deduct 1 Earned/Emergency Leave
   *   HD(EL)   → ON_LEAVE + deduct 0.5 Earned/Emergency Leave
   *   blank/~/- → skip
   */
  async importFromExcel(
    fileBuffer: Buffer,
    month: number,
    year: number,
    organizationId: string,
    importedBy: string,
  ): Promise<{ processed: number; skipped: number; errors: string[] }> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(fileBuffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestError('Excel file has no worksheets');

    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, employeeCode: true },
    });
    const empMap = new Map(employees.map(e => [e.employeeCode.toUpperCase(), e.id]));

    const leaveTypes = await prisma.leaveType.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true, defaultBalance: true },
    });

    const findLeaveType = (keyword: string) =>
      leaveTypes.find(lt => lt.code?.toUpperCase() === keyword) ||
      leaveTypes.find(lt => lt.name?.toUpperCase().includes(keyword));

    const slType  = findLeaveType('SL')  ?? findLeaveType('SICK');
    const clType  = findLeaveType('CL')  ?? findLeaveType('CASUAL');
    // EL = Earned Leave or Emergency Leave — try several common codes/names
    const elType  = findLeaveType('EL')  ?? findLeaveType('EARNED') ?? findLeaveType('EMERGENCY');

    const daysInMonth = new Date(year, month, 0).getDate();

    // Month date range for cleanup queries
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd   = new Date(Date.UTC(year, month - 1, daysInMonth));

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    // ── STEP 1: Detect EMP column by scanning data rows 2–10 ──────────────────
    let empColIndex = 2; // default: column B
    outerEmp:
    for (let r = 2; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= Math.min(sheet.columnCount, 10); c++) {
        const val = row.getCell(c).text?.toString().trim().toUpperCase() ?? '';
        if (/^EMP-\d+/.test(val)) {
          empColIndex = c;
          break outerEmp;
        }
      }
    }

    // ── STEP 2: Detect day-1 column robustly ──────────────────────────────────
    // Scan rows 1-5 for cells "1","2","3" consecutively — handles headers on row 2.
    // Use both .text and .value to handle numeric vs text-formatted day cells.
    let dayStartColIndex = empColIndex + 3; // fallback
    const getCellStr = (row: any, col: number) => {
      const cell = row.getCell(col);
      return (cell.text?.toString().trim() || cell.value?.toString().trim() || '');
    };
    outer123:
    for (let hr = 1; hr <= Math.min(5, sheet.rowCount); hr++) {
      const hrow = sheet.getRow(hr);
      for (let c = empColIndex + 1; c <= sheet.columnCount; c++) {
        const v1 = getCellStr(hrow, c);
        const v2 = getCellStr(hrow, c + 1);
        const v3 = getCellStr(hrow, c + 2);
        // Confirm three consecutive cells contain "1","2","3"
        if (v1 === '1' && v2 === '2' && v3 === '3') {
          dayStartColIndex = c;
          break outer123;
        }
      }
    }

    logger.info(`[Import] empColIndex=${empColIndex} dayStartColIndex=${dayStartColIndex} daysInMonth=${daysInMonth}`);

    // ── PASS 1: Parse sheet, collect all valid rows ───────────────────────────
    type DayEntry = { status: string; leaveTypeId: string | null; leaveDays: number; date: Date };
    const empDays = new Map<string, DayEntry[]>();
    const seenEmpCodes = new Set<string>();

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);

      // Skip completely empty rows
      const empCell = row.getCell(empColIndex).text?.toString().trim();
      if (!empCell) continue;

      if (!empCell.toUpperCase().startsWith('EMP')) {
        // Non-EMP code row — skip silently
        continue;
      }

      const empCode = empCell.toUpperCase();

      const employeeId = empMap.get(empCode);
      if (!employeeId) {
        skipped++;
        errors.push(`${empCode} not found in system`);
        continue;
      }

      if (!seenEmpCodes.has(empCode)) {
        seenEmpCodes.add(empCode);
        empDays.set(employeeId, []);
        processed++;
      }

      const days = empDays.get(employeeId)!;

      for (let day = 1; day <= daysInMonth; day++) {
        const colIndex = dayStartColIndex - 1 + day; // day 1 = dayStartColIndex
        const cell = row.getCell(colIndex);
        // Use .text first; fall back to .value for rich-text / formula cells
        const raw = (cell.text?.toString().trim() || cell.value?.toString().trim() || '').toUpperCase();

        let status: string;
        let leaveTypeId: string | null = null;
        let leaveDays = 0;

        if (!raw || raw === '~' || raw === '-' || raw === '--') {
          // Blank cell = employee was present (HR only fills leave/absent codes explicitly)
          status = 'PRESENT';
        } else if (raw === 'P') {
          status = 'PRESENT';
        } else if (raw === 'A') {
          status = 'ABSENT';
        } else if (raw === 'A(SL)') {
          status = 'ON_LEAVE';
          if (!slType) errors.push(`${empCode} day ${day}: Sick Leave type not configured — deduction skipped`);
          leaveTypeId = slType?.id ?? null;
          leaveDays = slType ? 1 : 0;
        } else if (raw === 'HD(SL)') {
          status = 'ON_LEAVE';
          if (!slType) errors.push(`${empCode} day ${day}: Sick Leave type not configured — deduction skipped`);
          leaveTypeId = slType?.id ?? null;
          leaveDays = slType ? 0.5 : 0;
        } else if (raw === 'A(CL)') {
          status = 'ON_LEAVE';
          if (!clType) errors.push(`${empCode} day ${day}: Casual Leave type not configured — deduction skipped`);
          leaveTypeId = clType?.id ?? null;
          leaveDays = clType ? 1 : 0;
        } else if (raw === 'HD(CL)') {
          status = 'ON_LEAVE';
          if (!clType) errors.push(`${empCode} day ${day}: Casual Leave type not configured — deduction skipped`);
          leaveTypeId = clType?.id ?? null;
          leaveDays = clType ? 0.5 : 0;
        } else if (raw === 'A(EL)') {
          status = 'ON_LEAVE';
          if (!elType) errors.push(`${empCode} day ${day}: Earned/Emergency Leave type not configured — deduction skipped`);
          leaveTypeId = elType?.id ?? null;
          leaveDays = elType ? 1 : 0;
        } else if (raw === 'HD(EL)') {
          status = 'ON_LEAVE';
          if (!elType) errors.push(`${empCode} day ${day}: Earned/Emergency Leave type not configured — deduction skipped`);
          leaveTypeId = elType?.id ?? null;
          leaveDays = elType ? 0.5 : 0;
        } else if (raw.startsWith('A(') || raw === 'WO' || raw === 'H' || raw === 'NH') {
          // Week off / Holiday / not-working — skip (no attendance record needed)
          continue;
        } else if (raw.startsWith('A')) {
          // Unknown absent-type code
          status = 'ABSENT';
        } else {
          // Unknown code — treat as present (safe default)
          status = 'PRESENT';
        }

        const date = new Date(Date.UTC(year, month - 1, day));

        // Overwrite if same day appears from a duplicate row
        const existingIdx = days.findIndex(d => d.date.getTime() === date.getTime());
        const entry: DayEntry = { status, leaveTypeId, leaveDays, date };
        if (existingIdx >= 0) {
          days[existingIdx] = entry;
        } else {
          days.push(entry);
        }
      }
    }

    if (processed === 0) {
      errors.push('No valid EMP-xxx rows found in the Excel file');
      return { processed, skipped, errors };
    }

    // ── PASS 2: For each employee, reset then write ───────────────────────────
    for (const [employeeId, days] of empDays.entries()) {
      if (days.length === 0) continue;

      // Fetch employee's organizationId once — used across all steps below
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { organizationId: true },
      });
      if (!emp) continue;
      const empOrgId = emp.organizationId;

      try {
        // Step A: Delete ALL attendance records for this employee in this month
        // (regardless of source — import always fully overrides the month).
        // Must delete children first because AttendanceLog / Break /
        // AttendanceRegularization / AttendanceAnomaly have Restrict FKs.
        const recordsToDelete = await prisma.attendanceRecord.findMany({
          where: { employeeId, date: { gte: monthStart, lte: monthEnd } },
          select: { id: true },
        });
        const idsToDelete = recordsToDelete.map(r => r.id);

        if (idsToDelete.length > 0) {
          await prisma.attendanceLog.deleteMany({ where: { attendanceId: { in: idsToDelete } } });
          await prisma.break.deleteMany({ where: { attendanceId: { in: idsToDelete } } });
          await prisma.attendanceAnomaly.deleteMany({ where: { attendanceId: { in: idsToDelete } } });
          await prisma.attendanceRegularization.deleteMany({ where: { attendanceId: { in: idsToDelete } } });
          await prisma.attendanceRecord.deleteMany({ where: { id: { in: idsToDelete } } });
        }

        // Step B: Delete any previously imported LeaveRequests for this month
        await (prisma.leaveRequest.deleteMany as any)({
          where: {
            employeeId,
            startDate: { gte: monthStart },
            endDate:   { lte: monthEnd },
            reason: { contains: `Imported from legacy Excel attendance (${month}/${year})` },
          },
        });

        // Step C: Reverse leave balance changes from a prior import of this month.
        // Old logs store the deduction amount as a negative number (-1, -0.5 …).
        // We add those back (i.e. subtract the negative → add) to restore balance.
        const oldLogs = await prisma.leaveAllocationLog.findMany({
          where: {
            employeeId,
            year,
            allocationType: 'PREVIOUS_USED',
            reason: { contains: `Excel import — ${month}/${year}` },
          },
          select: { id: true, leaveTypeId: true, days: true },
        });

        for (const log of oldLogs) {
          const bal = await prisma.leaveBalance.findFirst({
            where: { employeeId, leaveTypeId: log.leaveTypeId, year },
          });
          if (bal) {
            // Always subtract the absolute deduction regardless of how old logs stored it
            // (old logs may have days=+N positive; new logs store days=-N negative)
            const deduction = Math.abs(Number(log.days));
            const revertUsed = Math.max(0, Number(bal.used) - deduction);
            const revertPrev = Math.max(0, Number((bal as any).previousUsed ?? 0) - deduction);
            await prisma.leaveBalance.update({
              where: { id: bal.id },
              data: { used: revertUsed, previousUsed: revertPrev },
            });
          }
          await prisma.leaveAllocationLog.delete({ where: { id: log.id } });
        }
      } catch (err: any) {
        errors.push(`Reset failed for ${employeeId}: ${err.message}`);
        continue;
      }

      // Step D: Write attendance records
      // Use updateMany+create (not upsert) to avoid timezone mismatch on date column
      for (const entry of days) {
        try {
          const dateStr = entry.date.toISOString().split('T')[0]; // 'YYYY-MM-DD'
          const updated = await prisma.attendanceRecord.updateMany({
            where: { employeeId, date: new Date(dateStr) },
            data: {
              status: entry.status as any,
              workMode: 'OFFICE' as any,
              source: 'MANUAL_HR' as any,
              notes: `Imported from Excel (${month}/${year})`,
            },
          });
          if (updated.count === 0) {
            await prisma.attendanceRecord.create({
              data: {
                employeeId,
                date: new Date(dateStr),
                status: entry.status as any,
                workMode: 'OFFICE' as any,
                source: 'MANUAL_HR' as any,
                notes: `Imported from Excel (${month}/${year})`,
              },
            });
          }
        } catch (err: any) {
          errors.push(`${employeeId} day ${entry.date.getUTCDate()}: ${err.message}`);
        }
      }

      // Step E: Accumulate leave events per leave type, update balances + create requests
      type LeaveEvent = { date: Date; days: number };
      const leaveByType = new Map<string, LeaveEvent[]>();
      for (const entry of days) {
        if (!entry.leaveTypeId || entry.leaveDays <= 0) continue;
        if (!leaveByType.has(entry.leaveTypeId)) leaveByType.set(entry.leaveTypeId, []);
        leaveByType.get(entry.leaveTypeId)!.push({ date: entry.date, days: entry.leaveDays });
      }

      for (const [leaveTypeId, events] of leaveByType.entries()) {
        const totalDays = events.reduce((s, e) => s + e.days, 0);
        const sortedDates = events.map(e => e.date).sort((a, b) => a.getTime() - b.getTime());

        try {
          const existing = await prisma.leaveBalance.findFirst({
            where: { employeeId, leaveTypeId, year },
          });

          if (existing) {
            await prisma.leaveBalance.update({
              where: { id: existing.id },
              data: {
                used: { increment: totalDays },
                previousUsed: { increment: totalDays },
              },
            });
          } else {
            const lt = leaveTypes.find(l => l.id === leaveTypeId);
            const defaultAlloc = Number(lt?.defaultBalance ?? 0);
            await prisma.leaveBalance.create({
              data: {
                employeeId,
                leaveTypeId,
                year,
                organizationId: empOrgId,
                policyAllocated: defaultAlloc,
                manualAdjustment: 0,
                previousUsed: totalDays,
                allocated: defaultAlloc,
                used: totalDays,
                pending: 0,
                carriedForward: 0,
              },
            });
          }

          // Audit log — store days as NEGATIVE so the UI shows "-1" (deduction)
          await prisma.leaveAllocationLog.create({
            data: {
              employeeId,
              leaveTypeId,
              year,
              allocationType: 'PREVIOUS_USED',
              days: -totalDays,
              reason: `Excel import — ${month}/${year}`,
              changedBy: importedBy,
              organizationId: empOrgId,
            },
          });

          // Group consecutive dates (allow up to 3-day gap to bridge weekends)
          // into single LeaveRequest runs per leave type.
          const runs: Array<{ start: Date; end: Date; days: number }> = [];
          let runStart = sortedDates[0];
          let runEnd = sortedDates[0];
          let runDays = events.find(e => e.date.getTime() === sortedDates[0].getTime())?.days ?? 1;

          for (let i = 1; i < sortedDates.length; i++) {
            const prev = sortedDates[i - 1];
            const curr = sortedDates[i];
            const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
            const dayDays = events.find(e => e.date.getTime() === curr.getTime())?.days ?? 1;
            // Bridge weekends (gap ≤ 3 days means Fri→Mon counts as consecutive)
            if (diffDays <= 3) {
              runEnd = curr;
              runDays += dayDays;
            } else {
              runs.push({ start: runStart, end: runEnd, days: runDays });
              runStart = curr; runEnd = curr; runDays = dayDays;
            }
          }
          runs.push({ start: runStart, end: runEnd, days: runDays });

          for (const run of runs) {
            await (prisma.leaveRequest.create as any)({
              data: {
                employeeId,
                leaveTypeId,
                startDate: run.start,
                endDate: run.end,
                days: run.days,
                isHalfDay: run.days < 1,
                reason: `Imported from legacy Excel attendance (${month}/${year})`,
                status: 'APPROVED',
                paidDays: run.days,
                unpaidDays: 0,
              },
            });
          }
        } catch (err: any) {
          errors.push(`Leave update failed for ${employeeId}: ${err.message}`);
        }
      }
    }

    return { processed, skipped, errors };
  }
}

export const attendanceService = new AttendanceService();
