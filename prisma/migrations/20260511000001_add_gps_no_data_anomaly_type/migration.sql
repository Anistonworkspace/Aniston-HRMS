-- Add GPS_NO_DATA to AnomalyType enum
-- This value was present in shared/src/enums.ts but missing from schema.prisma

ALTER TYPE "AnomalyType" ADD VALUE IF NOT EXISTS 'GPS_NO_DATA';
