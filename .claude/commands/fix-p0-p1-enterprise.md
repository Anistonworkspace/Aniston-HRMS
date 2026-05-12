---
name: fix-p0-p1-enterprise
description: "Execute P0 and P1 fix plans: critical bugs, security vulnerabilities, major broken features. Follows safe-fix-plan-rules."
---

# P0/P1 Fix Execution — Aniston HRMS

Use `safe-fix-plan-rules.md` format for every fix. Follow `production-migration-safety.md` for any schema changes.

## Pre-Fix Checklist
Before executing any fix:
- [ ] The audit report has been reviewed and approved by user
- [ ] Fix plan has been reviewed and approved by user
- [ ] Migration plan (if needed) has been reviewed
- [ ] Rollback plan is documented
- [ ] User has explicitly said "fix this" or "execute fix [ID]"

## P0 Fix Protocol (Production Breaking / Data Loss Risk)
1. **Confirm scope**: What exact files will be modified?
2. **Show diff**: Show the proposed code change before applying
3. **Migration check**: Does this require a schema change?
4. **Backup check**: Is database backup required before this fix?
5. **Apply fix**: Make the code change
6. **Write test**: Add regression test to prevent recurrence
7. **Validate**: Run the validation command from the fix plan
8. **Do NOT push**: Wait for user to review and approve before any git operations

## P1 Fix Protocol (Major Feature Broken / Security Vulnerability)
1. **Confirm scope**: Show all files that will change
2. **Apply fix**: Make the minimal change to fix the issue
3. **Write test**: Add unit test covering the bug scenario
4. **Lint + typecheck**: Run `npm run typecheck` to verify no type errors
5. **Validate**: Run relevant test suite
6. **Report**: Show user what was changed and what test was added

## Common Fix Templates

### Fix: Missing organizationId scope
```typescript
// BEFORE (IDOR vulnerable)
const record = await prisma.leaveRequest.findUnique({ where: { id } });

// AFTER (org-scoped)
const record = await prisma.leaveRequest.findUnique({
  where: { id, organizationId: req.user.organizationId }
});
if (!record) throw new NotFoundError('Leave request not found');
```

### Fix: Missing self-approval guard
```typescript
// Add after fetching the resource
if (leaveRequest.employeeId === req.user.employeeId) {
  throw new ForbiddenError('You cannot approve your own leave request');
}
```

### Fix: Missing authenticate middleware
```typescript
// Add to route definition
router.get('/sensitive-resource', authenticate, requirePermission('resource', 'read'), controller.list);
```

### Fix: Missing prisma.$transaction
```typescript
// Wrap multi-table writes
await prisma.$transaction(async (tx) => {
  await tx.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } });
  await tx.leaveBalance.update({ where: { employeeId }, data: { used: { increment: days } } });
  await tx.notification.create({ data: notificationData });
});
```

### Fix: Missing RTK Query invalidation
```typescript
// Add missing tag to invalidatesTags
invalidatesTags: (result, error, { employeeId }) => [
  { type: 'LeaveRequests', id: employeeId },
  { type: 'LeaveBalance', id: employeeId },  // Was missing
  'LeaveStats',  // Was missing
],
```

## Fix Execution Order
Always fix in this order:
1. CRITICAL security vulnerabilities first (auth bypass, IDOR)
2. Data loss risks (missing transactions, wrong deletions)
3. Major broken workflows (state machine issues)
4. UI wiring issues (dead buttons, stale state)
5. Minor improvements

## After Every Fix
- Run: `npm run typecheck` (no type errors)
- Run: relevant test suite
- Show user: files changed + what was fixed
- Do NOT commit without explicit user instruction
- Do NOT push without explicit user instruction