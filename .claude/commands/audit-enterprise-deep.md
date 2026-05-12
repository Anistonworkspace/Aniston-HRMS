---
name: audit-enterprise-deep
description: "Run a full enterprise deep audit of Aniston HRMS across all 10 dimensions: logic, security, data, UI, performance, observability, DevOps, mobile, testing, compliance"
---

# Enterprise Deep Audit — Aniston HRMS

Run a comprehensive enterprise-grade audit across all dimensions. Follow the `enterprise-audit-rules.md` format strictly.

## Step 1: Scope Confirmation
Before starting, confirm which modules are in scope:
- [ ] All backend modules (40+)
- [ ] All frontend features
- [ ] Prisma schema
- [ ] GitHub Actions CI/CD
- [ ] Android APK/GPS
- [ ] PWA/Mobile
- [ ] Security/Privacy

## Step 2: Run Each Dimension Audit
Execute all of the following sub-audits in order:

### 2.1 Logic & State Machines
Use `logic-analyzer-agent` to:
- Trace every workflow from UI → API → service → DB → UI refresh
- Verify state machines for: attendance, leave, payroll, KYC, recruitment, exit, helpdesk
- Check for self-approval vulnerabilities
- Check for race conditions

### 2.2 Security & Privacy
Use `security-privacy-compliance-agent` to:
- Audit JWT storage (no localStorage)
- Audit cookie security flags
- Audit GPS consent (DPDP Act 2023)
- Audit Aadhaar/PAN encryption
- Audit CORS/CSP/rate limiting
- Audit file upload security

### 2.3 RBAC & API Security
Use `backend-rbac-api-agent` to:
- Verify every route has authenticate + permission check
- IDOR audit on all findUnique/findMany calls
- Self-approval patterns
- Manager outside-team access
- Error message leakage

### 2.4 Database & Migrations
Use `prisma-migration-data-agent` to:
- Every model has id/orgId/createdAt/updatedAt/deletedAt
- Enum consistency between Prisma and shared/src/enums.ts
- Index coverage for common query patterns
- Migration safety compliance

### 2.5 Frontend Wiring
Use `frontend-wiring-agent` to:
- Every route renders correct component
- Every button has wired handler
- RTK Query tag invalidation complete
- Mobile overflow check (375px viewport)
- Empty/error/loading states present

### 2.6 Performance
Use `performance-scale-agent` to:
- N+1 query detection
- Unbounded findMany patterns
- Missing indexes
- Dashboard caching gaps

### 2.7 Observability
Use `observability-incident-agent` to:
- Structured log format
- Health check depth
- Cron failure alerts
- GPS anomaly visibility

### 2.8 DevOps & Release
Use `devops-release-agent` to:
- CI/CD pipeline order
- Secret management
- APK signing safety
- Rollback plans

### 2.9 Android GPS
Use `android-gps-enterprise-agent` to:
- Foreground service configuration
- OEM battery optimization guidance
- Force Stop honest documentation
- AAB signing safety

### 2.10 Testing Gaps
Use `qa-test-automation-agent` to:
- Current coverage vs 9.5/10 target
- Missing unit/integration/E2E tests
- RBAC matrix coverage
- CI quality gate requirements

## Step 3: Compile Report
Produce the full audit report following `enterprise-audit-rules.md` format:
- Executive summary with overall score (X/10)
- Critical findings (P0)
- High findings (P1)
- Medium findings (P2)
- Low findings (P3)
- Recommended fix order with effort estimates
- Modules not audited (if any)

## Step 4: Fix Priority Matrix
After the report, produce a prioritized fix list:
```
Priority | Fix ID | Module | Description | Effort | Migration?
---------|--------|--------|-------------|--------|----------
P0       | ...    | ...    | ...         | ...    | yes/no
```