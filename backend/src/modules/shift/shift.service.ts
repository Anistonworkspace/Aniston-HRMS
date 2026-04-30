import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../middleware/errorHandler.js';
import type { CreateShiftInput, AssignShiftInput, CreateLocationInput } from './shift.validation.js';

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
            where: { shiftId: hybrid.id, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
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

    return prisma.shift.findMany({
      where: { organizationId, isActive: true },
      include: { _count: { select: { assignments: true } } },
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
    const activeAssignments = await prisma.shiftAssignment.count({
      where: { shiftId: id, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
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
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await prisma.shiftAssignment.updateMany({
          where: { shiftId: id, OR: [{ endDate: null }, { endDate: { gte: today } }] },
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
    const employee = await prisma.employee.findFirst({ where: { id: data.employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');

    const shift = await prisma.shift.findFirst({ where: { id: data.shiftId, organizationId } });
    if (!shift) throw new NotFoundError('Shift');

    // End any current open assignment
    await prisma.shiftAssignment.updateMany({
      where: { employeeId: data.employeeId, endDate: null },
      data: { endDate: new Date(data.startDate) },
    });

    // Map shift type to employee work mode
    const workModeMap: Record<string, string> = { OFFICE: 'OFFICE', FIELD: 'FIELD_SALES' };
    const newWorkMode = workModeMap[shift.shiftType] || 'OFFICE';

    // Update employee's workMode to match the assigned shift
    await prisma.employee.update({
      where: { id: data.employeeId },
      data: { workMode: newWorkMode as any },
    });

    // Sync employee's officeLocationId if the shift assignment includes a location
    if (data.locationId) {
      await prisma.employee.update({
        where: { id: data.employeeId },
        data: { officeLocationId: data.locationId },
      });
    }

    return prisma.shiftAssignment.create({
      data: {
        employeeId: data.employeeId,
        shiftId: data.shiftId,
        locationId: data.locationId || null,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        assignedBy,
      },
      include: {
        shift: true,
        location: { include: { geofence: true } },
        employee: { select: { firstName: true, lastName: true, employeeCode: true, workMode: true } },
      },
    });
  }

  async getEmployeeShift(employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: {
        shift: true,
        location: { include: { geofence: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async getMyShiftHistory(employeeId: string) {
    return prisma.shiftAssignment.findMany({
      where: { employeeId },
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
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: {
        shift: true,
        location: { include: { geofence: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, workMode: true } },
      },
      orderBy: { startDate: 'desc' },
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
