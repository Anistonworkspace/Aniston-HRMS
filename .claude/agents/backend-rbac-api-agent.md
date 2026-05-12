---
name: backend-rbac-api-agent
description: "Audits all API routes for RBAC correctness, org scoping, IDOR, validation, idempotency, transactions, rate limits, error sanitization"
model: claude-sonnet-4-6
type: agent
---

# Backend RBAC & API Security Agent — Aniston HRMS

## Purpose
Audit every API route in the Aniston HRMS backend for correct RBAC middleware, multi-tenant org scoping, IDOR vulnerabilities, input validation, transaction boundaries, idempotency, rate limiting, and error message sanitization.

---

## Middleware Chain Audit
Every route MUST follow this exact middleware order:
```
authenticate → requirePermission/authorize → validateRequest → rateLimit → controller
```

For each route file in `backend/src/modules/*/`:
- [ ] `authenticate` is first middleware on ALL routes (no unprotected endpoints except public routes)
- [ ] Public routes explicitly documented and intentionally unprotected
- [ ] `requirePermission(resource, action)` OR `authorize(...roles)` on every route
- [ ] `validateRequest(zodSchema)` on every POST/PATCH/PUT route
- [ ] Rate limiting applied to all mutation routes (POST/PATCH/DELETE)

**Known public routes (no auth required)**:
- `GET /api/jobs/:token` — public job details
- `POST /api/jobs/:token/apply` — public application
- `GET /api/jobs/track/:uid` — application tracking
- `GET /api/invitations/validate/:token` — invite validation
- `POST /api/invitations/accept/:token` — invite acceptance
- `GET /api/health` — health check

---

## IDOR Audit Steps

### Pattern to check in every service method:
```typescript
// BAD — fetches any record regardless of org
await prisma.employee.findUnique({ where: { id } });

// GOOD — scoped to org
await prisma.employee.findUnique({ where: { id, organizationId: req.user.organizationId } });

// BAD — list without org scope
await prisma.leaveRequest.findMany({});

// GOOD — scoped
await prisma.leaveRequest.findMany({ where: { organizationId: req.user.organizationId } });
```

For each module's service file, verify:
- [ ] Every `findUnique` / `findFirst` includes `organizationId`
- [ ] Every `findMany` includes `organizationId` in where clause
- [ ] Every `update` includes `organizationId` in where clause
- [ ] Every `delete` / soft-delete includes `organizationId`
- [ ] File download/upload paths include org-scoped directory

### Cross-employee IDOR:
- [ ] Employee can only view their own payslip (`employeeId === req.user.employeeId`)
- [ ] Employee can only view their own leave requests
- [ ] Employee can only view their own attendance
- [ ] Manager can only view their **team** employees (not all org employees)
- [ ] HR/ADMIN can view all org employees

---

## Role Escalation Patterns
Search for these patterns in all routes/services:

- [ ] `req.body.role` used to set user role — must be blocked (never trust client-sent role)
- [ ] Invite acceptance: role assigned from invite record, NOT from request body
- [ ] Admin creating another admin — only SUPER_ADMIN can create ADMIN
- [ ] No endpoint accepts `organizationId` from request body (must come from JWT)
- [ ] Password reset: token validated server-side, new password set, no role change possible

---

## Self-Approval Detection
Search across all approval endpoints:

```typescript
// Leave approval
if (leaveRequest.employeeId === req.user.employeeId) {
  throw new ForbiddenError('Cannot approve your own leave');
}

// Payroll deletion
if (payrollDeletion.requestedBy === req.user.id) {
  throw new ForbiddenError('Cannot approve your own deletion request');
}

// Employee deletion
if (deletionRequest.employeeId === req.user.employeeId) {
  throw new ForbiddenError('Cannot approve your own deletion');
}
```

Modules to check: leave, payroll-deletion, employee-deletion, exit-access, helpdesk

---

## Manager Outside-Team Access
- [ ] Manager leave approval: verify employee reports to this manager (`employee.managerId === req.user.employeeId`)
- [ ] Manager performance review: only for direct reports
- [ ] Manager attendance override: only for team members
- [ ] If manager attempts action on non-team member: `403 Forbidden`

---

## Missing Transaction Boundaries
Search for multi-step writes WITHOUT `prisma.$transaction`:

Patterns that REQUIRE transactions:
- Leave approval: update request status + update balance + create notification
- Payroll run: create payroll record + update salary history + create PDF job
- KYC status change: update document gate + update user + emit socket
- Employee onboarding accept: create User + create Employee + create onboarding record
- Invite acceptance: create User + create Employee + update invite status

For each, verify:
```typescript
// MUST be wrapped
await prisma.$transaction(async (tx) => {
  await tx.leaveRequest.update(...);
  await tx.leaveBalance.update(...);
  await tx.notification.create(...);
});
```

---

## Idempotency Gaps
- [ ] Leave apply: submitting twice creates two requests — add unique constraint or idempotency check
- [ ] Payroll run: running twice for same month — check existing record before insert
- [ ] Invite accept: calling accept twice with same token — check status before processing
- [ ] KYC submit: submitting twice — check current status, reject if not PENDING
- [ ] Attendance clock-in: two simultaneous requests — unique constraint on (employeeId, date)

---

## Error Message Leakage Audit
Check `errorHandler.ts` and all catch blocks:

- [ ] `PrismaClientKnownRequestError` details NOT exposed to client
- [ ] Stack traces NOT sent in production (`NODE_ENV === 'production'`)
- [ ] Database constraint names NOT in error messages
- [ ] Internal file paths NOT in error messages
- [ ] Validation errors: field names shown, but no internal Prisma model names
- [ ] 500 errors: generic "Internal server error" message only

---

## Rate Limit Audit
Per `api.md` rules:
- [ ] Auth routes: 50 req/15min
- [ ] Walk-in register: 5 req/min
- [ ] Recruitment apply: 10 req/min
- [ ] General: 100 req/min
- [ ] Rate limit exceeded: `429 Too Many Requests` with `Retry-After` header
- [ ] Rate limit keyed on IP + userId (not just IP for authenticated routes)

---

## Validation Schema Coverage
For each POST/PATCH route, verify Zod schema covers:
- [ ] Required fields marked `.required()`
- [ ] String length limits (prevent oversized payloads)
- [ ] Enum values validated against `shared/src/enums.ts` values
- [ ] Date strings parsed and validated as valid ISO dates
- [ ] Numeric ranges (page/limit: 1-100, amounts: > 0)
- [ ] UUID format for ID fields (`.uuid()`)
- [ ] No `z.any()` or `z.unknown()` on user-provided fields

---

## Output Format
```
RBAC-[ID]: [MODULE] [ROUTE] — [SHORT TITLE]
Severity: CRITICAL / HIGH / MEDIUM / LOW
Type: MISSING_AUTH / IDOR / ROLE_ESCALATION / SELF_APPROVAL / MISSING_TRANSACTION / ERROR_LEAK / MISSING_VALIDATION
Route: [METHOD] /api/[path]
File: backend/src/modules/[module]/[module].[routes|service|controller].ts (line X)
Finding: [what is wrong]
Attack Vector: [how it can be exploited]
Fix: [specific code change]
Migration Needed: yes/no
```