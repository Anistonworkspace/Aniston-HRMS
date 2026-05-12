---
name: final-release-gate
description: "Run the final release gate validation before deploying to production. Verifies all quality criteria are met."
---

# Final Release Gate — Aniston HRMS

Run this command before every production deployment. All gates must PASS before deploying.

## Gate 1: TypeScript — Zero Errors
```bash
npm run typecheck
```
Expected: exit code 0, no TypeScript errors
FAIL condition: any type error → BLOCK release

## Gate 2: Lint — Zero Errors
```bash
npm run lint
```
Expected: exit code 0, no ESLint errors (warnings allowed)
FAIL condition: any lint error → BLOCK release

## Gate 3: Unit Tests — All Pass
```bash
npm run test --workspace=backend
```
Expected: all tests pass, no failures
FAIL condition: any test failure → BLOCK release

## Gate 4: Coverage Threshold
```bash
npm run test --workspace=backend -- --coverage
```
Expected: line coverage >= 80% for service layer
FAIL condition: coverage below threshold → WARN (not block, unless configured as block)

## Gate 5: Build Success
```bash
npm run build:frontend && npm run build:backend
```
Expected: both builds succeed, no errors
FAIL condition: build failure → BLOCK release

## Gate 6: Schema Migration Safety
```bash
npx prisma migrate status
```
Expected: all migrations applied, no pending migrations
If pending migrations exist:
- Verify they are backward-compatible
- Confirm database backup exists
- Confirm staging test was done

## Gate 7: Security Checklist
Manually verify:
- [ ] No hardcoded secrets in any committed file
- [ ] `.env` not in git staging area
- [ ] No `*.jks`, `*.apk`, `*.aab` in repo
- [ ] API keys stored in GitHub secrets only
- [ ] All P0 and P1 security findings from last audit resolved

## Gate 8: P0/P1 Issues Resolved
Check the most recent audit report:
- [ ] Zero CRITICAL (P0) open findings
- [ ] Zero HIGH (P1) open findings
- [ ] All P2 findings acknowledged (not necessarily fixed, but known)

## Gate 9: Health Check Dry Run (Staging)
Deploy to staging first:
```bash
GET https://staging.hr.anistonav.com/api/health
```
Expected response:
```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok" },
    "redis": { "status": "ok" },
    "bullmq": { "status": "ok" }
  }
}
```
FAIL condition: any check "down" or "degraded" → investigate before production deploy

## Gate 10: Rollback Plan Documented
Before deploying, confirm:
- [ ] Current production commit hash noted
- [ ] Database backup taken: `pg_dump` → S3
- [ ] Rollback steps written: git revert + prisma migrate rollback (if applicable)
- [ ] Max rollback time estimated: < 10 minutes

## Gate 11: APK/AAB Safety (Mobile Releases Only)
- [ ] APK signed with release keystore (not debug)
- [ ] APK tested on Xiaomi + Samsung devices
- [ ] GPS tracking tested on physical device
- [ ] OEM battery optimization guidance shown in onboarding

---

## Release Verdict
After running all gates, produce:

```
RELEASE GATE REPORT — [date] [version]

Gate 1 TypeScript:    PASS / FAIL
Gate 2 Lint:          PASS / FAIL
Gate 3 Unit Tests:    PASS / FAIL
Gate 4 Coverage:      PASS (X%) / WARN (X% < 80%) / FAIL
Gate 5 Build:         PASS / FAIL
Gate 6 Migrations:    PASS / WARN / FAIL
Gate 7 Security:      PASS / FAIL
Gate 8 P0/P1 Issues:  PASS (0 open) / FAIL (N open)
Gate 9 Health Check:  PASS / FAIL
Gate 10 Rollback:     READY / NOT READY
Gate 11 APK (if mobile release): PASS / FAIL / N/A

OVERALL: APPROVED FOR RELEASE / BLOCKED — [reason]
```

If BLOCKED: list exactly what must be fixed before release is approved.
If APPROVED: state the final version and recommended deploy time.