---
name: testing-quality-gate-9-5
type: rule
applies_to: ["testing", "qa", "ci", "coverage"]
---

# Testing Quality Gate — Target 9.5/10 Score

## Current State (Baseline)
- Backend unit tests: 14 (Vitest)
- Frontend tests: 0
- E2E tests: 0
- RBAC matrix tests: 0
- Coverage: unknown (not measured)
- CI gate: none (tests don't block PRs)

## Required to Reach 9.5/10

### Coverage Requirements
- Backend service layer: **>= 80% line coverage** (measured by Vitest + v8)
- Backend utility functions: **>= 90% line coverage**
- Frontend critical components: **>= 70% line coverage** (RTL)
- CI blocks merge if coverage drops below threshold

### Unit Test Requirements (Backend)
Must have unit tests for:
- [ ] Every service method in all 40+ modules
- [ ] All payroll calculation functions (EPF/ESI/PT/TDS math)
- [ ] `encryption.ts` — AES-256-GCM round-trip
- [ ] `auditLogger.ts` — correct fields logged
- [ ] `documentFormatValidator.ts` — all document type validations
- [ ] All state machine transition guards (invalid transition throws error)

### Integration Test Requirements
Must have integration tests for:
- [ ] Every API endpoint (at least happy path + one error case)
- [ ] Full auth flow: login → access protected route → refresh → logout
- [ ] Full leave flow: apply → approve → balance deducted
- [ ] Full KYC flow: upload → OCR → HR approve → status VERIFIED
- [ ] Full payroll flow: run → finalize → PDF generated
- [ ] RBAC matrix: all 7 roles × critical routes (expect correct 200/403/401)

### E2E Test Requirements (Playwright)
Must have E2E tests for:
- [ ] Login and role-based redirect
- [ ] Employee leave apply and manager approval
- [ ] KYC document upload (mock file)
- [ ] Public job application (`/apply/:token`)
- [ ] Walk-in kiosk 5-step form
- [ ] Payroll run and salary slip download
- [ ] PWA install prompt on mobile viewport

### RBAC Matrix Test Requirements
For each of the 7 roles, test:
- [ ] Can access routes they should access (200)
- [ ] Blocked from routes they should not access (403)
- [ ] Self-approval is blocked (403 on own resource approval)
- [ ] Manager cannot access non-team employee (403)

Minimum RBAC test matrix: 7 roles × 40 routes = 280 test cases.

## CI Quality Gate Configuration
Add to `.github/workflows/deploy.yml`:
```yaml
- name: Run unit tests with coverage
  run: npm run test --workspace=backend -- --coverage --reporter=verbose
  
- name: Enforce coverage threshold
  run: |
    node -e "
      const cov = require('./backend/coverage/coverage-summary.json');
      const pct = cov.total.lines.pct;
      if (pct < 80) { console.error('Coverage ' + pct + '% < 80%'); process.exit(1); }
      console.log('Coverage ' + pct + '% OK');
    "

- name: Run E2E tests
  run: cd frontend && npx playwright test --reporter=github

- name: RBAC matrix test
  run: npm run test:rbac --workspace=backend
```

## Test File Organization
```
backend/src/
  modules/leave/__tests__/leave.service.test.ts
  modules/payroll/__tests__/payroll.service.test.ts
  modules/auth/__tests__/auth.service.test.ts
  modules/kyc/__tests__/document-gate.service.test.ts
  utils/__tests__/encryption.test.ts
  utils/__tests__/payrollCalculations.test.ts
  __tests__/rbac.integration.test.ts
  __tests__/setup.ts (global test setup)

frontend/src/
  features/leave/__tests__/LeavePage.test.tsx
  features/auth/__tests__/LoginPage.test.tsx
  e2e/leave-flow.spec.ts
  e2e/login.spec.ts
  e2e/kyc-upload.spec.ts
```

## Test Data Rules
- Use `faker` for dynamic data generation in tests
- Never use hardcoded UUIDs that look like real data
- Test DB is separate from dev DB (`.env.test` file)
- Truncate test data after each test suite (not each test — too slow)
- Never run tests against production database

## Score Mapping
- 14 tests, 0 coverage enforcement: 3.5/10
- 200 tests, no E2E, 60% coverage: 6.5/10
- 400 tests, 10 E2E, 80% coverage, CI gate: 8.0/10
- 800+ tests, 60 E2E, 80%+ coverage, RBAC matrix, CI gate: 9.5/10