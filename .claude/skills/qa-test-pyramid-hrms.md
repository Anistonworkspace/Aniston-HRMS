---
name: qa-test-pyramid-hrms
description: "Skill for HRMS test pyramid: write unit, integration, E2E, and RBAC matrix tests for all modules using Vitest, RTL, and Playwright"
type: skill
---

# QA Test Pyramid Skill — Aniston HRMS

## When to Use
Use when asked to:
- Write tests for a specific module
- Set up testing infrastructure
- Implement RBAC matrix tests
- Write E2E scenarios
- Increase coverage for a service

## Test Setup Files

### Backend Test Setup (`backend/src/__tests__/setup.ts`)
```typescript
import { beforeAll, afterAll, afterEach, vi } from 'vitest';

// Mock Prisma for unit tests
vi.mock('../lib/prisma', () => ({
  default: {
    employee: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    leaveRequest: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    leaveBalance: { findFirst: vi.fn(), update: vi.fn() },
    // ... all models used
    $transaction: vi.fn((fn) => fn(prisma)),
  }
}));

// Mock BullMQ queues
vi.mock('../jobs/queues', () => ({
  emailQueue: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) },
  notificationQueue: { add: vi.fn().mockResolvedValue({ id: 'job-2' }) },
  payrollQueue: { add: vi.fn().mockResolvedValue({ id: 'job-3' }) },
}));

afterEach(() => {
  vi.clearAllMocks();
});
```

### Frontend Test Setup (`frontend/src/__tests__/setup.ts`)
```typescript
import '@testing-library/jest-dom';
import { server } from './mswServer';

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Unit Test Templates

### Service Method Test
```typescript
// backend/src/modules/leave/__tests__/leave.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeaveService } from '../leave.service';
import prisma from '../../../lib/prisma';
import { ForbiddenError } from '../../../middleware/errorHandler';

describe('LeaveService', () => {
  let service: LeaveService;
  
  beforeEach(() => {
    service = new LeaveService();
  });

  describe('approveLeave', () => {
    it('should approve a pending leave request', async () => {
      const mockLeave = { id: 'leave-1', employeeId: 'emp-1', status: 'PENDING', days: 2 };
      const mockBalance = { id: 'bal-1', employeeId: 'emp-1', remaining: 10 };
      
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(mockLeave as any);
      vi.mocked(prisma.leaveBalance.findFirst).mockResolvedValue(mockBalance as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma as any));

      await service.approveLeave('leave-1', 'manager-1', 'emp-manager-1');
      
      expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) })
      );
    });

    it('should throw ForbiddenError when employee tries to approve own leave', async () => {
      const mockLeave = { id: 'leave-1', employeeId: 'emp-1', status: 'PENDING' };
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(mockLeave as any);

      await expect(
        service.approveLeave('leave-1', 'user-1', 'emp-1')  // Same employee
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw when leave is not in PENDING status', async () => {
      const mockLeave = { id: 'leave-1', employeeId: 'emp-1', status: 'APPROVED' };
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(mockLeave as any);

      await expect(
        service.approveLeave('leave-1', 'manager-1', 'emp-2')
      ).rejects.toThrow();
    });
  });
});
```

### Payroll Calculation Test
```typescript
// backend/src/modules/payroll/__tests__/payroll.calculations.test.ts
describe('Indian Payroll Calculations', () => {
  describe('EPF', () => {
    it('calculates 12% of basic when basic <= 15000', () => {
      expect(calculateEmployeeEpf(14000)).toBe(1680);  // 14000 * 12%
    });
    
    it('caps EPF at 15000 basic when basic > 15000', () => {
      expect(calculateEmployeeEpf(20000)).toBe(1800);  // 15000 * 12% = 1800
    });
  });

  describe('ESI', () => {
    it('applies 0.75% employee ESI when gross <= 21000', () => {
      expect(calculateEmployeeEsi(20000)).toBe(150);  // 20000 * 0.75%
    });
    
    it('applies 0% ESI when gross > 21000', () => {
      expect(calculateEmployeeEsi(22000)).toBe(0);
    });
  });
});
```

## RBAC Matrix Test
```typescript
// backend/src/__tests__/rbac.integration.test.ts
import supertest from 'supertest';
import app from '../app';
import { createTestToken } from './helpers/auth';

const RBAC_CASES = [
  // [method, path, role, expectedStatus, description]
  ['GET', '/api/employees', 'EMPLOYEE', 403, 'employee cannot list all employees'],
  ['GET', '/api/employees', 'HR', 200, 'HR can list employees'],
  ['POST', '/api/employees', 'MANAGER', 403, 'manager cannot create employee'],
  ['POST', '/api/employees', 'ADMIN', 201, 'admin can create employee'],
  ['GET', '/api/payroll', 'EMPLOYEE', 403, 'employee cannot view all payroll'],
  ['GET', '/api/payroll/my', 'EMPLOYEE', 200, 'employee can view own payroll'],
  ['POST', '/api/payroll/run', 'HR', 403, 'HR cannot run payroll'],
  ['POST', '/api/payroll/run', 'ADMIN', 200, 'admin can run payroll'],
] as const;

describe('RBAC Matrix', () => {
  RBAC_CASES.forEach(([method, path, role, expected, description]) => {
    it(`${description}`, async () => {
      const token = createTestToken({ role });
      const res = await supertest(app)[method.toLowerCase()](path)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(expected);
    });
  });
});
```

## E2E Test Template (Playwright)
```typescript
// frontend/e2e/leave-flow.spec.ts
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Leave Application Flow', () => {
  test('employee can apply for leave', async ({ page }) => {
    await loginAs(page, 'employee');
    await page.goto('/leave');
    await page.getByRole('button', { name: 'Apply Leave' }).click();
    
    await page.getByLabel('Leave Type').selectOption('Annual Leave');
    await page.getByLabel('Start Date').fill('2026-06-01');
    await page.getByLabel('End Date').fill('2026-06-03');
    await page.getByLabel('Reason').fill('Family vacation');
    await page.getByRole('button', { name: 'Submit' }).click();
    
    await expect(page.getByText('Leave request submitted')).toBeVisible();
    await expect(page.getByText('PENDING')).toBeVisible();
  });

  test('manager can approve leave', async ({ page }) => {
    await loginAs(page, 'manager');
    await page.goto('/leave');
    await page.getByRole('tab', { name: 'Team Requests' }).click();
    
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    
    await expect(page.getByText('Leave approved')).toBeVisible();
  });
});
```

## Coverage Tracking
After writing tests, run:
```bash
npm run test --workspace=backend -- --coverage --reporter=text
```
Look for lines: `Lines: X% (Y/Z)` — target >= 80% for service files.