-- Add allowUnpaidLeave toggle to LeavePolicy
ALTER TABLE "LeavePolicy" ADD COLUMN IF NOT EXISTS "allowUnpaidLeave" BOOLEAN NOT NULL DEFAULT true;

-- Add paidDays / unpaidDays split tracking to LeaveRequest
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "paidDays" DECIMAL(4,1) NOT NULL DEFAULT 0;
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "unpaidDays" DECIMAL(4,1) NOT NULL DEFAULT 0;
