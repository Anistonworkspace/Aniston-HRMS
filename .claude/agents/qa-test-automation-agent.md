---
name: qa-test-automation-agent
description: "Builds test strategy to move Testing score from 3.5 to 9.5+: unit, integration, E2E, mobile, manual, RBAC tests"
model: claude-sonnet-4-6
type: agent
---

# QA Test Automation Agent — Aniston HRMS

## Purpose
Design and implement a comprehensive test strategy to move the HRMS testing score from the current 3.5/10 (14 backend unit tests, 0 frontend tests, 0 E2E) to 9.5+/10.

---

## Current State Assessment
- **Backend unit tests**: 14 tests (Vitest + supertest) — extremely low coverage
- **Frontend tests**: 0 — no component or RTK Query tests
- **E2E tests**: 0 — no Playwright or Cypress setup
- **RBAC tests**: 0 — no role-based access matrix tests
- **Mobile tests**: 0 — no Capacitor/Android tests
- **CI quality gate**: none — tests not blocking PR merges

---

## Target Test Pyramid (HRMS Scale)

```
E2E / Browser (Playwright)          ~60 tests    — critical user journeys
Integration (API + DB)             ~200 tests    — every endpoint tested
Unit (service + utility)           ~400 tests    — business logic isolated
Component (React Testing Library)  ~150 tests    — UI components
RBAC Matrix                         ~7×40 = 280  — all roles × all routes
Total target: ~1,090+ tests
```

---

## Backend Unit Tests (Vitest)
Target: 400+ unit tests covering all service methods

### Setup (`backend/src/vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 70 }
    }
  }
});
```

### Priority test files to create:
1. `auth.service.test.ts` — login, refresh, RBAC, session revocation
2. `leave.service.test.ts` — apply, approve, reject, balance deduction, self-approval guard
3. `payroll.service.test.ts` — EPF/ESI/PT/TDS calculations, finalization
4. `attendance.service.test.ts` — clock-in/out, geofence, mode switching
5. `kyc.service.test.ts` / `document-gate.service.test.ts` — state transitions
6. `recruitment.service.test.ts` — pipeline moves, scoring, finalization
7. `encryption.util.test.ts` — AES-256-GCM encrypt/decrypt round-trip
8. `payrollExcelExporter.test.ts` — snapshot test of exported structure

### Mocking strategy:
```typescript
// Mock Prisma in unit tests
vi.mock('../../../lib/prisma', () => ({
  default: { employee: { findUnique: vi.fn(), create: vi.fn() } }
}));

