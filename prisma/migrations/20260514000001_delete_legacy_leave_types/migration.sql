-- Delete all leave types that were created before the HR-managed-only refactor.
-- These have legacy applicableTo values (ALL, ACTIVE, PROBATION, CONFIRMED, etc.)
-- that no longer exist in the validation layer.
-- HR will create fresh leave types from Leave Management → Types tab.
-- This migration is idempotent: if no legacy types exist, it's a no-op.

-- 1. Remove leave balances referencing legacy leave types first (FK constraint)
DELETE FROM "LeaveBalance"
WHERE "leaveTypeId" IN (
  SELECT id FROM "LeaveType"
  WHERE "applicableTo" NOT IN ('ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE')
);

-- 2. Remove leave policy rules referencing legacy leave types
DELETE FROM "LeavePolicyRule"
WHERE "leaveTypeId" IN (
  SELECT id FROM "LeaveType"
  WHERE "applicableTo" NOT IN ('ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE')
);

-- 3. Now delete the legacy leave types themselves
DELETE FROM "LeaveType"
WHERE "applicableTo" NOT IN ('ACTIVE_ONLY', 'TRAINEE_ONLY', 'ALL_ELIGIBLE');

-- 4. Also update the schema default for applicableTo to match current validation
ALTER TABLE "LeaveType" ALTER COLUMN "applicableTo" SET DEFAULT 'ACTIVE_ONLY';
