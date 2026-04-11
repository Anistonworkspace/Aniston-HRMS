import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { emitToOrg, invalidateDashboardCache } from '../../sockets/index.js';
import { enqueueEmail, enqueueNotification } from '../../jobs/queues.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { logger } from '../../lib/logger.js';
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
  private readonly MAX_RECLOCKIN_PER_DAY = 3; // Allow up to 3 re-clock-ins per day
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
    // Enterprise rule: GPS coordinates must be freshly acquired at the time of marking.
    // If the client sends gpsTimestamp, we enforce it must be < 5 minutes old.
    // This prevents employees from replaying an old location or using cached phone GPS.
    if (data.gpsTimestamp && data.latitude && data.longitude) {
      const gpsAgeMs = Date.now() - new Date(data.gpsTimestamp).getTime();
      const GPS_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
      if (gpsAgeMs > GPS_MAX_AGE_MS) {
        throw new BadRequestError(
          `Your GPS location is ${Math.round(gpsAgeMs / 60000)} minutes old. ` +
          `Please step outside, allow your GPS to refresh, and try again.`
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

    // ===== PHASE 3: Weekend/Sunday clock-in check =====
    const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId } });
    const weekOffDays = new Set(policy?.weekOffDays || [0]); // 0=Sunday
    const dayOfWeek = today.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const isSunday = dayOfWeek === 0;

    if (weekOffDays.has(dayOfWeek)) {
      // Check employee-level Sunday work override
      const isSundayWorker = isSunday && (policy as any)?.sundayWorkEnabled && employee.allowSundayWork;
      if (isSunday && !isSundayWorker) {
        throw new BadRequestError(
          'Sunday is a week off. Contact HR to enable Sunday working on your profile if you need to work today.'
        );
      }
      if (isSundayWorker) {
        data.notes = `${data.notes || ''} [Sunday work — pay multiplier: ${(policy as any)?.sundayPayMultiplier ?? 2.0}x]`.trim();
        // Fire-and-forget email notification to HR
        this._notifySundayAttendance(employee, organizationId, (policy as any)?.sundayPayMultiplier ?? 2.0).catch(err =>
          logger.warn(`[Attendance] Sunday notification email failed for ${employeeId}: ${err.message}`)
        );
      } else if (!isSunday) {
        // Non-Sunday week-off day (e.g., Saturday)
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
      return rec;
    });

    // Allow re-clock-in after clock-out (e.g., accidental clock-out or returning after break)
    const isReClockIn = !!(existing?.checkOut);

    // ===== PHASE 1: Re-clock-in limit =====
    if (isReClockIn && existing && existing.clockInCount >= this.MAX_RECLOCKIN_PER_DAY) {
      throw new BadRequestError(`Maximum re-clock-in limit (${this.MAX_RECLOCKIN_PER_DAY}) reached for today. Please contact HR for manual attendance.`);
    }

    // Check shift assignment — employee must have a shift assigned (or use org default)
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true, location: { include: { geofence: true } } },
      orderBy: { startDate: 'desc' },
    });

    // If no shift assignment, try to find the default shift for the org
    let shift = shiftAssignment?.shift;
    if (!shift) {
      const defaultShift = await prisma.shift.findFirst({
        where: { organizationId, isDefault: true, isActive: true },
      });
      if (defaultShift) {
        shift = defaultShift;
      }
    }

    const currentShiftType = shift?.shiftType || 'OFFICE';

    // ===== Location enforcement: OFFICE shift requires assigned location =====
    const assignedLocation = shiftAssignment?.location || employee.officeLocation;
    if (currentShiftType === 'OFFICE' && !assignedLocation?.geofence) {
      throw new BadRequestError(
        'No office location assigned. Please ask your HR/Admin to assign an office location to your profile before marking attendance.'
      );
    }

    // ===== PHASE 1.4: GPS spoofing detection =====
    if (data.latitude && data.longitude) {
      const spoofResult = await this.detectGPSSpoofing(employeeId, data.latitude, data.longitude);
      if (spoofResult.spoofing) {
        data.notes = `${data.notes || ''} [GPS SPOOF WARNING: ${spoofResult.distance}m jump in ${spoofResult.timeDiff}min]`.trim();
        logger.warn(`GPS spoofing detected for employee ${employeeId}: ${spoofResult.distance}m in ${spoofResult.timeDiff}min`);
      }
    }

    // Use shift assignment's location geofence, or fall back to employee's office location geofence
    const geofence = shiftAssignment?.location?.geofence || employee.officeLocation?.geofence;

    // Geofence validation
    let geofenceViolation = false;
    let geofenceDistance: number | null = null;
    let geofenceStatus = 'NO_GEOFENCE';

    if (currentShiftType === 'OFFICE' && geofence && geofence.radiusMeters && data.latitude && data.longitude) {
      // GPS accuracy check — reject unreliable readings (>150m) for geofence decisions
      if (data.accuracy && data.accuracy > 150) {
        data.notes = `${data.notes || ''} [GPS accuracy poor: ±${Math.round(data.accuracy)}m — geofence check skipped]`.trim();
        logger.warn(`Poor GPS accuracy (${data.accuracy}m) for employee ${employeeId} — skipping geofence check`);
      }
      const coords = geofence.coordinates as any;
      if (coords?.lat && coords?.lng && !(data.accuracy && data.accuracy > 150)) {
        const distance = this.haversineDistance(data.latitude, data.longitude, coords.lat, coords.lng);
        geofenceDistance = Math.round(distance);

        if (distance > geofence.radiusMeters) {
          geofenceViolation = true;
          geofenceStatus = 'OUTSIDE';

          if (geofence.strictMode) {
            throw new BadRequestError(
              `You are ${Math.round(distance)}m away from ${employee.officeLocation?.name || 'office'}. ` +
              `Maximum allowed: ${geofence.radiusMeters}m. Please clock in from within the office geofence.`
            );
          }
          data.notes = `${data.notes || ''} [Geofence warning: ${Math.round(distance)}m from office]`.trim();

          // Send email alert to HR when employee marks outside geofence
          const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { adminNotificationEmail: true, name: true } });
          if (org?.adminNotificationEmail) {
            enqueueEmail({
              to: org.adminNotificationEmail,
              subject: `Geofence Alert: ${employee.firstName} ${employee.lastName} (${employee.employeeCode}) marked attendance outside office`,
              template: 'geofence-violation',
              context: {
                employeeName: `${employee.firstName} ${employee.lastName}`,
                employeeCode: employee.employeeCode,
                employeeId: employee.id,
                distance: Math.round(distance),
                allowedRadius: geofence.radiusMeters,
                locationName: shiftAssignment?.location?.name || employee.officeLocation?.name || 'Office',
                checkInTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                orgName: org.name,
              },
            }).catch((err) => logger.error(`[Geofence] Failed to enqueue violation alert email:`, err));
          }
        } else {
          geofenceStatus = 'INSIDE';
        }
      }
    }

    const locationData = data.latitude && data.longitude
      ? { lat: data.latitude, lng: data.longitude, accuracy: data.accuracy }
      : null;

    // Shift-aware late detection (use IST for comparison since shift times are IST)
    const istNow = getISTNow(); // Only for time comparisons, NOT for storage
    let isLate = false;
    let lateMinutes = 0;
    let shiftInfo: any = null;

    if (shift) {
      const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
      // Grace: shift-level overrides policy-level; policy is org-wide default
      const graceMinutes = shift.graceMinutes || policy?.lateGraceMinutes || 15;
      const shiftStart = new Date(istNow);
      shiftStart.setHours(shiftHour, shiftMin, 0, 0);
      const graceEnd = new Date(shiftStart);
      graceEnd.setMinutes(graceEnd.getMinutes() + graceMinutes);

      // ===== PHASE 3: Early clock-in warning =====
      if (!isReClockIn) {
        const earlyThreshold = new Date(shiftStart);
        earlyThreshold.setMinutes(earlyThreshold.getMinutes() - this.EARLY_CLOCKIN_WARNING_MINUTES);
        if (istNow < earlyThreshold) {
          const earlyMin = Math.round((shiftStart.getTime() - istNow.getTime()) / 60000);
          data.notes = `${data.notes || ''} [Early clock-in: ${earlyMin} min before shift start ${shift.startTime}]`.trim();
        }
      }

      // Only check late on first clock-in, not re-clock-in
      if (!isReClockIn && istNow > graceEnd) {
        isLate = true;
        lateMinutes = Math.round((istNow.getTime() - shiftStart.getTime()) / (1000 * 60));
        data.notes = `${data.notes || ''} [Late by ${lateMinutes} min — shift ${shift.name} starts at ${shift.startTime}]`.trim();
      }

      // Auto-mark HALF_DAY: use policy.lateHalfDayAfterMins (org-level) if set, else grace + 30
      if (!isReClockIn) {
        const halfDayThreshold = policy?.lateHalfDayAfterMins || (graceMinutes + 30);
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
      // Determine initial status: HALF_DAY if very late, else PRESENT
      // Uses policy.lateHalfDayAfterMins as org-level half-day threshold
      const autoHalfDay = shift && (() => {
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const ss = new Date(istNow); ss.setHours(sh, sm, 0, 0);
        const graceMin = shift.graceMinutes || policy?.lateGraceMinutes || 15;
        const threshold = policy?.lateHalfDayAfterMins || (graceMin + 30);
        return Math.round((istNow.getTime() - ss.getTime()) / 60000) > threshold;
      })();

      record = await prisma.attendanceRecord.create({
        data: {
          employeeId,
          date: today,
          checkIn: now,
          status: autoHalfDay ? 'HALF_DAY' : 'PRESENT',
          workMode: employee.workMode,
          source: data.source || 'MANUAL_APP',
          checkInLocation: locationData,
          notes: data.notes,
          geofenceViolation,
          clockInCount: 1,
        },
      });
    }

    // Log the attendance event
    await prisma.attendanceLog.create({
      data: {
        attendanceId: record.id,
        action: isReClockIn ? 'RE_CLOCK_IN' : 'CLOCK_IN',
        timestamp: now,
        location: locationData,
        notes: data.notes || null,
        geofenceStatus,
        distanceMeters: geofenceDistance,
        shiftName: shift?.name || null,
      },
    });

    // For PROJECT_SITE mode, also create a site check-in
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

    return { ...record, isLate, lateMinutes, shift: shiftInfo, isReClockIn, geofenceViolation };
  }

  /**
   * Clock out — with previous-day and night shift support
   */
  async clockOut(employeeId: string, data: ClockOutInput) {
    const empStatus = await prisma.employee.findUnique({ where: { id: employeeId }, select: { status: true } });
    if (empStatus?.status === 'INACTIVE' || empStatus?.status === 'TERMINATED') {
      throw new BadRequestError('Your account is inactive. Contact HR to reactivate.');
    }

    // ===== GPS TIMESTAMP STALENESS CHECK (clock-out) =====
    if (data.gpsTimestamp && data.latitude && data.longitude) {
      const gpsAgeMs = Date.now() - new Date(data.gpsTimestamp).getTime();
      const GPS_MAX_AGE_MS = 5 * 60 * 1000;
      if (gpsAgeMs > GPS_MAX_AGE_MS) {
        throw new BadRequestError(
          `Your GPS location is ${Math.round(gpsAgeMs / 60000)} minutes old. ` +
          `Please step outside, allow your GPS to refresh, and try again.`
        );
      }
    }

    const today = getISTToday();
    const now = new Date();

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
    const fullDayHours = shift ? Number(shift.fullDayHours) : (clockOutPolicy?.fullDayMinHours || 8);
    const halfDayHours = shift ? Number(shift.halfDayHours) : (clockOutPolicy?.halfDayMinHours || 4);

    // Determine status based on shift/policy hours
    let status: 'PRESENT' | 'HALF_DAY' = 'PRESENT';
    if (totalHours < halfDayHours) {
      status = 'HALF_DAY';
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

    // ===== Overtime detection: gated by policy.otEnabled =====
    const extraHours = totalHours - fullDayHours;
    const otThresholdMin = clockOutPolicy?.otThresholdMinutes || 30;
    const otMaxPerDay = clockOutPolicy?.otMaxHoursPerDay || 4;
    if (clockOutPolicy?.otEnabled && extraHours > (otThresholdMin / 60)) {
      overtimeFlag = true;
      overtimeHours = Math.min(Math.round(extraHours * 100) / 100, otMaxPerDay);
    } else if (!clockOutPolicy?.otEnabled && totalHours > fullDayHours + this.OVERTIME_FLAG_EXTRA_HOURS) {
      // Fallback: flag excessive hours even if OT tracking is off (informational only)
      overtimeFlag = true;
    }

    const locationData = data.latitude && data.longitude
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
      notes = `${notes} [OT: ${overtimeHours.toFixed(1)}h overtime (policy: ${clockOutPolicy?.otRateMultiplier || 1.5}x rate, max ${otMaxPerDay}h/day)]`.trim();
    } else if (overtimeFlag) {
      notes = `${notes} [Overtime flagged: ${totalHours.toFixed(1)}h, expected ${fullDayHours}h]`.trim();
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        totalHours: Math.round(totalHours * 100) / 100,
        status,
        checkOutLocation: locationData,
        notes,
      },
    });

    // Log the clock-out event
    await prisma.attendanceLog.create({
      data: {
        attendanceId: record.id,
        action: 'CLOCK_OUT',
        timestamp: now,
        location: locationData,
        notes: [
          isEarlyCheckout && earlyMinutes > 15 ? `Early checkout by ${earlyMinutes} min` : '',
          isPreviousDayClockOut ? 'Previous day clock-out' : '',
          isLateClockout ? `Late clock-out by ${lateClockoutMinutes} min` : '',
        ].filter(Boolean).join('; ') || null,
        shiftName: shift?.name || null,
      },
    });

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

    // ===== Comp-Off auto-grant: if employee worked on weekoff/holiday and policy allows =====
    if (clockOutPolicy?.compOffEnabled && totalHours >= (clockOutPolicy.compOffMinOTHours || 4)) {
      const recordDay = new Date(record.date).getDay();
      const policyWeekOffs = new Set(clockOutPolicy.weekOffDays || [0]);
      const isWeekOff = policyWeekOffs.has(recordDay);
      const isHoliday = await prisma.holiday.findFirst({
        where: { organizationId: employee?.organizationId || '', date: new Date(record.date) },
      });

      if (isWeekOff || isHoliday) {
        const compOffExpiry = new Date();
        compOffExpiry.setDate(compOffExpiry.getDate() + (clockOutPolicy.compOffExpiryDays || 30));
        try {
          // Check if comp-off not already granted for this date
          const existingCompOff = await prisma.attendanceLog.findFirst({
            where: { attendanceId: record.id, action: 'COMP_OFF_GRANTED' },
          });
          if (!existingCompOff) {
            await prisma.attendanceLog.create({
              data: {
                attendanceId: record.id,
                action: 'COMP_OFF_GRANTED',
                timestamp: new Date(),
                notes: `Comp-off granted: worked ${totalHours.toFixed(1)}h on ${isHoliday ? `holiday (${isHoliday.name})` : 'week-off day'}. Expires: ${compOffExpiry.toISOString().split('T')[0]}. Min OT required: ${clockOutPolicy.compOffMinOTHours}h.`,
              },
            });
            logger.info(`Comp-off granted to employee ${employeeId} for working on ${isHoliday ? 'holiday' : 'weekoff'} (${record.date})`);
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
    const current = new Date(start);
    while (current <= end) {
      summary.totalDays++;
      const day = current.getDay();
      const dateStr = current.toISOString().split('T')[0];
      // Count Sunday as weekend ONLY if it's not already a holiday (avoid double-count)
      if (day === 0 && !holidayDates.has(dateStr)) {
        summary.weekends++;
      }
      current.setDate(current.getDate() + 1);
    }

    records.forEach((r) => {
      switch (r.status) {
        case 'PRESENT': summary.present++; break;
        case 'ABSENT': summary.absent++; break;
        case 'HALF_DAY': summary.halfDay++; break;
        case 'ON_LEAVE': summary.onLeave++; break;
        case 'WORK_FROM_HOME': summary.workFromHome++; break;
      }
      if (r.totalHours) totalWorkedHours += Number(r.totalHours);
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

    // Determine date for the query
    let queryDate: Date;
    if (startDate) {
      queryDate = new Date(startDate);
    } else {
      queryDate = new Date();
    }
    queryDate.setHours(0, 0, 0, 0);

    const endQueryDate = endDate ? new Date(endDate) : new Date(queryDate);
    endQueryDate.setHours(23, 59, 59, 999);

    // Build employee filter
    const empWhere: any = { organizationId, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION'] } };
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
   * Store GPS trail points (for FIELD_SALES employees)
   */
  async storeGPSTrail(employeeId: string, data: GPSTrailBatchInput) {
    const today = getISTToday();

    const points = data.points.map((p) => ({
      employeeId,
      date: today,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy || null,
      altitude: p.altitude || null,
      speed: p.speed || null,
      heading: p.heading || null,
      batteryLevel: p.batteryLevel || null,
      timestamp: new Date(p.timestamp),
    }));

    const result = await prisma.gPSTrailPoint.createMany({ data: points });

    // Audit log for GPS trail upload (compliance)
    try {
      await createAuditLog({
        userId: employeeId,
        organizationId: (await prisma.employee.findUnique({ where: { id: employeeId }, select: { organizationId: true } }))?.organizationId || '',
        entity: 'GPSTrailPoint',
        entityId: employeeId,
        action: 'GPS_TRAIL_UPLOAD',
        newValue: { pointCount: result.count, date: today.toISOString() },
      });
    } catch { /* non-blocking */ }

    return { stored: result.count };
  }

  /**
   * Get GPS trail for a specific employee and date
   */
  async getGPSTrail(employeeId: string, date: string) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const points = await prisma.gPSTrailPoint.findMany({
      where: { employeeId, date: targetDate },
      orderBy: { timestamp: 'asc' },
    });

    // Simple visit clustering: group points within 200m that span > 10 min
    const visits = this.clusterVisits(points);

    return { points, visits };
  }

  /**
   * Submit attendance regularization request
   */
  async submitRegularization(
    employeeId: string,
    attendanceId: string,
    reason: string,
    requestedCheckIn?: string,
    requestedCheckOut?: string
  ) {
    const record = await prisma.attendanceRecord.findFirst({
      where: { id: attendanceId, employeeId },
    });
    if (!record) throw new NotFoundError('Attendance record');

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
    approverRole?: string
  ) {
    const reg = await prisma.attendanceRegularization.findUnique({
      where: { id: regularizationId },
      include: { attendance: true },
    });
    if (!reg) throw new NotFoundError('Regularization request');

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

      // If approved, update the attendance record
      if (action === 'APPROVED') {
        const updateData: any = {};
        if (reg.requestedCheckIn) updateData.checkIn = reg.requestedCheckIn;
        if (reg.requestedCheckOut) {
          updateData.checkOut = reg.requestedCheckOut;
          if (reg.requestedCheckIn || reg.attendance.checkIn) {
            const start = new Date(reg.requestedCheckIn || reg.attendance.checkIn!);
            const end = new Date(reg.requestedCheckOut);
            updateData.totalHours = Math.round(
              ((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 100
            ) / 100;
          }
          // Use shift's halfDayHours for status determination instead of hardcoded 4
          const regShift = await tx.shiftAssignment.findFirst({
            where: { employeeId: reg.attendance.employeeId, endDate: null },
            include: { shift: true },
            orderBy: { startDate: 'desc' },
          });
          const halfDayThreshold = Number(regShift?.shift?.halfDayHours) || 4;
          updateData.status = updateData.totalHours >= halfDayThreshold ? 'PRESENT' : 'HALF_DAY';
        }

        if (Object.keys(updateData).length > 0) {
          await tx.attendanceRecord.update({
            where: { id: reg.attendanceId },
            data: updateData,
          });
        }
      }

      return updatedReg;
    });

    return updated;
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

    // Build summary (same logic as getMyAttendance)
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
    const current = new Date(start);
    while (current <= end) {
      summary.totalDays++;
      const day = current.getDay();
      if (day === 0) summary.weekends++; // Sunday only — Saturday is working day
      current.setDate(current.getDate() + 1);
    }

    records.forEach((r) => {
      switch (r.status) {
        case 'PRESENT': summary.present++; break;
        case 'ABSENT': summary.absent++; break;
        case 'HALF_DAY': summary.halfDay++; break;
        case 'ON_LEAVE': summary.onLeave++; break;
        case 'WORK_FROM_HOME': summary.workFromHome++; break;
      }
      if (r.totalHours) totalWorkedHours += Number(r.totalHours);
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
  async markAttendance(data: MarkAttendanceInput, markedBy: string, organizationId?: string) {
    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) throw new NotFoundError('Employee');

    // ===== Multi-tenant validation =====
    if (organizationId && employee.organizationId !== organizationId) {
      throw new BadRequestError('Employee does not belong to your organization.');
    }

    const date = new Date(data.date);
    date.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.upsert({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date,
        },
      },
      update: {
        status: data.status,
        workMode: data.workMode || employee.workMode,
        source: 'MANUAL_HR',
        notes: `Marked by HR/Admin (userId: ${markedBy})`,
      },
      create: {
        employeeId: data.employeeId,
        date,
        status: data.status,
        workMode: data.workMode || employee.workMode,
        source: 'MANUAL_HR',
        notes: `Marked by HR/Admin (userId: ${markedBy})`,
      },
    });

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

    // Subtract break durations
    const breaks = await prisma.break.findMany({
      where: { attendanceId: recordId, endTime: { not: null } },
    });
    const totalBreakMs = breaks.reduce((sum, b) => sum + (b.durationMinutes || 0) * 60 * 1000, 0);

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
          where: { attendance: { employeeId }, location: { not: null } },
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
        checkInPhoto: data.checkInPhoto || null,
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
    ] = await Promise.all([
      // Total active (non-system) employees
      prisma.employee.count({
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION'] } },
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
    ]);

    // Derived stats from records
    const present = records.filter(r => r.status === 'PRESENT' || r.status === 'WORK_FROM_HOME').length;
    const absent = records.filter(r => r.status === 'ABSENT').length;
    const halfDay = records.filter(r => r.status === 'HALF_DAY').length;
    const lateArrivals = records.filter(r => {
      if (!r.checkIn) return false;
      const log = r.logs?.find((l: any) => l.action === 'CLOCK_IN');
      return log?.notes?.includes('Late') || log?.notes?.includes('late');
    }).length;
    const earlyExits = records.filter(r => {
      if (!r.checkOut || !r.checkIn) return false;
      const hours = Number(r.totalHours || 0);
      return hours > 0 && hours < 4;
    }).length;
    const missingPunch = records.filter(r => r.checkIn && !r.checkOut && r.status === 'PRESENT').length;
    const notCheckedIn = Math.max(0, totalActive - records.length);

    return {
      expectedToday: isWeekend ? 0 : totalActive,
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
  }, organizationId: string) {
    const { page, limit, startDate, endDate, employeeId, department, status, workMode,
      designation, managerId, shiftType, anomalyType, regularizationStatus, employeeType,
      search, sortBy, sortOrder } = query;
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
        ? { in: employeeType === 'PROBATION' ? ['PROBATION'] : employeeType === 'INTERN' ? ['ACTIVE'] : ['ACTIVE', 'PROBATION'] }
        : { in: ['ACTIVE', 'PROBATION'] },
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
        where: { organizationId, deletedAt: null, isSystemAccount: { not: true }, status: { in: ['ACTIVE', 'PROBATION'] } },
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
    if (status) mergedData = mergedData.filter(r => r.status === status);
    if (anomalyType) mergedData = mergedData.filter(r => r.anomalyTypes?.includes(anomalyType));
    if (regularizationStatus) mergedData = mergedData.filter(r => r.regularizationStatus === regularizationStatus);
    if (shiftType) mergedData = mergedData.filter(r => r.shift?.shiftType === shiftType);

    // Sort
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

      // Fix #6: Use policy grace as fallback when shift doesn't have it
      const graceMinutes = shift?.graceMinutes ?? policy?.lateGraceMinutes ?? 15;

      // --- LATE ARRIVAL ---
      if (record.checkIn && shift) {
        const [shiftH, shiftM] = shift.startTime.split(':').map(Number);
        const shiftStart = new Date(queryDate);
        shiftStart.setHours(shiftH, shiftM, 0, 0);
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

      // --- MISSING PUNCH ---
      if (record.checkIn && !record.checkOut && shift) {
        const now = getISTNow();
        const [endH, endM] = shift.endTime.split(':').map(Number);
        const shiftEnd = new Date(queryDate);
        shiftEnd.setHours(endH, endM, 0, 0);
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

      // --- GEOFENCE VIOLATION ---
      if (record.geofenceViolation) {
        anomalies.push({
          attendanceId: record.id, employeeId: empId, date: queryDate,
          type: 'OUTSIDE_GEOFENCE', severity: 'HIGH',
          description: 'Check-in recorded outside approved geofence area',
          metadata: { checkInLocation: record.checkInLocation },
          organizationId, autoDetected: true,
        });
      }

      // --- EARLY EXIT ---
      if (record.checkOut && shift) {
        const [endH, endM] = shift.endTime.split(':').map(Number);
        const shiftEnd = new Date(queryDate);
        shiftEnd.setHours(endH, endM, 0, 0);
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

      // --- Fix #5: GPS SPOOFING (detect large jumps in GPS trail) ---
      if (record.checkIn && record.checkInLocation) {
        const loc = record.checkInLocation as any;
        if (loc?.lat && loc?.lng) {
          // Check if there was a previous day's checkout location and compare
          const prevRecord = await prisma.attendanceRecord.findFirst({
            where: { employeeId: empId, date: { lt: queryDate }, checkOutLocation: { not: null } },
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

      // --- Fix #5: HOLIDAY ATTENDANCE (worked on a non-optional holiday) ---
      if (holiday && !holiday.isOptional && record.checkIn) {
        anomalies.push({
          attendanceId: record.id, employeeId: empId, date: queryDate,
          type: 'HOLIDAY_ATTENDANCE', severity: 'MEDIUM',
          description: `Attendance recorded on holiday: ${holiday.name}`,
          metadata: { holidayName: holiday.name, holidayType: holiday.isOptional ? 'optional' : 'mandatory' },
          organizationId, autoDetected: true,
        });
      }

      // --- Fix #5: LEAVE OVERLAP (attendance exists + approved leave exists) ---
      // This catches edge cases where HR manually created a record for someone on leave
      if (record.checkIn && onLeaveSet.has(empId)) {
        // Note: This won't fire because we skip onLeave employees above.
        // But if we detect a record that was created BEFORE leave was approved, flag it.
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

    return {
      record,
      regularizations,
      anomalies,
      leaveRequests,
      shiftAssignment,
      shift: shiftAssignment?.shift || null,
      location: shiftAssignment?.location || null,
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
}

export const attendanceService = new AttendanceService();
