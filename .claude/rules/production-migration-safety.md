---
name: production-migration-safety
type: rule
applies_to: ["database", "migration", "prisma", "deploy"]
---

# Production Migration Safety Rules — Aniston HRMS

## Absolute Rules (Never Violate)

### Never in Production
- NEVER run `prisma db push` in production — it bypasses migration tracking
- NEVER run `prisma migrate dev` in production — it may create new migrations unexpectedly
- NEVER use `--accept-data-loss` flag in any environment without explicit data backup
- NEVER edit migration files after they have been applied to any environment
- NEVER drop columns or tables without verifying no code references them first

### Always Before Migration
- ALWAYS create a full database backup before running any migration in production
- ALWAYS test migration on staging DB clone first (restore prod backup to staging, run migration)
- ALWAYS verify migration is backward-compatible (old code can run against new schema)
- ALWAYS have a rollback plan before migrating

## Production Migration Command
```bash
# CORRECT — production deploy
DATABASE_URL=$PROD_DATABASE_URL npx prisma migrate deploy

# WRONG — never in production
npx prisma db push
npx prisma migrate dev
```

## Backward-Compatible Migration Strategy (Expand-Contract Pattern)

### Phase 1: Expand (deploy with backward compat)
- Add new nullable columns (old code ignores them)
- Add new tables (old code doesn't use them)
- Add new indexes (old code benefits automatically)

### Phase 2: Migrate data (after old code is gone)
- Populate new columns from old columns
- Set new columns to required if needed

### Phase 3: Contract (remove old patterns)
- Remove old columns (only after new code is fully deployed and verified)
- Remove old tables

This ensures zero-downtime migrations.

## Dangerous Migration Patterns — Flag and Require Approval
These migration operations require explicit approval and backup before executing:

1. **Column drop**: `ALTER TABLE ... DROP COLUMN` — data permanently lost
2. **Table drop**: `DROP TABLE` — data permanently lost
3. **Column type change**: e.g., `VARCHAR → INT` — may fail or truncate data
4. **Adding NOT NULL without default**: fails if existing rows have NULL
5. **Removing unique constraint**: may introduce duplicates
6. **Changing foreign key behavior**: `Cascade` → `Restrict` may block deletes

For each of the above:
- Backup required: YES
- Staging test required: YES
- Rollback plan required: YES (documented in migration PR)

## Backup Requirements
Before any production migration:
```bash
# Create backup
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U $DB_USER $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql

# Store backup in S3 or equivalent
aws s3 cp backup_*.sql s3://aniston-hrms-backups/pre-migration/

# Verify backup is complete (check file size > 0)
ls -la backup_*.sql
```

Backup must be:
- Stored in S3 or external storage (not only on the same EC2 instance)
- Verified before migration starts
- Retained for minimum 30 days after migration

## Migration Rollback Procedure
```bash
# 1. Restore database from backup
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER $DB_NAME < backup_TIMESTAMP.sql

# 2. Mark migration as rolled back (if needed)
DATABASE_URL=$PROD_DATABASE_URL npx prisma migrate resolve --rolled-back MIGRATION_NAME

# 3. Verify database state
npx prisma migrate status
```

## CI/CD Migration Gate
In `.github/workflows/deploy.yml`:
```yaml
- name: Run database migrations
  run: npx prisma migrate deploy
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  # This step MUST run BEFORE pm2 reload
  # This step MUST run AFTER database backup
```

The migration MUST succeed before the application is reloaded. If migration fails:
- PM2 reload is NOT triggered
- Deploy is marked as failed
- Previous app version continues running (still compatible with old schema)

## Dev/Staging Commands (Safe to Use)
```bash
npm run db:generate   # Safe — regenerates Prisma client after schema change
npm run db:push       # Safe for DEV only — syncs schema without migration file
npm run db:migrate    # Safe for DEV only — creates + applies migration
npm run db:studio     # Safe — read-only GUI browser
```