-- Migration: Fix employeeCode uniqueness to be scoped per organization
-- Previously: global @unique on employeeCode blocked multi-org deployments (Org A's EMP-001 collided with Org B's EMP-001)
-- Now: composite @@unique([organizationId, employeeCode]) — each org has its own namespace

-- Step 1: Drop the global unique constraint
DROP INDEX IF EXISTS "Employee_employeeCode_key";

-- Step 2: Add composite unique index (org-scoped)
CREATE UNIQUE INDEX "Employee_organizationId_employeeCode_key" ON "Employee"("organizationId", "employeeCode");

-- Step 3: Add compound index on (employeeId, date) for AttendanceRecord — speeds up date-range queries
CREATE INDEX IF NOT EXISTS "AttendanceRecord_employeeId_date_idx" ON "AttendanceRecord"("employeeId", "date");
