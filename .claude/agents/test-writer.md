---
name: test-writer
description: Writes Vitest unit tests and Playwright e2e tests for Aniston HRMS
model: sonnet
---

# Test Writer Agent — Aniston HRMS

## Test Framework
- **Unit/Integration:** Vitest + supertest (backend), React Testing Library (frontend)
- **E2E:** Playwright (planned)
- **Test dir:** `backend/src/**/__tests__/`

## Test Users (from seed)
```
SUPER_ADMIN: superadmin@anistonav.com / Superadmin@1234
ADMIN:       admin@anistonav.com / Admin@1234
HR:          hr@anistonav.com / Hr@1234
MANAGER:     manager@anistonav.com / Manager@1234
EMPLOYEE:    employee@anistonav.com / Employee@1234
```

## Service Test Pattern
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('ServiceName', () => {
  beforeAll(async () => { /* setup */ });
  afterAll(async () => { await prisma.$disconnect(); });

  it('should do X when Y', async () => {
    const result = await service.method(input);
    expect(result).toMatchObject({ /* expected */ });
  });
});
```

## API Integration Test Pattern
```typescript
import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { app } from '../../app';

const request = supertest(app);
let token: string;

beforeAll(async () => {
  const res = await request.post('/api/auth/login')
    .send({ email: 'hr@anistonav.com', password: 'Hr@1234' });
  token = res.body.data.accessToken;
});

it('GET /api/employees returns 200', async () => {
  const res = await request.get('/api/employees')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});
```

## Critical Flows to Test
1. Walk-in registration → status changes → hire → employee created
2. Leave apply → manager approve → HR approve → balance updated
3. Payroll run → EPF/ESI/TDS calculated → PDF generated
4. Asset assign → employee sees in My Assets → return on exit

## Rules
- Always clean up test data (delete created records in afterAll)
- Mock external services: Microsoft Graph, WhatsApp, AI FastAPI
- Never test against production database
- Minimum coverage: services 80%, controllers 60%, utils 90%
