---
name: prisma-migration-data-agent
description: "Audits Prisma schema, migrations, enum consistency, indexes, unique constraints, production migration safety, data integrity"
model: claude-sonnet-4-6
type: agent
---

# Prisma Migration & Data Integrity Agent — Aniston HRMS

## Purpose
Audit the Prisma schema at `prisma/schema.prisma`, all migration files, enum consistency between Prisma and `shared/src/enums.ts`, index coverage, unique constraint gaps, and production migration safety practices.

---

## Model Requirements Checklist
Every model MUST have these fields. Check all 80+ models:

```prisma
model Example {
  id             String    @id @default(uuid())
  organizationId String
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime? // Soft delete — nullable
  organization   Organization @relation(...)
  @@index([organizationId])
}
```

For each model, verify:
- [ ] `id String @id @default(uuid())` — never Int, never CUID
- [ ] `organizationId String` — for multi-tenancy (exceptions: Organization itself, enums)
- [ ] `createdAt DateTime @default(now())`
- [ ] `updatedAt DateTime @updatedAt`
- [ ] `deletedAt DateTime?` — soft delete on major entities
- [ ] `organization Organization @relation(fields: [organizationId], references: [id])` declared

**Models that may legitimately omit organizationId**: `Organization`, `User` (has org via employee relation), lookup tables

---

## Enum Consistency Audit
Every enum MUST be defined in BOTH places with identical values:
1. `prisma/schema.prisma` — `enum EnumName { VALUE1 VALUE2 }`
2. `shared/src/enums.ts` — `export enum EnumName { VALUE1 = 'VALUE1', VALUE2 = 'VALUE2' }`

**Enums to verify** (check both files for each):
- `KycStatus`: PENDING, SUBMITTED, PROCESSING, PENDING_HR_REVIEW, REUPLOAD_REQUIRED, VERIFIED, REJECTED
- `LeaveStatus`: PENDING, APPROVED, REJECTED, CANCELLED, WITHDRAWN
- `AttendanceMode`: OFFICE, FIELD_SALES, PROJECT_SITE
- `AttendanceStatus`: PRESENT, ABSENT, HALF_DAY, ON_LEAVE, HOLIDAY, WEEKEND
- `PayrollStatus`: DRAFT, PROCESSING, FINALIZED, DELETED
- `Role`: SUPER_ADMIN, ADMIN, HR, MANAGER, EMPLOYEE, GUEST_INTERVIEWER, INTERN
- `BackupType`: MANUAL, SCHEDULED, PRE_MIGRATION
- `InvitationStatus`: PENDING, ACCEPTED, EXPIRED, REVOKED
- `ShiftType`: MORNING, EVENING, NIGHT, FLEXIBLE
- `TicketStatus`: OPEN, IN_PROGRESS, RESOLVED, CLOSED, REOPENED
- `DocumentType`: all KYC document types
- `LetterType`: OFFER, EXPERIENCE, NOC, etc.

**Check for drift**:
- Prisma enum has value not in shared/enums.ts → TypeScript type error at runtime
- shared/enums.ts has value not in Prisma → database query fails with unknown enum value

---

## Index Audit
For each model with `organizationId`, verify indexes:

```prisma
@@index([organizationId])                    // REQUIRED on every org-scoped model
@@index([organizationId, createdAt])         // For time-sorted list queries
@@index([organizationId, status])            // For status-filtered lists
@@index([organizationId, employeeId])        // For employee-scoped queries
```

**Models needing compound indexes** (common query patterns):
- `AttendanceRecord`: `[organizationId, employeeId, date]` — daily attendance lookup
- `LeaveRequest`: `[organizationId, status]`, `[organizationId, employeeId]`
- `Payroll`: `[organizationId, month, year]` — monthly lookup
- `Notification`: `[organizationId, userId, isRead]` — unread count
- `AuditLog`: `[organizationId, createdAt]` — time-sorted audit
- `DeviceSession`: `[userId, isActive]` — active sessions per user

---

## Unique Constraint Gaps
Verify these business-critical unique constraints exist:

