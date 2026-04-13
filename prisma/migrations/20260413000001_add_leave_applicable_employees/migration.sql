-- Add specific employee targeting to LeaveType
-- If applicableToEmployeeIds is set (JSON array), ONLY those employees see/can apply the leave.
-- This overrides applicableTo (status) and applicableToRole (role) filters.
ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "applicableToEmployeeIds" TEXT;
