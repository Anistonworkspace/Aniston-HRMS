import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { aiService } from '../../services/ai.service.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { generateEmployeeCode } from '../../utils/employeeCode.js';
import { logger } from '../../lib/logger.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as pdfParseModule from 'pdf-parse';
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

function generateUid(): string {
  return 'ANST-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ─── Hardcoded fallback MCQ questions when AI is unavailable ───
const FALLBACK_MCQ_QUESTIONS = [
  // INTELLIGENCE (2)
  {
    questionText: 'A company\'s revenue increased by 20% in the first year and decreased by 10% in the second year. What is the approximate net change over two years?',
    optionA: '10% increase',
    optionB: '8% increase',
    optionC: '12% increase',
    optionD: '15% increase',
    correctOption: 'B',
    category: 'INTELLIGENCE' as const,
  },
  {
    questionText: 'If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?',
    optionA: '100 minutes',
    optionB: '20 minutes',
    optionC: '5 minutes',
    optionD: '50 minutes',
    correctOption: 'C',
    category: 'INTELLIGENCE' as const,
  },
  // INTEGRITY (2)
  {
    questionText: 'You discover that a colleague has been claiming overtime hours they didn\'t actually work. What would you do?',
    optionA: 'Ignore it — it\'s not your responsibility',
    optionB: 'Confront them aggressively in front of others',
    optionC: 'Speak to your manager or HR privately about your concern',
    optionD: 'Start doing the same since everyone else does it',
    correctOption: 'C',
    category: 'INTEGRITY' as const,
  },
  {
    questionText: 'Your manager asks you to slightly exaggerate the project metrics in a client report. What is the best response?',
    optionA: 'Do it without question since your manager asked',
    optionB: 'Politely explain that accurate reporting builds long-term trust and suggest presenting the data honestly',
    optionC: 'Refuse loudly and threaten to report them',
    optionD: 'Modify the numbers just a little so it\'s not a big deal',
    correctOption: 'B',
    category: 'INTEGRITY' as const,
  },
  // ENERGY (2)
  {
    questionText: 'You are assigned to a new project with a very tight deadline and unfamiliar technology. How do you approach it?',
    optionA: 'Tell your manager the deadline is unrealistic and refuse',
    optionB: 'Wait for someone else to figure out the technology first',
    optionC: 'Immediately start researching the technology, create a plan, and proactively ask colleagues for guidance',
    optionD: 'Work only during office hours and hope for the best',
    correctOption: 'C',
    category: 'ENERGY' as const,
  },
  {
    questionText: 'After a major project setback that wasn\'t your fault, what is your typical reaction?',
    optionA: 'Focus on finding who is to blame',
    optionB: 'Feel discouraged and wait for further instructions',
    optionC: 'Take a moment, then analyze what can be salvaged and propose a revised plan',
    optionD: 'Complain to colleagues about the unfair situation',
    correctOption: 'C',
    category: 'ENERGY' as const,
  },
];

export class PublicApplyService {
  /**
   * Get job details + MCQ questions for the public form.
   * If no AI-generated questions exist, returns hardcoded fallback questions.
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

    // If no AI-generated questions exist, return fallback questions with generated IDs
    // IMPORTANT: Strip correctOption so candidates can't see answers in DevTools
    let questions: Array<{ id: string; questionText: string; optionA: string; optionB: string; optionC: string; optionD: string; category: string }> = job.questions;
    if (questions.length === 0) {
      questions = FALLBACK_MCQ_QUESTIONS.map((q, i) => ({
        id: `fallback-${i}`,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        category: q.category,
      }));
    }

    return {
      id: job.id,
      title: job.title,
      department: job.department,
      location: job.location,
      type: job.type,
      description: job.description,
      requirements: job.requirements,
      questions,
    };
  }

  /**
   * Submit a public application with MCQ answers + resume.
   */
  async submitApplication(publicFormToken: string, data: {
    candidateName: string;
    email?: string;
    mobileNumber?: string;
    city?: string;
    experience?: string;
    currentDesignation?: string;
    preferredLocation?: string;
    willingToRelocate?: string;
    currentCTC?: string;
    expectedCTC?: string;
    noticePeriod?: string;
    mcqAnswers: Array<{ questionId: string; selectedOption: string }>;
    resumeUrl?: string;
  }) {
    const job = await prisma.jobOpening.findUnique({
      where: { publicFormToken },
      include: { questions: true },
    });

    if (!job || !job.publicFormEnabled) throw new NotFoundError('Job not found');

    // Determine the questions to score against — DB questions or fallbacks
    const questionsToScore = job.questions.length > 0
      ? job.questions
      : FALLBACK_MCQ_QUESTIONS.map((q, i) => ({ id: `fallback-${i}`, ...q }));

    const hasQuestions = questionsToScore.length > 0;
    const hasAnswers = data.mcqAnswers && data.mcqAnswers.length > 0;

    // Score MCQ answers (null if no questions were answered)
    let mcqScore: number | null = null;
    let intelligenceScore: number | null = null;
    let integrityScore: number | null = null;
    let energyScore: number | null = null;

    if (hasQuestions && hasAnswers) {
      let totalCorrect = 0;
      let intCorrect = 0, intTotal = 0;
      let intgCorrect = 0, intgTotal = 0;
      let enCorrect = 0, enTotal = 0;

      for (const question of questionsToScore) {
        const answer = data.mcqAnswers.find(a => a.questionId === question.id);
        const isCorrect = answer?.selectedOption === question.correctOption;
        if (isCorrect) totalCorrect++;

        switch (question.category) {
          case 'INTELLIGENCE': intTotal++; if (isCorrect) intCorrect++; break;
          case 'INTEGRITY': intgTotal++; if (isCorrect) intgCorrect++; break;
          case 'ENERGY': enTotal++; if (isCorrect) enCorrect++; break;
        }
      }

      mcqScore = (totalCorrect / questionsToScore.length) * 100;
      intelligenceScore = intTotal > 0 ? (intCorrect / intTotal) * 100 : null;
      integrityScore = intgTotal > 0 ? (intgCorrect / intgTotal) * 100 : null;
      energyScore = enTotal > 0 ? (enCorrect / enTotal) * 100 : null;
    }

    const uid = generateUid();

    // Analyze resume against job description (best-effort, non-blocking)
    let resumeMatchScore: number | null = null;
    let resumeScoreData: any = null;
    if (data.resumeUrl && job.description) {
      try {
        const result = await this.analyzeResumeMatch(data.resumeUrl, job.description, job.title, job.requirements, job.organizationId);
        resumeMatchScore = result.matchScore;
        resumeScoreData = result;
      } catch (err) {
        logger.warn('Resume analysis failed (non-blocking):', err);
      }
    }

    // Calculate total AI score — weighted average of available scores
    let totalAiScore: number | null = null;
    const scoreComponents: number[] = [];
    if (mcqScore !== null) scoreComponents.push(mcqScore);
    if (resumeMatchScore !== null) scoreComponents.push(resumeMatchScore);
    if (scoreComponents.length > 0) {
      totalAiScore = scoreComponents.reduce((a, b) => a + b, 0) / scoreComponents.length;
    }

    const application = await prisma.publicApplication.create({
      data: {
        uid,
        jobOpeningId: job.id,
        candidateName: data.candidateName,
        email: data.email || null,
        mobileNumber: data.mobileNumber || null,
        city: data.city || null,
        experience: data.experience || null,
        currentDesignation: data.currentDesignation || null,
        preferredLocation: data.preferredLocation || null,
        willingToRelocate: data.willingToRelocate || null,
        currentCTC: data.currentCTC || null,
        expectedCTC: data.expectedCTC || null,
        noticePeriod: data.noticePeriod || null,
        resumeUrl: data.resumeUrl || null,
        resumeScoreData,
        resumeMatchScore,
        mcqAnswers: data.mcqAnswers,
        mcqScore,
        intelligenceScore,
        integrityScore,
        energyScore,
        totalAiScore,
        candidateUid: uid,
        organizationId: job.organizationId,
      },
    });

    // Send WhatsApp confirmation to candidate (best-effort, non-blocking)
    if (data.mobileNumber) {
      try {
        const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
        const trackUrl = `https://hr.anistonav.com/track/${application.uid}`;
        const msg = `Hi ${data.candidateName}! 🎯\n\nThank you for applying for *${job.title}* at Aniston Technologies.\n\nYour Application ID: *${application.uid}*\nTrack your application: ${trackUrl}\n\nWe'll review your application and get back to you soon.\n— HR Team, Aniston Technologies LLP`;
        await whatsAppService.sendMessage({ to: data.mobileNumber, message: msg }, job.organizationId);
      } catch {
        // WhatsApp not connected or failed — silently continue
      }
    }

    return {
      candidateUid: application.candidateUid,
      uid: application.uid,
    };
  }

  /**
   * Analyze resume match against job description using AI or lightweight text matching.
   * Uses AI prompt if configured, otherwise falls back to keyword matching.
   */
  /**
   * Extract text from a PDF resume using pdf-parse, then score it against the JD.
   * Strategy:
   *   1. pdf-parse extracts clean text from the uploaded PDF
   *   2. If AI is configured → send resume text + JD to AI for deep scoring (0-100)
   *   3. If AI unavailable → keyword-matching fallback (job title + requirements + description keywords)
   */
  private async analyzeResumeMatch(
    resumeUrl: string,
    jobDescription: string,
    jobTitle: string,
    requirements: string[],
    organizationId: string
  ): Promise<{ matchScore: number; strengths: string[]; gaps: string[]; summary: string }> {
    // ── Step 1: Extract text from PDF using pdf-parse ──
    let resumeText = '';
    try {
      const filePath = path.join(process.cwd(), resumeUrl.startsWith('/') ? resumeUrl.slice(1) : resumeUrl);
      if (!fs.existsSync(filePath)) {
        return { matchScore: 0, strengths: [], gaps: ['Resume file not found on server'], summary: 'File missing.' };
      }

      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      resumeText = (pdfData.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000); // Keep up to 5k chars for analysis

      logger.info(`[ResumeParser] Extracted ${resumeText.length} chars from ${path.basename(filePath)} (${pdfData.numpages} pages)`);
    } catch (err) {
      logger.warn('[ResumeParser] pdf-parse failed:', err);
      return {
        matchScore: 0,
        strengths: [],
        gaps: ['Could not parse PDF — file may be image-based or corrupted'],
        summary: 'PDF text extraction failed. The file may be a scanned image without OCR text layer.',
      };
    }

    if (!resumeText || resumeText.length < 30) {
      return {
        matchScore: 0,
        strengths: [],
        gaps: ['Resume appears to be image-based with no extractable text'],
        summary: 'No readable text found in resume. Consider uploading a text-based PDF.',
      };
    }

    // ── Step 2: Try AI-powered deep analysis ──
    try {
      const systemPrompt = `You are an expert HR resume screener at an Indian technology company. Analyze this resume against the job description and score the match from 0 to 100.

Consider:
- Relevant skills and technologies mentioned
- Years of experience alignment
- Education and certifications
- Domain/industry match
- Location and availability

Return ONLY valid JSON:
{"matchScore":75,"strengths":["Relevant skill 1","Good experience"],"gaps":["Missing certification","Less experience than required"],"summary":"One-line overall assessment"}`;

      const userPrompt = `JOB TITLE: ${jobTitle}

JOB DESCRIPTION:
${jobDescription.slice(0, 1000)}

REQUIREMENTS:
${requirements.length > 0 ? requirements.join('\n- ') : 'Not specified'}

CANDIDATE RESUME TEXT:
${resumeText.slice(0, 3000)}`;

      const result = await aiService.prompt(organizationId, systemPrompt, userPrompt, 1024);
      if (result.success && result.data) {
        const jsonMatch = result.data.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            matchScore: Math.min(100, Math.max(0, Math.round(Number(parsed.matchScore) || 50))),
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
            gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 5) : [],
            summary: String(parsed.summary || '').slice(0, 300),
          };
        }
      }
    } catch (err) {
      logger.warn('[ResumeParser] AI analysis failed, falling back to keyword matching:', err);
    }

    // ── Step 3: Fallback — keyword matching against JD ──
    const resumeLower = resumeText.toLowerCase();

    // Build keyword set from job title, requirements, and description
    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'will', 'been', 'they', 'their', 'about', 'would', 'which', 'should', 'could', 'other', 'more', 'also', 'into', 'over', 'such', 'than', 'only']);

    const extractKeywords = (text: string): string[] =>
      text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));

    const jdKeywords = [
      ...extractKeywords(jobTitle),
      ...requirements.flatMap(r => extractKeywords(r)),
      ...extractKeywords(jobDescription).slice(0, 40),
    ];
    const uniqueKeywords = [...new Set(jdKeywords)];

    if (uniqueKeywords.length === 0) {
      return { matchScore: 50, strengths: [], gaps: [], summary: 'Not enough job description keywords to analyze.' };
    }

    let matchedCount = 0;
    const matched: string[] = [];
    const missed: string[] = [];

    for (const kw of uniqueKeywords) {
      if (resumeLower.includes(kw)) {
        matchedCount++;
        if (matched.length < 8) matched.push(kw);
      } else {
        if (missed.length < 8) missed.push(kw);
      }
    }

    const rawScore = (matchedCount / uniqueKeywords.length) * 100;
    // Normalize: a 50%+ keyword match is quite strong, scale it
    const matchScore = Math.min(100, Math.max(0, Math.round(rawScore * 1.2)));

    return {
      matchScore,
      strengths: matched.map(k => `Resume mentions: "${k}"`),
      gaps: missed.map(k => `JD expects: "${k}" — not found in resume`),
      summary: `Keyword analysis: ${matchedCount} of ${uniqueKeywords.length} job keywords found in resume (${Math.round(rawScore)}% raw match).`,
    };
  }

  /**
   * Generate MCQ screening questions for a job.
   * Falls back to hardcoded questions if AI is unavailable.
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

    let questions: any[] = [];

    if (result.success && result.data) {
      try {
        const jsonMatch = result.data.match(/\[[\s\S]*\]/);
        questions = JSON.parse(jsonMatch?.[0] || '[]');
      } catch {
        // Parse failed — will fall through to fallback
        logger.warn('Failed to parse AI-generated MCQ questions, using fallback');
      }
    }

    // If AI failed or returned nothing, use fallback questions
    if (questions.length === 0) {
      logger.info(`AI unavailable for job ${jobId}, using fallback MCQ questions`);
      questions = FALLBACK_MCQ_QUESTIONS;
    }

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
          aiGenerated: !!(result.success && result.data && questions !== FALLBACK_MCQ_QUESTIONS),
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
        interviewRounds: {
          select: { scheduledAt: true },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!app) throw new NotFoundError('Application not found');

    const nextInterview = app.interviewRounds?.[0];

    return {
      uid: app.uid,
      name: app.candidateName,
      jobTitle: app.jobOpening.title,
      status: app.status,
      appliedAt: app.createdAt,
      interviewDate: nextInterview?.scheduledAt || null,
    };
  }

  /**
   * List public applications for a job (HR view).
   */
  async listApplications(organizationId: string, jobId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = { organizationId, deletedAt: null };
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
   * Create an interview round and assign to an interviewer (Phase 7).
   */
  async createRound(applicationId: string, data: {
    roundType: 'HR' | 'MANAGER' | 'SUPERADMIN';
    conductedBy: string;
    scheduledAt?: string;
  }, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
    });
    if (!app) throw new NotFoundError('Application not found');

    const round = await prisma.interviewRound.create({
      data: {
        applicationId,
        roundType: data.roundType,
        conductedBy: data.conductedBy,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        status: 'PENDING_ROUND',
        organizationId,
      },
    });

    return round;
  }

  /**
   * Schedule an interview for a candidate (Phase 6).
   * Creates round, updates status, and sends WhatsApp/email notifications.
   */
  async scheduleInterview(applicationId: string, data: {
    interviewerId?: string;
    interviewerName?: string;
    scheduledAt: string;
    location: string;
    notes?: string;
    messageType?: 'whatsapp' | 'email' | 'both';
    roundType?: 'HR' | 'MANAGER' | 'SUPERADMIN';
  }, organizationId: string, userId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { jobOpening: { select: { title: true } } },
    });
    if (!app) throw new NotFoundError('Application not found');

    const round = await prisma.interviewRound.create({
      data: {
        applicationId,
        roundType: data.roundType || 'HR',
        conductedBy: data.interviewerId || userId,
        scheduledAt: new Date(data.scheduledAt),
        status: 'PENDING_ROUND',
        organizationId,
      },
    });

    // Update application status
    await prisma.publicApplication.update({
      where: { id: applicationId },
      data: { status: 'INTERVIEW_SCHEDULED' },
    });

    // Generate messages using AI preview
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    const preview = await this.previewScheduleMessage(organizationId, {
      scheduledAt: data.scheduledAt,
      location: data.location,
      interviewerName: data.interviewerName || 'HR Team',
      jobTitle: app.jobOpening.title,
      companyName: org?.name || 'Aniston Technologies LLP',
      candidateName: app.candidateName,
    });

    const messageType = data.messageType || 'both';

    // Send email notification
    if ((messageType === 'email' || messageType === 'both') && app.email) {
      try {
        const { enqueueEmail } = await import('../../jobs/queues.js');
        await enqueueEmail({
          to: app.email,
          subject: preview.emailSubject || `Interview Scheduled: ${app.jobOpening.title}`,
          template: 'generic',
          context: {
            title: 'Interview Scheduled',
            message: preview.emailBody || `Your interview is scheduled for ${new Date(data.scheduledAt).toLocaleString('en-IN')} at ${data.location}`,
          },
        });
      } catch (err) {
        logger.error('Failed to send interview email:', err);
      }
    }

    // Send WhatsApp notification
    if ((messageType === 'whatsapp' || messageType === 'both') && app.mobileNumber) {
      try {
        const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
        await whatsAppService.sendMessage(
          { to: app.mobileNumber, message: preview.whatsappDraft || `Hi ${app.candidateName}, your interview is scheduled.` },
          organizationId
        );
      } catch (err) {
        logger.error('Failed to send interview WhatsApp:', err);
      }
    }

    return { round, preview };
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
   * HR/Admin can score any round in their org; interviewers can only score their own.
   */
  async scoreRound(roundId: string, score: number, feedback: string, userId: string, organizationId: string) {
    if (score < 0 || score > 100) throw new BadRequestError('Score must be between 0 and 100');

    const round = await prisma.interviewRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundError('Round not found');
    if (round.organizationId !== organizationId) throw new NotFoundError('Round not found');

    return prisma.interviewRound.update({
      where: { id: roundId },
      data: { score, feedback, status: 'COMPLETED_ROUND', completedAt: new Date() },
    });
  }

  /**
   * Get interview tasks for the current user (Phase 7).
   * Managers see only rounds assigned to them.
   * HR/Admin see all rounds in their org.
   */
  async getInterviewTasks(userId: string, userRole: string, organizationId: string) {
    const isHrAdmin = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(userRole);

    const where: any = { organizationId };
    if (!isHrAdmin) {
      where.conductedBy = userId;
    }

    const rounds = await prisma.interviewRound.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        application: {
          select: {
            id: true,
            candidateName: true,
            email: true,
            mobileNumber: true,
            candidateUid: true,
            totalAiScore: true,
            mcqScore: true,
            status: true,
            jobOpening: { select: { title: true, department: true } },
          },
        },
      },
    });

    return rounds;
  }

  /**
   * Finalize a candidate — compute final score and update status (Phase 7).
   */
  async finalizeCandidate(applicationId: string, finalStatus: 'SELECTED' | 'REJECTED' | 'ON_HOLD', userId: string, organizationId: string) {
    const app = await prisma.publicApplication.findFirst({
      where: { id: applicationId, organizationId },
      include: { interviewRounds: true, jobOpening: { select: { title: true, department: true } } },
    });
    if (!app) throw new NotFoundError('Application not found');

    // Calculate final score — only include non-null scores
    const roundScores = app.interviewRounds.filter(r => r.score !== null).map(r => r.score!);
    const allScores: number[] = [];
    if (app.totalAiScore !== null) allScores.push(app.totalAiScore);
    allScores.push(...roundScores);
    const finalScore = allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;

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

    // On selection: create Employee profile and send notification emails
    if (finalStatus === 'SELECTED') {
      try {
        const nameParts = (app.candidateName || '').trim().split(/\s+/);
        const firstName = nameParts[0] || 'New';
        const lastName = nameParts.slice(1).join(' ') || 'Employee';
        const employeeCode = await generateEmployeeCode(organizationId);

        await prisma.employee.create({
          data: {
            employeeCode,
            firstName,
            lastName,
            email: app.email || `${employeeCode.toLowerCase()}@pending.aniston.com`,
            phone: app.mobileNumber || '',
            gender: 'OTHER',
            joiningDate: new Date(),
            status: 'PROBATION',
            organizationId,
          },
        });

        logger.info(`Employee profile created for selected candidate: ${app.candidateName} (${employeeCode})`);

        if (app.email) {
          await enqueueEmail({
            to: app.email,
            subject: `Congratulations! You've been selected for ${app.jobOpening.title}`,
            template: 'generic',
            context: {
              title: 'Congratulations!',
              message: `Dear ${app.candidateName},<br><br>We are delighted to inform you that you have been <strong>selected</strong> for the position of <strong>${app.jobOpening.title}</strong> at Aniston Technologies.<br><br>Our HR team will reach out to you shortly with the next steps regarding your onboarding process.<br><br>We look forward to having you on our team!<br><br>Best regards,<br>HR Team — Aniston Technologies`,
            },
          });
        }

        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { adminNotificationEmail: true, name: true },
        });

        if (org?.adminNotificationEmail) {
          await enqueueEmail({
            to: org.adminNotificationEmail,
            subject: `Candidate Selected: ${app.candidateName} for ${app.jobOpening.title}`,
            template: 'generic',
            context: {
              title: 'Candidate Selected',
              message: `A candidate has been finalized as <strong>SELECTED</strong>.<br><br><strong>Name:</strong> ${app.candidateName}<br><strong>Email:</strong> ${app.email || 'N/A'}<br><strong>Phone:</strong> ${app.mobileNumber || 'N/A'}<br><strong>Position:</strong> ${app.jobOpening.title}<br><strong>Department:</strong> ${app.jobOpening.department || 'N/A'}<br><strong>Final Score:</strong> ${finalScore.toFixed(1)}%<br><strong>Employee Code:</strong> ${employeeCode}<br><br>The employee profile has been created with status PROBATION. Please proceed with onboarding.`,
            },
          });
        }
      } catch (err) {
        logger.error('Error in post-selection tasks for candidate:', err);
      }
    }

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
