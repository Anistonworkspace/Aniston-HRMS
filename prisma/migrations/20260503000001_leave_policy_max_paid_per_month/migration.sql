-- AlterTable: add maxPaidLeavesPerMonth to LeavePolicy
ALTER TABLE "LeavePolicy" ADD COLUMN IF NOT EXISTS "maxPaidLeavesPerMonth" INTEGER NOT NULL DEFAULT 0;
