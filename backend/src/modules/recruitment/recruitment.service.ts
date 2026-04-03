import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { aiService } from '../../services/ai.service.js';
import { logger } from '../../lib/logger.js';
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

  async getJobById(id: string, organizationId: string) {
    const job = await prisma.jobOpening.findFirst({
      where: { id, organizationId },
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

  async updateJob(id: string, data: any, organizationId: string) {
    const existing = await prisma.jobOpening.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Job opening');
    // Remove fields that should not be overwritable
    delete data.organizationId;
    delete data.postedBy;
    return prisma.jobOpening.update({ where: { id }, data });
  }

  async deleteJob(id: string, organizationId: string) {
    const job = await prisma.jobOpening.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { applications: true } } },
    });
    if (!job) throw new NotFoundError('Job opening');
    if (job._count.applications > 0) {
      throw new BadRequestError('Cannot delete job with existing applications. Close it instead.');
    }
    await prisma.jobOpening.update({ where: { id }, data: { status: 'CLOSED', deletedAt: new Date() } });
    return { message: 'Job deleted successfully' };
  }

  // ==================
  // APPLICATIONS
  // ==================

  async getApplications(jobId: string, organizationId: string, status?: string) {
    // Verify job belongs to org
    const job = await prisma.jobOpening.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new NotFoundError('Job opening');

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

  async getApplicationById(id: string, organizationId: string) {
    const app = await prisma.application.findFirst({
      where: { id, jobOpening: { organizationId } },
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

  async moveApplicationStage(id: string, status: string, organizationId: string) {
    const app = await prisma.application.findFirst({ where: { id, jobOpening: { organizationId } } });
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
  // AI JOB DESCRIPTION GENERATOR
  // ==================

  async generateJobDescription(organizationId: string, data: { title: string; department?: string; requirements?: string; type?: string }) {
    const systemPrompt = `You are an expert HR recruiter. Generate a professional, engaging job description.
Return a JSON object with: { "description": string, "keyResponsibilities": string[], "qualifications": string[], "niceToHave": string[] }
Keep it concise, professional, and relevant to the Indian job market.
Return ONLY valid JSON, no markdown or extra text.`;

    const userPrompt = `Generate a job description for the following position:
Title: ${data.title}
${data.department ? `Department: ${data.department}` : ''}
${data.type ? `Employment Type: ${data.type}` : ''}
${data.requirements ? `Additional Requirements/Notes: ${data.requirements}` : ''}`;

    const aiResponse = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);

    let parsed: any;
    try {
      const content = aiResponse.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch (parseErr) {
      logger.warn(`[AI Job Description] Failed to parse AI response: ${(parseErr as Error).message}`);
      throw new BadRequestError('AI failed to generate a valid job description. Please try again.');
    }

    return parsed;
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

    let scoreResult: any;

    try {
      // Call the AI service for resume scoring
      const response = await fetch(`${aiServiceUrl}/ai/scoring/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.AI_SERVICE_API_KEY || 'dev-ai-key',
        },
        body: JSON.stringify({
          resume_text: app.resumeUrl || `Candidate: ${app.candidateName}, Email: ${app.email}`,
          job_description: app.jobOpening?.description || app.jobOpening?.title || '',
          job_title: app.jobOpening?.title || '',
          required_skills: app.jobOpening?.requirements || [],
        }),
      });

      if (response.ok) {
        scoreResult = await response.json();
      } else {
        throw new Error(`AI service returned ${response.status}`);
      }
    } catch (err) {
      // Fallback to mock scoring if AI service is unavailable
      scoreResult = {
        overall_score: Math.round((60 + Math.random() * 30) * 10) / 10,
        match_percentage: Math.round((50 + Math.random() * 40) * 10) / 10,
        strengths: ['Relevant experience', 'Skills alignment', 'Education match'],
        gaps: ['Could strengthen leadership skills'],
        suggested_questions: ['Tell me about a challenging project', 'How do you prioritize tasks?'],
        reasoning: 'Score generated from fallback analysis (AI service unavailable)',
      };
    }

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScore: scoreResult.overall_score,
        aiScoreDetails: scoreResult,
      },
    });

    return scoreResult;
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

  // ==================
  // SHARE JOB VIA EMAIL
  // ==================

  async shareJobViaEmail(jobId: string, email: string, customMessage?: string) {
    const job = await prisma.jobOpening.findUnique({
      where: { id: jobId },
      include: { organization: { select: { name: true } } },
    });
    if (!job) throw new NotFoundError('Job opening');
    if (!job.publicFormToken) throw new BadRequestError('This job does not have a public application form');

    const applyUrl = `https://hr.anistonav.com/apply/${job.publicFormToken}`;
    const orgName = job.organization?.name || 'Aniston Technologies';

    await enqueueEmail({
      to: email,
      subject: `Job Opening: ${job.title} at ${orgName}`,
      template: 'job-share',
      context: {
        jobTitle: job.title,
        department: job.department || '',
        location: job.location || '',
        type: job.type || '',
        applyUrl,
        orgName,
        customMessage: customMessage || '',
      },
    });

    return { sent: true, email };
  }
}

export const recruitmentService = new RecruitmentService();
