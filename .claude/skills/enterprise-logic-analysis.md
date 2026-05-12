---
name: enterprise-logic-analysis
description: "Skill for deep business logic analysis: trace full UI→API→service→DB→notification→UI flows, detect broken state machines, race conditions, missing guards"
type: skill
---

# Enterprise Logic Analysis Skill — Aniston HRMS

## When to Use This Skill
Use when asked to:
- Find business logic bugs
- Trace a workflow end-to-end
- Verify a state machine is correct
- Check if self-approval is possible
- Find race conditions
- Verify edge cases are handled

## Analysis Methodology

### Step 1: Identify the Workflow
1. Name the workflow (e.g., "leave approval", "KYC submission")
2. Find the UI entry point (component file)
3. Find the API endpoint (RTK Query mutation)
4. Find the service method (backend service)
5. Find the Prisma models involved

### Step 2: Trace Forward
Trace every step:
- UI: what happens on button click?
- RTK Query: which mutation hook? what payload?
- Express: which route? which middleware?
- Controller: how is request parsed?
- Service: what business logic runs? what Prisma queries?
- Database: what records change?
- Side effects: BullMQ jobs? socket events? emails?

### Step 3: Trace Backward (UI Refresh)
- What RTK tags are invalidated?
- What socket event triggers UI update?
- What Redux state changes?
- Is the UI stale after the operation?

### Step 4: Apply Logic Bug Checklist
- Self-approval possible?
- Race condition possible?
- Wrong state transition allowed?
- Missing edge cases (null, deleted, wrong org)?

## Pattern Recognition

### Self-Approval Pattern
```typescript
// RED FLAG: no check on who is approving vs who requested
async approveLeave(id: string, approverId: string) {
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  await prisma.leaveRequest.update({ where: { id }, data: { status: 'APPROVED', approverId } });
  // MISSING: if (leave.employeeId === approverId) throw error
}
```

### Race Condition Pattern
```typescript
// RED FLAG: check-then-act not atomic
const balance = await prisma.leaveBalance.findFirst({ where: { employeeId } });
if (balance.remaining < daysRequested) throw error;
// GAP: another request could pass this check simultaneously before either updates
await prisma.leaveBalance.update({ where: { id: balance.id }, data: { remaining: { decrement: daysRequested } } });
// SAFE alternative: use database-level constraint or transaction with select for update
```

### Missing State Check Pattern
```typescript
// RED FLAG: updating status without checking current state
async approveLeave(id: string) {
  await prisma.leaveRequest.update({
    where: { id },
    data: { status: 'APPROVED' }
    // MISSING: where: { id, status: 'PENDING' }
    // PROBLEM: can approve already-rejected or already-approved leaves
  });
}
```

### Unbounded Query Pattern
```typescript
// RED FLAG: no pagination, no limit
const employees = await prisma.employee.findMany({
  where: { organizationId }
  // MISSING: take: limit, skip: offset
  // RISK: returns all employees (could be 1000+)
});
```

## Output Format
Always produce findings in this exact format:

```
LOGIC-[ID]: [MODULE] — [SHORT TITLE]
Severity: P0 / P1 / P2 / P3
Flow: [UI component] → [API route] → [service method] → [DB model]
Current Behavior: [what actually happens]
Expected Behavior: [what should happen]
Root Cause: [specific code location and why it's wrong]
Files:
  - [path]:[line] — [description]
Migration Needed: yes/no
Fix Complexity: low/medium/high
Reproduce: [one-line test case]
```

## Efficiency Tips
- Start with the most dangerous patterns: self-approval, missing auth, IDOR
- Check terminal state transitions — if VERIFIED can become PENDING, that's critical
- For payroll: always verify calculations with actual Indian statutory formulas
- For KYC: trace the socket event path — is `kycCompleted` immediately updated in Redux?
- For attendance: check date boundary at midnight for night-shift workers