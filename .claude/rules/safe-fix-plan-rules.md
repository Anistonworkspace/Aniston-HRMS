---
name: safe-fix-plan-rules
type: rule
applies_to: ["bug-fix", "hotfix", "patch", "remediation"]
---

# Safe Fix Plan Rules — Aniston HRMS

## Required Format for Every Fix Plan
Every fix plan (especially for P0/P1 issues) MUST include all fields:

```
FIX-[ID]: [SHORT TITLE]
Severity: P0 / P1 / P2 / P3
Module: [backend module name or frontend feature]
Files to Modify:
  - backend/src/modules/[module]/[module].service.ts (line X)
  - frontend/src/features/[module]/[Component].tsx (line Y)
Migration Needed: yes/no
  - If yes: describe the schema change and data impact
Data at Risk: yes/no
  - If yes: describe what data could be lost or corrupted
Fix Description: [detailed description of the code change]
Test Plan:
  - Unit test: [describe the unit test to add]
  - Manual test: [step-by-step to verify fix works]
  - Regression test: [what existing behavior to verify still works]
Rollback Plan:
  - Git: git revert [describe commit to revert]
  - Migration rollback: [if migration needed, describe rollback SQL]
  - Service restart: pm2 reload ecosystem.config.js
Validation Command: [specific command to verify fix is working]
Estimated Effort: [low: <1h / medium: 1-4h / high: >4h]
```

## P0 Fix Rules (Production Outage / Data Loss)
- Fix IMMEDIATELY — do not wait for sprint planning
- Must have code review before deploying (even in emergency)
- Must have rollback plan ready before deploying
- Must run at least smoke tests before deploying to production
- Post-fix: write a postmortem document

## P1 Fix Rules (Major Feature Broken / Security Vulnerability)
- Fix within 24 hours
- Must have unit test covering the fixed bug (regression prevention)
- Must pass all CI gates before merging
- Notify affected users if data was impacted

## P2 Fix Rules (Partial Feature Broken)
- Fix within current sprint (1-2 weeks)
- Unit test required
- Standard PR review process

## P3 Fix Rules (Minor / Low Impact)
- Fix in backlog priority order
- Nice-to-have test
- Standard PR review process

## Migration Safety in Fix Plans
If a fix requires a schema migration:
1. State the migration as the FIRST step (before code change)
2. Backup requirement: ALWAYS for production migration
3. Staging test: ALWAYS test migration on staging first
4. Code must be backward-compatible with OLD schema during deploy window
5. Deploy sequence: run migration → deploy new code (never code → then migration)

## Fix Plan Completeness Check
Before presenting a fix plan, verify:
- [ ] Root cause identified (not just symptoms)
- [ ] All affected files listed (not just one)
- [ ] Migration impact assessed
- [ ] Rollback plan is actionable (not "revert the commit" without specifying which)
- [ ] Validation command can actually verify the fix (not vague "check if it works")
- [ ] Related modules checked for same pattern (is this a systemic issue?)

## Systemic Issue Rule
If the same pattern causes multiple bugs (e.g., missing org scope in 5 modules):
- Report as a SYSTEMIC finding with count
- Create one fix plan that addresses all instances
- Add a lint rule or PR checklist item to prevent recurrence
- Do NOT create separate fix plans for each instance of the same pattern