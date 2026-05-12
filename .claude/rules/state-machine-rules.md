---
name: state-machine-rules
type: rule
applies_to: ["state-machine", "workflow", "transitions", "status"]
---

# State Machine Analysis Rules — Aniston HRMS

## Required Elements for Every State Machine
When documenting or analyzing any workflow with status/state fields, ALWAYS define:

1. **All states**: every possible enum value, including intermediate and terminal
2. **Valid transitions**: from → to, with trigger description
3. **Triggering roles**: which RBAC roles can trigger each transition
4. **Blocked transitions**: transitions that are explicitly NOT allowed (and why)
5. **Terminal states**: states that cannot be exited (require special override to re-open)
6. **Rollback states**: states that represent an error or reversal (REUPLOAD_REQUIRED, REOPENED)
7. **Self-transition guard**: which transitions must be blocked for the same actor who created the resource
8. **Concurrency handling**: what happens if two users trigger the same transition simultaneously

## Must-Define Format
```
Workflow: [NAME]
Enum: [EnumName] from shared/src/enums.ts
States: [list all values]
Initial state: [value set on create]
Terminal states: [values — once here, cannot transition away without override]
Rollback states: [values that represent going backwards]

Transitions:
  [FROM] → [TO]
    trigger: [what action causes this]
    roles: [which roles can trigger]
    guard: [conditions that must be true]
    side effects: [emails, socket events, audit logs, queue jobs]
    
Blocked:
  [FROM] → [TO]: reason [why this transition is forbidden]
```

## State Verification Steps
1. Open `shared/src/enums.ts` — list all values for the enum
2. Open `backend/src/modules/[module]/[module].service.ts` — map every `update` call that touches the status field
3. For each `update`, verify: current state check present before transition
4. Verify terminal states have guard: `if (TERMINAL_STATES.includes(current)) throw BadRequestError`
5. Verify roles: the service checks `req.user.role` is in allowed roles for transition
6. Verify side effects: audit log written, socket emitted, notification queued

## Prisma Optimistic Lock Pattern
For critical state transitions, use Prisma's `where` clause as an optimistic lock:
```typescript
// BAD — race condition possible
const leave = await prisma.leaveRequest.findUnique({ where: { id } });
if (leave.status !== 'PENDING') throw error;
await prisma.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } });

// GOOD — atomic check + update
const leave = await prisma.leaveRequest.updateMany({
  where: { id, status: 'PENDING' },  // Only updates if still PENDING
  data: { status: 'APPROVED' }
});
if (leave.count === 0) throw new ConflictError('Leave already processed');
```

## Terminal State Rule
Terminal states MUST be treated as irreversible in the service:
- `VERIFIED` (KYC) — cannot go back to PENDING_HR_REVIEW
- `HIRED` / `REJECTED` (Recruitment) — cannot go back to INTERVIEWED
- `FINALIZED` (Payroll) — cannot go back to DRAFT (requires deletion with approval)
- `CLOSED` (Helpdesk) — can only go to REOPENED, then IN_PROGRESS (not directly to OPEN)
- `COMPLETED` (Exit) — cannot be undone

If code allows transitioning OUT of a terminal state without an explicit re-open mechanism, flag as CRITICAL.

## Rollback State Rule
Rollback states mean the workflow went backwards (not forward):
- `REUPLOAD_REQUIRED` — HR found a problem, employee must re-do
- `REOPENED` — resolved ticket had a problem
- `REGULARIZATION_PENDING` — employee missed clock-in, requesting correction

For rollback states:
- The original requester (employee) must be notified
- The reason must be stored
- The re-do path must be defined
- Previous valid data must be preserved (not deleted)

## Missing Transition Red Flags
Flag these as HIGH or CRITICAL findings:
- Transition exists in UI but not in service (orphan button)
- Transition exists in service but no UI to trigger it (dead code)
- Transition exists in service but no role check (anyone can trigger)
- State value exists in enum but no service method handles it (undefined state)
- No audit log for a state transition involving sensitive data