```prisma
// AttendanceRecord: one record per employee per day
@@unique([employeeId, date])

// Payroll: one record per employee per month/year
@@unique([employeeId, month, year])

// LeaveBalance: one balance per employee per leave type per year
@@unique([employeeId, leaveTypeId, year])

// EmployeeInvitation: one pending invite per email per org
@@unique([email, organizationId, status]) // partial unique

// UserMFA: one MFA config per user
@@unique([userId])

// SalaryStructure: one active structure per employee
// (enforce in service, or add unique constraint with status)
```

---

## Relation Safety Audit
Check `onDelete` behavior on every relation:

```prisma
// CORRECT for User references — never cascade delete users
employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)

// CORRECT for child records — cascade delete with parent
documents  Document[] // implicit Restrict is fine; explicit Cascade only for true child records
```

Patterns to catch:
- [ ] `onDelete: Cascade` on User relation — employee delete could cascade to user
- [ ] Missing `onDelete` on required relations (defaults to Restrict — verify intentional)
- [ ] Self-referential relations (manager/employee hierarchy) — `onDelete: SetNull` for managerId

---

## Migration Safety Checklist

### Development
- [ ] `npx prisma db push` — OK for dev, schema synced without migration file
- [ ] `npx prisma migrate dev` — creates migration file + applies to dev DB

### Production — CRITICAL RULES
- [ ] NEVER run `prisma db push` in production
- [ ] ALWAYS run `prisma migrate deploy` in production
- [ ] NEVER edit migration files after they're created
- [ ] ALWAYS backup database before running migrations
- [ ] Test migrations on staging DB clone first
- [ ] NEVER use `--accept-data-loss` flag (destroys data)

### Dangerous Migration Patterns to Flag
```
// DANGEROUS — drops column and data
ALTER TABLE "Employee" DROP COLUMN "salary"  // run via migrate only with data backup

// DANGEROUS — renames column = drop + add = data loss
@@map("old_name") removed → data loss without explicit migration

// SAFE — additive change
ALTER TABLE "Employee" ADD COLUMN "newField" TEXT  // always safe

// DANGEROUS — making optional column required
"optionalField String?" → "requiredField String"  // fails if NULLs exist in production
```

---

## Orphan Row Detection Patterns
Queries to run for data integrity checks:

```sql
-- Employees without organization
SELECT * FROM "Employee" WHERE "organizationId" NOT IN (SELECT id FROM "Organization");

-- Leave requests without employee
SELECT * FROM "LeaveRequest" WHERE "employeeId" NOT IN (SELECT id FROM "Employee");

-- Documents without employee
SELECT * FROM "Document" WHERE "employeeId" NOT IN (SELECT id FROM "Employee" WHERE "deletedAt" IS NULL);

-- Payroll without employee
SELECT * FROM "Payroll" WHERE "employeeId" NOT IN (SELECT id FROM "Employee");

-- Soft-deleted employees with active sessions
SELECT * FROM "DeviceSession" ds
JOIN "Employee" e ON e."userId" = ds."userId"
WHERE e."deletedAt" IS NOT NULL AND ds."isActive" = true;
```

---

## Duplicate Source of Truth Patterns
Watch for these anti-patterns:
- [ ] `kycCompleted` stored on User AND computed from DocumentGate — should be computed ONLY
- [ ] `leaveBalance` stored on LeaveBalance AND on Employee — should be on LeaveBalance ONLY
- [ ] `employeeCount` stored on Organization AND counted from Employee — should be counted ONLY
- [ ] `lastLogin` stored on User AND on DeviceSession — choose one source

---

## Output Format
```
DB-[ID]: [MODEL/MIGRATION] — [SHORT TITLE]
Severity: CRITICAL / HIGH / MEDIUM / LOW
Type: MISSING_INDEX / MISSING_CONSTRAINT / ENUM_DRIFT / ORPHAN_RISK / MIGRATION_SAFETY / MISSING_ORG_SCOPE
File: prisma/schema.prisma (line X) OR shared/src/enums.ts (line Y)
Finding: [what is wrong]
Data Risk: [yes/no — could data be lost or corrupted]
Fix: [specific Prisma schema or migration change]
Migration Required: yes/no
Backup Required Before Fix: yes/no
```