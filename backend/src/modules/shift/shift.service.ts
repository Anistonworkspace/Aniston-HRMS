import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../middleware/errorHandler.js';
import type { CreateShiftInput, AssignShiftInput, CreateLocationInput } from './shift.validation.js';
import { emitToUser } from '../../sockets/index.js';

export class ShiftService {
  // ===================== SHIFTS =====================

  /**
   * Cleanup: ensure only one active shift per type (OFFICE, FIELD).
   * HYBRID shifts are treated as OFFICE duplicates and deactivated.
   * Deactivates duplicates, keeping the default or most-assigned one.
   */
  private async ensureOnePerType(organizationId: string) {
    // Only migrate deprecated HYBRID shifts to OFFICE — no longer enforce one-per-type for OFFICE/FIELD
    const hybridShifts = await prisma.shift.findMany({
      where: { organizationId, shiftType: 'HYBRID', isActive: true },
    });
    if (hybridShifts.length > 0) {
      const officeShift = await prisma.shift.findFirst({
        where: { organizationId, shiftType: 'OFFICE', isActive: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      for (const hybrid of hybridShifts) {
        if (officeShift) {
          await prisma.shiftAssignment.updateMany({
            where: { shiftId: hybrid.id, OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
            data: { shiftId: officeShift.id },
          });
        }
        await prisma.shift.update({
          where: { id: hybrid.id },
          data: { isActive: false, code: `${hybrid.code}_HYB_${Date.now()}` },
        });
      }
    }
  }

  async getShifts(organizationId: string) {
    // Always ensure the two default shifts (General + Live Tracking) exist
    await this.ensureDefaultShifts(organizationId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return prisma.shift.findMany({
      where: { organizationId, isActive: true },
      include: {
        _count: {
          select: {
            assignments: {
              where: {
                OR: [{ endDate: null }, { endDate: { gte: today } }],
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Ensure both a General (OFFICE) and Live Tracking (FIELD) shift exist.
   * Auto-creates missing ones with sensible defaults.
   */
  private async ensureDefaultShifts(organizationId: string) {
    const existing = await prisma.shift.findMany({
      where: { organizationId, isActive: true },
      select: { shiftType: true },
    });
    const types = existing.map(s => s.shiftType);

    if (!types.includes('OFFICE')) {
      // Check for a soft-deleted OFFICE shift to reactivate
      const deletedOffice = await prisma.shift.findFirst({
        where: { organizationId, shiftType: 'OFFICE', isActive: false },
      });
      if (deletedOffice) {
        await prisma.shift.update({
          where: { id: deletedOffice.id },
          data: {
            isActive: true,
            code: 'GENERAL-SHIFT',
            name: 'General Shift',
            startTime: '09:00',
            endTime: '18:00',
            graceMinutes: 15,
            isDefault: true,
          },
        });
      } else {
        await prisma.shift.create({
          data: {
            organizationId,
            name: 'General Shift',
            code: 'GENERAL-SHIFT',
            shiftType: 'OFFICE',
            startTime: '09:00',
            endTime: '18:00',
            graceMinutes: 15,
            fullDayHours: 8,
            halfDayHours: 4,
            isDefault: true,
            isActive: true,
          },
        });
      }
    }

    if (!types.includes('FIELD')) {
      // Check for a soft-deleted FIELD shift to reactivate
      const deleted = await prisma.shift.findFirst({
        where: { organizationId, shiftType: 'FIELD', isActive: false },
      });
      if (deleted) {
        await prisma.shift.update({
          where: { id: deleted.id },
          data: {
            isActive: true,
            code: 'LIVE-TRACK',
            name: 'Live Tracking',
            startTime: '09:00',
            endTime: '18:30',
            trackingIntervalMinutes: 60,
          },
        });
      } else {
        await prisma.shift.create({
          data: {
            organizationId,
            name: 'Live Tracking',
            code: 'LIVE-TRACK',
            shiftType: 'FIELD',
            startTime: '09:00',
            endTime: '18:30',
            graceMinutes: 30,
            fullDayHours: 8,
            halfDayHours: 4,
            isDefault: false,
            isActive: true,
            trackingIntervalMinutes: 60,
          },
        });
      }
    }
  }

  async createShift(data: CreateShiftInput, organizationId: string, assignedBy?: string) {
    // Check if an active shift with same code exists
    const existing = await prisma.shift.findFirst({
      where: { code: data.code, organizationId },
    });

    if (existing && existing.isActive) {
      throw new ConflictError(`Shift code "${data.code}" already exists`);
    }

    let shift;

    // If a soft-deleted shift with same code exists, reactivate it with new data
    if (existing && !existing.isActive) {
      if (data.isDefault) {
        await prisma.shift.updateMany({
          where: { organizationId, isDefault: true, id: { not: existing.id } },
          data: { isDefault: false },
        });
      }
      shift = await prisma.shift.update({
        where: { id: existing.id },
        data: { ...data, organizationId, isActive: true },
      });
    } else {
      // If this is default, unset other defaults
      if (data.isDefault) {
        await prisma.shift.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      shift = await prisma.shift.create({
        data: { ...data, organizationId },
      });
    }

    // Auto-assign General (OFFICE) shift to all employees without a shift
    if (data.shiftType === 'OFFICE' && data.isDefault && assignedBy) {
      await this.autoAssignDefaultShift(organizationId, assignedBy);
    }

    return shift;
  }

  async updateShift(id: string, data: any, organizationId: string) {
    const shift = await prisma.shift.findFirst({ where: { id, organizationId } });
    if (!shift) throw new NotFoundError('Shift');

    if (data.isDefault) {
      await prisma.shift.updateMany({
        where: { organizationId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return prisma.shift.update({ where: { id }, data });
  }

  async deleteShift(id: string, organizationId: string) {
    const shift = await prisma.shift.findFirst({ where: { id, organizationId } });
    if (!shift) throw new NotFoundError('Shift');

    // Check if shift has active assignments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeAssignments = await prisma.shiftAssignment.count({
      where: { shiftId: id, OR: [{ endDate: null }, { endDate: { gt: today } }] },
    });

    if (activeAssignments > 0) {
      // Find default shift to reassign employees
      const defaultShift = await prisma.shift.findFirst({
        where: { organizationId, shiftType: 'OFFICE', isDefault: true, isActive: true, id: { not: id } },
      });
      // Soft delete — rename code to free up the unique constraint
      await prisma.shift.update({
        where: { id },
        data: { isActive: false, code: `${shift.code}_DEL_${Date.now()}` },
      });
      // Reassign all affected employees to default shift
      if (defaultShift) {
        await prisma.shiftAssignment.updateMany({
          where: { shiftId: id, OR: [{ endDate: null }, { endDate: { gt: today } }] },
          data: { shiftId: defaultShift.id },
        });
      }
      return { message: 'Shift deactivated and employees reassigned to default shift' };
    }

    // Hard delete if no active assignments
    await prisma.shiftAssignment.deleteMany({ where: { shiftId: id } });
    await prisma.shift.delete({ where: { id } });
    return { message: 'Shift deleted' };
  }

  async assignShift(data: AssignShiftInput, organizationId: string, assignedBy: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId },
      select: { id: true, status: true, userId: true },
    });
    if (!employee) throw new NotFoundError('Employee');

    // Block assignment for employees who are no longer active
    const BLOCKED_STATUSES = ['TERMINATED', 'INACTIVE'];
    if (BLOCKED_STATUSES.includes(employee.status)) {
      throw new BadRequestError(`Cannot assign a shift to a ${employee.status.toLowerCase()} employee.`);
    }

    const shift = await prisma.shift.findFirst({ where: { id: data.shiftId, organizationId, isActive: true } });
    if (!shift) throw new NotFoundError('Shift');

    const newStart = new Date(data.startDate);
    newStart.setHours(0, 0, 0, 0);

    // Validate endDate if provided.
    // endDate semantics: inclusive — the assignment is active until end-of-day on endDate.
    // We store it as a DATE column and query with { gt: today } to mean "still active today".
    let newEnd: Date | null = null;
    if (data.endDate) {
      newEnd = new Date(data.endDate);
      newEnd.setHours(0, 0, 0, 0);
      if (newEnd <= newStart) {
        throw new BadRequestError('endDate must be after startDate.');
      }
    }

    const workModeMap: Record<string, string> = {
      OFFICE: 'OFFICE',
      FIELD: 'FIELD_SALES',
      HYBRID: 'HYBRID',
    };
    const newWorkMode = workModeMap[shift.shiftType] || 'OFFICE';

    // All reads + writes inside a transaction to prevent overlap races.
    const assignment = await prisma.$transaction(async (tx) => {

      // ── 1. Same-startDate check (excluding soft-deleted rows) ────────────────
      // If a non-deleted assignment with exactly this start date already exists,
      // update it in-place rather than creating a duplicate (idempotent re-submit).
      const sameStart = await tx.shiftAssignment.findFirst({
        where: {
          employeeId: data.employeeId,
          startDate: newStart,
          deletedAt: null,
        },
      });

      // ── 2. Full date-range overlap check (excluding soft-deleted rows) ────────
      // An existing assignment [existStart, existEnd] overlaps [newStart, newEnd] when:
      //   existStart < effectiveNewEnd  AND  (existEnd is null OR existEnd > newStart)
      // where effectiveNewEnd is newEnd if set, or far-future if open-ended.
      // We exclude the sameStart row (handled by update above) to avoid false rejection.
      // We also exclude open-ended rows because updateMany will close them in step 3.
      const overlapWhere: any = {
        employeeId: data.employeeId,
        deletedAt: null,
        endDate: { not: null },       // open-ended rows will be closed — skip them here
        startDate: { lt: newEnd ?? new Date('9999-12-31') }, // existStart < effectiveNewEnd
        NOT: sameStart ? [{ id: sameStart.id }] : [],
      };
      // existEnd > newStart  (ensures the existing assignment is still active when new one starts)
      overlapWhere.endDate = { not: null, gt: newStart };
      // Also require existStart < effectiveNewEnd (already set above via startDate filter)

      const overlapping = await tx.shiftAssignment.findFirst({ where: overlapWhere });
      if (overlapping) {
        const existStart = overlapping.startDate.toISOString().split('T')[0];
        const existEnd   = overlapping.endDate!.toISOString().split('T')[0];
        const reqStart   = newStart.toISOString().split('T')[0];
        const reqEnd     = newEnd ? newEnd.toISOString().split('T')[0] : 'open-ended';
        throw new BadRequestError(
          `Shift assignment conflict: requested period ${reqStart}–${reqEnd} overlaps ` +
          `existing assignment ${existStart}–${existEnd}. ` +
          `Please end the existing assignment first or choose a non-overlapping date range.`
        );
      }

      // ── 3. Same-startDate → update existing row ──────────────────────────────
      if (sameStart) {
        // Close any OTHER open-ended assignments that are older than this same-day row.
        // This handles the case where the employee had a long-running assignment (startDate
        // in the past, endDate = null) that was never closed when today's row was first created.
        await tx.shiftAssignment.updateMany({
          where: {
            employeeId: data.employeeId,
            deletedAt: null,
            endDate: null,
            NOT: { id: sameStart.id }, // don't close the row we're about to update
          },
          data: { endDate: newStart },
        });

        const updated = await tx.shiftAssignment.update({
          where: { id: sameStart.id },
          data: {
            shiftId: data.shiftId,
            locationId: data.locationId || null,
            endDate: newEnd,
            assignedBy,
            deletedAt: null,
          },
          include: {
            shift: true,
            location: { include: { geofence: true } },
            employee: { select: { firstName: true, lastName: true, employeeCode: true, workMode: true } },
          },
        });

        // Always write both workMode AND officeLocationId so switching OFFICE→FIELD
        // clears the old location, and FIELD→OFFICE sets the new one.
        await tx.employee.update({
          where: { id: data.employeeId },
          data: {
            workMode: newWorkMode as any,
            officeLocationId: data.locationId || null,
          },
        });

        return updated;
      }

      // ── 4. Close any open-ended (non-deleted) assignment ─────────────────────
      // Set endDate = newStart so the previous assignment ends the day the new one begins.
      await tx.shiftAssignment.updateMany({
        where: { employeeId: data.employeeId, endDate: null, deletedAt: null },
        data: { endDate: newStart },
      });

      // ── 5. Create the new assignment ─────────────────────────────────────────
      const created = await tx.shiftAssignment.create({
        data: {
          employeeId: data.employeeId,
          shiftId: data.shiftId,
          locationId: data.locationId || null,
          organizationId,
          startDate: newStart,
          endDate: newEnd,
          assignedBy,
        },
        include: {
          shift: true,
          location: { include: { geofence: true } },
          employee: { select: { firstName: true, lastName: true, employeeCode: true, workMode: true } },
        },
      });

      // Always write both workMode AND officeLocationId — switching OFFICE→FIELD
      // must clear the old location, FIELD→OFFICE must set the new one.
      await tx.employee.update({
        where: { id: data.employeeId },
        data: {
          workMode: newWorkMode as any,
          officeLocationId: data.locationId || null,
        },
      });

      return created;
    });

    // Notify the affected employee's open browser/app tab so their attendance page
    // can refetch without a manual refresh. Safe to ignore if socket not connected.
    if (employee.userId) {
      emitToUser(employee.userId, 'shift:assigned', {
        employeeId: data.employeeId,
        shiftId: data.shiftId,
        shiftType: shift.shiftType,
        workMode: newWorkMode,
        startDate: data.startDate,
        trackingIntervalMinutes: shift.trackingIntervalMinutes ?? 60,
      });
    }

    return assignment;
  }

  async getEmployeeShift(employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        deletedAt: null,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gt: today } }],
      },
      include: {
        shift: true,
        location: { include: { geofence: true } },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getMyShiftHistory(employeeId: string) {
    return prisma.shiftAssignment.findMany({
      where: { employeeId, deletedAt: null },
      include: {
        shift: true,
        location: true,
      },
      orderBy: { startDate: 'desc' },
      take: 20,
    });
  }

  /**
   * Auto-assign the default (General/OFFICE) shift to all employees without an active shift assignment.
   * Called when the General shift is created or on-demand via API.
   */
  async autoAssignDefaultShift(organizationId: string, assignedBy: string) {
    const defaultShift = await prisma.shift.findFirst({
      where: { organizationId, isActive: true, shiftType: 'OFFICE', isDefault: true },
    });
    if (!defaultShift) return { assigned: 0, message: 'No default General shift found' };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find employees without any active shift assignment
    const employeesWithoutShift = await prisma.employee.findMany({
      where: {
        organizationId,
        deletedAt: null,
        NOT: {
          shiftAssignments: {
            some: {
              startDate: { lte: today },
              OR: [{ endDate: null }, { endDate: { gte: today } }],
            },
          },
        },
      },
      select: { id: true },
    });

    if (employeesWithoutShift.length === 0) return { assigned: 0, message: 'All employees already have shifts' };

    // Find the default office location for auto-assignment
    const defaultLocation = await prisma.officeLocation.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    // Bulk create assignments and update workMode
    await prisma.$transaction(async (tx) => {
      await tx.shiftAssignment.createMany({
        data: employeesWithoutShift.map(emp => ({
          employeeId: emp.id,
          shiftId: defaultShift.id,
          locationId: defaultLocation?.id || null,
          organizationId,
          startDate: today,
          endDate: null,
          assignedBy,
        })),
      });
      await tx.employee.updateMany({
        where: { id: { in: employeesWithoutShift.map(e => e.id) } },
        data: { workMode: 'OFFICE' },
      });
    });

    return { assigned: employeesWithoutShift.length, message: `General shift auto-assigned to ${employeesWithoutShift.length} employees` };
  }

  /**
   * Get all active shift assignments for all employees in the org (for roster page)
   */
  async getAllAssignments(organizationId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return prisma.shiftAssignment.findMany({
      where: {
        employee: { organizationId, deletedAt: null },
        startDate: { lte: today },
        // Use gt (not gte) so assignments closed today don't show alongside the new same-day assignment.
        // When HR reassigns with startDate=today, the old one gets endDate=today; exclusive end prevents
        // the old record from appearing alongside the new one and winning the frontend dedup map.
        OR: [{ endDate: null }, { endDate: { gt: today } }],
      },
      include: {
        shift: true,
        location: { include: { geofence: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, workMode: true } },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // ===================== OFFICE LOCATIONS + GEOFENCE =====================

  async getLocations(organizationId: string) {
    return prisma.officeLocation.findMany({
      where: { organizationId },
      include: { geofence: true },
      orderBy: { name: 'asc' },
    });
  }

  async createLocation(data: CreateLocationInput, organizationId: string) {
    const { latitude, longitude, radiusMeters, autoCheckIn, autoCheckOut, strictMode, ...locationData } = data;

    return prisma.$transaction(async (tx) => {
      const geofence = await tx.geofence.create({
        data: {
          name: data.name,
          type: 'OFFICE',
          coordinates: { lat: latitude, lng: longitude },
          radiusMeters,
          autoCheckIn,
          autoCheckOut,
          strictMode,
          organizationId,
        },
      });

      const location = await tx.officeLocation.create({
        data: {
          ...locationData,
          geofenceId: geofence.id,
          organizationId,
        },
        include: { geofence: true },
      });

      return location;
    });
  }

  async updateLocation(id: string, data: any, organizationId: string) {
    const location = await prisma.officeLocation.findFirst({
      where: { id, organizationId },
      include: { geofence: true },
    });
    if (!location) throw new NotFoundError('Office location');

    const { latitude, longitude, radiusMeters, autoCheckIn, autoCheckOut, strictMode, ...locationData } = data;

    return prisma.$transaction(async (tx) => {
      if (location.geofenceId && (latitude !== undefined || longitude !== undefined || radiusMeters !== undefined)) {
        const geofenceUpdate: any = {};
        if (latitude !== undefined || longitude !== undefined) {
          const coords = location.geofence?.coordinates as any || {};
          geofenceUpdate.coordinates = {
            lat: latitude ?? coords.lat,
            lng: longitude ?? coords.lng,
          };
        }
        if (radiusMeters !== undefined) geofenceUpdate.radiusMeters = radiusMeters;
        if (autoCheckIn !== undefined) geofenceUpdate.autoCheckIn = autoCheckIn;
        if (autoCheckOut !== undefined) geofenceUpdate.autoCheckOut = autoCheckOut;
        if (strictMode !== undefined) geofenceUpdate.strictMode = strictMode;
        if (data.name) geofenceUpdate.name = data.name;

        await tx.geofence.update({ where: { id: location.geofenceId }, data: geofenceUpdate });
      }

      return tx.officeLocation.update({
        where: { id },
        data: locationData,
        include: { geofence: true },
      });
    });
  }

  async deleteLocation(id: string, organizationId: string) {
    const location = await prisma.officeLocation.findFirst({
      where: { id, organizationId },
    });
    if (!location) throw new NotFoundError('Office location');

    await prisma.$transaction(async (tx) => {
      if (location.geofenceId) {
        await tx.officeLocation.update({ where: { id }, data: { geofenceId: null } });
        await tx.geofence.delete({ where: { id: location.geofenceId } });
      }
      await tx.officeLocation.delete({ where: { id } });
    });

    return { message: 'Location deleted' };
  }
}

export const shiftService = new ShiftService();
