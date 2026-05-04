/**
 * fix-stale-leave-balances.ts
 *
 * One-time production script: removes LeaveBalance rows that belong to leave types
 * no longer applicable to an employee's CURRENT status.
 *
 * Example: employee was PROBATION (10-day TRAINEE_ONLY balance created), then HR
 * changed them to ACTIVE (20-day ACTIVE_ONLY balance created). The old 10-day
 * TRAINEE_ONLY row is stale and makes the totals show 30 instead of 20.
 *
 * Safety rules:
 *  - Only removes rows where used=0 AND pending=0 (no history to preserve)
 *  - If used>0 or pending>0, zeros out allocation instead (preserves the audit trail)
 *  - Skips employees whose status is not leave-eligible
 *  - Never touches rows for ALL_ELIGIBLE leave types (those apply to all)
 *
 * Usage:
 *   DRY_RUN=true  npx tsx src/scripts/fix-stale-leave-balances.ts
 *   DRY_RUN=false npx tsx src/scripts/fix-stale-leave-balances.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';
const CURRENT_YEAR = new Date().getFullYear();
const POLICY_MANAGED = ['ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE'];

function getExpectedAudiences(status: string, userRole: string | null): string[] {
  const isTrainee = status === 'PROBATION' || status === 'INTERN' || userRole === 'INTERN';
  const isActive = status === 'ACTIVE';
  const audiences: string[] = ['ALL_ELIGIBLE']; // always included
  if (isActive) audiences.push('ACTIVE_ONLY');
  if (isTrainee) audiences.push('TRAINEE_ONLY');
  return audiences;
}

async function main() {
  console.log(`\n========================================`);
  console.log(`  Stale Balance Fix — ${DRY_RUN ? 'DRY RUN (no changes)' : '*** LIVE ***'}`);
  console.log(`  Year: ${CURRENT_YEAR}`);
  console.log(`========================================\n`);

  const employees = await prisma.employee.findMany({
    where: {
      status: { in: ['ACTIVE', 'PROBATION', 'INTERN'] },
      deletedAt: null,
    },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true, status: true,
      user: { select: { role: true } },
      leaveBalances: {
        where: { year: CURRENT_YEAR, deletedAt: null },
        include: { leaveType: { select: { id: true, name: true, applicableTo: true, isActive: true } } },
      },
    },
  });

  console.log(`Processing ${employees.length} leave-eligible employees...\n`);

  let totalDeleted = 0;
  let totalZeroed = 0;
  let totalSkipped = 0;

  for (const emp of employees) {
    const expected = getExpectedAudiences(emp.status, emp.user?.role ?? null);
    const staleBalances = emp.leaveBalances.filter(b => {
      const app = b.leaveType?.applicableTo as string;
      if (!POLICY_MANAGED.includes(app)) return false; // skip legacy types
      return !expected.includes(app);
    });

    if (staleBalances.length === 0) { totalSkipped++; continue; }

    console.log(`  ${emp.employeeCode} ${emp.firstName} ${emp.lastName} [${emp.status}]`);

    for (const bal of staleBalances) {
      const used = Number(bal.used);
      const pending = Number(bal.pending);
      const app = bal.leaveType?.applicableTo;

      if (used === 0 && pending === 0) {
        if (DRY_RUN) {
          console.log(`    [DRY] DELETE stale balance: ${bal.leaveType?.name} (${app}) — 0 used, 0 pending`);
        } else {
          await prisma.leaveBalance.delete({ where: { id: bal.id } });
          console.log(`    DELETED stale balance: ${bal.leaveType?.name} (${app})`);
        }
        totalDeleted++;
      } else {
        if (DRY_RUN) {
          console.log(`    [DRY] ZERO stale balance: ${bal.leaveType?.name} (${app}) — has ${used} used / ${pending} pending`);
        } else {
          await (prisma.leaveBalance.update as any)({
            where: { id: bal.id },
            data: { policyAllocated: 0, allocated: used + pending },
          });
          console.log(`    ZEROED stale balance: ${bal.leaveType?.name} (${app}) — kept ${used} used / ${pending} pending`);
        }
        totalZeroed++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`  Employees processed  : ${employees.length}`);
  console.log(`  Balances deleted     : ${totalDeleted}`);
  console.log(`  Balances zeroed      : ${totalZeroed}`);
  console.log(`  Employees no change  : ${totalSkipped}`);
  console.log(DRY_RUN ? '\n  DRY RUN — no data was changed.' : '\n  Done.');
  console.log(`========================================\n`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Script failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
