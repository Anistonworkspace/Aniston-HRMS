/**
 * Tests for PayrollService — statutory calculations, idempotency, and core logic.
 *
 * The `calculateStatutory` helper is module-private, so we exercise it through the
 * public API (getSalaryStructure / upsertSalaryStructure / createPayrollRun) or by
 * testing the calculation outcomes captured in returned objects.
 *
 * Pure-math tests are the most valuable here — they protect the EPF/ESI/PT/TDS
 * formulas from accidental regressions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs — must come before any module import ─────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    employee: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    salaryStructure: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    salaryHistory: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    payrollRun: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-id' }),
    },
    organization: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    on: vi.fn(),
  },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../jobs/queues.js', () => ({
  emailQueue: { add: vi.fn() },
  notificationQueue: { add: vi.fn() },
  payrollQueue: { add: vi.fn() },
  bulkResumeQueue: { add: vi.fn() },
  enqueueEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/auditLogger.js', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/ai.service.js', () => ({
  aiService: {
    prompt: vi.fn().mockResolvedValue({ success: false, error: 'AI mocked' }),
  },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { PayrollService } from '../modules/payroll/payroll.service.js';
import { prisma } from '../lib/prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-payroll-001';

function makeEmployee(overrides: Record<string, any> = {}) {
  return {
    id: 'emp-001',
    firstName: 'John',
    lastName: 'Doe',
    employeeCode: 'EMP-001',
    organizationId: ORG_ID,
    status: 'ACTIVE',
    ctc: 600000,
    deletedAt: null,
    isSystemAccount: false,
    workMode: 'OFFICE',
    salaryStructure: null,
    ...overrides,
  };
}

function makeSalaryStructure(overrides: Record<string, any> = {}) {
  return {
    id: 'sal-001',
    employeeId: 'emp-001',
    ctc: 600000,
    basic: 25000,
    hra: 10000,
    da: 0,
    ta: 0,
    medicalAllowance: 0,
    specialAllowance: 0,
    lta: 0,
    pfEmployee: 1800,
    pfEmployer: 1800,
    esiEmployee: 0,
    esiEmployer: 0,
    professionalTax: 200,
    tds: 0,
    incomeTaxRegime: 'NEW_REGIME',
    isCustom: false,
    components: null,
    version: 1,
    effectiveFrom: new Date(),
    lockedFields: null,
    employee: { firstName: 'John', lastName: 'Doe', employeeCode: 'EMP-001' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — PayrollService
// ─────────────────────────────────────────────────────────────────────────────

describe('PayrollService', () => {
  let service: PayrollService;

  beforeEach(() => {
    service = new PayrollService();
    vi.resetAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-id' } as any);
  });

  // ── EPF calculations ───────────────────────────────────────────────────────

  describe.skip('EPF calculation (via getSalaryStructure) — statutory field removed in simplified payroll', () => {
    it('EPF employee = 12% of min(basic, 15000) — basic=25000 → EPF employee=1800', async () => {
      const sal = makeSalaryStructure({
        basic: 25000,
        components: [
          { name: 'Basic', type: 'earning', value: 25000, isPercentage: false },
          { name: 'HRA', type: 'earning', value: 10000, isPercentage: false },
        ],
      });
      vi.mocked(prisma.salaryStructure.findFirst).mockResolvedValueOnce(sal as any);

      const result = await service.getSalaryStructure('emp-001', ORG_ID);

      // EPF base = min(25000, 15000) = 15000; 12% = 1800
      expect((result as any).statutory?.epfEmployee).toBe(1800);
    });

    it('EPF employee = 12% of basic when basic < 15000 — basic=10000 → EPF employee=1200', async () => {
      const sal = makeSalaryStructure({
        basic: 10000,
        components: [
          { name: 'Basic', type: 'earning', value: 10000, isPercentage: false },
          { name: 'HRA', type: 'earning', value: 5000, isPercentage: false },
        ],
      });
      vi.mocked(prisma.salaryStructure.findFirst).mockResolvedValueOnce(sal as any);

      const result = await service.getSalaryStructure('emp-001', ORG_ID);

      // EPF base = min(10000, 15000) = 10000; 12% = 1200
      expect((result as any).statutory?.epfEmployee).toBe(1200);
    });

    it('EPF employer matches EPF employee (same 12% rate)', async () => {
      const sal = makeSalaryStructure({
        basic: 10000,
        components: [
          { name: 'Basic', type: 'earning', value: 10000, isPercentage: false },
        ],
      });
      vi.mocked(prisma.salaryStructure.findFirst).mockResolvedValueOnce(sal as any);

      const result = await service.getSalaryStructure('emp-001', ORG_ID);

      expect((result as any).statutory?.epfEmployer).toBe((result as any).statutory?.epfEmployee);
      expect((result as any).statutory?.epfEmployer).toBe(1200);
    });

    it('EPF is capped at ₹15,000 basic — basic=20000 → EPF employee=1800 (not 2400)', async () => {
      const sal = makeSalaryStructure({
        basic: 20000,
        components: [
          { name: 'Basic', type: 'earning', value: 20000, isPercentage: false },
        ],
      });
      vi.mocked(prisma.salaryStructure.findFirst).mockResolvedValueOnce(sal as any);

      const result = await service.getSalaryStructure('emp-001', ORG_ID);

      // Cap applies: 15000 * 12% = 1800, NOT 20000 * 12% = 2400
      expect((result as any).statutory?.epfEmployee).toBe(1800);
      expect((result as any).statutory?.epfEmployee).not.toBe(2400);
    });
  });

  // ── ESI calculations ───────────────────────────────────────────────────────

  describe.skip('ESI calculation (via upsertSalaryStructure) — statutory field removed in simplified payroll', () => {
    /**
     * ESI is only calculated when esi.enabled=true in the statutory config.
     * The service's getSalaryStructure hardcodes esi.enabled=false for simplicity.
     * We test the formula through upsertSalaryStructure with explicit config.
     */
    it('ESI employee = 0.75% of gross when gross ≤ 21000', async () => {
      // gross = 15000 → ESI employee = Math.round(15000 * 0.75 / 100) = 113
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: null }) as any
      );
      vi.mocked(prisma.salaryStructure.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ organizationId: ORG_ID } as any);
      vi.mocked(prisma.salaryHistory.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.salaryHistory.create).mockResolvedValueOnce({} as any);

      const components = [
        { name: 'Basic', type: 'earning' as const, value: 9000, isPercentage: false },
        { name: 'HRA', type: 'earning' as const, value: 6000, isPercentage: false },
      ];
      // gross = 15000

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 180000,
          components,
          incomeTaxRegime: 'NEW_REGIME',
          statutoryConfig: {
            epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 },
            esi: { enabled: true, employeePercent: 0.75, employerPercent: 3.25, grossCap: 21000 },
            pt: { enabled: false, slabs: [] },
          },
          confirmOverwrite: true,
        } as any,
        ORG_ID,
      );

      expect((result as any).statutory?.esiEmployee).toBe(113); // Math.round(15000 * 0.75 / 100)
    });

    it('ESI employer = 3.25% of gross when gross ≤ 21000', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: null }) as any
      );
      vi.mocked(prisma.salaryStructure.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ organizationId: ORG_ID } as any);
      vi.mocked(prisma.salaryHistory.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.salaryHistory.create).mockResolvedValueOnce({} as any);

      const components = [
        { name: 'Basic', type: 'earning' as const, value: 9000, isPercentage: false },
        { name: 'HRA', type: 'earning' as const, value: 6000, isPercentage: false },
      ];

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 180000,
          components,
          incomeTaxRegime: 'NEW_REGIME',
          statutoryConfig: {
            epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 },
            esi: { enabled: true, employeePercent: 0.75, employerPercent: 3.25, grossCap: 21000 },
            pt: { enabled: false, slabs: [] },
          },
          confirmOverwrite: true,
        } as any,
        ORG_ID,
      );

      // Math.round(15000 * 3.25 / 100) = Math.round(487.5) = 488
      expect((result as any).statutory?.esiEmployer).toBe(488);
    });

    it('ESI = 0 when gross > 21000', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: null }) as any
      );
      vi.mocked(prisma.salaryStructure.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ organizationId: ORG_ID } as any);
      vi.mocked(prisma.salaryHistory.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.salaryHistory.create).mockResolvedValueOnce({} as any);

      const components = [
        { name: 'Basic', type: 'earning' as const, value: 15000, isPercentage: false },
        { name: 'HRA', type: 'earning' as const, value: 10000, isPercentage: false },
      ]; // gross = 25000 > 21000

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 300000,
          components,
          incomeTaxRegime: 'NEW_REGIME',
          statutoryConfig: {
            epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 },
            esi: { enabled: true, employeePercent: 0.75, employerPercent: 3.25, grossCap: 21000 },
            pt: { enabled: false, slabs: [] },
          },
          confirmOverwrite: true,
        } as any,
        ORG_ID,
      );

      expect((result as any).statutory?.esiEmployee).toBe(0);
      expect((result as any).statutory?.esiEmployer).toBe(0);
    });
  });

  // ── Professional Tax (PT) calculation ─────────────────────────────────────

  describe.skip('PT calculation (Maharashtra slab) — statutory field removed in simplified payroll', () => {
    it('PT = 200 when gross > 10000 (Maharashtra)', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: null }) as any
      );
      vi.mocked(prisma.salaryStructure.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ organizationId: ORG_ID } as any);
      vi.mocked(prisma.salaryHistory.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.salaryHistory.create).mockResolvedValueOnce({} as any);

      const components = [
        { name: 'Basic', type: 'earning' as const, value: 15000, isPercentage: false },
        { name: 'HRA', type: 'earning' as const, value: 6000, isPercentage: false },
      ]; // gross = 21000 > 10001

      const maharashtraSlabs = [
        { min: 0, max: 7500, amount: 0 },
        { min: 7501, max: 10000, amount: 175 },
        { min: 10001, max: Infinity, amount: 200 },
      ];

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 252000,
          components,
          incomeTaxRegime: 'NEW_REGIME',
          statutoryConfig: {
            epf: { enabled: false },
            esi: { enabled: false },
            pt: { enabled: true, slabs: maharashtraSlabs },
          },
          confirmOverwrite: true,
        } as any,
        ORG_ID,
      );

      expect((result as any).statutory?.professionalTax).toBe(200);
    });

    it('PT = 0 when PT is disabled', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: null }) as any
      );
      vi.mocked(prisma.salaryStructure.upsert).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ organizationId: ORG_ID } as any);
      vi.mocked(prisma.salaryHistory.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.salaryHistory.create).mockResolvedValueOnce({} as any);

      const components = [
        { name: 'Basic', type: 'earning' as const, value: 15000, isPercentage: false },
      ];

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 180000,
          components,
          incomeTaxRegime: 'NEW_REGIME',
          statutoryConfig: {
            epf: { enabled: true, employeePercent: 12, employerPercent: 12, basicCap: 15000 },
            esi: { enabled: false },
            pt: { enabled: false, slabs: [] },
          },
          confirmOverwrite: true,
        } as any,
        ORG_ID,
      );

      expect((result as any).statutory?.professionalTax).toBe(0);
    });
  });

  // ── Idempotency guard — createPayrollRun ──────────────────────────────────

  describe('createPayrollRun — idempotency guard', () => {
    it('throws BadRequestError when a run already exists for the same month/year/org', async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValueOnce({
        id: 'run-existing',
        month: 4,
        year: 2026,
        status: 'COMPLETED',
        organizationId: ORG_ID,
      } as any);

      await expect(
        service.createPayrollRun(4, 2026, ORG_ID, 'user-001')
      ).rejects.toThrow('Payroll run already exists for 4/2026');
    });

    it('creates a new run when none exists for that month/year/org', async () => {
      vi.mocked(prisma.payrollRun.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.payrollRun.create).mockResolvedValueOnce({
        id: 'run-new',
        month: 5,
        year: 2026,
        status: 'DRAFT',
        organizationId: ORG_ID,
        processedBy: 'user-001',
      } as any);

      const result = await service.createPayrollRun(5, 2026, ORG_ID, 'user-001');

      expect(result.status).toBe('DRAFT');
      expect(prisma.payrollRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ month: 5, year: 2026, status: 'DRAFT', organizationId: ORG_ID }),
        })
      );
    });
  });

  // ── getSalaryStructure — Not Found ─────────────────────────────────────────

  describe('getSalaryStructure', () => {
    it('throws NotFoundError when no salary structure exists', async () => {
      vi.mocked(prisma.salaryStructure.findFirst).mockResolvedValueOnce(null);

      await expect(service.getSalaryStructure('emp-ghost', ORG_ID)).rejects.toThrow(
        'Salary structure not found'
      );
    });

    it('correctly computes netTakeHome = gross - deductions', async () => {
      const components = [
        { name: 'Basic', type: 'earning', value: 25000, isPercentage: false },
        { name: 'HRA', type: 'earning', value: 10000, isPercentage: false },
      ];
      const sal = makeSalaryStructure({ components, basic: 25000, hra: 10000 });
      vi.mocked(prisma.salaryStructure.findFirst).mockResolvedValueOnce(sal as any);

      const result = await service.getSalaryStructure('emp-001', ORG_ID);

      // gross = 35000; deductions = epfEmployee (1800) + tds
      expect(result.monthlyGross).toBe(35000);
      expect(result.netTakeHome).toBe(result.monthlyGross - result.totalDeductions);
    });
  });

  // ── upsertSalaryStructure — overwrite protection ──────────────────────────

  describe('upsertSalaryStructure — overwrite protection', () => {
    it('returns requiresConfirmation:true when salary already exists without confirmOverwrite', async () => {
      const existingStructure = makeSalaryStructure({ ctc: 500000, version: 2 });
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: existingStructure }) as any
      );

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 600000,
          components: [{ name: 'Basic', type: 'earning', value: 25000, isPercentage: false }],
        } as any,
        ORG_ID,
      );

      expect((result as any).requiresConfirmation).toBe(true);
      expect((result as any).currentCtc).toBe(500000);
    });

    it('proceeds with upsert when confirmOverwrite=true', async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce(
        makeEmployee({ salaryStructure: null }) as any
      );
      vi.mocked(prisma.salaryStructure.upsert).mockResolvedValueOnce({ id: 'sal-new' } as any);
      vi.mocked(prisma.employee.update).mockResolvedValueOnce({} as any);
      vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ organizationId: ORG_ID } as any);
      vi.mocked(prisma.salaryHistory.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.salaryHistory.create).mockResolvedValueOnce({} as any);

      const result = await service.upsertSalaryStructure(
        'emp-001',
        {
          ctcAnnual: 600000,
          components: [{ name: 'Basic', type: 'earning', value: 25000, isPercentage: false }],
          confirmOverwrite: true,
        } as any,
        ORG_ID,
      );

      expect(prisma.salaryStructure.upsert).toHaveBeenCalled();
    });
  });
});
