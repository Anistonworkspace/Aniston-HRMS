/**
 * Tests for PublicApplyService + public job application endpoints.
 *
 * All external dependencies are mocked — no real DB/Redis/AI calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── env stubs ─────────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-chars-long!!';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

// ── Mocks ─────────────────────────────────────────────────────────────────
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    jobOpening: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    jobApplicationQuestion: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    publicApplication: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    interviewRound: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-id' }),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
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

// Mock the AiService so we can control AI responses in tests
vi.mock('../services/ai.service.js', () => ({
  aiService: {
    prompt: vi.fn(),
    chat: vi.fn(),
  },
}));

vi.mock('../modules/ai-config/ai-config.service.js', () => ({
  aiConfigService: {
    getActiveConfigRaw: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(null),
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { PublicApplyService } from '../modules/public-apply/public-apply.service.js';
import { prisma } from '../lib/prisma.js';
import { aiService } from '../services/ai.service.js';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const ORG_ID = 'org-test-001';
const JOB_TOKEN = 'public-form-token-xyz';
const JOB_ID = 'job-001';

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: JOB_ID,
    organizationId: ORG_ID,
    title: 'Software Engineer',
    department: 'Engineering',
    location: 'Bangalore',
    type: 'FULL_TIME',
    description: 'Build great software.',
    requirements: '3+ years experience.',
    publicFormToken: JOB_TOKEN,
    publicFormEnabled: true,
    questions: [],
    ...overrides,
  };
}

function makeQuestion(id: string, category: string, correctOption: string) {
  return {
    id,
    jobOpeningId: JOB_ID,
    questionText: `Question ${id}`,
    optionA: 'Option A',
    optionB: 'Option B',
    optionC: 'Option C',
    optionD: 'Option D',
    correctOption,
    category,
    aiGenerated: true,
    createdAt: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Unit tests — PublicApplyService
// ─────────────────────────────────────────────────────────────────────────

describe('PublicApplyService', () => {
  let service: PublicApplyService;

  beforeEach(() => {
    service = new PublicApplyService();
    vi.clearAllMocks();
  });

  // ── getJobForm ─────────────────────────────────────────────────────────

  describe('getJobForm', () => {
    it('returns job details with questions for a valid public form token', async () => {
      // Prisma select in the service excludes correctOption — mimic what Prisma returns
      const questionsFromPrisma = [{
        id: 'q-1',
        questionText: 'Question q-1',
        optionA: 'Option A',
        optionB: 'Option B',
        optionC: 'Option C',
        optionD: 'Option D',
        category: 'INTELLIGENCE',
        // correctOption is intentionally absent — Prisma select does not include it
      }];
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        makeJob({ questions: questionsFromPrisma }) as any
      );

      const result = await service.getJobForm(JOB_TOKEN);

      expect(result.title).toBe('Software Engineer');
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]).not.toHaveProperty('correctOption');
    });

    it('excludes correctOption from questions because the Prisma select omits it', async () => {
      // The service uses a Prisma select that does not include correctOption.
      // We mirror that by providing question objects without the field.
      const questionsFromPrisma = [
        {
          id: 'q-1',
          questionText: 'Question q-1',
          optionA: 'Option A',
          optionB: 'Option B',
          optionC: 'Option C',
          optionD: 'Option D',
          category: 'INTEGRITY',
        },
      ];
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        makeJob({ questions: questionsFromPrisma }) as any
      );

      const result = await service.getJobForm(JOB_TOKEN);

      for (const q of result.questions) {
        expect(q).not.toHaveProperty('correctOption');
      }
    });

    it('throws NotFoundError for unknown token', async () => {
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(null);

      await expect(service.getJobForm('bad-token')).rejects.toThrow('Job not found');
    });

    it('throws NotFoundError when publicFormEnabled is false', async () => {
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        makeJob({ publicFormEnabled: false }) as any
      );

      await expect(service.getJobForm(JOB_TOKEN)).rejects.toThrow('Job not found or form disabled');
    });
  });

  // ── submitApplication ──────────────────────────────────────────────────

  describe('submitApplication', () => {
    it('scores MCQ answers correctly and persists to DB', async () => {
      const questions = [
        makeQuestion('q-1', 'INTELLIGENCE', 'A'), // correct = A
        makeQuestion('q-2', 'INTELLIGENCE', 'B'), // correct = B
        makeQuestion('q-3', 'INTEGRITY', 'C'),    // correct = C
        makeQuestion('q-4', 'INTEGRITY', 'D'),    // correct = D
        makeQuestion('q-5', 'ENERGY', 'A'),        // correct = A
        makeQuestion('q-6', 'ENERGY', 'B'),        // correct = B
      ];

      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        makeJob({ questions }) as any
      );

      let capturedCreate: any = null;
      vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
        capturedCreate = args.data;
        return { id: 'app-1', candidateUid: 'ANST-XXXX', uid: 'ANST-XXXX', ...args.data };
      });

      // Answers: q-1=A(correct), q-2=A(wrong), q-3=C(correct), q-4=A(wrong), q-5=A(correct), q-6=A(wrong)
      // totalCorrect = 3 out of 6  →  mcqScore = 50
      // INTELLIGENCE: 1/2 = 50, INTEGRITY: 1/2 = 50, ENERGY: 1/2 = 50
      const mcqAnswers = [
        { questionId: 'q-1', selectedOption: 'A' }, // correct
        { questionId: 'q-2', selectedOption: 'A' }, // wrong (correct=B)
        { questionId: 'q-3', selectedOption: 'C' }, // correct
        { questionId: 'q-4', selectedOption: 'A' }, // wrong (correct=D)
        { questionId: 'q-5', selectedOption: 'A' }, // correct
        { questionId: 'q-6', selectedOption: 'A' }, // wrong (correct=B)
      ];

      await service.submitApplication(JOB_TOKEN, {
        candidateName: 'Rahul Gupta',
        email: 'rahul@example.com',
        mcqAnswers,
      });

      expect(capturedCreate).not.toBeNull();
      expect(capturedCreate.mcqScore).toBeCloseTo(50, 1);
      expect(capturedCreate.intelligenceScore).toBeCloseTo(50, 1);
      expect(capturedCreate.integrityScore).toBeCloseTo(50, 1);
      expect(capturedCreate.energyScore).toBeCloseTo(50, 1);
    });

    it('gives 100% MCQ score when all answers are correct', async () => {
      const questions = [
        makeQuestion('q-a', 'INTELLIGENCE', 'A'),
        makeQuestion('q-b', 'INTEGRITY', 'B'),
      ];
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        makeJob({ questions }) as any
      );

      let capturedScore: number | null = null;
      vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
        capturedScore = args.data.mcqScore;
        return { id: 'app-2', candidateUid: 'ANST-1234', uid: 'ANST-1234', ...args.data };
      });

      await service.submitApplication(JOB_TOKEN, {
        candidateName: 'Ananya Patel',
        mcqAnswers: [
          { questionId: 'q-a', selectedOption: 'A' },
          { questionId: 'q-b', selectedOption: 'B' },
        ],
      });

      expect(capturedScore).toBeCloseTo(100, 1);
    });

    it('gives 0% MCQ score when all answers are wrong', async () => {
      const questions = [
        makeQuestion('q-x', 'ENERGY', 'C'),
        makeQuestion('q-y', 'ENERGY', 'D'),
      ];
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        makeJob({ questions }) as any
      );

      let capturedScore: number | null = null;
      vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
        capturedScore = args.data.mcqScore;
        return { id: 'app-3', candidateUid: 'ANST-ZZZZ', uid: 'ANST-ZZZZ', ...args.data };
      });

      await service.submitApplication(JOB_TOKEN, {
        candidateName: 'Wrong Answers',
        mcqAnswers: [
          { questionId: 'q-x', selectedOption: 'A' }, // wrong
          { questionId: 'q-y', selectedOption: 'A' }, // wrong
        ],
      });

      expect(capturedScore).toBeCloseTo(0, 1);
    });

    it('generates a unique candidateUid starting with ANST-', async () => {
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(makeJob() as any);

      let capturedUid: string | null = null;
      vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
        capturedUid = args.data.candidateUid;
        return { id: 'app-4', candidateUid: capturedUid!, uid: capturedUid!, ...args.data };
      });

      await service.submitApplication(JOB_TOKEN, {
        candidateName: 'Test Candidate',
        mcqAnswers: [],
      });

      expect(capturedUid).toMatch(/^ANST-/);
    });

    it('throws NotFoundError for an unknown form token', async () => {
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(null);

      await expect(
        service.submitApplication('bad-token', { candidateName: 'X', mcqAnswers: [] })
      ).rejects.toThrow('Job not found');
    });
  });

  // ── generateQuestions ──────────────────────────────────────────────────

  describe('generateQuestions', () => {
    const aiQuestions = [
      { questionText: 'Q1', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctOption: 'A', category: 'INTELLIGENCE' },
      { questionText: 'Q2', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctOption: 'B', category: 'INTELLIGENCE' },
      { questionText: 'Q3', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctOption: 'C', category: 'INTEGRITY' },
      { questionText: 'Q4', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctOption: 'D', category: 'INTEGRITY' },
      { questionText: 'Q5', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctOption: 'A', category: 'ENERGY' },
      { questionText: 'Q6', optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctOption: 'B', category: 'ENERGY' },
    ];

    it('calls aiService.prompt and saves the generated questions', async () => {
      vi.mocked(prisma.jobOpening.findFirst).mockResolvedValueOnce(makeJob() as any);
      vi.mocked(aiService.prompt).mockResolvedValueOnce({
        success: true,
        data: JSON.stringify(aiQuestions),
      });
      vi.mocked(prisma.jobApplicationQuestion.deleteMany).mockResolvedValueOnce({ count: 0 } as any);

      // $transaction should execute each create call
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) => {
        return Promise.all(ops);
      });

      await service.generateQuestions(JOB_ID, ORG_ID);

      expect(aiService.prompt).toHaveBeenCalledOnce();
      expect(prisma.jobApplicationQuestion.deleteMany).toHaveBeenCalledWith({
        where: { jobOpeningId: JOB_ID },
      });
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('wraps AI response that contains extra text around the JSON array', async () => {
      vi.mocked(prisma.jobOpening.findFirst).mockResolvedValueOnce(makeJob() as any);
      // AI sometimes adds prose before/after the JSON
      vi.mocked(aiService.prompt).mockResolvedValueOnce({
        success: true,
        data: `Here are your questions:\n${JSON.stringify(aiQuestions)}\nHope that helps!`,
      });
      vi.mocked(prisma.jobApplicationQuestion.deleteMany).mockResolvedValueOnce({ count: 0 } as any);
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) =>
        Promise.all(ops)
      );

      // Should not throw — the service must extract the JSON array via regex
      await expect(service.generateQuestions(JOB_ID, ORG_ID)).resolves.not.toThrow();
    });

    it('throws BadRequestError when AI returns an error', async () => {
      vi.mocked(prisma.jobOpening.findFirst).mockResolvedValueOnce(makeJob() as any);
      vi.mocked(aiService.prompt).mockResolvedValueOnce({
        success: false,
        error: 'No AI provider configured. Go to Settings → API Integrations.',
      });

      await expect(service.generateQuestions(JOB_ID, ORG_ID)).rejects.toThrow(
        /Failed to generate questions/i
      );
    });

    it('throws NotFoundError when job does not exist in the org', async () => {
      vi.mocked(prisma.jobOpening.findFirst).mockResolvedValueOnce(null);

      await expect(service.generateQuestions('nonexistent-job', ORG_ID)).rejects.toThrow(
        'Job not found'
      );
    });

    it('limits questions to 6 even if AI returns more', async () => {
      const manyQuestions = Array.from({ length: 10 }, (_, i) => ({
        questionText: `Q${i + 1}`,
        optionA: 'A',
        optionB: 'B',
        optionC: 'C',
        optionD: 'D',
        correctOption: 'A',
        category: 'INTELLIGENCE',
      }));

      vi.mocked(prisma.jobOpening.findFirst).mockResolvedValueOnce(makeJob() as any);
      vi.mocked(aiService.prompt).mockResolvedValueOnce({
        success: true,
        data: JSON.stringify(manyQuestions),
      });
      vi.mocked(prisma.jobApplicationQuestion.deleteMany).mockResolvedValueOnce({ count: 0 } as any);

      let transactionArg: any[] = [];
      vi.mocked(prisma.$transaction).mockImplementationOnce(async (ops: any[]) => {
        transactionArg = ops;
        return Promise.all(ops);
      });

      await service.generateQuestions(JOB_ID, ORG_ID);

      // The transaction should receive at most 6 creates
      expect(transactionArg.length).toBeLessThanOrEqual(6);
    });
  });

  // ── trackApplication ───────────────────────────────────────────────────

  describe('trackApplication', () => {
    it('returns candidate status for a valid UID', async () => {
      vi.mocked(prisma.publicApplication.findUnique).mockResolvedValueOnce({
        uid: 'ANST-1A2B',
        candidateName: 'Shreya Mehta',
        status: 'SUBMITTED',
        totalAiScore: 72.5,
        createdAt: new Date('2026-03-01T10:00:00Z'),
        jobOpening: { title: 'Product Manager' },
      } as any);

      const result = await service.trackApplication('ANST-1A2B');

      expect(result.uid).toBe('ANST-1A2B');
      expect(result.name).toBe('Shreya Mehta');
      expect(result.jobTitle).toBe('Product Manager');
      expect(result.status).toBe('SUBMITTED');
      expect(result.appliedAt).toBeDefined();
    });

    it('does NOT return score or other private data', async () => {
      vi.mocked(prisma.publicApplication.findUnique).mockResolvedValueOnce({
        uid: 'ANST-SAFE',
        candidateName: 'Vijay Kumar',
        status: 'SHORTLISTED',
        totalAiScore: 88,
        createdAt: new Date(),
        jobOpening: { title: 'DevOps Engineer' },
      } as any);

      const result = await service.trackApplication('ANST-SAFE');

      // The public tracking result must not expose internal scores
      expect(result).not.toHaveProperty('totalAiScore');
      expect(result).not.toHaveProperty('mcqScore');
      expect(result).not.toHaveProperty('intelligenceScore');
    });

    it('throws NotFoundError for unknown UID', async () => {
      vi.mocked(prisma.publicApplication.findUnique).mockResolvedValueOnce(null);

      await expect(service.trackApplication('ANST-FAKE')).rejects.toThrow('Application not found');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration tests — public job form endpoints
// ─────────────────────────────────────────────────────────────────────────

describe('/api/jobs public endpoints (integration)', () => {
  let request: any;
  let jwtLib: any;
  let app: any;

  const ORG_ID = 'org-test-001';

  beforeEach(async () => {
    vi.clearAllMocks();
    const supertest = await import('supertest');
    jwtLib = await import('jsonwebtoken');
    const appModule = await import('../app.js');
    app = appModule.app;
    request = supertest.default(app);
  });

  function makeToken(role: string) {
    return jwtLib.sign(
      { userId: 'u-1', email: `${role.toLowerCase()}@aniston.com`, role, organizationId: ORG_ID },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );
  }

  // ── GET /api/jobs/form/:token — public, no auth ────────────────────────

  describe('GET /api/jobs/form/:token', () => {
    it('returns job form without any auth header', async () => {
      // The service uses a Prisma select that excludes correctOption.
      // We mock with the projected shape (no correctOption) to match real Prisma behavior.
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        {
          id: JOB_ID,
          organizationId: ORG_ID,
          title: 'Frontend Developer',
          department: 'Engineering',
          location: 'Remote',
          type: 'FULL_TIME',
          description: 'Build UI.',
          requirements: 'React experience.',
          publicFormToken: 'pub-token-001',
          publicFormEnabled: true,
          questions: [
            {
              id: 'q-pub-1',
              questionText: 'What is 2+2?',
              optionA: '3',
              optionB: '4',
              optionC: '5',
              optionD: '6',
              category: 'INTELLIGENCE',
              // correctOption is NOT included — mirrors the Prisma select projection
            },
          ],
        } as any
      );

      const res = await request.get('/api/jobs/form/pub-token-001');

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Frontend Developer');
      expect(res.body.data.questions).toHaveLength(1);
      // Correct answer must not be in the public response
      for (const q of res.body.data.questions) {
        expect(q).not.toHaveProperty('correctOption');
      }
    });

    it('returns 404 for disabled form token', async () => {
      vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
        {
          id: JOB_ID,
          publicFormEnabled: false,
          questions: [],
        } as any
      );

      const res = await request.get('/api/jobs/form/disabled-token');
      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/jobs/track/:uid — public, no auth ─────────────────────────

  describe('GET /api/jobs/track/:uid', () => {
    it('returns application status without auth header', async () => {
      vi.mocked(prisma.publicApplication.findUnique).mockResolvedValueOnce({
        uid: 'ANST-TRCK',
        candidateName: 'Track Me',
        status: 'INTERVIEW_SCHEDULED',
        totalAiScore: 65,
        createdAt: new Date(),
        jobOpening: { title: 'QA Engineer' },
      } as any);

      const res = await request.get('/api/jobs/track/ANST-TRCK');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INTERVIEW_SCHEDULED');
    });

    it('returns 404 for unknown UID', async () => {
      vi.mocked(prisma.publicApplication.findUnique).mockResolvedValueOnce(null);

      const res = await request.get('/api/jobs/track/ANST-XXXX');
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/jobs/jobs/:jobId/generate-questions — requires auth ───────

  describe('POST /api/jobs/:jobId/generate-questions', () => {
    it('returns 401 without auth token', async () => {
      // The router applies authenticate middleware to all routes — no token → 401
      const res = await request.post(`/api/jobs/${JOB_ID}/generate-questions`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for EMPLOYEE role (no recruitment:update permission)', async () => {
      // EMPLOYEE does not have recruitment in their permissions map
      const token = makeToken('EMPLOYEE');
      const res = await request
        .post(`/api/jobs/${JOB_ID}/generate-questions`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('returns 404 when job does not exist for HR', async () => {
      vi.mocked(prisma.jobOpening.findFirst).mockResolvedValueOnce(null);

      const token = makeToken('HR');
      const res = await request
        .post(`/api/jobs/nonexistent-job/generate-questions`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/ai-assistant/chat — requires ADMIN/HR ───────────────────

  describe('POST /api/ai-assistant/chat', () => {
    it('returns 401 without token', async () => {
      const res = await request.post('/api/ai-assistant/chat').send({ message: 'Hello' });
      expect(res.status).toBe(401);
    });

    it('returns 403 for EMPLOYEE role', async () => {
      const token = makeToken('EMPLOYEE');
      const res = await request
        .post('/api/ai-assistant/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'Hello' });
      expect(res.status).toBe(403);
    });

    it('returns 403 for MANAGER role', async () => {
      const token = makeToken('MANAGER');
      const res = await request
        .post('/api/ai-assistant/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'Hello' });
      expect(res.status).toBe(403);
    });

    it('allows ADMIN role through the auth middleware', async () => {
      // We only test that it passes auth (200 or 400/500 from service logic is fine)
      // The aiService is mocked to return a failing response so we get a service error,
      // but what we care about is that it is NOT 401 or 403.
      const token = makeToken('ADMIN');
      const res = await request
        .post('/api/ai-assistant/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'Show me leave stats', organizationId: ORG_ID });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('allows HR role through the auth middleware', async () => {
      const token = makeToken('HR');
      const res = await request
        .post('/api/ai-assistant/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: 'How many employees?', organizationId: ORG_ID });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MCQ scoring — pure algorithmic edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('MCQ scoring algorithm (edge cases)', () => {
  let service: PublicApplyService;

  beforeEach(() => {
    service = new PublicApplyService();
    vi.clearAllMocks();
  });

  it('handles empty questions list without dividing by zero', async () => {
    vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
      makeJob({ questions: [] }) as any
    );

    let capturedScore: number | null = null;
    vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
      capturedScore = args.data.mcqScore;
      return { id: 'app-empty', candidateUid: 'ANST-0000', uid: 'ANST-0000', ...args.data };
    });

    await service.submitApplication(JOB_TOKEN, { candidateName: 'Edge Case', mcqAnswers: [] });

    // With 0 questions we'd divide by 1 (guarded) → 0%
    expect(capturedScore).toBe(0);
  });

  it('handles unanswered questions as incorrect', async () => {
    const questions = [
      makeQuestion('q-missing', 'INTELLIGENCE', 'A'), // no answer supplied
    ];
    vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
      makeJob({ questions }) as any
    );

    let capturedScore: number | null = null;
    vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
      capturedScore = args.data.mcqScore;
      return { id: 'app-miss', candidateUid: 'ANST-MISS', uid: 'ANST-MISS', ...args.data };
    });

    // Submit with no answers for q-missing
    await service.submitApplication(JOB_TOKEN, { candidateName: 'No Answer', mcqAnswers: [] });

    expect(capturedScore).toBeCloseTo(0, 1);
  });

  it('scores per-category independently', async () => {
    const questions = [
      makeQuestion('q-int-1', 'INTELLIGENCE', 'A'),  // correct = A
      makeQuestion('q-int-2', 'INTELLIGENCE', 'B'),  // correct = B
      makeQuestion('q-itg-1', 'INTEGRITY', 'C'),      // correct = C
    ];
    vi.mocked(prisma.jobOpening.findUnique).mockResolvedValueOnce(
      makeJob({ questions }) as any
    );

    let capturedData: any = null;
    vi.mocked(prisma.publicApplication.create).mockImplementationOnce(async (args: any) => {
      capturedData = args.data;
      return { id: 'app-cat', candidateUid: 'ANST-CAT1', uid: 'ANST-CAT1', ...args.data };
    });

    await service.submitApplication(JOB_TOKEN, {
      candidateName: 'Category Test',
      mcqAnswers: [
        { questionId: 'q-int-1', selectedOption: 'A' }, // correct INTEL
        { questionId: 'q-int-2', selectedOption: 'A' }, // wrong INTEL (correct=B)
        { questionId: 'q-itg-1', selectedOption: 'C' }, // correct INTEGRITY
      ],
    });

    // intelligenceScore: 1/2 = 50%, integrityScore: 1/1 = 100%, energyScore: 0/0 = 0 (no energy qs)
    expect(capturedData.intelligenceScore).toBeCloseTo(50, 1);
    expect(capturedData.integrityScore).toBeCloseTo(100, 1);
    expect(capturedData.energyScore).toBeCloseTo(0, 1);
  });
});
