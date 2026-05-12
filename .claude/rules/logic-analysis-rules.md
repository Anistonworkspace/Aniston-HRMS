---
name: logic-analysis-rules
type: rule
applies_to: ["logic", "bug-detection", "state-machine", "workflow"]
---

# Logic Analysis Rules — Aniston HRMS

## Core Requirement: Full Flow Tracing
When analyzing any logic bug or workflow, ALWAYS trace the COMPLETE path:
```
UI → RTK Query mutation → API route → middleware → controller → service → Prisma → DB
                                                                              ↓
UI refresh ← RTK tag invalidation ← response ← BullMQ job ← socket emit ← service result
```
Do NOT stop at the service layer. Do NOT stop at the API. Trace all the way to UI state.

## Enum Completeness Rule
For any state machine analysis:
1. List ALL enum values from `shared/src/enums.ts` for the relevant enum
2. Map EVERY value to a handler/transition in the service
3. Flag any enum value with NO handler as a logic gap
4. Verify enum in `shared/src/enums.ts` matches `prisma/schema.prisma` exactly

Example:
```
KycStatus: PENDING | SUBMITTED | PROCESSING | PENDING_HR_REVIEW | REUPLOAD_REQUIRED | VERIFIED | REJECTED
Handler map:
  PENDING → submitDocuments() ✓
  SUBMITTED → startOcrProcessing() ✓
  PROCESSING → completeOcr() ✓
  PENDING_HR_REVIEW → verifyByHr() ✓ | rejectByHr() ✓ | requestReupload() ✓
  REUPLOAD_REQUIRED → resubmitDocument() ✓
  VERIFIED → [terminal] ✓
  REJECTED → [terminal] ✓ — BUT: can HR re-open? If yes, missing transition.
```

## Self-Approval Rule
EVERY approval endpoint MUST be checked for self-approval:
- Leave approval: `approverId !== requesterId`
- Payroll deletion approval: `approverId !== requestedById`
- Employee deletion approval: `approverId !== targetEmployeeId`
- Any "manager approves" flow: manager cannot approve their own requests

If self-approval check is missing → flag as CRITICAL logic bug.

## Race Condition Checklist
For every multi-step operation, verify atomicity:
- Leave apply + balance check: wrapped in `prisma.$transaction()`?
- Payroll run for same month: unique constraint on `(employeeId, month, year)` prevents duplicate?
- KYC submit: idempotent if submitted twice? (check current status before transitioning)
- Attendance clock-in: unique constraint on `(employeeId, date)` prevents double clock-in?
- Token refresh: what happens if two requests refresh simultaneously?

## Clock-In/Out Boundary Rule
Always verify date boundary behavior:
- Night shift employee: shift spans midnight — which date is the attendance record?
- Late clock-out: clock-out after midnight — attribute to previous day or current day?
- Timezone: all times stored as UTC, displayed in org's timezone?

## BullMQ Deduplication Rule
For every cron/queue:
- Payroll cron: must use `jobId` to prevent duplicate runs
- Email worker: must be started once per process (not per request)
- Repeat jobs: `repeat: { pattern: '0 0 * * *' }` must have `jobId` set

## Missing Edge Cases Checklist
For every service method, ask:
1. What happens if the resource doesn't exist? (404)
2. What happens if it's soft-deleted? (filter `deletedAt: null`)
3. What happens if wrong org? (403 or 404)
4. What happens if the state is wrong for this action? (400 BadRequest)
5. What happens if a required related record doesn't exist? (400 or auto-create)
6. What if the user is the INTERN role — does the code handle INTERN differently from EMPLOYEE?

## Output Rule
Every logic finding MUST include:
- The exact service method name where the bug exists
- The exact Prisma model and field involved
- Whether a DB migration is needed to fix it
- A one-line test case to reproduce: `POST /api/leaves with managerId === employeeId → expect 403`