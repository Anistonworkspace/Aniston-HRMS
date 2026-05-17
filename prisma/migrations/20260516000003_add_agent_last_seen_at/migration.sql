-- BUG-002: Add agentLastSeenAt to Employee table.
-- agentPairedAt tracks when the agent first paired (set once in verifyPairCode).
-- agentLastSeenAt tracks the last ping/heartbeat (updated every 2–5 minutes).
-- Separating these prevents agentPairedAt from being overwritten by every heartbeat,
-- which made it impossible to know when an employee actually configured their agent.

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "agentLastSeenAt" TIMESTAMP(3);

-- Backfill: copy agentPairedAt into agentLastSeenAt for employees that already have it.
-- This gives existing deployments accurate last-seen data without losing paired-at history.
UPDATE "Employee" SET "agentLastSeenAt" = "agentPairedAt" WHERE "agentPairedAt" IS NOT NULL AND "agentLastSeenAt" IS NULL;
