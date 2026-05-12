---
name: rbac-multitenancy-rules
type: rule
applies_to: ["backend", "api", "service", "rbac", "multitenancy"]
---

# RBAC & Multi-Tenancy Rules — Aniston HRMS

## The Absolute Rule: organizationId on Every Query
Every Prisma query that accesses org-scoped data MUST include `organizationId`:

```typescript
// ALWAYS — include organizationId in where clause
await prisma.employee.findUnique({
  where: { id, organizationId: req.user.organizationId }
});

await prisma.leaveRequest.findMany({
  where: { organizationId: req.user.organizationId, status: 'PENDING' }
});

await prisma.employee.update({
  where: { id, organizationId: req.user.organizationId },
  data: { ... }
});
```

**Never trust organizationId from request body.** Always use `req.user.organizationId` from the JWT.

## Route Middleware Order (Mandatory)
Every protected route MUST follow exactly this order:
```
authenticate → requirePermission/authorize → validateRequest → controller
```

No exceptions. If a route is missing `authenticate`, it's a CRITICAL security vulnerability.

## Role Hierarchy and Access
```
SUPER_ADMIN: all orgs, all data, all actions
ADMIN: own org, all data, all actions except cross-org
HR: own org, all employee data, cannot manage ADMIN/SUPER_ADMIN
MANAGER: own org, own team employees only
EMPLOYEE: own org, own data only
INTERN: own org, own data only (subset of EMPLOYEE)
GUEST_INTERVIEWER: own org, interview-related data only
```

## Self-Approval Rule
EVERY approval endpoint MUST enforce:
```typescript
if (resource.requestedBy === req.user.id || resource.employeeId === req.user.employeeId) {
  throw new ForbiddenError('Cannot approve your own request');
}
```

Applies to: leave approval, payroll deletion approval, employee deletion approval, any approval workflow.

## Manager Team Scope Rule
MANAGER role can only view/action on their direct reports:
```typescript
// In every manager endpoint, add team scope check
const employee = await prisma.employee.findUnique({
  where: { id: targetEmployeeId, organizationId }
});
if (employee?.managerId !== req.user.employeeId && req.user.role !== 'HR' && req.user.role !== 'ADMIN') {
  throw new ForbiddenError('You can only manage your direct reports');
}
```

## Role Escalation Prevention
- `organizationId` in request body must be IGNORED (use JWT value)
- `role` in request body for user creation must be validated against allowed roles:
  - Only SUPER_ADMIN can create ADMIN
  - Only ADMIN/SUPER_ADMIN can create HR
  - HR can create EMPLOYEE/INTERN
- Invite acceptance: role comes from `EmployeeInvitation.role`, NOT from request body

## IDOR Prevention Pattern
For every resource fetch, use the compound where:
```typescript
// Pattern 1: Direct org scope
const record = await prisma.leaveRequest.findUnique({
  where: { id, organizationId: req.user.organizationId }
});
if (!record) throw new NotFoundError('Leave request not found');

// Pattern 2: Scope through employee relationship
const payslip = await prisma.payroll.findFirst({
  where: { id, employee: { organizationId: req.user.organizationId } }
});

// Pattern 3: Employee's own data
const myLeave = await prisma.leaveRequest.findUnique({
  where: { id, employeeId: req.user.employeeId }
});
```

## File Access IDOR Prevention
Every file download endpoint must:
1. Find the document record with `organizationId` scoping
2. Verify the file path from the DB record (never from request params)
3. Serve the file only if authorization passes

## Permission Check Order
Use `requirePermission(resource, action)` for granular control:
```typescript
// Route-level permission check
router.get('/employees', authenticate, requirePermission('employees', 'read'), controller);
router.post('/employees', authenticate, requirePermission('employees', 'create'), controller);
router.patch('/employees/:id', authenticate, requirePermission('employees', 'update'), controller);
router.delete('/employees/:id', authenticate, requirePermission('employees', 'delete'), controller);
```

All permissions defined in `shared/src/permissions.ts` — do not define inline.

## Cross-Org Data Leak Prevention
Aggregation endpoints (dashboard, reports) must ALWAYS include organizationId:
```typescript
// WRONG — aggregates ALL orgs
const total = await prisma.employee.count();

// CORRECT — org-scoped aggregation
const total = await prisma.employee.count({
  where: { organizationId: req.user.organizationId, deletedAt: null }
});
```