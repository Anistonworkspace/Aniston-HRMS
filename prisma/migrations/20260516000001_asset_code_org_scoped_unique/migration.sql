-- Migration: asset_code_org_scoped_unique
-- Drop the old global unique constraint on assetCode
-- and replace with a per-organization unique constraint.
-- This allows different organizations to reuse the same asset codes (e.g. LAP-001).

-- Drop old global unique index (safe — no data loss, only constraint change)
DROP INDEX IF EXISTS "Asset_assetCode_key";

-- Add new org-scoped unique index
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_assetCode_organizationId_key"
  ON "Asset"("assetCode", "organizationId");
