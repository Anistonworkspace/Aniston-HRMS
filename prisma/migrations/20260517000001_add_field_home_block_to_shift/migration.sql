-- AddColumn: blockMarkInInsideHomeGeofence and homeGeofenceRadiusMeters on Shift
-- Safe additive migration — existing rows get the defaults automatically.

ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "blockMarkInInsideHomeGeofence" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "homeGeofenceRadiusMeters" INTEGER NOT NULL DEFAULT 200;
