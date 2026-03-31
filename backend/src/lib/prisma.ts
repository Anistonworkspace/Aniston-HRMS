import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// =====================
// SOFT DELETE EXTENSION
// =====================
// Models with `deletedAt` field: Employee, Department, Designation, Document
// Using Prisma Client Extensions (v5+) for soft delete support.
//
// NOTE: The global middleware approach ($use) is deprecated in Prisma v5.
// Instead, soft delete filtering is handled at the service layer via
// `deletedAt: null` in WHERE clauses (already applied consistently in all services).
// This file keeps Prisma vanilla — no extension required — because
// all read queries already filter `deletedAt: null` and all delete
// operations already use `update({ deletedAt: new Date() })` in services.
//
// The backup scripts + soft delete at the service layer provide full protection:
// - No data is ever hard-deleted (soft delete in services)
// - Pre-deploy database backup captures all data including soft-deleted
// - Upload files are backed up before every deployment
//
// If you need global middleware in the future, use Prisma Client Extensions:
// const prisma = basePrisma.$extends({ ... })

export const prisma = basePrisma;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
