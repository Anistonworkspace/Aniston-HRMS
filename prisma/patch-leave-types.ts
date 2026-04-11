/**
 * Patch leave type policies to match business rules:
 *
 *  SL  (Sick Leave)       — allowSameDay=true,  noticeDays=0, isPaid=true
 *  EL  (Emergency Leave)  — allowSameDay=true,  noticeDays=0, isPaid=true
 *  CL  (Casual Leave)     — allowSameDay=false, noticeDays=2, isPaid=true
 *  PL  (Privileged Leave) — allowSameDay=false, noticeDays=2, isPaid=true
 *  LWP (Leave Without Pay)— allowSameDay=true,  noticeDays=0, isPaid=false
 *
 * Run from project root:
 *   npx ts-node --esm prisma/patch-leave-types.ts
 * OR (if using tsx):
 *   npx tsx prisma/patch-leave-types.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PATCHES: Array<{
  codes: string[];
  data: {
    allowSameDay: boolean;
    noticeDays: number;
    isPaid?: boolean;
  };
}> = [
  {
    codes: ['SL', 'SICK'],
    data: { allowSameDay: true, noticeDays: 0, isPaid: true },
  },
  {
    codes: ['EL', 'EMERGENCY'],
    data: { allowSameDay: true, noticeDays: 0, isPaid: true },
  },
  {
    codes: ['CL', 'CASUAL'],
    data: { allowSameDay: false, noticeDays: 2, isPaid: true },
  },
  {
    codes: ['PL', 'PRIVILEGE', 'PRIVILEGED'],
    data: { allowSameDay: false, noticeDays: 2, isPaid: true },
  },
  {
    codes: ['LWP', 'LEAVE_WITHOUT_PAY'],
    data: { allowSameDay: true, noticeDays: 0, isPaid: false },
  },
];

async function main() {
  console.log('🔧  Patching leave type policies...\n');

  for (const patch of PATCHES) {
    const types = await prisma.leaveType.findMany({
      where: { code: { in: patch.codes } },
      select: { id: true, name: true, code: true, organizationId: true, allowSameDay: true, noticeDays: true, isPaid: true },
    });

    if (types.length === 0) {
      console.log(`⚠️   No leave types found for codes: ${patch.codes.join(', ')} — skipping`);
      continue;
    }

    for (const lt of types) {
      await prisma.leaveType.update({
        where: { id: lt.id },
        data: patch.data,
      });
      console.log(
        `✅  [${lt.code}] ${lt.name}` +
        `  allowSameDay: ${lt.allowSameDay} → ${patch.data.allowSameDay}` +
        `  noticeDays: ${lt.noticeDays} → ${patch.data.noticeDays}` +
        (patch.data.isPaid !== undefined ? `  isPaid: ${lt.isPaid} → ${patch.data.isPaid}` : '')
      );
    }
  }

  console.log('\n✅  Done. All leave type policies patched.');
}

main()
  .catch((e) => { console.error('❌  Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
