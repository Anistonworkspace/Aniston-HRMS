/**
 * cleanup-orphaned-leave-records.ts
 *
 * Finds AttendanceRecord rows with status=ON_LEAVE that have no corresponding
 * approved LeaveRequest covering that date for the same employee, then deletes them.
 *
 * Also recalculates LeaveBalance.used and LeaveBalance.pending for the current year
 * by counting actual APPROVED / PENDING LeaveRequest days.
 *
 * Usage:
 *   DRY_RUN=true  npx tsx src/scripts/cleanup-orphaned-leave-records.ts
 *   DRY_RUN=false npx tsx src/scripts/cleanup-orphaned-leave-records.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '../../.env') });

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN !== 'false';

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`\n========================================`);
  console.log(`  Leave Cleanup Script — ${DRY_RUN ? 'DRY RUN (no changes)' : '*** LIVE — WILL DELETE ***'}`);
  console.log(`========================================\n`);

  // ── Step 1: Find all ON_LEAVE attendance records ──────────────────────────
  console.log('Step 1: Fetching all ON_LEAVE attendance records...');
  const onLeaveRecords = await prisma.attendanceRecord.findMany({
    where: { status: 'ON_LEAVE' },
    select: {
      id: true,
      employeeId: true,
      date: true,
      notes: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { date: 'asc' }],
  });

  console.log(`Found ${onLeaveRecords.length} ON_LEAVE attendance record(s) total.\n`);

  if (onLeaveRecords.length === 0) {
    console.log('Nothing to clean up. Exiting.');
    await prisma.$disconnect();
    return;
  }

  // ── Step 2: For each record, check if a valid LeaveRequest covers that date ──
  console.log('Step 2: Checking each record against approved LeaveRequests...\n');

  const orphaned: typeof onLeaveRecords = [];
  const covered: typeof onLeaveRecords = [];

  for (const rec of onLeaveRecords) {
    const recDate = new Date(rec.date);

    // A valid leave request is one that:
    //  - belongs to the same employee
    //  - has a terminal approved status (APPROVED or APPROVED_WITH_CONDITION)
    //    OR is still in-flight (PENDING, MANAGER_APPROVED) — we keep those too
    //  - covers this date (startDate <= recDate <= endDate)
    const covering = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: rec.employeeId,
        status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION', 'PENDING', 'MANAGER_APPROVED'] },
        startDate: { lte: recDate },
        endDate: { gte: recDate },
      },
    });

    if (covering) {
      covered.push(rec);
    } else {
      orphaned.push(rec);
    }
  }

  console.log(`  Covered by a valid LeaveRequest : ${covered.length}`);
  console.log(`  Orphaned (no matching request)  : ${orphaned.length}\n`);

  if (orphaned.length === 0) {
    console.log('No orphaned records found. Calendar data is already consistent. Exiting.');
    await prisma.$disconnect();
    return;
  }

  // ── Step 3: Show what will be deleted ────────────────────────────────────
  console.log('Step 3: Orphaned records to be deleted:\n');
  const byEmployee: Record<string, { name: string; dates: string[] }> = {};
  for (const rec of orphaned) {
    const key = rec.employeeId;
    if (!byEmployee[key]) {
      byEmployee[key] = {
        name: `${rec.employee.firstName} ${rec.employee.lastName} (${rec.employee.employeeCode})`,
        dates: [],
      };
    }
    byEmployee[key].dates.push(isoDate(rec.date));
  }
  for (const [, { name, dates }] of Object.entries(byEmployee)) {
    console.log(`  ${name}`);
    for (const d of dates) {
      console.log(`    - ${d}`);
    }
  }
  console.log('');

  // ── Step 4: Delete orphaned attendance records ────────────────────────────
  if (DRY_RUN) {
    console.log('[DRY RUN] Would delete the above records. Re-run with DRY_RUN=false to apply.\n');
  } else {
    console.log('Step 4: Deleting orphaned ON_LEAVE attendance records...');
    const ids = orphaned.map((r) => r.id);
    const deleted = await prisma.attendanceRecord.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`  Deleted ${deleted.count} attendance record(s).\n`);
  }

  // ── Step 5: Recalculate LeaveBalance.used and .pending ────────────────────
  console.log('Step 5: Recalculating LeaveBalance.used and .pending for current year...');
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(`${currentYear}-01-01`);
  const yearEnd = new Date(`${currentYear}-12-31`);

  // Get all leave balances for current year
  const balances = await prisma.leaveBalance.findMany({
    where: { year: currentYear, deletedAt: null },
    select: { id: true, employeeId: true, leaveTypeId: true, used: true, pending: true },
  });

  console.log(`  Found ${balances.length} LeaveBalance record(s) for ${currentYear}.\n`);

  let balanceUpdates = 0;
  for (const bal of balances) {
    // Count actual APPROVED days
    const approvedAgg = await prisma.leaveRequest.aggregate({
      where: {
        employeeId: bal.employeeId,
        leaveTypeId: bal.leaveTypeId,
        status: { in: ['APPROVED', 'APPROVED_WITH_CONDITION'] },
        startDate: { gte: yearStart, lte: yearEnd },
      },
      _sum: { days: true },
    });

    // Count actual PENDING days (PENDING + MANAGER_APPROVED)
    const pendingAgg = await prisma.leaveRequest.aggregate({
      where: {
        employeeId: bal.employeeId,
        leaveTypeId: bal.leaveTypeId,
        status: { in: ['PENDING', 'MANAGER_APPROVED'] },
        startDate: { gte: yearStart, lte: yearEnd },
      },
      _sum: { days: true },
    });

    const correctUsed = Number(approvedAgg._sum.days ?? 0);
    const correctPending = Number(pendingAgg._sum.days ?? 0);
    const currentUsed = Number(bal.used);
    const currentPending = Number(bal.pending);

    if (correctUsed !== currentUsed || correctPending !== currentPending) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Balance ${bal.id}: used ${currentUsed}→${correctUsed}, pending ${currentPending}→${correctPending}`);
      } else {
        await prisma.leaveBalance.update({
          where: { id: bal.id },
          data: { used: correctUsed, pending: correctPending },
        });
        console.log(`  Updated balance ${bal.id}: used ${currentUsed}→${correctUsed}, pending ${currentPending}→${correctPending}`);
      }
      balanceUpdates++;
    }
  }

  if (balanceUpdates === 0) {
    console.log('  All LeaveBalance.used and .pending values are already correct.\n');
  } else if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would update ${balanceUpdates} LeaveBalance record(s).\n`);
  } else {
    console.log(`\n  Updated ${balanceUpdates} LeaveBalance record(s).\n`);
  }

  console.log('========================================');
  console.log(DRY_RUN ? '  DRY RUN complete — no data was changed.' : '  Cleanup complete.');
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Script failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
