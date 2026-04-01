import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';

export class HybridScheduleService {
  async getSchedule(employeeId: string) {
    return prisma.hybridSchedule.findUnique({ where: { employeeId } });
  }

  async setSchedule(employeeId: string, data: {
    officeDays: number[];
    wfhDays: number[];
    notes?: string;
  }, organizationId: string, setBy: string) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
    });
    if (!employee) throw new NotFoundError('Employee');
    if (employee.workMode !== 'HYBRID') {
      throw new BadRequestError('Hybrid schedule can only be set for HYBRID work mode employees');
    }

    // Validate days are 0-6
    const allDays = [...data.officeDays, ...data.wfhDays];
    if (allDays.some(d => d < 0 || d > 6)) throw new BadRequestError('Days must be 0 (Sun) to 6 (Sat)');

    return prisma.hybridSchedule.upsert({
      where: { employeeId },
      update: {
        officeDays: data.officeDays,
        wfhDays: data.wfhDays,
        notes: data.notes || null,
        setBy,
      },
      create: {
        employeeId,
        officeDays: data.officeDays,
        wfhDays: data.wfhDays,
        effectiveFrom: new Date(),
        notes: data.notes || null,
        setBy,
        organizationId,
      },
    });
  }

  async deleteSchedule(employeeId: string) {
    return prisma.hybridSchedule.delete({ where: { employeeId } }).catch(() => null);
  }
}

export const hybridScheduleService = new HybridScheduleService();
