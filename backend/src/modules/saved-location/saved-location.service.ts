import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';

export class SavedLocationService {
  async list(organizationId: string) {
    return prisma.savedLocation.findMany({
      where: { organizationId },
      include: { addedBy: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } } },
      orderBy: [{ isImportant: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      address?: string;
      latitude: number;
      longitude: number;
      radiusMeters?: number;
      isImportant?: boolean;
      category?: string;
    }
  ) {
    const loc = await prisma.savedLocation.create({
      data: { ...data, organizationId, addedByUserId: userId },
    });
    await createAuditLog({
      userId,
      organizationId,
      entity: 'SavedLocation',
      entityId: loc.id,
      action: 'CREATE',
      newValue: data as Record<string, unknown>,
    });
    return loc;
  }

  async update(
    id: string,
    organizationId: string,
    userId: string,
    data: {
      name?: string;
      address?: string;
      radiusMeters?: number;
      isImportant?: boolean;
      category?: string;
    }
  ) {
    const existing = await prisma.savedLocation.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('SavedLocation not found');
    const updated = await prisma.savedLocation.update({ where: { id }, data });
    await createAuditLog({
      userId,
      organizationId,
      entity: 'SavedLocation',
      entityId: id,
      action: 'UPDATE',
      oldValue: existing as unknown as Record<string, unknown>,
      newValue: data as Record<string, unknown>,
    });
    return updated;
  }

  async remove(id: string, organizationId: string, userId: string) {
    const existing = await prisma.savedLocation.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('SavedLocation not found');
    await prisma.savedLocation.delete({ where: { id } });
    await createAuditLog({
      userId,
      organizationId,
      entity: 'SavedLocation',
      entityId: id,
      action: 'DELETE',
      oldValue: existing as unknown as Record<string, unknown>,
    });
  }

  async promoteFromVisit(visitId: string, organizationId: string, userId: string, name: string) {
    const visit = await prisma.locationVisit.findFirst({
      where: { id: visitId, organizationId },
    });
    if (!visit) throw new NotFoundError('LocationVisit not found');

    const loc = await prisma.savedLocation.create({
      data: {
        organizationId,
        addedByUserId: userId,
        name,
        address: visit.locationName ?? undefined,
        latitude: visit.latitude,
        longitude: visit.longitude,
        radiusMeters: 100,
        isImportant: true,
      },
    });

    // Mark the visit as promoted
    await prisma.locationVisit.update({ where: { id: visitId }, data: { isImportant: true } });

    await createAuditLog({
      userId,
      organizationId,
      entity: 'SavedLocation',
      entityId: loc.id,
      action: 'CREATE',
      newValue: { promotedFromVisit: visitId, name } as Record<string, unknown>,
    });

    return loc;
  }
}

export const savedLocationService = new SavedLocationService();
