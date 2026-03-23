import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import type { CreateDocumentInput, DocumentQuery } from './document.validation.js';

export class DocumentService {
  async list(query: DocumentQuery, organizationId: string) {
    const { page, limit, employeeId, type, status } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (employeeId) where.employeeId = employeeId;
    if (type) where.type = type;
    if (status) where.status = status;
    // Scope to org via employee relation
    if (!employeeId) {
      where.employee = { organizationId };
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return {
      data: documents,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  async getById(id: string) {
    const doc = await prisma.document.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    if (!doc) throw new NotFoundError('Document');
    return doc;
  }

  async create(data: CreateDocumentInput, fileUrl: string, userId: string) {
    return prisma.document.create({
      data: {
        name: data.name,
        type: data.type as any,
        fileUrl,
        employeeId: data.employeeId || null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        status: 'PENDING',
      },
    });
  }

  async verify(id: string, status: string, verifierId: string, rejectionReason?: string) {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundError('Document');

    return prisma.document.update({
      where: { id },
      data: {
        status: status as any,
        verifiedBy: verifierId,
        verifiedAt: new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason : null,
      },
    });
  }

  async remove(id: string) {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundError('Document');

    return prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const documentService = new DocumentService();
