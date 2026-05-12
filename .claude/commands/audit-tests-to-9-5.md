---
name: audit-tests-to-9-5
description: "Audit current test coverage and produce a detailed plan to move testing score from 3.5 to 9.5+"
---

# Testing Gap Audit — Target 9.5/10 — Aniston HRMS

Use `qa-test-automation-agent` with `testing-quality-gate-9-5.md` rule.

## Step 1: Baseline Assessment
Measure current state:

1. Count existing test files:
```bash
find backend/src -name "*.test.ts" -o -name "*.spec.ts" | wc -l
find frontend/src -name "*.test.tsx" -o -name "*.spec.tsx" | wc -l
find frontend -name "*.spec.ts" | wc -l
```

2. Run existing tests and get coverage:
```bash
npm run test --workspace=backend -- --coverage --reporter=verbose 2>&1 | tail -30
```

3. Document: total tests, coverage %, failing tests

## Step 2: Gap Analysis by Layer

### Unit Test Gaps
For each module in `backend/src/modules/`, check if a `__tests__/` directory exists:
- List modules WITH unit tests
- List modules WITHOUT unit tests (these are gaps)
- For each module without tests, estimate: how many service methods need tests?

### Integration Test Gaps
Check `backend/src/__tests__/` for integration tests:
- Is there an `rbac.integration.test.ts`?
- Is there end-to-end flow tests (apply leave → approve → balance deducted)?
- Is there a test database configuration (`.env.test`)?

### Frontend Component Test Gaps
Check `frontend/src/` for component tests:
- Are there any `.test.tsx` files?
- Is there a Vitest config for frontend?
- Is MSW set up for mocking API calls?

### E2E Test Gaps
Check `frontend/` for Playwright:
- Is `playwright.config.ts` present?
- Is there an `e2e/` or `tests/` directory?
- Are any `.spec.ts` E2E test files present?

## Step 3: Priority Test Plan
Produce a prioritized list of tests to write, ordered by risk:

**Tier 1 — Must have (P0 risk if missing)**:
1. Auth flow: login, JWT refresh, logout
2. Self-approval prevention (leave, payroll deletion)
3. Payroll calculations (EPF/ESI/PT/TDS math)
4. KYC state machine transitions
5. RBAC matrix: 7 roles × 10 critical routes

**Tier 2 — High value (P1 quality)**:
6. Leave apply + approve + balance deduction
7. Employee CRUD with org scoping
8. Attendance clock-in/out state machine
9. Document upload + soft-delete filter
10. Recruitment finalization (HIRED/REJECTED terminal)

**Tier 3 — Completeness (P2)**:
11. E2E: leave flow
12. E2E: KYC upload
13. E2E: public job application
14. Component tests: LeavePage, PayrollPage, KycGatePage

## Step 4: Infrastructure Setup Plan
List what infrastructure needs to be created:
1. `backend/src/__tests__/setup.ts` — global test setup, Prisma mock or test DB
2. `backend/.env.test` — test database URL
3. `frontend/src/__tests__/setup.ts` — RTL setup, MSW server
4. `frontend/playwright.config.ts` — E2E configuration
5. `.github/workflows/deploy.yml` — add coverage gate

## Step 5: Score Projection
Map current state and target:
```
Current: [X] tests, [Y]% coverage, no E2E = 3.5/10
After Tier 1: ~50 tests, ~40% coverage = 5.5/10
After Tier 2: ~200 tests, ~70% coverage = 7.5/10
After Tier 3: ~400 tests, ~80% coverage, 30 E2E = 8.5/10
After RBAC matrix + full E2E: 800+ tests = 9.5/10
```

Provide: current score, next milestone, estimated developer-hours to reach 9.5.