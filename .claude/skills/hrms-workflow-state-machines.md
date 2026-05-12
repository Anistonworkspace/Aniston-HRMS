---
name: hrms-workflow-state-machines
description: "Skill for HRMS workflow state machine analysis: model states, transitions, guards, terminal states, and rollback paths for all HRMS workflows"
type: skill
---

# HRMS Workflow State Machine Skill — Aniston HRMS

## When to Use
Use when asked to:
- Verify a workflow's state machine is correct
- Find missing transitions
- Check for terminal state escape vulnerabilities
- Model a new workflow
- Debug "wrong status" bugs

## State Machine Modeling Approach

### Step 1: Enumerate All States
Read the enum from `shared/src/enums.ts`. Never assume — read the actual file.

### Step 2: Find All Transitions
Search the service file for `update` calls that change the status field:
```bash
grep -n "status:" backend/src/modules/[module]/[module].service.ts
```

### Step 3: Map Transitions to Methods
For each service method that changes status:
- What is the required current state?
- What is the new state?
- What roles can call this method?
- What side effects occur (email, socket, queue)?

### Step 4: Find Gaps
- States that have no method producing them (orphan states)
- States that have no method consuming them (orphan terminal states)
- Methods that don't check current state (dangerous — allows invalid transitions)

## Complete State Machine Reference

### KYC DocumentGate (Critical)
```
PENDING ──[submitDocuments/EMPLOYEE]──────────────► SUBMITTED
SUBMITTED ──[startOcr/SYSTEM]──────────────────────► PROCESSING
PROCESSING ──[ocrComplete/SYSTEM]──────────────────► PENDING_HR_REVIEW
PENDING_HR_REVIEW ──[hrApprove/HR,ADMIN]────────────► VERIFIED (TERMINAL)
PENDING_HR_REVIEW ──[hrReject/HR,ADMIN]─────────────► REJECTED (TERMINAL)
PENDING_HR_REVIEW ──[hrDeleteDoc/HR,ADMIN]──────────► REUPLOAD_REQUIRED (ROLLBACK)
ANY ──[hrDeleteDoc/HR,ADMIN]─────────────────────────► REUPLOAD_REQUIRED (ROLLBACK)
REUPLOAD_REQUIRED ──[resubmitDoc/EMPLOYEE]───────────► SUBMITTED (ROLLBACK RESOLVED)

Socket: kyc:status-changed emitted on every transition
Redux: setUser({ kycCompleted: true/false }) on status change
```

### Leave Request
```
─ ──[applyLeave/EMPLOYEE,INTERN,MANAGER]──────► PENDING
PENDING ──[approveLeave/MANAGER,HR,ADMIN]───────► APPROVED (+ balance deducted)
PENDING ──[rejectLeave/MANAGER,HR,ADMIN]────────► REJECTED
PENDING ──[withdrawLeave/EMPLOYEE own only]─────► WITHDRAWN
APPROVED ──[cancelLeave/HR,ADMIN]───────────────► CANCELLED (+ balance restored)

GUARD: approverId !== requesterId (self-approval blocked)
GUARD: manager can only approve own team's leaves
```

### Payroll
```
─ ──[runPayroll/ADMIN]───────────────────────► DRAFT
DRAFT ──[processPayroll/SYSTEM]─────────────► PROCESSING
PROCESSING ──[finalizePayroll/SYSTEM]───────► FINALIZED (TERMINAL)
FINALIZED ──[deleteRequest/HR,ADMIN]────────► [creates PayrollDeletionRequest]
[deletion approved] ──────────────────────► DELETED (TERMINAL)

GUARD: unique on (employeeId, month, year) — no duplicate runs
```

### Recruitment Candidate
```
─ ──[publicApply/PUBLIC]──────────────────► APPLIED
APPLIED ──[moveToScreen/HR,ADMIN]─────────► SCREENING
SCREENING ──[scheduleInterview/HR,ADMIN]──► INTERVIEW_SCHEDULED
INTERVIEW_SCHEDULED ──[conductInterview]──► INTERVIEWED
INTERVIEWED ──[finalize(HIRED)/HR,ADMIN]──► HIRED (TERMINAL)
INTERVIEWED ──[finalize(REJECTED)/HR,ADMIN]► REJECTED (TERMINAL)
ANY ──[candidateWithdraws/PUBLIC]──────────► WITHDRAWN (TERMINAL)
```

## Verification Pattern
For any state machine, use this test:
```typescript
// Test: cannot transition from terminal state
it('should not allow transitioning from VERIFIED status', async () => {
  const gate = await createDocumentGate({ status: 'VERIFIED' });
  await expect(service.submitDocuments(gate.id, employee.id))
    .rejects.toThrow('KYC already verified');
});

// Test: self-approval blocked
it('should not allow employee to approve their own leave', async () => {
  const leave = await createLeaveRequest({ employeeId: employee.id });
  await expect(service.approveLeave(leave.id, employee.id))
    .rejects.toThrow('Cannot approve your own leave');
});
```

## Output: State Diagram Text Format
```
[PENDING] ──apply/EMPLOYEE──► [PROCESSING]
[PROCESSING] ──approve/MANAGER──► [APPROVED] ●TERMINAL
[PROCESSING] ──reject/MANAGER──► [REJECTED] ●TERMINAL
[PROCESSING] ──withdraw/EMPLOYEE──► [WITHDRAWN]

● = terminal state
✗ = blocked transition (e.g., APPROVED ──► PENDING is BLOCKED)
```

## Red Flags to Always Report
- Terminal state can be exited (no guard) → CRITICAL
- No state check before status update → HIGH (race condition + invalid transition risk)
- Self-approval not blocked → CRITICAL
- Role not checked on transition → HIGH
- No audit log on transition → MEDIUM
- No socket event for real-time UI update on critical transitions → MEDIUM