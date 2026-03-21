import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import type { CreateJobInput, CreateApplicationInput, InterviewScoreInput, CreateOfferInput, JobQuery } from './recruitment.validation.js';

export class RecruitmentService {
  // ==================
  // JOB OPENINGS
  // ==================

  async getJobOpenings(query: JobQuery, organizationId: string) {
    const { page, limit, status, department, type, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };
    if (status) where.status = status;
    if (department) where.department = department;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [jobs, total] = await Promise.all([
      prisma.jobOpening.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { applications: true } } },
      }),
      prisma.jobOpening.count({ where }),
    ]);

    return {
      data: jobs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  async getJobById(id: string) {
    const job = await prisma.jobOpening.findUnique({
      where: { id },
      include: {
        applications: {
          orderBy: { createdAt: 'desc' },
          include: {
            interviewScores: { orderBy: { round: 'asc' } },
            offerLetter: true,
          },
        },
        _count: { select: { applications: true } },
      },
    });
    if (!job) throw new NotFoundError('Job opening');
    return job;
  }

  async createJob(data: CreateJobInput, organizationId: string, postedBy: string) {
    return prisma.jobOpening.create({
      data: {
        ...data,
        status: 'DRAFT',
        postedBy,
        organizationId,
      },
    });
  }

  async updateJob(id: string, data: any) {
    return prisma.jobOpening.update({ where: { id }, data });
  }

  // ==================
  // APPLICATIONS
  // ==================

  async getApplications(jobId: string, status?: string) {
    const where: any = { jobOpeningId: jobId };
    if (status) where.status = status;

    return prisma.application.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        interviewScores: { orderBy: { round: 'asc' } },
        offerLetter: true,
      },
    });
  }

  async getApplicationById(id: string) {
    const app = await prisma.application.findUnique({
      where: { id },
      include: {
        jobOpening: { select: { title: true, department: true, location: true } },
        interviewScores: { orderBy: { round: 'asc' } },
        offerLetter: true,
      },
    });
    if (!app) throw new NotFoundError('Application');
    return app;
  }

  async createApplication(data: CreateApplicationInput) {
    // Check if job is open
    const job = await prisma.jobOpening.findUnique({ where: { id: data.jobOpeningId } });
    if (!job || job.status !== 'OPEN') {
      throw new BadRequestError('Job opening is not accepting applications');
    }

    // Check duplicate
    const existing = await prisma.application.findFirst({
      where: { jobOpeningId: data.jobOpeningId, email: data.email },
    });
    if (existing) {
      throw new BadRequestError('An application with this email already exists for this job');
    }

    return prisma.application.create({
      data: {
        ...data,
        status: 'APPLIED',
        currentStage: 1,
      },
    });
  }

  async moveApplicationStage(id: string, status: string) {
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new NotFoundError('Application');

    return prisma.application.update({
      where: { id },
      data: { status: status as any },
      include: {
        interviewScores: true,
        offerLetter: true,
      },
    });
  }

  // ==================
  // INTERVIEW SCORES
  // ==================

  async addInterviewScore(data: InterviewScoreInput, interviewerId?: string) {
    const app = await prisma.application.findUnique({ where: { id: data.applicationId } });
    if (!app) throw new NotFoundError('Application');

    // Calculate overall if not provided
    const scores = [data.communicationScore, data.technicalScore, data.problemSolving, data.culturalFit].filter(Boolean) as number[];
    const overall = data.overallScore || (scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null);

    const score = await prisma.interviewScore.create({
      data: {
        applicationId: data.applicationId,
        round: data.round,
        interviewerId: interviewerId || null,
        communicationScore: data.communicationScore || null,
        technicalScore: data.technicalScore || null,
        problemSolving: data.problemSolving || null,
        culturalFit: data.culturalFit || null,
        overallScore: overall,
        notes: data.notes || null,
        teamsRecordingUrl: data.teamsRecordingUrl || null,
      },
    });

    // Update application AI score (average of all rounds)
    const allScores = await prisma.interviewScore.findMany({
      where: { applicationId: data.applicationId },
    });
    const avgOverall = allScores.reduce((sum, s) => sum + (Number(s.overallScore) || 0), 0) / allScores.length;
    await prisma.application.update({
      where: { id: data.applicationId },
      data: { aiScore: Math.round(avgOverall * 100) / 100 },
    });

    return score;
  }

  // ==================
  // OFFER LETTERS
  // ==================

  async createOffer(data: CreateOfferInput) {
    const app = await prisma.application.findUnique({ where: { id: data.applicationId } });
    if (!app) throw new NotFoundError('Application');

    const existing = await prisma.offerLetter.findUnique({ where: { applicationId: data.applicationId } });
    if (existing) throw new BadRequestError('Offer already exists for this application');

    const offer = await prisma.$transaction(async (tx) => {
      const created = await tx.offerLetter.create({
        data: {
          applicationId: data.applicationId,
          candidateEmail: data.candidateEmail,
          ctc: data.ctc,
          basicSalary: data.basicSalary,
          joiningDate: data.joiningDate ? new Date(data.joiningDate) : null,
          status: 'DRAFT',
        },
      });

      await tx.application.update({
        where: { id: data.applicationId },
        data: { status: 'OFFER' },
      });

      return created;
    });

    return offer;
  }

  async updateOfferStatus(offerId: string, status: string) {
    const offer = await prisma.offerLetter.findUnique({
      where: { id: offerId },
      include: { application: true },
    });
    if (!offer) throw new NotFoundError('Offer letter');

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOffer = await tx.offerLetter.update({
        where: { id: offerId },
        data: {
          status: status as any,
          ...(status === 'SENT' ? { sentAt: new Date() } : {}),
          ...(status === 'ACCEPTED' || status === 'REJECTED' ? { respondedAt: new Date() } : {}),
        },
      });

      if (status === 'ACCEPTED') {
        await tx.application.update({
          where: { id: offer.applicationId },
          data: { status: 'OFFER_ACCEPTED' },
        });
      }

      return updatedOffer;
    });

    return updated;
  }

  // ==================
  // AI SCORING
  // ==================

  async triggerAIScoring(applicationId: string, aiServiceUrl: string) {
    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { jobOpening: true },
    });
    if (!app) throw new NotFoundError('Application');

    // This calls the AI service — for now return mock data
    // In production, this would call the FastAPI service
    const mockScore = {
      overall_score: 72.5,
      match_percentage: 68.0,
      strengths: ['Relevant skills', 'Good experience', 'Education match'],
      gaps: ['Missing certification', 'Limited leadership'],
      suggested_questions: ['Describe your leadership experience', 'How do you handle deadlines?'],
      reasoning: 'Strong technical fit with some gaps in leadership',
    };

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScore: mockScore.overall_score,
        aiScoreDetails: mockScore,
      },
    });

    return mockScore;
  }

  // ==================
  // PIPELINE STATS
  // ==================

  async getPipelineStats(organizationId: string) {
    const statusCounts = await prisma.application.groupBy({
      by: ['status'],
      _count: true,
      where: {
        jobOpening: { organizationId },
      },
    });

    const stats: Record<string, number> = {};
    statusCounts.forEach((s) => { stats[s.status] = s._count; });

    const openJobs = await prisma.jobOpening.count({
      where: { organizationId, status: 'OPEN' },
    });

    return { pipeline: stats, openJobs };
  }
}

export const recruitmentService = new RecruitmentService();
