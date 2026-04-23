import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../middleware/errorHandler.js';

export class CompOffService {
  private async expireStaleCredits(organizationId: string) {
    await prisma.compOffCredit.updateMany({
      where: { organizationId, status: 'AVAILABLE', expiryDate: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  async getCredits(employeeId: string, organizationId: string) {
    await this.expireStaleCredits(organizationId);
    return prisma.compOffCredit.findMany({
      where: { employeeId, organizationId },
      orderBy: { earnedDate: 'desc' },
    });
  }

  async getBalance(employeeId: string, organizationId: string): Promise<number> {
    await this.expireStaleCredits(organizationId);
    return prisma.compOffCredit.count({
      where: { employeeId, organizationId, status: 'AVAILABLE', expiryDate: { gte: new Date() } },
    });
  }

  async listOrgCredits(organizationId: string, status?: string) {
    const where: any = { organizationId };
    if (status) where.status = status;
    return prisma.compOffCredit.findMany({
      where,
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
      orderBy: { earnedDate: 'desc' },
      take: 200,
    });
  }

  /** HR grants a comp-off credit to an employee (e.g. after approving OT/Sunday work) */
  async grantCredit(data: {
    employeeId: string;
    organizationId: string;
    earnedDate: Date;
    hoursWorked: number;
    notes?: string;
    expiryMonths?: number; // default 3
  }) {
    const emp = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId: data.organizationId },
    });
    if (!emp) throw new NotFoundError('Employee');

    const expiryDate = new Date(data.earnedDate);
    expiryDate.setMonth(expiryDate.getMonth() + (data.expiryMonths ?? 3));

    return prisma.compOffCredit.create({
      data: {
        employeeId: data.employeeId,
        organizationId: data.organizationId,
        earnedDate: data.earnedDate,
        expiryDate,
        hoursWorked: data.hoursWorked,
        status: 'AVAILABLE',
        notes: data.notes,
      },
    });
  }

  /** Consume the oldest available comp-off credit (used when employee applies comp-off leave) */
  async redeemCredit(employeeId: string, organizationId: string, leaveRequestId: string) {
    await this.expireStaleCredits(organizationId);

    const credit = await prisma.compOffCredit.findFirst({
      where: { employeeId, organizationId, status: 'AVAILABLE', expiryDate: { gte: new Date() } },
      orderBy: { earnedDate: 'asc' }, // FIFO: use oldest first
    });
    if (!credit) throw new BadRequestError('No available comp-off credits to redeem');

    return prisma.compOffCredit.update({
      where: { id: credit.id },
      data: { status: 'USED', usedDate: new Date(), leaveRequestId },
    });
  }
}

export const compOffService = new CompOffService();
