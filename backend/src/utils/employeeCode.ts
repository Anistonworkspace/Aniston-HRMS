import { prisma } from '../lib/prisma.js';

/**
 * Generate the next employee code for an organization.
 * Uses order-by-desc on existing codes to avoid collisions from soft-deleted records.
 */
export async function generateEmployeeCode(organizationId: string): Promise<string> {
  const lastEmployee = await prisma.employee.findFirst({
    where: { organizationId },
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true },
  });

  if (!lastEmployee) {
    return 'EMP-001';
  }

  const lastNum = parseInt(lastEmployee.employeeCode.replace('EMP-', ''), 10);
  return `EMP-${String(lastNum + 1).padStart(3, '0')}`;
}
