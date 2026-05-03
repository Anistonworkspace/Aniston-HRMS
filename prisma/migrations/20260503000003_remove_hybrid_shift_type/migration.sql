-- Migration: Remove HYBRID from ShiftType enum
-- Safe to re-run: guarded by IF EXISTS check.
-- Timeouts prevent hanging if another session holds a lock.
SET lock_timeout = '10s';
SET statement_timeout = '25s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ShiftType' AND e.enumlabel = 'HYBRID'
  ) THEN
    UPDATE "Shift" SET "shiftType" = 'OFFICE' WHERE "shiftType" = 'HYBRID';
    ALTER TYPE "ShiftType" RENAME TO "ShiftType_old";
    CREATE TYPE "ShiftType" AS ENUM ('OFFICE', 'FIELD');
    ALTER TABLE "Shift" ALTER COLUMN "shiftType" DROP DEFAULT;
    ALTER TABLE "Shift" ALTER COLUMN "shiftType" TYPE "ShiftType"
      USING "shiftType"::text::"ShiftType";
    ALTER TABLE "Shift" ALTER COLUMN "shiftType" SET DEFAULT 'OFFICE';
    DROP TYPE "ShiftType_old";
  END IF;
END $$;
