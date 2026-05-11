-- GPS v1.5.5 tracking fields — add missing enum values and GPSTrailPoint.source column.
-- These were previously applied to dev DB via `db push` only.
-- This migration makes them safe for `prisma migrate deploy` on production.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL.
-- All ADD VALUE statements must be outside BEGIN/COMMIT blocks.

ALTER TYPE "AnomalyType" ADD VALUE IF NOT EXISTS 'GPS_HEARTBEAT_MISSED';
ALTER TYPE "AnomalyType" ADD VALUE IF NOT EXISTS 'GPS_GAP';
ALTER TYPE "AnomalyType" ADD VALUE IF NOT EXISTS 'GPS_SIGNAL_LOST';

-- Add source column to GPSTrailPoint for offline_sync vs realtime differentiation
ALTER TABLE "GPSTrailPoint" ADD COLUMN IF NOT EXISTS "source" TEXT;
