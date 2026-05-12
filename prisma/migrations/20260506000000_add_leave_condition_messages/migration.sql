-- CreateTable (IF NOT EXISTS for idempotency — safe to re-run on prod)
CREATE TABLE IF NOT EXISTS "LeaveConditionMessage" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveConditionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS for idempotency)
CREATE INDEX IF NOT EXISTS "LeaveConditionMessage_leaveRequestId_idx" ON "LeaveConditionMessage"("leaveRequestId");
CREATE INDEX IF NOT EXISTS "LeaveConditionMessage_organizationId_idx" ON "LeaveConditionMessage"("organizationId");

-- AddForeignKey (only add if constraint does not already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'LeaveConditionMessage_leaveRequestId_fkey'
  ) THEN
    ALTER TABLE "LeaveConditionMessage"
      ADD CONSTRAINT "LeaveConditionMessage_leaveRequestId_fkey"
      FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
