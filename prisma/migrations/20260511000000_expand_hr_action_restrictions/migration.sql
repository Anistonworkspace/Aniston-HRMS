-- Add new HR action restriction columns to HRActionRestriction table
-- Using ADD COLUMN IF NOT EXISTS for idempotency on re-deploy

ALTER TABLE "HRActionRestriction"
  ADD COLUMN IF NOT EXISTS "canHRRunPayroll" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHREditSalary" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRViewPayroll" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRAddPayrollAdjustment" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRExportAttendance" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRResolveRegularization" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRSetHybridSchedule" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRManageKYC" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRManageExit" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "canHRResetPassword" BOOLEAN NOT NULL DEFAULT true;

-- Also ensure ShiftChangeRequest and HRActionRestriction tables exist (from previous session)
-- These are created by db:push but may need the migration marker for prod deploy
