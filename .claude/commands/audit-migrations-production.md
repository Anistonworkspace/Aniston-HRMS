---
name: audit-migrations-production
description: "Audit Prisma schema, migration files, enum consistency, index coverage, and production migration safety"
---

# Migration & Production Safety Audit — Aniston HRMS

Use `prisma-migration-data-agent` with `production-migration-safety.md` and `database.md` rules.

## Step 1: Schema Completeness
Read `prisma/schema.prisma`. For every model, verify:
- [ ] `id String @id @default(uuid())`
- [ ] `organizationId String` (except Organization model itself)
- [ ] `createdAt DateTime @default(now())`
- [ ] `updatedAt DateTime @updatedAt`
- [ ] `deletedAt DateTime?` on major entities

List all models that FAIL this check.

## Step 2: Enum Consistency
Read `shared/src/enums.ts` and `prisma/schema.prisma`.
For EVERY enum in Prisma, verify it exists in shared/enums.ts with IDENTICAL values.
For EVERY enum in shared/enums.ts, verify it exists in Prisma schema.

List any enum values that exist in one place but not the other (drift).

## Step 3: Index Coverage
For the following query patterns, verify corresponding indexes exist in schema:

1. Attendance: `WHERE employeeId = X AND date BETWEEN Y AND Z`
   Needs: `@@index([employeeId, date])`

2. Leave: `WHERE organizationId = X AND status = Y`
   Needs: `@@index([organizationId, status])`

3. Payroll: `WHERE organizationId = X AND month = Y AND year = Z`
   Needs: `@@index([organizationId, month, year])`

4. Notification: `WHERE userId = X AND isRead = false`
   Needs: `@@index([userId, isRead])`

5. DeviceSession: `WHERE userId = X AND isActive = true`
   Needs: `@@index([userId, isActive])`

6. Document: `WHERE employeeId = X AND deletedAt IS NULL`
   Needs: `@@index([employeeId])` + filtered index behavior via Prisma

## Step 4: Unique Constraint Audit
Verify these business-critical unique constraints:
- `AttendanceRecord`: `@@unique([employeeId, date])`
- `Payroll`: `@@unique([employeeId, month, year])`
- `LeaveBalance`: `@@unique([employeeId, leaveTypeId, year])`

## Step 5: Migration Files Safety
Check `prisma/migrations/` directory:
- [ ] Migration files are NOT modified after creation (check git history)
- [ ] Each migration has a corresponding SQL file
- [ ] No migration drops columns without data backup note
- [ ] No migration adds NOT NULL column without default or data migration

## Step 6: CI/CD Migration Safety
Check `.github/workflows/deploy.yml`:
- [ ] Uses `prisma migrate deploy` not `prisma db push`
- [ ] Migration runs BEFORE `pm2 reload`
- [ ] Database backup step exists before migration

## Step 7: Orphan Row Check Queries
Provide SQL queries to check for orphan rows in production:
```sql
-- Employees without organization
SELECT COUNT(*) FROM "Employee" e
WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = e."organizationId");

-- Soft-deleted employees with active device sessions
SELECT e.id, e."employeeCode" FROM "Employee" e
JOIN "User" u ON u.id = e."userId"
JOIN "DeviceSession" ds ON ds."userId" = u.id
WHERE e."deletedAt" IS NOT NULL AND ds."isActive" = true;
```

## Output
Produce findings using DB format from `prisma-migration-data-agent`.
Include:
- Count of models missing required fields
- List of enum drift items
- List of missing indexes
- List of missing unique constraints
- Migration safety verdict: SAFE / NEEDS ATTENTION / CRITICAL