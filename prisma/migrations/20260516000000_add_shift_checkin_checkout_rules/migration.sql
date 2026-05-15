-- Add per-shift check-in/checkout rule fields to Shift model
-- All columns are additive with defaults matching the previous hardcoded values
-- so existing shifts behave identically until HR explicitly changes them.

ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "gpsRequiredForMarkIn"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trackingStartsOnCheckIn"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "trackingStopsOnCheckOut"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "singleCheckInPerDay"           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "maxReClockInsPerDay"           INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "earlyCheckInBlockMinutes"      INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "remoteCheckoutAllowedAfterHour" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "gpsAccuracyGateMeters"         INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS "gpsSpoofingDistanceKm"         INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "gpsSpoofingTimeMinutes"        INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "gpsMaxAgeSeconds"              INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "outsideGeofenceAlertEnabled"   BOOLEAN NOT NULL DEFAULT false;
