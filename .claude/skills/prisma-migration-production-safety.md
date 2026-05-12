---
name: prisma-migration-production-safety
description: "Skill for safe Prisma schema changes and production migrations: expand-contract pattern, backup strategy, rollback plan, enum sync, index design"
type: skill
---

# Prisma Migration Production Safety Skill — Aniston HRMS

## When to Use
Use when asked to:
- Add a new field or model to the schema
- Change an existing field type
- Add an enum value
- Remove a field or model
- Fix missing indexes
- Audit migration safety

## Core Safety Principle: Expand-Contract
Never make a breaking schema change in a single deploy. Use two-phase:

**Phase 1 (Expand)**: Add the new thing without removing the old
- New nullable columns: safe (old code ignores them)
- New tables: safe (old code doesn't use them)
- New enum values: safe (old code ignores unknown values)
- New indexes: safe (old code benefits automatically)

**Phase 2 (Contract)**: Remove the old thing after new code is stable
- Remove old column: safe ONLY after all code that uses it is deployed and confirmed
- Remove old enum value: safe ONLY after no code references it

## Adding a New Model
```prisma
// SAFE to add at any time
model NewModel {
  id             String    @id @default(uuid())
  organizationId String
  name           String
  description    String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime?
  
  organization   Organization @relation(fields: [organizationId], references: [id])
  
  @@index([organizationId])
  @@index([organizationId, createdAt])
}
```

After adding: `npx prisma generate` (dev) or `npx prisma migrate dev --name add_new_model` (creates migration file)

## Adding a New Field to Existing Model

### Safe (nullable or with default):
```prisma
// SAFE — nullable field, old code unaffected
newField String?

// SAFE — field with default, existing rows get default value
status   String @default("PENDING")
```

### Dangerous (requires data migration):
```prisma
// DANGEROUS — fails if any existing row has null
requiredField String  // NOT NULL without default

// FIX: add as nullable first, migrate data, then make required in next deploy
requiredField String?  // Phase 1
requiredField String   // Phase 2 (after data migration)
```

## Adding Enum Values
In `prisma/schema.prisma`:
```prisma
enum LeaveStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
  WITHDRAWN
  NEW_STATUS  // Add here
}
```

In `shared/src/enums.ts`:
```typescript
export enum LeaveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  WITHDRAWN = 'WITHDRAWN',
  NEW_STATUS = 'NEW_STATUS',  // Add here — must match exactly
}
```

Run: `npx prisma generate` to update client types.

## Index Design Patterns for HRMS

### Always add index on organizationId:
```prisma
@@index([organizationId])
```

### Add compound indexes for common query patterns:
```prisma
// Attendance: daily lookup
@@index([employeeId, date])
@@index([organizationId, date])

// Leave: by status and org
@@index([organizationId, status])
@@index([organizationId, employeeId])

// Payroll: monthly lookup
@@index([organizationId, month, year])

// Notifications: unread count
@@index([userId, isRead])
@@index([organizationId, userId])
```

### Unique constraints for business rules:
```prisma
// One attendance record per employee per day
@@unique([employeeId, date])

// One payroll per employee per month
@@unique([employeeId, month, year])

// One MFA config per user
@@unique([userId])
```

## Production Migration Commands
```bash
# DEV: create migration and apply
npx prisma migrate dev --name descriptive_name

# PRODUCTION: apply pending migrations (NEVER dev or push)
DATABASE_URL=$PROD_DB_URL npx prisma migrate deploy

# Check status
DATABASE_URL=$PROD_DB_URL npx prisma migrate status

# NEVER in production:
# npx prisma db push
# npx prisma migrate dev
# npx prisma migrate reset
```

## Pre-Migration Backup
```bash
# Always backup before migration
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
PGPASSWORD=$DB_PASSWORD pg_dump \
  -h $DB_HOST \
  -U $DB_USER \
  -d $DB_NAME \
  --no-password \
  > $BACKUP_FILE

# Verify backup
wc -l $BACKUP_FILE  # Should be > 0

# Upload to S3
aws s3 cp $BACKUP_FILE s3://aniston-hrms-backups/pre-migration/
```

## Rollback Pattern
```bash
# If migration breaks something:
# 1. Restore from backup
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER $DB_NAME < backup_TIMESTAMP.sql

# 2. Mark migration as rolled back (if it partially ran)
DATABASE_URL=$PROD_DB_URL npx prisma migrate resolve --rolled-back MIGRATION_NAME

# 3. Deploy previous code version
```

## Danger Check Before Any Migration
Ask these questions:
1. Does this drop a column? → Backup required, confirm code no longer uses it
2. Does this add NOT NULL without default? → Data migration required first
3. Does this change a column type? → Verify no data will truncate/fail
4. Does this remove an enum value? → Verify no rows use this value
5. Does this change a foreign key behavior? → Verify downstream effects