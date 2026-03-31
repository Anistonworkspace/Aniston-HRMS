import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { logger } from '../../lib/logger.js';
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

  async create(organizationId: string, data: CreateHolidayInput, userId?: string) {
    const holidayDate = new Date(data.date);

    // Check for duplicate date in same org
    const existing = await prisma.holiday.findUnique({
      where: { date_organizationId: { date: holidayDate, organizationId } },
    });
    if (existing) {
      throw new BadRequestError('A holiday already exists on this date');
    }

    const holiday = await prisma.holiday.create({
      data: {
        name: data.name,
        date: holidayDate,
        type: data.type || 'PUBLIC',
        isOptional: data.isOptional || false,
        isHalfDay: data.isHalfDay || false,
        halfDaySession: data.halfDaySession || null,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        description: data.description || null,
        color: data.color || null,
        notifyEmployees: data.notifyEmployees ?? true,
        createdBy: userId || null,
        organizationId,
      },
    });

    // Send email notification to all employees
    if (data.notifyEmployees !== false) {
      this.notifyAllEmployees(organizationId, holiday).catch(err =>
        logger.error('Failed to send holiday notification:', err)
      );
    }

    return holiday;
  }

  async bulkCreate(organizationId: string, holidays: CreateHolidayInput[], userId?: string) {
    let created = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const h of holidays) {
      try {
        const holiday = await this.create(organizationId, { ...h, notifyEmployees: false }, userId);
        results.push(holiday);
        created++;
      } catch {
        skipped++;
      }
    }

    return { created, skipped, total: holidays.length, holidays: results };
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
    if (data.isHalfDay !== undefined) updateData.isHalfDay = data.isHalfDay;
    if (data.halfDaySession !== undefined) updateData.halfDaySession = data.halfDaySession;
    if (data.startTime !== undefined) updateData.startTime = data.startTime;
    if (data.endTime !== undefined) updateData.endTime = data.endTime;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.color !== undefined) updateData.color = data.color;

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

  /**
   * Return a list of standard Indian holidays for a given year.
   * HR can review and bulk-add them.
   */
  getIndianHolidaysSuggestions(year: number) {
    return [
      { name: 'Republic Day', date: `${year}-01-26`, type: 'PUBLIC', description: 'National holiday commemorating the adoption of the Indian Constitution.' },
      { name: 'Maha Shivaratri', date: `${year}-02-26`, type: 'PUBLIC', description: 'Hindu festival honoring Lord Shiva.' },
      { name: 'Holi', date: `${year}-03-14`, type: 'PUBLIC', description: 'Festival of colors celebrating the triumph of good over evil.' },
      { name: 'Good Friday', date: `${year}-04-18`, type: 'OPTIONAL', description: 'Christian holiday commemorating the crucifixion of Jesus Christ.' },
      { name: 'Eid ul-Fitr', date: `${year}-03-31`, type: 'PUBLIC', description: 'Islamic festival marking the end of Ramadan.' },
      { name: 'Dr. B.R. Ambedkar Jayanti', date: `${year}-04-14`, type: 'PUBLIC', description: 'Birth anniversary of Dr. B.R. Ambedkar, architect of Indian Constitution.' },
      { name: 'May Day / Labour Day', date: `${year}-05-01`, type: 'OPTIONAL', description: 'International Workers Day celebrating labour rights.' },
      { name: 'Buddha Purnima', date: `${year}-05-12`, type: 'OPTIONAL', description: 'Celebrates the birth, enlightenment, and death of Gautama Buddha.' },
      { name: 'Eid ul-Adha', date: `${year}-06-07`, type: 'OPTIONAL', description: 'Islamic festival of sacrifice.' },
      { name: 'Muharram', date: `${year}-06-27`, type: 'OPTIONAL', description: 'Islamic New Year and remembrance of Hussain ibn Ali.' },
      { name: 'Independence Day', date: `${year}-08-15`, type: 'PUBLIC', description: 'National holiday celebrating Indian independence from British rule.' },
      { name: 'Janmashtami', date: `${year}-08-16`, type: 'OPTIONAL', description: 'Hindu festival celebrating the birth of Lord Krishna.' },
      { name: 'Milad-un-Nabi', date: `${year}-09-05`, type: 'OPTIONAL', description: 'Celebrates the birthday of Prophet Muhammad.' },
      { name: 'Mahatma Gandhi Jayanti', date: `${year}-10-02`, type: 'PUBLIC', description: 'Birth anniversary of Mahatma Gandhi, Father of the Nation.' },
      { name: 'Dussehra / Vijaya Dashami', date: `${year}-10-02`, type: 'PUBLIC', description: 'Hindu festival celebrating the victory of Lord Rama over Ravana.' },
      { name: 'Diwali', date: `${year}-10-20`, type: 'PUBLIC', description: 'Festival of lights celebrating the triumph of light over darkness.' },
      { name: 'Bhai Dooj', date: `${year}-10-22`, type: 'OPTIONAL', description: 'Festival celebrating the bond between brothers and sisters.' },
      { name: 'Guru Nanak Jayanti', date: `${year}-11-15`, type: 'OPTIONAL', description: 'Birth anniversary of Guru Nanak Dev, founder of Sikhism.' },
      { name: 'Christmas', date: `${year}-12-25`, type: 'PUBLIC', description: 'Christian holiday celebrating the birth of Jesus Christ.' },
    ];
  }

  /**
   * Send holiday notification email to all active employees.
   */
  private async notifyAllEmployees(organizationId: string, holiday: any) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, status: { in: ['ACTIVE', 'PROBATION'] }, isSystemAccount: { not: true } },
      select: { email: true, firstName: true },
    });

    if (employees.length === 0) return;

    const holidayDate = new Date(holiday.date).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
    });

    const typeLabel = holiday.type === 'EVENT' ? 'Company Event' : holiday.isHalfDay ? 'Half-Day Holiday' : 'Holiday';
    const timingInfo = holiday.startTime && holiday.endTime
      ? `${holiday.startTime} — ${holiday.endTime}`
      : holiday.isHalfDay
        ? `${holiday.halfDaySession === 'FIRST_HALF' ? 'Morning Off (First Half)' : 'Afternoon Off (Second Half)'}`
        : 'Full Day';

    for (const emp of employees) {
      try {
        await enqueueEmail({
          to: emp.email,
          subject: `${holiday.type === 'EVENT' ? '📅 Event' : '🎉 Holiday'}: ${holiday.name} — ${holidayDate}`,
          template: 'holiday-notification',
          context: {
            employeeName: emp.firstName,
            holidayName: holiday.name,
            holidayDate,
            typeLabel,
            timingInfo,
            description: holiday.description || '',
            orgName: org?.name || 'Aniston Technologies',
            isEvent: holiday.type === 'EVENT',
            color: holiday.color || (holiday.type === 'EVENT' ? '#F97316' : '#4F46E5'),
          },
        });
      } catch (err) {
        logger.error(`Failed to send holiday email to ${emp.email}:`, err);
      }
    }

    logger.info(`Holiday notification sent to ${employees.length} employees for: ${holiday.name}`);
  }
}

export const holidayService = new HolidayService();
