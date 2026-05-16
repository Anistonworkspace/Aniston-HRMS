import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, BadRequestError, AppError } from '../../middleware/errorHandler.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
import type { CreateAssetInput, UpdateAssetInput, AssignAssetInput, ReturnAssetInput, ExitChecklistItemInput, AssetQuery } from './asset.validation.js';

export class AssetService {
  async list(query: AssetQuery, organizationId: string) {
    const { page, limit, category, status, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { assetCode: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { vendor: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) where.category = category;
    if (status) where.status = status;

    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignments: {
            where: { returnedAt: null },
            include: {
              employee: {
                select: { id: true, firstName: true, lastName: true, employeeCode: true },
              },
            },
            take: 1,
          },
        },
      }),
      prisma.asset.count({ where }),
    ]);

    return {
      data: assets,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async getById(id: string, organizationId: string) {
    const asset = await prisma.asset.findFirst({
      where: { id, organizationId },
      include: {
        assignments: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });

    if (!asset) throw new NotFoundError('Asset');
    return asset;
  }

  async create(data: CreateAssetInput, organizationId: string, userId?: string) {
    const existing = await prisma.asset.findUnique({
      where: { assetCode_organizationId: { assetCode: data.assetCode, organizationId } },
    });
    if (existing) throw new ConflictError('An asset with this code already exists');

    const asset = await prisma.asset.create({
      data: {
        name: data.name,
        assetCode: data.assetCode,
        category: data.category,
        brand: data.brand || null,
        modelNumber: data.modelNumber || null,
        serialNumber: data.serialNumber || null,
        condition: data.condition || 'GOOD',
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchaseCost: data.purchaseCost || null,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : null,
        vendor: data.vendor || null,
        location: data.location || null,
        notes: data.notes || null,
        organizationId,
      },
    });
    await createAuditLog({ userId: userId || organizationId, organizationId, entity: 'Asset', entityId: asset.id, action: 'CREATE', newValue: { name: data.name, assetCode: data.assetCode, category: data.category } });
    return asset;
  }

  async update(id: string, data: UpdateAssetInput, organizationId: string, userId?: string) {
    const existing = await prisma.asset.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Asset');

    if (data.assetCode && data.assetCode !== existing.assetCode) {
      const duplicate = await prisma.asset.findUnique({
        where: { assetCode_organizationId: { assetCode: data.assetCode, organizationId } },
      });
      if (duplicate) throw new ConflictError('An asset with this code already exists');
    }

    const updateData: any = { ...data };
    if (data.purchaseDate) updateData.purchaseDate = new Date(data.purchaseDate);
    if (data.warrantyExpiry) updateData.warrantyExpiry = new Date(data.warrantyExpiry);

    const updated = await prisma.asset.update({ where: { id }, data: updateData });
    await createAuditLog({ userId: userId || organizationId, organizationId, entity: 'Asset', entityId: id, action: 'UPDATE', newValue: updateData });
    return updated;
  }

  async assign(data: AssignAssetInput, assignedBy: string, organizationId?: string) {
    const asset = await prisma.asset.findFirst({
      where: organizationId ? { id: data.assetId, organizationId } : { id: data.assetId },
    });
    if (!asset) throw new NotFoundError('Asset');
    if (asset.status === 'ASSIGNED') throw new BadRequestError('Asset is already assigned. Return it first before reassigning.');
    if (asset.status === 'RETIRED') throw new BadRequestError('Cannot assign a retired asset.');

    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId: asset.organizationId, deletedAt: null },
      include: { user: { select: { email: true } }, organization: { select: { name: true } } },
    });
    if (!employee) throw new NotFoundError('Employee');

    try {
      const assignment = await prisma.$transaction(async (tx) => {
        const created = await tx.assetAssignment.create({
          data: {
            assetId: data.assetId,
            employeeId: data.employeeId,
            assignedBy,
            condition: data.condition || null,
            notes: data.notes || null,
          },
          include: {
            asset: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
        });

        await tx.asset.update({
          where: { id: data.assetId },
          data: { status: 'ASSIGNED' },
        });

        return created;
      });

      // Send email notification to employee (non-blocking)
      const employeeEmail = (employee as any).user?.email;
      if (employeeEmail) {
        enqueueEmail({
          to: employeeEmail,
          subject: `Asset Assigned: ${asset.name}`,
          template: 'asset-assigned',
          context: {
            employeeName: `${employee.firstName} ${employee.lastName}`,
            assetName: asset.name,
            assetCode: (asset as any).assetCode || null,
            category: (asset as any).category || null,
            brand: (asset as any).brand || null,
            model: (asset as any).modelNumber || null,
            serialNumber: (asset as any).serialNumber || null,
            condition: data.condition || null,
            notes: data.notes || null,
            assignedAt: new Date().toISOString(),
            orgName: (employee as any).organization?.name || 'Aniston Technologies',
            hrmsUrl: 'https://hr.anistonav.com/my-assets',
          },
        }).catch((err) => logger.warn(`[Asset] Email notification failed: ${err.message}`));
      }

      return assignment;
    } catch (err: any) {
      if (err instanceof BadRequestError || err instanceof NotFoundError) throw err;
      logger.error(`[Asset] assign() transaction failed: ${err.message}`);
      throw new AppError('Asset assignment failed. Please try again.', 500, 'TRANSACTION_FAILED');
    }
  }

  async returnAsset(assignmentId: string, returnData?: ReturnAssetInput, organizationId?: string) {
    const assignment = await prisma.assetAssignment.findFirst({
      where: organizationId
        ? { id: assignmentId, asset: { organizationId } }
        : { id: assignmentId },
      include: { asset: true },
    });

    if (!assignment) throw new NotFoundError('Asset assignment');
    if (assignment.returnedAt) throw new BadRequestError('This asset has already been returned.');

    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.assetAssignment.update({
          where: { id: assignmentId },
          data: {
            returnedAt: new Date(),
            returnCondition: returnData?.returnCondition || null,
            returnNotes: returnData?.returnNotes || null,
          },
          include: {
            asset: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
        });

        // Update asset status and condition if return condition provided
        const assetUpdate: any = { status: 'AVAILABLE' as const };
        if (returnData?.returnCondition) {
          assetUpdate.condition = returnData.returnCondition;
        }

        await tx.asset.update({
          where: { id: assignment.assetId },
          data: assetUpdate,
        });

        // Check if this employee has an exit checklist and update it
        const checklist = await tx.exitChecklist.findUnique({
          where: { employeeId: assignment.employeeId },
          include: { items: true },
        });

        if (checklist) {
          // Mark matching checklist item as returned
          const matchingItem = checklist.items.find(
            (item) => item.assetId === assignment.assetId && !item.isReturned
          );
          if (matchingItem) {
            await tx.exitChecklistItem.update({
              where: { id: matchingItem.id },
              data: { isReturned: true, returnedAt: new Date() },
            });
          }

          // Check if all items are now returned
          const updatedItems = await tx.exitChecklistItem.findMany({
            where: { checklistId: checklist.id },
          });
          const allReturned = updatedItems.every((item) => item.isReturned);

          if (allReturned) {
            await tx.exitChecklist.update({
              where: { id: checklist.id },
              data: {
                assetsClearedAt: new Date(),
                salaryProcessingUnblocked: true,
              },
            });
          }
        }

        return updated;
      });
    } catch (err: any) {
      if (err instanceof BadRequestError || err instanceof NotFoundError) throw err;
      logger.error(`[Asset] returnAsset() transaction failed: ${err.message}`);
      throw new AppError('Asset return failed. Please try again.', 500, 'TRANSACTION_FAILED');
    }
  }

  async getAssignments(assetId: string, organizationId: string) {
    const asset = await prisma.asset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundError('Asset');

    return prisma.assetAssignment.findMany({
      where: { assetId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getMyAssets(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employee: { select: { id: true } } },
    });
    if (!user?.employee) return [];

    return prisma.assetAssignment.findMany({
      where: { employeeId: user.employee.id, returnedAt: null },
      include: { asset: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getEmployeeAssets(employeeId: string, organizationId: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundError('Employee');
    return prisma.assetAssignment.findMany({
      where: { employeeId },
      include: { asset: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async getStats(organizationId: string) {
    const [total, assigned, available, maintenance, retired, byCategory] = await Promise.all([
      prisma.asset.count({ where: { organizationId } }),
      prisma.asset.count({ where: { organizationId, status: 'ASSIGNED' } }),
      prisma.asset.count({ where: { organizationId, status: 'AVAILABLE' } }),
      prisma.asset.count({ where: { organizationId, status: 'MAINTENANCE' } }),
      prisma.asset.count({ where: { organizationId, status: 'RETIRED' } }),
      prisma.asset.groupBy({
        by: ['category'],
        where: { organizationId },
        _count: true,
      }),
    ]);

    return {
      total,
      assigned,
      available,
      maintenance,
      retired,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count })),
    };
  }

  // =====================
  // EXIT CHECKLIST
  // =====================

  async createExitChecklist(employeeId: string) {
    // Check if already exists
    const existing = await prisma.exitChecklist.findUnique({ where: { employeeId } });
    if (existing) return existing;

    // Find all unreturned asset assignments
    const pendingAssignments = await prisma.assetAssignment.findMany({
      where: { employeeId, returnedAt: null },
      include: { asset: true },
    });

    const checklist = await prisma.exitChecklist.create({
      data: {
        employeeId,
        salaryProcessingUnblocked: pendingAssignments.length === 0,
        assetsClearedAt: pendingAssignments.length === 0 ? new Date() : null,
        items: {
          create: pendingAssignments.map((a) => ({
            assetId: a.assetId,
            itemName: `${a.asset.name} (${a.asset.assetCode})`,
          })),
        },
      },
      include: { items: true },
    });

    return checklist;
  }

  async getExitChecklist(employeeId: string) {
    const checklist = await prisma.exitChecklist.findUnique({
      where: { employeeId },
      include: {
        items: {
          include: {
            asset: {
              select: { id: true, name: true, assetCode: true, category: true, condition: true },
            },
          },
        },
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            exitStatus: true, resignationDate: true, lastWorkingDate: true,
          },
        },
      },
    });

    if (!checklist) return null;
    return checklist;
  }

  async markChecklistItemReturned(
    employeeId: string,
    data: ExitChecklistItemInput,
    approvedBy: string
  ) {
    const checklist = await prisma.exitChecklist.findUnique({
      where: { employeeId },
      include: { items: true },
    });

    if (!checklist) throw new NotFoundError('Exit checklist');

    const item = checklist.items.find((i) => i.id === data.itemId);
    if (!item) throw new NotFoundError('Checklist item');

    try {
      return await prisma.$transaction(async (tx) => {
        // Update the checklist item
        await tx.exitChecklistItem.update({
          where: { id: data.itemId },
          data: {
            isReturned: data.isReturned,
            returnedAt: data.isReturned ? new Date() : null,
            approvedBy: data.isReturned ? approvedBy : null,
            notes: data.notes || null,
          },
        });

        // If item has an asset and is being returned, also return the asset assignment
        if (data.isReturned && item.assetId) {
          const assignment = await tx.assetAssignment.findFirst({
            where: { assetId: item.assetId, employeeId, returnedAt: null },
          });
          if (assignment) {
            await tx.assetAssignment.update({
              where: { id: assignment.id },
              data: { returnedAt: new Date() },
            });
            await tx.asset.update({
              where: { id: item.assetId },
              data: { status: 'AVAILABLE' },
            });
          }
        }

        // Check if all items returned
        const allItems = await tx.exitChecklistItem.findMany({
          where: { checklistId: checklist.id },
        });
        const allReturned = allItems.every((i) =>
          i.id === data.itemId ? data.isReturned : i.isReturned
        );

        await tx.exitChecklist.update({
          where: { id: checklist.id },
          data: {
            assetsClearedAt: allReturned ? new Date() : null,
            salaryProcessingUnblocked: allReturned,
          },
        });

        // Return updated checklist
        return tx.exitChecklist.findUnique({
          where: { employeeId },
          include: {
            items: {
              include: {
                asset: {
                  select: { id: true, name: true, assetCode: true, category: true, condition: true },
                },
              },
            },
          },
        });
      });
    } catch (err: any) {
      if (err instanceof BadRequestError || err instanceof NotFoundError) throw err;
      logger.error(`[Asset] markChecklistItemReturned() transaction failed: ${err.message}`);
      throw new AppError('Checklist update failed. Please try again.', 500, 'TRANSACTION_FAILED');
    }
  }
}

export const assetService = new AssetService();
