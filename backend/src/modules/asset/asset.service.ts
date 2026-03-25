import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../middleware/errorHandler.js';
import type { CreateAssetInput, UpdateAssetInput, AssignAssetInput, AssetQuery } from './asset.validation.js';

export class AssetService {
  async list(query: AssetQuery, organizationId: string) {
    const { page, limit, category, status, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { assetCode: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
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

  async getById(id: string) {
    const asset = await prisma.asset.findUnique({
      where: { id },
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

    if (!asset) {
      throw new NotFoundError('Asset');
    }

    return asset;
  }

  async create(data: CreateAssetInput, organizationId: string) {
    // Check for duplicate asset code
    const existing = await prisma.asset.findUnique({
      where: { assetCode: data.assetCode },
    });
    if (existing) {
      throw new ConflictError('An asset with this code already exists');
    }

    const asset = await prisma.asset.create({
      data: {
        name: data.name,
        assetCode: data.assetCode,
        category: data.category,
        serialNumber: data.serialNumber || null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchaseCost: data.purchaseCost || null,
        notes: data.notes || null,
        organizationId,
      },
    });

    return asset;
  }

  async update(id: string, data: UpdateAssetInput) {
    const existing = await prisma.asset.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Asset');
    }

    // Check asset code uniqueness if changed
    if (data.assetCode && data.assetCode !== existing.assetCode) {
      const duplicate = await prisma.asset.findUnique({
        where: { assetCode: data.assetCode },
      });
      if (duplicate) {
        throw new ConflictError('An asset with this code already exists');
      }
    }

    const updateData: any = { ...data };
    if (data.purchaseDate) updateData.purchaseDate = new Date(data.purchaseDate);

    const asset = await prisma.asset.update({
      where: { id },
      data: updateData,
    });

    return asset;
  }

  async assign(data: AssignAssetInput, assignedBy: string) {
    const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
    if (!asset) {
      throw new NotFoundError('Asset');
    }

    if (asset.status === 'ASSIGNED') {
      throw new BadRequestError('Asset is already assigned. Return it first before reassigning.');
    }

    if (asset.status === 'RETIRED') {
      throw new BadRequestError('Cannot assign a retired asset.');
    }

    // Verify employee exists
    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, deletedAt: null },
    });
    if (!employee) {
      throw new NotFoundError('Employee');
    }

    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.assetAssignment.create({
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

      return assignment;
    });

    return result;
  }

  async returnAsset(assignmentId: string) {
    const assignment = await prisma.assetAssignment.findUnique({
      where: { id: assignmentId },
      include: { asset: true },
    });

    if (!assignment) {
      throw new NotFoundError('Asset assignment');
    }

    if (assignment.returnedAt) {
      throw new BadRequestError('This asset has already been returned.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.assetAssignment.update({
        where: { id: assignmentId },
        data: { returnedAt: new Date() },
        include: {
          asset: true,
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
        },
      });

      await tx.asset.update({
        where: { id: assignment.assetId },
        data: { status: 'AVAILABLE' },
      });

      return updated;
    });

    return result;
  }

  async getAssignments(assetId: string) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundError('Asset');
    }

    const assignments = await prisma.assetAssignment.findMany({
      where: { assetId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return assignments;
  }
  async getMyAssets(userId: string) {
    // Find the employee linked to this user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { employee: { select: { id: true } } },
    });
    if (!user?.employee) return [];

    return prisma.assetAssignment.findMany({
      where: { employeeId: user.employee.id, returnedAt: null },
      include: {
        asset: true,
      },
      orderBy: { assignedAt: 'desc' },
    });
  }
}

export const assetService = new AssetService();
