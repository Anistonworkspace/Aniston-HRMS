import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * One-time fix: FIELD shifts that were never explicitly configured (trackingIntervalMinutes
 * is NULL) are reset to 1 minute — the correct default for live GPS tracking.
 *
 * Shifts with any explicit value (including 60 min intentionally set by HR) are left untouched.
 * Going forward, shift.service.ts enforces a max of 60 minutes and a minimum of 1 minute,
 * so this script only needs to run once to clean up legacy NULL entries.
 *
 * Run: npx tsx scripts/fix-field-shift-interval.ts
 */
async function main() {
  const result = await prisma.shift.updateMany({
    where: {
      shiftType: 'FIELD',
      trackingIntervalMinutes: null,
    },
    data: { trackingIntervalMinutes: 1 },
  });
  console.log(`Updated ${result.count} FIELD shift(s) with NULL interval → 1 min.`);
  console.log('Shifts with any explicit interval (including 60 min) were not changed.');
  console.log('HR can adjust the interval from Roster → Edit Shift → GPS Interval.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
