-- Leave Policy Engine Migration
-- Adds per-category allocation rules, prorata support, and allocation audit log

-- 1. Enhance LeavePolicy with duration settings
ALTER TABLE "LeavePolicy" ADD COLUMN IF NOT EXISTS "probationDurationMonths" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "LeavePolicy" ADD COLUMN IF NOT EXISTS "internDurationMonths" INTEGER NOT NULL DEFAULT 3;

-- 2. Enhance LeavePolicyRule with per-category allocation fields
ALTER TABLE "LeavePolicyRule" ADD COLUMN IF NOT EXISTS "employeeCategory" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "LeavePolicyRule" ADD COLUMN IF NOT EXISTS "yearlyDays" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "LeavePolicyRule" ADD COLUMN IF NOT EXISTS "monthlyDays" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "LeavePolicyRule" ADD COLUMN IF NOT EXISTS "accrualType" TEXT NOT NULL DEFAULT 'UPFRONT';
ALTER TABLE "LeavePolicyRule" ADD COLUMN IF NOT EXISTS "isProrata" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeavePolicyRule" ALTER COLUMN "daysAllowed" SET DEFAULT 0;

-- Seed yearlyDays from legacy daysAllowed where yearlyDays is 0
UPDATE "LeavePolicyRule" SET "yearlyDays" = "daysAllowed" WHERE "yearlyDays" = 0 AND "daysAllowed" > 0;

-- Drop old unique constraint, recreate with employeeCategory included
DROP INDEX IF EXISTS "LeavePolicyRule_policyId_leaveTypeId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "LeavePolicyRule_policyId_leaveTypeId_employeeCategory_key"
  ON "LeavePolicyRule"("policyId", "leaveTypeId", "employeeCategory");

-- 3. Create LeaveAllocationLog for audit trail
CREATE TABLE IF NOT EXISTS "LeaveAllocationLog" (
  "id"               TEXT NOT NULL,
  "employeeId"       TEXT NOT NULL,
  "leaveTypeId"      TEXT NOT NULL,
  "policyId"         TEXT,
  "year"             INTEGER NOT NULL,
  "allocationType"   TEXT NOT NULL,
  "days"             DOUBLE PRECISION NOT NULL,
  "previousDays"     DOUBLE PRECISION,
  "reason"           TEXT,
  "calculationBasis" JSONB,
  "changedBy"        TEXT,
  "organizationId"   TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveAllocationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeaveAllocationLog_employeeId_year_idx"
  ON "LeaveAllocationLog"("employeeId", "year");
CREATE INDEX IF NOT EXISTS "LeaveAllocationLog_organizationId_idx"
  ON "LeaveAllocationLog"("organizationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveAllocationLog_employeeId_fkey') THEN
    ALTER TABLE "LeaveAllocationLog"
      ADD CONSTRAINT "LeaveAllocationLog_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveAllocationLog_leaveTypeId_fkey') THEN
    ALTER TABLE "LeaveAllocationLog"
      ADD CONSTRAINT "LeaveAllocationLog_leaveTypeId_fkey"
      FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveAllocationLog_organizationId_fkey') THEN
    ALTER TABLE "LeaveAllocationLog"
      ADD CONSTRAINT "LeaveAllocationLog_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeaveAllocationLog_policyId_fkey') THEN
    ALTER TABLE "LeaveAllocationLog"
      ADD CONSTRAINT "LeaveAllocationLog_policyId_fkey"
      FOREIGN KEY ("policyId") REFERENCES "LeavePolicy"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Safe data migration: deactivate duplicate probation leave types
--    and point their historical requests to the canonical type.
--    We match by code prefix: "CL (P)", "SL (P)", etc.
--    Runs only if duplicates exist — safe to run multiple times.

DO $$
DECLARE
  r RECORD;
  canonical_id TEXT;
BEGIN
  -- For each org, find probation-variant leave types and migrate requests
  FOR r IN
    SELECT lt.id as dup_id, lt.code as dup_code, lt."organizationId"
    FROM "LeaveType" lt
    WHERE lt."isActive" = true
      AND (
        lt.name ILIKE '%(probation)%'
        OR lt.name ILIKE '%probation%'
        OR lt.code ILIKE '%(P)'
        OR lt.code ILIKE '%_P'
      )
  LOOP
    -- Find canonical leave type (same org, same base code without (P) suffix)
    -- e.g. 'CL (P)' → look for 'CL'
    SELECT id INTO canonical_id
    FROM "LeaveType"
    WHERE "organizationId" = r."organizationId"
      AND "isActive" = true
      AND id != r.dup_id
      AND (
        code = regexp_replace(r.dup_code, '\s*[\(\[]?[Pp]\)?.*$', '')
        OR code = split_part(r.dup_code, ' ', 1)
      )
    LIMIT 1;

    IF canonical_id IS NOT NULL THEN
      -- Re-point leave requests to canonical type
      UPDATE "LeaveRequest"
        SET "leaveTypeId" = canonical_id
        WHERE "leaveTypeId" = r.dup_id;

      -- Re-point leave balances: merge used/pending into canonical balance if exists
      UPDATE "LeaveBalance" canonical_bal
        SET used = canonical_bal.used + dup.used,
            pending = canonical_bal.pending + dup.pending
        FROM "LeaveBalance" dup
        WHERE dup."leaveTypeId" = r.dup_id
          AND canonical_bal."leaveTypeId" = canonical_id
          AND canonical_bal."employeeId" = dup."employeeId"
          AND canonical_bal.year = dup.year;

      -- Delete now-redundant duplicate balances
      DELETE FROM "LeaveBalance" WHERE "leaveTypeId" = r.dup_id;

      -- Deactivate duplicate leave type (don't delete — preserve audit trail)
      UPDATE "LeaveType" SET "isActive" = false WHERE id = r.dup_id;

      RAISE NOTICE 'Migrated % → % for org %', r.dup_code, canonical_id, r."organizationId";
    END IF;
  END LOOP;
END $$;
