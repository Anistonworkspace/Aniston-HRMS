import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { aiService } from '../../services/ai.service.js';
import crypto from 'crypto';

function generateUid(): string {
  return 'ANST-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

export class PublicApplyService {
  /**
   * Get job details + MCQ questions for the public form.
   */
  async getJobForm(publicFormToken: string) {
    const job = await prisma.jobOpening.findUnique({
      where: { publicFormToken },
      include: {
        questions: {
          select: {
            id: true,
            questionText: true,
            optionA: true,
            optionB: true,
            optionC: true,
            optionD: true,
            category: true,
          },
        },
      },
    });

    if (!job || !job.publicFormEnabled) throw new NotFoundError('Job not found or form disabled');

    return {
      id: job.id,
      title: job.title,
      department: job.department,
      location: job.location,
      type: job.type,
      description: job.description,
      requirements: job.requirements,
      questions: job.questions,
    };
  }

  /**
   * Submit a public application with MCQ answers + resume.
   */
  async submitApplication(publicFormToken: string, data: {
    candidateName: string;
    email?: string;
    mobileNumber?: string;
    mcqAnswers: Array<{ questionId: string; selectedOption: string }>;
    resumeUrl?: string;
  }) {
    const job = await prisma.jobOpening.findUnique({
      where: { publicFormToken },
      include: { questions: true },
    });

    if (!job || !job.publicFormEnabled) throw new NotFoundError('Job not found');

    // Score MCQ answers
    let totalCorrect = 0;
    let intelligenceCorrect = 0;
    let intelligenceTotal = 0;
    let integrityCorrect = 0;
    let integrityTotal = 0;
    let energyCorrect = 0;
    let energyTotal = 0;

    for (const question of job.questions) {
      const answer = data.mcqAnswers.find(a => a.questionId === question.id);
      const isCorrect = answer?.selectedOption === question.correctOption;
      if (isCorrect) totalCorrect++;

      switch (question.category) {
        case 'INTELLIGENCE': intelligenceTotal++; if (isCorrect) intelligenceCorrect++; break;
        case 'INTEGRITY': integrityTotal++; if (isCorrect) integrityCorrect++; break;
        case 'ENERGY': energyTotal++; if (isCorrect) energyCorrect++; break;
      }
    }

    const totalQuestions = job.questions.length || 1;
    const mcqScore = (totalCorrect / totalQuestions) * 100;
    const intelligenceScore = intelligenceTotal > 0 ? (intelligenceCorrect / intelligenceTotal) * 100 : 0;
    const integrityScore = integrityTotal > 0 ? (integrityCorrect / integrityTotal) * 100 : 0;
    const energyScore = energyTotal > 0 ? (energyCorrect / energyTotal) * 100 : 0;

    const uid = generateUid();
    const candidateUid = uid;

    const application = await prisma.publicApplication.create({
      data: {
        uid,
        jobOpeningId: job.id,
        candidateName: data.candidateName,
        email: data.email || null,
        mobileNumber: data.mobileNumber || null,
        resumeUrl: data.resumeUrl || null,
        mcqAnswers: data.mcqAnswers,
        mcqScore,
        intelligenceScore,
        integrityScore,
        energyScore,
        totalAiScore: mcqScore, // Will be updated when resume is scored
        candidateUid,
        organizationId: job.organizationId,
      },
    });

    return {
      candidateUid: application.candidateUid,
      uid: application.uid,
    };
  }

  /**
   * Generate MCQ screening questions for a job.
   */
  async generateQuestions(jobId: string, organizationId: string) {
    const job = await prisma.jobOpening.findFirst({
      where: { id: jobId, organizationId },
    });
    if (!job) throw new NotFoundError('Job not found');

    const systemPrompt = `You are an expert HR recruiter. Generate exactly 6 multiple-choice screening questions for a job candidate. The questions should NOT be directly about the job role but should assess the candidate's:
- INTELLIGENCE (2 questions): logical reasoning, analytical thinking, problem-solving
- INTEGRITY (2 questions): ethical judgment, honesty, trustworthiness
- ENERGY (2 questions): motivation, drive, resilience, initiative

Each question must have 4 options (A, B, C, D) where the correct answer tests the desired trait. Make the correct answer non-obvious.

Return ONLY a JSON array:
[{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctOption":"A","category":"INTELLIGENCE"}]`;

    const userPrompt = `Job Title: ${job.title}\nDepartment: ${job.department}\nDescription: ${job.description?.slice(0, 500)}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);

    if (!result.success || !result.data) {
      throw new BadRequestError('Failed to generate questions: ' + (result.error || 'AI not configured'));
    }

    // Parse the JSON from AI response
    let questions: any[];
    try {
      const jsonMatch = result.data.match(/\[[\s\S]*\]/);
      questions = JSON.parse(jsonMatch?.[0] || '[]');
    } catch {
      throw new BadRequestError('Failed to parse AI response. Please try again.');
    }

    if (questions.length === 0) throw new BadRequestError('No questions generated. Try again.');

    // Delete existing questions for this job
    await prisma.jobApplicationQuestion.deleteMany({ where: { jobOpeningId: jobId } });

    // Build create operations for up to 6 questions
    const createOps = questions.slice(0, 6).map(q =>
      prisma.jobApplicationQuestion.create({
        data: {
          jobOpeningId: jobId,
          questionText: q.questionText,
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
          correctOption: q.correctOption,
          category: q.category,
          aiGenerated: true,
        },
      })
    );

    const created = await prisma.$transaction(createOps);

    return created;
  }

  /**
   * Track application status (public).
   */
  async trackApplication(candidateUid: string) {
    const app = await prisma.publicApplication.findUnique({
      where: { candidateUid },
      select: {
        uid: true,
        candidateName: true,
        status: true,
        totalAiScore: true,
        createdAt: true,
        jobOpening: { select: { title: true } },
      },
    });

    if (!app) throw new NotFoundError('Application not found');

    return {
      uid: app.uid,
      name: app.candidateName,
      jobTitle: app.jobOpening.title,
      status: app.status,
      appliedAt: app.createdAt,
    };
  }

  /**
   * List public applications for a job (HR view).
   */
  async listApplications(organizationId: string, jobId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = { organizationId };
    if (jobId) where.jobOpeningId = jobId;

    const [applications, total] = await Promise.all([
      prisma.publicApplication.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { jobOpening: { select: { title: true } } },
      }),
      prisma.publicApplication.count({ where }),
    ]);

    return {
      data: applications,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }
  /**
   * Schedule an interview for a candidate (Phase 6).
   */
  async scheduleInterview(applicationId: string, data: {
    interviewerId: string;
    scheduledAt: string;
    location: string;
    roundType: 'HR' | 'MANAGER' | 'SUPERADMIN';
  }, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
    });
    if (!app) throw new NotFoundError('Application not found');

    const round = await prisma.interviewRound.create({
      data: {
        applicationId,
        roundType: data.roundType,
        conductedBy: data.interviewerId,
        scheduledAt: new Date(data.scheduledAt),
        status: 'PENDING_ROUND',
      },
    });

    // Update application status
    await prisma.publicApplication.update({
      where: { id: applicationId },
      data: { status: 'INTERVIEW_SCHEDULED' },
    });

    return round;
  }

  /**
   * AI-generate interview scheduling message preview (Phase 6).
   */
  async previewScheduleMessage(organizationId: string, data: {
    scheduledAt: string;
    location: string;
    interviewerName: string;
    jobTitle: string;
    companyName: string;
    candidateName: string;
  }) {
    const systemPrompt = `You are an HR assistant. Generate a professional WhatsApp message and email for scheduling an interview. Be friendly but professional. Include all details provided.`;
    const userPrompt = `Generate a WhatsApp message and email for this interview:
- Candidate: ${data.candidateName}
- Position: ${data.jobTitle}
- Company: ${data.companyName}
- Date/Time: ${new Date(data.scheduledAt).toLocaleString('en-IN')}
- Location: ${data.location}
- Interviewer: ${data.interviewerName}

Return JSON: {"whatsappDraft":"...","emailSubject":"...","emailBody":"..."}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 800);
    if (!result.success) {
      return {
        whatsappDraft: `Hi ${data.candidateName}, your interview for ${data.jobTitle} at ${data.companyName} is scheduled for ${new Date(data.scheduledAt).toLocaleString('en-IN')} at ${data.location}. Please be on time. - HR Team`,
        emailSubject: `Interview Scheduled: ${data.jobTitle} at ${data.companyName}`,
        emailBody: `Dear ${data.candidateName},\n\nYour interview is scheduled.\n\nDate: ${new Date(data.scheduledAt).toLocaleString('en-IN')}\nLocation: ${data.location}\nInterviewer: ${data.interviewerName}\n\nBest regards,\nHR Team`,
      };
    }

    try {
      const jsonMatch = result.data!.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch?.[0] || '{}');
    } catch {
      return { whatsappDraft: result.data, emailSubject: '', emailBody: '' };
    }
  }

  /**
   * Generate interview questions for a round (Phase 7).
   */
  async generateInterviewQuestions(roundId: string, organizationId: string) {
    const round = await prisma.interviewRound.findUnique({
      where: { id: roundId },
      include: { application: { include: { jobOpening: true } } },
    });
    if (!round) throw new NotFoundError('Round not found');

    const systemPrompt = `You are an expert interviewer. Generate 8 interview questions with suggested answers for the interviewer. Tailor the questions to the candidate's profile and job requirements.
Return ONLY a JSON array: [{"question":"...","suggestedAnswer":"..."}]`;

    const userPrompt = `Job: ${round.application.jobOpening.title}
Department: ${round.application.jobOpening.department}
Round Type: ${round.roundType}
Candidate: ${round.application.candidateName}
Job Description: ${round.application.jobOpening.description?.slice(0, 500)}`;

    const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);
    if (!result.success) throw new BadRequestError('Failed to generate: ' + result.error);

    let questions: any[];
    try {
      const jsonMatch = result.data!.match(/\[[\s\S]*\]/);
      questions = JSON.parse(jsonMatch?.[0] || '[]');
    } catch {
      throw new BadRequestError('Failed to parse AI response');
    }

    await prisma.interviewRound.update({
      where: { id: roundId },
      data: { aiQuestionsGenerated: questions },
    });

    return questions;
  }

  /**
   * Score an interview round (Phase 7).
   */
  async scoreRound(roundId: string, score: number, feedback: string, userId: string) {
    if (score < 0 || score > 100) throw new BadRequestError('Score must be between 0 and 100');

    const round = await prisma.interviewRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundError('Round not found');
    if (round.conductedBy !== userId) throw new BadRequestError('Only the assigned interviewer can score');

    return prisma.interviewRound.update({
      where: { id: roundId },
      data: { score, feedback, status: 'COMPLETED_ROUND', completedAt: new Date() },
    });
  }

  /**
   * Finalize a candidate — compute final score and update status (Phase 7).
   */
  async finalizeCandidate(applicationId: string, finalStatus: 'SELECTED' | 'REJECTED' | 'ON_HOLD', userId: string, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { interviewRounds: true },
    });
    if (!app) throw new NotFoundError('Application not found');

    // Calculate final score
    const roundScores = app.interviewRounds.filter(r => r.score !== null).map(r => r.score!);
    const aiPreScreenScore = app.totalAiScore || 0;
    const allScores = [aiPreScreenScore, ...roundScores];
    const finalScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;

    const updated = await prisma.publicApplication.update({
      where: { id: applicationId },
      data: {
        finalScore,
        finalStatus,
        finalizedAt: new Date(),
        finalizedBy: userId,
        status: finalStatus,
      },
    });

    return updated;
  }

  /**
   * Get application detail with rounds (Phase 7).
   */
  async getApplicationDetail(applicationId: string, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: {
        jobOpening: { select: { title: true, department: true, description: true } },
        interviewRounds: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!app) throw new NotFoundError('Application not found');
    return app;
  }
}

export const publicApplyService = new PublicApplyService();
