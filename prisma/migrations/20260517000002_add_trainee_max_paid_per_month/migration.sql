-- Add maxPaidLeavesPerMonthTrainee to LeavePolicy
-- This allows HR to configure a separate monthly paid leave cap for PROBATION and INTERN employees.
ALTER TABLE "LeavePolicy" ADD COLUMN "maxPaidLeavesPerMonthTrainee" INTEGER NOT NULL DEFAULT 0;
