-- CreateTable
CREATE TABLE "LeaveConditionMessage" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveConditionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveConditionMessage_leaveRequestId_idx" ON "LeaveConditionMessage"("leaveRequestId");

-- CreateIndex
CREATE INDEX "LeaveConditionMessage_organizationId_idx" ON "LeaveConditionMessage"("organizationId");

-- AddForeignKey
ALTER TABLE "LeaveConditionMessage" ADD CONSTRAINT "LeaveConditionMessage_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
