-- Add balance breakdown fields to support policy/manual separation
ALTER TABLE "LeaveBalance" ADD COLUMN IF NOT EXISTS "policyAllocated" DECIMAL(5,1) NOT NULL DEFAULT 0;
ALTER TABLE "LeaveBalance" ADD COLUMN IF NOT EXISTS "manualAdjustment" DECIMAL(5,1) NOT NULL DEFAULT 0;
ALTER TABLE "LeaveBalance" ADD COLUMN IF NOT EXISTS "previousUsed" DECIMAL(5,1) NOT NULL DEFAULT 0;

-- Backfill: policyAllocated = allocated for all existing rows (conservative)
UPDATE "LeaveBalance" SET "policyAllocated" = "allocated" WHERE "policyAllocated" = 0 AND "allocated" > 0;

-- Best-effort: reconstruct manualAdjustment from BALANCE_CORRECTION logs
UPDATE "LeaveBalance" lb
SET "manualAdjustment" = COALESCE((
  SELECT SUM(lal.days)
  FROM "LeaveAllocationLog" lal
  WHERE lal."employeeId" = lb."employeeId"
    AND lal."leaveTypeId" = lb."leaveTypeId"
    AND lal.year = lb.year
    AND lal."allocationType" = 'MANUAL_ADJUSTMENT'
    AND (lal."calculationBasis"->>'adjustmentType' = 'BALANCE_CORRECTION'
      OR lal."calculationBasis"->>'adjustmentType' = 'BALANCE_SET')
), 0);

-- Adjust policyAllocated to reflect that allocated = policyAllocated + manualAdjustment
UPDATE "LeaveBalance"
SET "policyAllocated" = GREATEST(0, "allocated" - "manualAdjustment")
WHERE "manualAdjustment" != 0;

-- Best-effort: reconstruct previousUsed from PREVIOUS_USED logs
UPDATE "LeaveBalance" lb
SET "previousUsed" = COALESCE((
  SELECT SUM(lal.days)
  FROM "LeaveAllocationLog" lal
  WHERE lal."employeeId" = lb."employeeId"
    AND lal."leaveTypeId" = lb."leaveTypeId"
    AND lal.year = lb.year
    AND lal."allocationType" = 'MANUAL_ADJUSTMENT'
    AND lal."calculationBasis"->>'adjustmentType' = 'PREVIOUS_USED'
    AND lal.days > 0
), 0);
