import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import type { CreateHolidayInput, UpdateHolidayInput, HolidayQuery } from './holiday.validation.js';

export class HolidayService {
  async list(organizationId: string, query: HolidayQuery) {
    const year = query.year || new Date().getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31);

    const where: any = {
      organizationId,
      date: { gte: startOfYear, lte: endOfYear },
    };

    if (query.type) {
      where.type = query.type;
    }

    return prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async create(organizationId: string, data: CreateHolidayInput) {
    const holidayDate = new Date(data.date);

    // Check for duplicate date in same org
    const existing = await prisma.holiday.findUnique({
      where: { date_organizationId: { date: holidayDate, organizationId } },
    });
    if (existing) {
      throw new BadRequestError('A holiday already exists on this date');
    }

    return prisma.holiday.create({
      data: {
        name: data.name,
        date: holidayDate,
        type: data.type || 'PUBLIC',
        isOptional: data.isOptional || false,
        organizationId,
      },
    });
  }

  async update(id: string, organizationId: string, data: UpdateHolidayInput) {
    const holiday = await prisma.holiday.findFirst({
      where: { id, organizationId },
    });
    if (!holiday) throw new NotFoundError('Holiday');

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.date !== undefined) updateData.date = new Date(data.date);
    if (data.type !== undefined) updateData.type = data.type;
    if (data.isOptional !== undefined) updateData.isOptional = data.isOptional;

    return prisma.holiday.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string, organizationId: string) {
    const holiday = await prisma.holiday.findFirst({
      where: { id, organizationId },
    });
    if (!holiday) throw new NotFoundError('Holiday');

    await prisma.holiday.delete({ where: { id } });
    return { message: 'Holiday deleted' };
  }
}

export const holidayService = new HolidayService();
