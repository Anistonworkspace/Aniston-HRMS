-- ============================================================
-- Migration: attendance_shift_snapshot_and_indexes
-- Date: 2026-05-03
-- Purpose:
--   P2-A: Snapshot the active Shift and ShiftAssignment at clock-in time.
--         Plain UUID columns (no FK constraint) so historical records
--         are preserved even if the Shift/ShiftAssignment row is later deleted.
--   P2-B: Add missing indexes on ShiftAssignment for overlap queries.
-- ============================================================

-- P2-A: Add shift snapshot columns to AttendanceRecord (nullable — old rows stay null)
ALTER TABLE "AttendanceRecord"
  ADD COLUMN IF NOT EXISTS "shiftId"           TEXT,
  ADD COLUMN IF NOT EXISTS "shiftAssignmentId" TEXT;

-- P2-A: Indexes on new snapshot columns (used by payroll/compliance reports)
CREATE INDEX IF NOT EXISTS "AttendanceRecord_shiftId_idx"
  ON "AttendanceRecord" ("shiftId");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_shiftAssignmentId_idx"
  ON "AttendanceRecord" ("shiftAssignmentId");

-- P2-B: Missing ShiftAssignment indexes for overlap detection and range queries
CREATE INDEX IF NOT EXISTS "ShiftAssignment_employeeId_endDate_idx"
  ON "ShiftAssignment" ("employeeId", "endDate");

CREATE INDEX IF NOT EXISTS "ShiftAssignment_employeeId_startDate_endDate_idx"
  ON "ShiftAssignment" ("employeeId", "startDate", "endDate");
