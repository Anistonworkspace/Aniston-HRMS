/**
 * Backfill ABSENT records for past weekdays where OFFICE employees have no attendance record.
 *
 * This script is safe to run multiple times — it only inserts records where none exist.
 * Run on production EC2 to fix missing attendance days after DB recovery.
 *
 * Usage:
 *   cd /home/ubuntu/Aniston-HRMS
 *   npx ts-node --esm scripts/backfill-absent-records.ts
 *
 * Or via node (after building):
 *   node -r dotenv/config scripts/backfill-absent-records.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // ── Date range: May 1 to yesterday (do NOT touch today — employee may still check in)
  const startDate = new Date('2026-05-01T00:00:00.000Z');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  if (yesterday < startDate) {
    console.log('Nothing to backfill — start date is in the future.');
    return;
  }

  // ── Collect all orgs
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Found ${orgs.length} organization(s)`);

  let totalInserted = 0;

  for (const org of orgs) {
    // Get holidays in range for this org
    const holidays = await prisma.holiday.findMany({
      where: { organizationId: org.id, date: { gte: startDate, lte: yesterday } },
      select: { date: true },
    });
    const holidayDates = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));

    // Get OFFICE employees in this org who are active
    const employees = await prisma.employee.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        workMode: 'OFFICE',
        status: { in: ['ACTIVE', 'PROBATION', 'INTERN', 'NOTICE_PERIOD'] },
      },
      select: { id: true, employeeCode: true, firstName: true, joiningDate: true },
    });

    console.log(`\nOrg: ${org.name} — ${employees.length} OFFICE employees`);

    for (const emp of employees) {
      // Only backfill from joining date (or May 1, whichever is later)
      const joiningMidnight = emp.joiningDate
        ? new Date(`${emp.joiningDate.toISOString().split('T')[0]}T00:00:00.000Z`)
        : startDate;
      const effectiveStart = joiningMidnight > startDate ? joiningMidnight : startDate;

      // Get all existing attendance dates for this employee in range
      const existing = await prisma.attendanceRecord.findMany({
        where: { employeeId: emp.id, date: { gte: effectiveStart, lte: yesterday } },
        select: { date: true },
      });
      const existingDates = new Set(existing.map(r => r.date.toISOString().split('T')[0]));

      // Walk through each date in range
      const current = new Date(effectiveStart);
      const toInsert: Date[] = [];

      while (current <= yesterday) {
        const dayOfWeek = current.getDay();
        const dateStr = current.toISOString().split('T')[0];

        // Skip Sundays and holidays — only mark Mon-Sat non-holidays as ABSENT
        if (dayOfWeek !== 0 && !holidayDates.has(dateStr) && !existingDates.has(dateStr)) {
          toInsert.push(new Date(current));
        }

        current.setDate(current.getDate() + 1);
      }

      if (toInsert.length === 0) {
        console.log(`  ${emp.employeeCode} ${emp.firstName}: no missing days`);
        continue;
      }

      // Batch insert ABSENT records
      let inserted = 0;
      for (const date of toInsert) {
        try {
          await prisma.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId: emp.id, date } },
            create: {
              employeeId: emp.id,
              date,
              status: 'ABSENT',
              workMode: 'OFFICE',
              source: 'MANUAL_HR',
              notes: 'Auto-backfilled: no attendance record found for this workday',
              clockInCount: 0,
            },
            update: {
              // Do not overwrite existing records — upsert with no-op update
            },
          });
          inserted++;
        } catch (e: any) {
          console.warn(`  Warning: could not insert ABSENT for ${emp.employeeCode} on ${date.toISOString().split('T')[0]}: ${e.message}`);
        }
      }

      console.log(`  ${emp.employeeCode} ${emp.firstName}: inserted ${inserted} ABSENT records (${toInsert.map(d => d.toISOString().split('T')[0]).join(', ')})`);
      totalInserted += inserted;
    }
  }

  console.log(`\n✅ Done. Total ABSENT records inserted: ${totalInserted}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
