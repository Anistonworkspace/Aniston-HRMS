-- ============================================================
-- Migration: add_leave_settings_intern_role
-- Adds: INTERN employee status, applicableToRole on LeaveType,
--       allowPastDates, maxAdvanceDays on LeaveType,
--       workingDays on Organization
-- Uses IF NOT EXISTS guards — safe to run on DBs that already
-- have these columns from an earlier prisma db push.
-- ============================================================

-- 1. Add INTERN to EmployeeStatus enum
-- Note: ALTER TYPE ADD VALUE cannot run inside a transaction.
-- Prisma detects this and runs it outside the transaction block.
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'INTERN' AFTER 'PROBATION';

-- 2. Add applicableToRole to LeaveType
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "applicableToRole" TEXT;

-- 3. Add allowPastDates to LeaveType
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "allowPastDates" BOOLEAN NOT NULL DEFAULT false;

-- 4. Add maxAdvanceDays to LeaveType
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "maxAdvanceDays" INTEGER;

-- 5. Add workingDays to Organization
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5,6';
