---
name: audit-logic-state-machines
description: "Audit all business logic and state machine correctness across every HRMS module"
---

# Logic & State Machine Audit — Aniston HRMS

Use `logic-analyzer-agent` and `workflow-state-machine-agent` with `logic-analysis-rules.md` and `state-machine-rules.md`.

## Modules to Audit
Run the full checklist for each:

### 1. Attendance State Machine
- File: `backend/src/modules/attendance/attendance.service.ts`
- States: ABSENT | PRESENT | ON_BREAK | CHECKED_OUT | REGULARIZATION_PENDING | REGULARIZED
- Verify: clock-in guard, date boundary (night shift midnight), GPS mode switching
- Check: can employee clock-in twice same day? (duplicate guard)

### 2. Leave State Machine
- File: `backend/src/modules/leave/leave.service.ts`
- States: PENDING | APPROVED | REJECTED | CANCELLED | WITHDRAWN
- Critical check: self-approval guard (`approverId !== requesterId`)
- Critical check: manager team scope on approval
- Check: balance deduction only on APPROVED, not PENDING
- Check: INTERN role leave policy applied correctly

### 3. Payroll State Machine
- File: `backend/src/modules/payroll/payroll.service.ts`
- States: DRAFT | PROCESSING | FINALIZED | DELETED
- Check: EPF/ESI/PT/TDS calculations correct
- Check: PayrollDeletionRequest approval workflow
- Check: re-run idempotency (unique constraint on month/year/employee)

### 4. KYC State Machine
- File: `backend/src/modules/onboarding/document-gate.service.ts`
- States: PENDING | SUBMITTED | PROCESSING | PENDING_HR_REVIEW | REUPLOAD_REQUIRED | VERIFIED | REJECTED
- Critical check: REUPLOAD_REQUIRED sets specific docType, not all docs
- Critical check: re-upload clears specific docType from reuploadDocTypes[]
- Critical check: kycCompleted derived from status, socket event triggers Redux update
- Check: combined PDF extracts all required docs before advancing

### 5. Recruitment State Machine
- File: `backend/src/modules/recruitment/recruitment.service.ts`
- States: APPLIED | SCREENING | INTERVIEW_SCHEDULED | INTERVIEWED | OFFER_SENT | HIRED | REJECTED
- Check: finalization is terminal (HIRED/REJECTED cannot change)
- Check: interview round scores weighted correctly

### 6. Exit/Offboarding State Machine
- File: `backend/src/modules/exit-access/exit-access.service.ts`
- States: INITIATED | CHECKLIST_PENDING | CHECKLIST_COMPLETE | ACCESS_REVOKED | COMPLETED
- Check: ACCESS_REVOKED cannot fire until CHECKLIST_COMPLETE
- Check: all DeviceSessions invalidated on exit

### 7. Helpdesk State Machine
- File: `backend/src/modules/helpdesk/helpdesk.service.ts`
- States: OPEN | IN_PROGRESS | RESOLVED | CLOSED | REOPENED
- Check: requester cannot resolve own ticket
- Check: REOPENED goes to IN_PROGRESS not directly OPEN

### 8. Employee Invitation
- File: `backend/src/modules/invitation/invitation.service.ts`
- States: PENDING | ACCEPTED | EXPIRED | REVOKED
- Check: 72h TTL enforced
- Check: accept is atomic (User + Employee + onboarding created together)
- Check: role from invite record, NOT from request body

## Output Required
For each module:
1. State diagram (text format)
2. List of valid transitions found in code
3. List of missing transitions (in spec but not in code)
4. List of unguarded transitions (no state check before update)
5. Self-approval vulnerability status
6. Race condition risk assessment
7. Severity rating for each finding