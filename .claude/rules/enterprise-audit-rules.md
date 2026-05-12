---
name: enterprise-audit-rules
type: rule
applies_to: ["audit", "review", "analysis"]
---

# Enterprise Audit Rules — Aniston HRMS

## Scope Requirements
Every enterprise audit MUST cover ALL of the following dimensions:
1. **Logic correctness** — state machines, business rules, edge cases
2. **Security** — auth, RBAC, IDOR, encryption, session management
3. **Data integrity** — schema, migrations, indexes, orphan rows
4. **Frontend wiring** — dead UI, broken mutations, stale state
5. **Performance** — N+1 queries, unbounded lists, caching gaps
6. **Observability** — logs, health checks, alerts, triage readiness
7. **DevOps** — CI/CD pipeline, secrets, rollback plans
8. **Mobile/PWA** — responsive design, APK/GPS reliability
9. **Testing** — coverage gaps, missing test scenarios
10. **Compliance** — DPDP Act 2023, audit trails, consent

## Format Rules
Every audit finding MUST include:
- **Unique ID**: `[CATEGORY]-[number]` (e.g., `BUG-001`, `SEC-012`)
- **Severity**: CRITICAL / HIGH / MEDIUM / LOW (see definitions below)
- **Type**: specific category of issue
- **File**: absolute path + line number
- **Finding**: what is wrong (factual, not opinion)
- **Impact**: what breaks or what risk exists
- **Fix**: specific, actionable code change or configuration
- **Migration needed**: yes/no
- **Test to validate fix**: specific command or step

## Severity Definitions
- **CRITICAL**: Data loss, security breach, production outage possible. Fix before any release.
- **HIGH**: Major feature broken, RBAC bypassed, significant data integrity risk. Fix within current sprint.
- **MEDIUM**: Partial feature broken, UX degraded, performance issue at scale. Fix in next sprint.
- **LOW**: Minor UX issue, missing optimization, code smell. Fix when convenient.

## Scoring Rules
Scores are on a scale of 1–10. Use this rubric:
- **9.5–10**: Near-perfect. Only minor cosmetic issues. Production-safe.
- **8–9.4**: Solid. A few medium issues, no critical/high.
- **6–7.9**: Acceptable. Some high issues, no criticals. Do not release to production.
- **4–5.9**: Significant problems. Multiple high issues or one critical. Needs work.
- **2–3.9**: Major problems. Multiple criticals or fundamental architecture issues.
- **< 2**: Do not deploy. Fundamental issues threatening data integrity or security.

## Honesty Requirements
- NEVER inflate scores to please the user
- NEVER say "looks good" without verifying all checklist items
- Report ALL findings, even if uncomfortable (e.g., self-approval vulnerability exists)
- If a module was not fully audited, state explicitly what was NOT covered
- If a finding is uncertain (code path unclear), flag as `UNVERIFIED — needs testing`
- Always distinguish between: confirmed bug, suspected issue, and recommendation

## Anti-Patterns to Never Do
- Do NOT generate a score before running the full checklist
- Do NOT skip modules because they "seem fine"
- Do NOT report only positives and omit negatives
- Do NOT round up scores (3.5 is 3.5, not "almost 4")
- Do NOT suggest closing critical issues as "accepted risk" without explicit user confirmation

## Audit Output Structure
```
## AUDIT REPORT: [Scope] — [Date]
### Executive Summary
  Score: X/10
  Critical issues: N
  High issues: N
  Medium issues: N
  Low issues: N
  Release recommendation: [BLOCK / PROCEED WITH CONDITIONS / PROCEED]

### Critical Findings (fix immediately)
  [BUG-001] ...
  [SEC-001] ...

### High Findings
  ...

### Medium Findings
  ...

### Low Findings
  ...

### Modules Not Audited (if any)
  ...

### Recommended Fix Order
  1. [ID] [description] — [estimated effort]
  ...
```