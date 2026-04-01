import { prisma } from '../lib/prisma.js';

/**
 * Generate the next employee code for an organization.
 * Uses order-by-desc on existing codes to avoid collisions from soft-deleted records.
 */
export async function generateEmployeeCode(organizationId: string): Promise<string> {
  // Include ALL employees (even soft-deleted) to avoid unique constraint collisions
  // Use raw query to get MAX numeric code reliably
  const allEmployees = await prisma.employee.findMany({
    where: { organizationId, employeeCode: { startsWith: 'EMP-' } },
    select: { employeeCode: true },
  });

  if (allEmployees.length === 0) {
    return 'EMP-001';
  }

  // Find the highest numeric code across all records (including soft-deleted)
  let maxNum = 0;
  for (const emp of allEmployees) {
    const num = parseInt(emp.employeeCode.replace('EMP-', ''), 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  }

  return `EMP-${String(maxNum + 1).padStart(3, '0')}`;
}
