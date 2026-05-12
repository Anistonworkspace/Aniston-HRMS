import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.holiday.deleteMany({ where: { createdBy: null } });
  console.log(`Deleted ${result.count} auto-seeded holidays`);
}

main()
  .catch((e) => console.log('Holiday cleanup skipped:', e.message))
  .finally(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
