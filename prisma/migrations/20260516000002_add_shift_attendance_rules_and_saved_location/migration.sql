-- Migration: add_shift_attendance_rules_and_saved_location
-- Adds autoAbsentAfterHours, lateMarkCutoffMinutes, breakDeductionMinutes to Shift
-- Adds lateMarkCutoffMinutes, breakDeductionMinutes to AttendancePolicy
-- Adds isImportant to LocationVisit
-- Creates SavedLocation model

-- Shift: add auto-absent threshold (per-shift override of org policy)
ALTER TABLE "Shift" ADD COLUMN "autoAbsentAfterHours" INTEGER;

-- Shift: add late → absent cutoff (minutes late before forcing ABSENT)
ALTER TABLE "Shift" ADD COLUMN "lateMarkCutoffMinutes" INTEGER;

-- Shift: add break deduction minutes for payroll purposes
ALTER TABLE "Shift" ADD COLUMN "breakDeductionMinutes" INTEGER NOT NULL DEFAULT 0;

-- AttendancePolicy: add late → absent cutoff
ALTER TABLE "AttendancePolicy" ADD COLUMN "lateMarkCutoffMinutes" INTEGER;

-- AttendancePolicy: add break deduction minutes for payroll purposes
ALTER TABLE "AttendancePolicy" ADD COLUMN "breakDeductionMinutes" INTEGER NOT NULL DEFAULT 0;

-- LocationVisit: add isImportant flag
ALTER TABLE "LocationVisit" ADD COLUMN "isImportant" BOOLEAN NOT NULL DEFAULT false;

-- SavedLocation: new model for HR-curated important locations
CREATE TABLE "SavedLocation" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "address"        TEXT,
    "latitude"       DOUBLE PRECISION NOT NULL,
    "longitude"      DOUBLE PRECISION NOT NULL,
    "radiusMeters"   INTEGER NOT NULL DEFAULT 100,
    "isImportant"    BOOLEAN NOT NULL DEFAULT false,
    "category"       TEXT,
    "addedByUserId"  TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedLocation_pkey" PRIMARY KEY ("id")
);

-- SavedLocation: index on organizationId for multi-tenant queries
CREATE INDEX "SavedLocation_organizationId_idx" ON "SavedLocation"("organizationId");

-- SavedLocation: foreign key to Organization (cascade delete)
ALTER TABLE "SavedLocation" ADD CONSTRAINT "SavedLocation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SavedLocation: foreign key to User (restrict delete — cannot delete user if they added locations)
ALTER TABLE "SavedLocation" ADD CONSTRAINT "SavedLocation_addedByUserId_fkey"
    FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
