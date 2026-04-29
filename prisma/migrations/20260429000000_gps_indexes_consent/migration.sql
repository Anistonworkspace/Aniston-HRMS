-- ============================================================
-- Migration: gps_indexes_consent
-- Date: 2026-04-29
-- Purpose:
--   1. Add compound index on GPSTrailPoint for HR trail queries
--      (eliminates full-table-scan at scale with 100+ field employees)
--   2. Add employeeId+timestamp index for duplicate detection
--   3. Add GPS location-tracking consent fields to Employee
--      (required for DPDP Act 2023 compliance — field sales employees)
-- ============================================================

-- 1. Compound GPS trail query index
--    Used by: getGPSTrail(employeeId, date) with org-scope check
--    Eliminates full-table-scan; critical when GPSTrailPoint exceeds 100k rows
CREATE INDEX IF NOT EXISTS "GPSTrailPoint_organizationId_employeeId_date_idx"
  ON "GPSTrailPoint" ("organizationId", "employeeId", "date");

-- 2. Timestamp index for duplicate point detection and chronological queries
CREATE INDEX IF NOT EXISTS "GPSTrailPoint_employeeId_timestamp_idx"
  ON "GPSTrailPoint" ("employeeId", "timestamp");

-- 3. GPS consent fields on Employee
--    locationTrackingConsented: true once employee explicitly accepts consent dialog
--    locationTrackingConsentAt: ISO timestamp of acceptance (audit trail)
--    locationTrackingConsentVersion: consent text version (e.g. "v1") for future re-consent on policy changes
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "locationTrackingConsented"        BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "locationTrackingConsentAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "locationTrackingConsentVersion"   TEXT;
