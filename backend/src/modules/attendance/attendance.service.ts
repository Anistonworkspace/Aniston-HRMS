import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';
import { emitToOrg } from '../../sockets/index.js';
import type { ClockInInput, ClockOutInput, GPSTrailBatchInput, AttendanceQuery, MarkAttendanceInput } from './attendance.validation.js';

export class AttendanceService {
  /**
   * Clock in — handles all 3 work modes
   */
  async clockIn(employeeId: string, data: ClockInInput, organizationId: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: { officeLocation: { include: { geofence: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if already clocked in today
    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });

    if (existing?.checkIn && !existing.checkOut) {
      throw new BadRequestError('Already clocked in. Please clock out first.');
    }

    if (existing?.checkOut) {
      throw new BadRequestError('Already completed attendance for today.');
    }

    // Geofence validation — only for OFFICE shift type
    // Check employee's current shift assignment type
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true, location: { include: { geofence: true } } },
      orderBy: { startDate: 'desc' },
    });
    const currentShiftType = shiftAssignment?.shift?.shiftType || 'OFFICE';

    // Use shift assignment's location geofence, or fall back to employee's office location geofence
    const geofence = shiftAssignment?.location?.geofence || employee.officeLocation?.geofence;

    // Only enforce geofence for OFFICE shifts (FIELD and HYBRID can clock in from anywhere)
    if (currentShiftType === 'OFFICE' && geofence && geofence.radiusMeters && data.latitude && data.longitude) {
      const coords = geofence.coordinates as any;
      if (coords?.lat && coords?.lng) {
        const distance = this.haversineDistance(data.latitude, data.longitude, coords.lat, coords.lng);
        if (distance > geofence.radiusMeters) {
          if (geofence.strictMode) {
            throw new BadRequestError(
              `You are ${Math.round(distance)}m away from ${employee.officeLocation?.name || 'office'}. ` +
              `Maximum allowed: ${geofence.radiusMeters}m. Please clock in from within the office geofence.`
            );
          }
          data.notes = `${data.notes || ''} [Geofence warning: ${Math.round(distance)}m from office]`.trim();
        }
      }
    }

    const now = new Date();
    const locationData = data.latitude && data.longitude
      ? { lat: data.latitude, lng: data.longitude, accuracy: data.accuracy }
      : null;

    // Shift-aware late detection
    const shift = shiftAssignment?.shift;
    let isLate = false;
    let lateMinutes = 0;
    let shiftInfo: any = null;

    if (shift) {
      const [shiftHour, shiftMin] = shift.startTime.split(':').map(Number);
      const graceMinutes = shift.graceMinutes || 15;
      const shiftStart = new Date(now);
      shiftStart.setHours(shiftHour, shiftMin, 0, 0);
      const graceEnd = new Date(shiftStart);
      graceEnd.setMinutes(graceEnd.getMinutes() + graceMinutes);

      if (now > graceEnd) {
        isLate = true;
        lateMinutes = Math.round((now.getTime() - shiftStart.getTime()) / (1000 * 60));
        data.notes = `${data.notes || ''} [Late by ${lateMinutes} min — shift ${shift.name} starts at ${shift.startTime}]`.trim();
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

    const record = await prisma.attendanceRecord.create({
      data: {
        employeeId,
        date: today,
        checkIn: now,
        status: 'PRESENT',
        workMode: employee.workMode,
        source: data.source || 'MANUAL_APP',
        checkInLocation: locationData,
        notes: data.notes,
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

    // Emit real-time event
    emitToOrg(organizationId, 'attendance:checkin', {
      employeeId, employeeName: `${employee.firstName} ${employee.lastName}`,
      checkIn: now.toISOString(), status: 'PRESENT', isLate, lateMinutes,
    });

    return { ...record, isLate, lateMinutes, shift: shiftInfo };
  }

  /**
   * Clock out
   */
  async clockOut(employeeId: string, data: ClockOutInput) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });

    if (!record) {
      throw new BadRequestError('No clock-in found for today. Please clock in first.');
    }

    if (record.checkOut) {
      throw new BadRequestError('Already clocked out for today.');
    }

    const now = new Date();
    const checkIn = new Date(record.checkIn!);
    const totalHours = (now.getTime() - checkIn.getTime()) / (1000 * 60 * 60);

    // Get employee's shift for shift-aware status calculation
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true },
      orderBy: { startDate: 'desc' },
    });

    const shift = shiftAssignment?.shift;
    const fullDayHours = shift ? Number(shift.fullDayHours) : 8;
    const halfDayHours = shift ? Number(shift.halfDayHours) : 4;

    // Determine status based on shift hours
    let status: 'PRESENT' | 'HALF_DAY' = 'PRESENT';
    if (totalHours < halfDayHours) {
      status = 'HALF_DAY';
    }

    // Early checkout detection
    let isEarlyCheckout = false;
    let earlyMinutes = 0;
    if (shift) {
      const [endHour, endMin] = shift.endTime.split(':').map(Number);
      const shiftEnd = new Date(now);
      shiftEnd.setHours(endHour, endMin, 0, 0);
      // Handle overnight shifts (e.g., night shift 22:00–06:00)
      if (endHour < parseInt(shift.startTime.split(':')[0])) {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
      }
      if (now < shiftEnd) {
        isEarlyCheckout = true;
        earlyMinutes = Math.round((shiftEnd.getTime() - now.getTime()) / (1000 * 60));
      }
    }

    const locationData = data.latitude && data.longitude
      ? { lat: data.latitude, lng: data.longitude, accuracy: data.accuracy }
      : null;

    let notes = record.notes || '';
    if (isEarlyCheckout && earlyMinutes > 15) {
      notes = `${notes} [Early checkout by ${earlyMinutes} min]`.trim();
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        totalHours: Math.round(totalHours * 100) / 100,
        status,
        checkOutLocation: locationData,
        notes: notes || record.notes,
      },
    });

    // Emit real-time event
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true, organizationId: true } });
    if (emp) {
      emitToOrg(emp.organizationId, 'attendance:checkout', {
        employeeId, employeeName: `${emp.firstName} ${emp.lastName}`,
        checkOut: now.toISOString(), totalHours: Math.round(totalHours * 100) / 100,
        status, isEarlyCheckout, earlyMinutes,
      });
    }

    return { ...updated, isEarlyCheckout, earlyMinutes };
  }

  /**
   * Get today's attendance status for an employee
   */
  async getTodayStatus(employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      include: { breaks: true },
    });

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { workMode: true, firstName: true, lastName: true },
    });

    // Get current shift
    const shiftAssignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      include: { shift: true },
      orderBy: { startDate: 'desc' },
    });

    // Calculate active break
    let activeBreak = null;
    if (record?.breaks) {
      activeBreak = record.breaks.find((b) => !b.endTime) || null;
    }

    const shift = shiftAssignment?.shift;

    return {
      record,
      isCheckedIn: !!record?.checkIn && !record?.checkOut,
      isCheckedOut: !!record?.checkOut,
      isOnBreak: !!activeBreak,
      activeBreak,
      workMode: employee?.workMode,
      totalHours: record?.totalHours || null,
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
      include: { breaks: true },
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
    const current = new Date(start);
    while (current <= end) {
      summary.totalDays++;
      const day = current.getDay();
      if (day === 0 || day === 6) {
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

    // Count NOT_CHECKED_IN
    const notCheckedIn = totalEmployees - presentCount - absentCount - onLeaveCount;

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    const breakRecord = await prisma.break.create({
      data: {
        attendanceId: record.id,
        startTime: new Date(),
        type: breakType as any,
      },
    });

    return breakRecord;
  }

  /**
   * End a break
   */
  async endBreak(employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    return updated;
  }

  /**
   * Store GPS trail points (for FIELD_SALES employees)
   */
  async storeGPSTrail(employeeId: string, data: GPSTrailBatchInput) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    const existing = await prisma.attendanceRegularization.findUnique({
      where: { attendanceId },
    });
    if (existing) throw new BadRequestError('Regularization already submitted for this date.');

    const reg = await prisma.attendanceRegularization.create({
      data: {
        attendanceId,
        reason,
        requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
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

      // Calculate grace end time
      const checkInDate = new Date(requestedCheckIn);
      const graceEnd = new Date(checkInDate);
      graceEnd.setHours(shiftHour, shiftMin + graceMinutes, 0, 0);

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
    action: 'APPROVED' | 'REJECTED',
    approvedBy: string,
    remarks?: string
  ) {
    const reg = await prisma.attendanceRegularization.findUnique({
      where: { id: regularizationId },
      include: { attendance: true },
    });
    if (!reg) throw new NotFoundError('Regularization request');

    const updated = await prisma.$transaction(async (tx) => {
      const updatedReg = await tx.attendanceRegularization.update({
        where: { id: regularizationId },
        data: {
          status: action,
          approvedBy,
          approverRemarks: remarks || null,
        },
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
          updateData.status = updateData.totalHours >= 4 ? 'PRESENT' : 'HALF_DAY';
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
      include: { breaks: true },
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
      if (day === 0 || day === 6) summary.weekends++;
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
  async markAttendance(data: MarkAttendanceInput, markedBy: string) {
    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) throw new NotFoundError('Employee');

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

    return record;
  }

  /**
   * Simple visit clustering for GPS trail points
   */
  private clusterVisits(points: any[]) {
    if (points.length === 0) return [];

    const visits: any[] = [];
    let clusterStart = 0;
    const RADIUS_THRESHOLD = 0.002; // ~200m in degrees
    const MIN_DURATION_MS = 10 * 60 * 1000; // 10 minutes

    for (let i = 1; i < points.length; i++) {
      const distance = Math.sqrt(
        Math.pow(Number(points[i].lat) - Number(points[clusterStart].lat), 2) +
        Math.pow(Number(points[i].lng) - Number(points[clusterStart].lng), 2)
      );

      if (distance > RADIUS_THRESHOLD) {
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
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const attendanceService = new AttendanceService();
