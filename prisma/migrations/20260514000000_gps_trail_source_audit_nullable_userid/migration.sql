-- Migration: gps_trail_source_audit_nullable_userid
-- Adds source column to GPSTrailPoint (fixes 400 errors on all GPS trail uploads)
-- Makes AuditLog.userId nullable (fixes 2651/day FK constraint violations)

-- 1. Add source column to GPSTrailPoint
ALTER TABLE "GPSTrailPoint" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'realtime';

-- 2. Make AuditLog.userId nullable (was NOT NULL, causing FK violations for system events)
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
