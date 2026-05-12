---
name: audit-rbac-idor
description: "Audit all API routes for RBAC correctness, org scoping, IDOR vulnerabilities, self-approval, role escalation, error leakage"
---

# RBAC & IDOR Audit — Aniston HRMS

Use `backend-rbac-api-agent` with `rbac-multitenancy-rules.md`.

## Step 1: Route Inventory
Read `backend/src/app.ts` and all route files. List every route with:
- HTTP method + path
- Middleware chain
- Expected roles allowed

## Step 2: Middleware Completeness
For every route, verify the chain:
```
authenticate → requirePermission/authorize → validateRequest → controller
```
Flag any route missing `authenticate` (unless in known public list).

Known public routes (no auth):
- `GET /api/jobs/:token`
- `POST /api/jobs/:token/apply`
- `GET /api/jobs/track/:uid`
- `GET /api/invitations/validate/:token`
- `POST /api/invitations/accept/:token`
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/register` (if open registration exists)

## Step 3: IDOR Audit
For each module's service file, search for `findUnique`, `findFirst`, `findMany`, `update`, `delete`:
- Does every query include `organizationId: req.user.organizationId`?
- Does every employee-scoped query scope by `employeeId` when needed?
- Can user A access user B's data by guessing an ID?

High-priority modules to check:
1. `employee.service.ts` — employee data access
2. `leave.service.ts` — leave request access
3. `payroll.service.ts` — payslip access (employee should only see own)
4. `document.service.ts` — document file access
5. `attendance.service.ts` — attendance records
6. `helpdesk.service.ts` — ticket access

## Step 4: Self-Approval Check
Search all approval endpoints for self-approval guard:
```bash
grep -r "approve\|reject\|finalize" backend/src/modules/*/
```
For each approval method, verify:
```typescript
if (resource.requestedBy === req.user.id) {
  throw new ForbiddenError('Cannot approve your own request');
}
```
Modules: leave, payroll-deletion, employee-deletion, helpdesk

## Step 5: Role Escalation Check
Search for any endpoint that accepts `role` from request body:
```bash
grep -r "req\.body\.role\|body\.role" backend/src/modules/*/
```
Verify: role is NEVER set from request body (only from invite record or admin assignment).

Search for `organizationId` from request body:
```bash
grep -r "req\.body\.organizationId" backend/src/modules/*/
```
Verify: organizationId is NEVER taken from request body.

## Step 6: Manager Team Scope
For leave approval and performance review endpoints:
- Does the manager role check verify the employee is a direct report?
- `employee.managerId === req.user.employeeId` check present?

## Step 7: Error Message Audit
Check `backend/src/middleware/errorHandler.ts`:
- Prisma errors: does the error handler expose raw Prisma error details?
- Stack traces: are they hidden in production?
- Check: search for `error.message` being sent directly to client

## Step 8: Rate Limit Audit
Check rate limit middleware applied to:
- `POST /api/auth/login` (50/15min)
- `POST /api/walk-in/register` (5/min)
- `POST /api/jobs/:token/apply` (10/min)

## Output
Produce findings using RBAC format from `backend-rbac-api-agent`.
Summary: "X routes missing auth, Y IDOR vulnerabilities, Z self-approval gaps, W role escalation risks."
Mark each CRITICAL/HIGH/MEDIUM/LOW.