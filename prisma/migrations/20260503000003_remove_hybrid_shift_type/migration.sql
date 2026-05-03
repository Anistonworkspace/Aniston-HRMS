-- Migration: Remove HYBRID from ShiftType enum
-- Strategy: rename old enum → migrate data → create new enum without HYBRID → swap back
-- Safe to re-run: all steps guarded with IF EXISTS / DO $$ checks.

DO $$
BEGIN
  -- Only run if HYBRID still exists in the enum
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ShiftType' AND e.enumlabel = 'HYBRID'
  ) THEN

    -- 1. Migrate any HYBRID shifts to OFFICE before dropping the value
    UPDATE "Shift" SET "shiftType" = 'OFFICE' WHERE "shiftType" = 'HYBRID';

    -- 2. Rename existing enum to a temp name
    ALTER TYPE "ShiftType" RENAME TO "ShiftType_old";

    -- 3. Create new enum without HYBRID
    CREATE TYPE "ShiftType" AS ENUM ('OFFICE', 'FIELD');

    -- 4. Swap the column to use the new enum
    ALTER TABLE "Shift"
      ALTER COLUMN "shiftType" TYPE "ShiftType"
      USING "shiftType"::text::"ShiftType";

    -- 5. Drop the old enum
    DROP TYPE "ShiftType_old";

  END IF;
END $$;
