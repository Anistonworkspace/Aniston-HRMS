import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../middleware/errorHandler.js';
import type { CreateShiftInput, AssignShiftInput, CreateLocationInput } from './shift.validation.js';

export class ShiftService {
  // ===================== SHIFTS =====================

  async getShifts(organizationId: string) {
    return prisma.shift.findMany({
      where: { organizationId, isActive: true },
      include: { _count: { select: { assignments: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createShift(data: CreateShiftInput, organizationId: string, assignedBy?: string) {
    // Only allow one shift per type (General=OFFICE, Live Tracking=FIELD)
    const existingType = await prisma.shift.findFirst({
      where: { organizationId, shiftType: data.shiftType, isActive: true },
    });
    if (existingType) {
      throw new ConflictError(`A ${data.shiftType === 'OFFICE' ? 'General' : 'Live Tracking'} shift already exists`);
    }

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
      // Soft delete — rename code to free up the unique constraint
      await prisma.shift.update({
        where: { id },
        data: { isActive: false, code: `${shift.code}_DEL_${Date.now()}` },
      });
      return { message: 'Shift deactivated' };
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

    // Bulk create assignments and update workMode
    await prisma.$transaction(async (tx) => {
      await tx.shiftAssignment.createMany({
        data: employeesWithoutShift.map(emp => ({
          employeeId: emp.id,
          shiftId: defaultShift.id,
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