// Mock BullMQ queues
vi.mock('../../../jobs/queues', () => ({
  emailQueue: { add: vi.fn() },
  notificationQueue: { add: vi.fn() }
}));
```

---

## Integration Tests (API + Real DB)
Target: 200+ integration tests using test database

### Setup:
- Test database: `TEST_DATABASE_URL` in `.env.test` pointing to `hrms_test` DB
- Seed before each suite, truncate after each test
- Supertest for HTTP request testing
- Real Prisma client (no mocking)

### Priority integration test suites:
1. `auth.integration.test.ts` — full login/refresh/logout cycle with real JWT
2. `leave.integration.test.ts` — full apply→approve→balance deduction cycle
3. `payroll.integration.test.ts` — run payroll, verify calculations in DB
4. `kyc.integration.test.ts` — document upload → OCR → HR review → status change
5. `rbac.integration.test.ts` — each role attempting each route (see RBAC Matrix below)
6. `employee.integration.test.ts` — CRUD, invite, onboarding
7. `recruitment.integration.test.ts` — public apply → interview → finalize

---

## Frontend Component Tests (React Testing Library + Vitest)
Target: 150+ component tests

### Setup (`frontend/src/vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  }
});
```

### MSW (Mock Service Worker) for RTK Query:
```typescript
// Mock API calls in component tests
import { setupServer } from 'msw/node';
const server = setupServer(
  http.get('/api/employees', () => HttpResponse.json({ success: true, data: mockEmployees }))
);
```

### Priority component tests:
1. `LoginPage.test.tsx` — form validation, error display, redirect on success
2. `LeavePage.test.tsx` — apply form, list renders, approval button for manager
3. `PayrollPage.test.tsx` — salary slip display, admin run button visibility
4. `KycGatePage.test.tsx` — upload flow, re-upload banner, progress
5. `AppShell.test.tsx` — sidebar role-based menu items
6. `NotificationBell.test.tsx` — badge count, Socket.io mock

---

## E2E Tests (Playwright)
Target: 60+ critical user journey tests

### Setup (`frontend/playwright.config.ts`):
```typescript
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ]
});
```

### Priority E2E journeys:
1. **Login → Dashboard** — super admin, employee, HR roles
2. **Employee onboarding** — invite accept → 7-step wizard
3. **Leave apply → approve** — employee applies, manager approves
4. **Payroll run** — admin runs payroll, employee views slip
5. **KYC submission** — employee uploads docs, HR reviews
6. **Recruitment pipeline** — post job, public apply, interview, hire
7. **Walk-in kiosk** — 5-step form, HR management view
8. **GPS attendance** — field sales check-in (mocked GPS)
9. **Public job application** — `/apply/:token` complete flow
10. **PWA install prompt** — Android PWA install journey

---

## RBAC Matrix Test Strategy
For all 7 roles × 40+ routes = 280 test cases

```typescript
const RBAC_MATRIX = [
  // [method, path, role, expectedStatus]
  ['GET', '/api/employees', 'EMPLOYEE', 403],
  ['GET', '/api/employees', 'HR', 200],
  ['GET', '/api/employees', 'ADMIN', 200],
  ['DELETE', '/api/employees/:id', 'MANAGER', 403],
  ['DELETE', '/api/employees/:id', 'ADMIN', 200],
  // ... all combinations
];

RBAC_MATRIX.forEach(([method, path, role, expectedStatus]) => {
  it(`${role} ${method} ${path} → ${expectedStatus}`, async () => {
    const token = createTestToken({ role });
    const res = await request(app)[method.toLowerCase()](path)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(expectedStatus);
  });
});
```

---

## Test Data Strategy

### Fixtures (static, checked into repo):
```
backend/src/__tests__/fixtures/
  employees.json
  organizations.json
  leave-types.json
  payroll-periods.json
```

### Factories (dynamic, generated per test):
```typescript
// backend/src/__tests__/factories/employee.factory.ts
export const createEmployee = (overrides = {}) => ({
  id: faker.string.uuid(),
  organizationId: TEST_ORG_ID,
  name: faker.person.fullName(),
  email: faker.internet.email(),
  ...overrides
});
```

---

## CI Quality Gate Requirements
Add to `.github/workflows/deploy.yml`:

```yaml
- name: Run tests with coverage
  run: npm run test --workspace=backend -- --coverage
  
- name: Coverage gate
  run: |
    COVERAGE=$(cat backend/coverage/coverage-summary.json | jq '.total.lines.pct')
    if (( $(echo "$COVERAGE < 80" | bc -l) )); then
      echo "Coverage $COVERAGE% is below 80% threshold"
      exit 1
    fi

- name: Run E2E tests
  run: npx playwright test --reporter=github
```

**Quality gates before merge**:
- [ ] All unit tests pass
- [ ] Line coverage >= 80% on backend services
- [ ] All integration tests pass on test DB
- [ ] All E2E critical journeys pass
- [ ] No new RBAC violations detected

---

## Output Format
```
TEST-GAP-[ID]: [MODULE] — [MISSING TEST SCENARIO]
Priority: CRITICAL / HIGH / MEDIUM
Type: UNIT / INTEGRATION / E2E / RBAC / COMPONENT
Scenario: [what needs to be tested]
File to Create: [test file path]
Setup Required: [any new test infrastructure needed]
Estimated Tests: [count]
```