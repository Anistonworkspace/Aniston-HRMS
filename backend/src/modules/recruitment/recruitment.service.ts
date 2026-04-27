import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { aiService } from '../../services/ai.service.js';
import { logger } from '../../lib/logger.js';
import { createAuditLog } from '../../utils/auditLogger.js';
import { emitToOrg } from '../../sockets/index.js';
import type { CreateJobInput, UpdateJobInput, CreateApplicationInput, InterviewScoreInput, CreateOfferInput, JobQuery } from './recruitment.validation.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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
        include: { _count: { select: { applications: true, questions: true } } },
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
        questions: true,
        _count: { select: { applications: true, questions: true } },
      },
    });
    if (!job) throw new NotFoundError('Job opening');
    return job;
  }

  async createJob(data: CreateJobInput, organizationId: string, postedBy: string) {
    const job = await prisma.jobOpening.create({
      data: {
        ...data,
        status: 'DRAFT',
        postedBy,
        organizationId,
      },
    });
    await createAuditLog({ userId: postedBy, organizationId, entity: 'JobOpening', entityId: job.id, action: 'CREATE', newValue: { title: data.title, department: data.department } });
    return job;
  }

  async updateJob(id: string, data: UpdateJobInput, organizationId: string, updatedBy?: string) {
    const existing = await prisma.jobOpening.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Job opening');
    // Whitelist only editable fields — never spread raw data into Prisma update
    const allowedUpdate: Record<string, any> = {};
    const editableFields = ['title', 'department', 'location', 'type', 'experience', 'salaryRange',
      'description', 'requirements', 'openings', 'status', 'publishToNaukri', 'publishToWebsite'];
    for (const field of editableFields) {
      if ((data as any)[field] !== undefined) allowedUpdate[field] = (data as any)[field];
    }
    if (allowedUpdate.status === 'CLOSED') allowedUpdate.closedAt = new Date();
    const updated = await prisma.jobOpening.update({ where: { id, organizationId }, data: allowedUpdate });
    await createAuditLog({ userId: updatedBy || organizationId, organizationId, entity: 'JobOpening', entityId: id, action: 'UPDATE', newValue: allowedUpdate });
    return updated;
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
    await prisma.jobOpening.update({ where: { id, organizationId }, data: { status: 'CLOSED', closedAt: new Date() } });
    return { message: 'Job closed successfully' };
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
    // Verify job is open — single query, no org bypass possible
    const job = await prisma.jobOpening.findFirst({
      where: { id: data.jobOpeningId, status: 'OPEN' },
      select: { id: true, organizationId: true, status: true },
    });
    if (!job) throw new BadRequestError('Job opening is not accepting applications');

    // Reject if caller passes a mismatched organizationId (prevents cross-org submit)
    if ((data as any).organizationId && (data as any).organizationId !== job.organizationId) {
      throw new BadRequestError('Job opening does not belong to the specified organization');
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const existing = await prisma.application.findFirst({
      where: { jobOpeningId: data.jobOpeningId, email: normalizedEmail },
    });
    if (existing) {
      throw new BadRequestError('An application with this email already exists for this job');
    }

    return prisma.application.create({
      data: {
        ...data,
        email: normalizedEmail,
        status: 'APPLIED',
        currentStage: 1,
      },
    });
  }

  async moveApplicationStage(id: string, status: string, organizationId: string) {
    const app = await prisma.application.findFirst({ where: { id, jobOpening: { organizationId } } });
    if (!app) throw new NotFoundError('Application');

    // State machine: validate legal transitions
    const VALID_TRANSITIONS: Record<string, string[]> = {
      APPLIED: ['SCREENING', 'REJECTED', 'WITHDRAWN'],
      SCREENING: ['ASSESSMENT', 'INTERVIEW_1', 'REJECTED', 'WITHDRAWN'],
      ASSESSMENT: ['INTERVIEW_1', 'REJECTED', 'WITHDRAWN'],
      INTERVIEW_1: ['INTERVIEW_2', 'HR_ROUND', 'FINAL_ROUND', 'REJECTED', 'WITHDRAWN'],
      INTERVIEW_2: ['HR_ROUND', 'FINAL_ROUND', 'REJECTED', 'WITHDRAWN'],
      HR_ROUND: ['FINAL_ROUND', 'OFFER', 'REJECTED', 'WITHDRAWN'],
      FINAL_ROUND: ['OFFER', 'REJECTED', 'WITHDRAWN'],
      OFFER: ['OFFER_ACCEPTED', 'OFFER_REJECTED', 'NEGOTIATING', 'WITHDRAWN'],
      OFFER_ACCEPTED: ['JOINED'],
      OFFER_REJECTED: [],
      NEGOTIATING: ['OFFER', 'REJECTED', 'WITHDRAWN'],
      JOINED: [],
      REJECTED: ['APPLIED'], // allow reconsideration
      WITHDRAWN: [],
    };
    const allowed = VALID_TRANSITIONS[app.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestError(`Cannot move from ${app.status} to ${status}. Allowed: ${allowed.join(', ') || 'none'}`);
    }

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

  async addInterviewScore(data: InterviewScoreInput, interviewerId?: string, organizationId?: string) {
    const app = await prisma.application.findFirst({
      where: { id: data.applicationId, ...(organizationId ? { jobOpening: { organizationId } } : {}) },
    });
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
    if (allScores.length > 0) {
      const avgOverall = allScores.reduce((sum, s) => sum + (Number(s.overallScore) || 0), 0) / allScores.length;
      const clamped = Math.max(0, Math.min(100, Math.round(avgOverall * 100) / 100));
      await prisma.application.update({
        where: { id: data.applicationId },
        data: { aiScore: clamped },
      });
    }

    return score;
  }

  // ==================
  // OFFER LETTERS
  // ==================

  async createOffer(data: CreateOfferInput, organizationId?: string) {
    const app = organizationId
      ? await prisma.application.findFirst({ where: { id: data.applicationId, jobOpening: { organizationId } } })
      : await prisma.application.findUnique({ where: { id: data.applicationId } });
    if (!app) throw new NotFoundError('Application');

    // app already validated as belonging to this org above — scoping via application join is sufficient
    const existing = await prisma.offerLetter.findFirst({
      where: { applicationId: data.applicationId, application: { jobOpening: { organizationId } } },
    });
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

  async updateOfferStatus(offerId: string, status: string, organizationId?: string) {
    const offer = organizationId
      ? await prisma.offerLetter.findFirst({
          where: { id: offerId, application: { jobOpening: { organizationId } } },
          include: { application: true },
        })
      : await prisma.offerLetter.findUnique({ where: { id: offerId }, include: { application: true } });
    if (!offer) throw new NotFoundError('Offer letter');

    // State machine: validate legal offer transitions
    const OFFER_TRANSITIONS: Record<string, string[]> = {
      DRAFT: ['SENT'],
      SENT: ['ACCEPTED', 'REJECTED', 'NEGOTIATING', 'EXPIRED'],
      NEGOTIATING: ['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
      ACCEPTED: [],  // terminal
      REJECTED: [],  // terminal
      EXPIRED: [],   // terminal
    };
    const allowedOfferStatuses = OFFER_TRANSITIONS[offer.status] || [];
    if (!allowedOfferStatuses.includes(status)) {
      throw new BadRequestError(`Cannot transition offer from ${offer.status} to ${status}. Allowed: ${allowedOfferStatuses.join(', ') || 'none (terminal state)'}`);
    }

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

    // Auto-trigger invite flow when offer is accepted
    if (status === 'ACCEPTED' && offer.candidateEmail && offer.application) {
      try {
        const job = await prisma.jobOpening.findFirst({
          where: { id: offer.application.jobOpeningId, ...(organizationId ? { organizationId } : {}) },
          select: { organizationId: true, department: true },
        });
        if (job) {
          // Find matching department
          const dept = job.department ? await prisma.department.findFirst({
            where: { organizationId: job.organizationId, name: job.department, deletedAt: null },
            select: { id: true },
          }) : null;

          const candidateEmail = offer.candidateEmail.toLowerCase();
          const candidateName = (offer.application as any).candidateName as string | null | undefined;
          const isIntern = (offer.application as any).isIntern as boolean | undefined;
          const role = isIntern ? 'INTERN' : 'EMPLOYEE';

          // Auto-create invitation for the accepted candidate
          const invitation = await prisma.employeeInvitation.create({
            data: {
              email: candidateEmail,
              role,
              departmentId: dept?.id || null,
              invitedBy: 'system',
              organizationId: job.organizationId,
              status: 'PENDING',
              expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            },
          });

          // GAP-001: Auto-create User + Employee record if not already present
          const existingEmployee = await prisma.employee.findFirst({
            where: { email: candidateEmail, organizationId: job.organizationId, deletedAt: null },
          });

          if (existingEmployee) {
            logger.warn(`[Recruitment] Employee already exists for ${candidateEmail} — skipping auto-creation`);
          } else {
            try {
              // Determine next employee code
              const lastEmployee = await prisma.employee.findFirst({
                where: { organizationId: job.organizationId },
                orderBy: { employeeCode: 'desc' },
                select: { employeeCode: true },
              });
              const lastNum = lastEmployee?.employeeCode
                ? parseInt(lastEmployee.employeeCode.replace('EMP-', ''), 10)
                : 0;
              const employeeCode = `EMP-${String(lastNum + 1).padStart(3, '0')}`;

              const nameParts = (candidateName || candidateEmail.split('@')[0]).split(' ');
              const firstName = nameParts[0] || candidateEmail.split('@')[0];
              const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Pending';

              const newEmployee = await prisma.$transaction(async (tx) => {
                // Check again inside transaction to guard against race conditions
                const existingUser = await tx.user.findUnique({ where: { email: candidateEmail } });

                const user = existingUser || await tx.user.create({
                  data: {
                    email: candidateEmail,
                    passwordHash: '',
                    role,
                    status: 'PENDING_VERIFICATION',
                    organizationId: job.organizationId,
                  },
                });

                const employee = await tx.employee.create({
                  data: {
                    employeeCode,
                    userId: user.id,
                    firstName,
                    lastName,
                    email: candidateEmail,
                    phone: '0000000000',
                    gender: 'PREFER_NOT_TO_SAY',
                    workMode: 'OFFICE',
                    joiningDate: new Date(),
                    status: 'ONBOARDING',
                    organizationId: job.organizationId,
                    departmentId: dept?.id || null,
                  },
                });

                // Update invitation with the new employeeId if field exists on model
                try {
                  await tx.employeeInvitation.update({
                    where: { id: invitation.id },
                    data: { employeeId: employee.id } as any,
                  });
                } catch {
                  // employeeId column may not exist on EmployeeInvitation — skip silently
                }

                await tx.auditLog.create({
                  data: {
                    userId: 'system',
                    entity: 'Employee',
                    entityId: employee.id,
                    action: 'CREATE',
                    newValue: { employeeCode, source: 'offer_acceptance', offerId: offer.id },
                    organizationId: job.organizationId,
                  },
                });

                return employee;
              });

              logger.info(`[Recruitment] Auto-created employee ${newEmployee.employeeCode} for ${candidateEmail} after offer acceptance`);
            } catch (empErr) {
              // Non-blocking: employee creation failure should not block invite flow
              logger.warn(`[Recruitment] Auto-employee creation failed for ${candidateEmail}:`, empErr);
            }
          }

          // Queue invite email
          await enqueueEmail({
            to: candidateEmail,
            subject: 'Welcome! Complete your onboarding',
            template: 'onboarding-invite',
            context: {
              name: candidateName || candidateEmail.split('@')[0],
              link: `https://hr.anistonav.com/onboarding/invite/${invitation.inviteToken}`,
            },
          });

          logger.info(`[Recruitment] Auto-invite sent to ${candidateEmail} after offer acceptance`);
        }
      } catch (err) {
        // Non-blocking: invite failure should not rollback offer acceptance
        logger.warn(`[Recruitment] Auto-invite failed for ${offer.candidateEmail}:`, err);
      }
    }

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

    // Sanitize user inputs: strip prompt injection patterns, truncate
    const safe = (s?: string, max = 500) =>
      (s || '')
        .replace(/[\[\]`{}]/g, '')    // Remove brackets, backticks, braces
        .replace(/\n{2,}/g, ' ')      // Collapse multi-line injections
        .replace(/--+/g, '-')         // Collapse dash separators
        .slice(0, max)
        .trim();

    const userPrompt = `Generate a job description for the following position:
Title: ${safe(data.title, 200)}
${data.department ? `Department: ${safe(data.department, 100)}` : ''}
${data.type ? `Employment Type: ${safe(data.type, 50)}` : ''}
${data.requirements ? `Additional Requirements/Notes: ${safe(data.requirements)}` : ''}`;

    const aiResponse = await aiService.prompt(organizationId, systemPrompt, userPrompt, 2048);

    let parsed: any;
    try {
      const content = (aiResponse.data || '') as string;
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

  async triggerAIScoring(applicationId: string, organizationId?: string) {
    const app = organizationId
      ? await prisma.application.findFirst({
          where: { id: applicationId, jobOpening: { organizationId } },
          include: { jobOpening: true },
        })
      : await prisma.application.findUnique({ where: { id: applicationId }, include: { jobOpening: true } });
    if (!app) throw new NotFoundError('Application');
    const resolvedOrgId = organizationId || app.jobOpening?.organizationId || '';
    if (!app.resumeUrl) {
      logger.warn(`[AI Scoring] No resume URL for application ${applicationId} — skipping`);
      if (resolvedOrgId) emitToOrg(resolvedOrgId, 'recruitment:ai_scored', { applicationId, aiScore: null, reason: 'no_resume' });
      return { matchScore: null, summary: 'No resume uploaded for this application', strengths: [], gaps: [], matchedKeywords: [], missingKeywords: [] };
    }

    const { publicApplyService } = await import('../public-apply/public-apply.service.js');
    const result = await publicApplyService.analyzeResumeMatch(
      app.resumeUrl,
      app.jobOpening?.description || app.jobOpening?.title || '',
      app.jobOpening?.title || '',
      app.jobOpening?.requirements || [],
      resolvedOrgId,
    );

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScore: result.matchScore ?? null,
        aiScoreDetails: {
          overall_score: result.matchScore,
          match_percentage: result.matchScore,
          strengths: result.strengths,
          gaps: result.gaps,
          summary: result.summary,
          matchedKeywords: result.matchedKeywords,
          missingKeywords: result.missingKeywords,
          parseMethod: result.parseMethod,
        },
      },
    });

    if (resolvedOrgId) {
      emitToOrg(resolvedOrgId, 'recruitment:ai_scored', {
        applicationId,
        aiScore: result.matchScore ?? null,
      });
    }

    return result;
  }

  // ==================
  // M-1: MCQ SCORING FOR INTERNAL APPLICANTS
  // ==================

  /**
   * Get MCQ questions for an internal application's job (M-1).
   * Returns the job's questions so HR can administer in-person or auto-score.
   */
  async getApplicationMCQQuestions(applicationId: string, organizationId: string) {
    const app = await prisma.application.findFirst({
      where: { id: applicationId, jobOpening: { organizationId } },
      include: {
        jobOpening: {
          include: {
            questions: {
              select: { id: true, questionText: true, optionA: true, optionB: true, optionC: true, optionD: true, category: true },
            },
          },
        },
      },
    });
    if (!app) throw new NotFoundError('Application');
    return {
      jobTitle: app.jobOpening.title,
      questions: app.jobOpening.questions,
    };
  }

  /**
   * Score MCQ answers for an internal application and store score on Application (M-1).
   */
  async scoreApplicationMCQ(applicationId: string, answers: Array<{ questionId: string; selectedOption: string }>, organizationId: string) {
    const app = await prisma.application.findFirst({
      where: { id: applicationId, jobOpening: { organizationId } },
      include: { jobOpening: { include: { questions: true } } },
    });
    if (!app) throw new NotFoundError('Application');

    const questions = app.jobOpening.questions;
    if (questions.length === 0) throw new BadRequestError('No MCQ questions configured for this job');

    let totalCorrect = 0, intCorrect = 0, intTotal = 0, intgCorrect = 0, intgTotal = 0, enCorrect = 0, enTotal = 0;

    for (const question of questions) {
      const answer = answers.find(a => a.questionId === question.id);
      const isCorrect = answer?.selectedOption === question.correctOption;
      if (isCorrect) totalCorrect++;
      switch (question.category) {
        case 'INTELLIGENCE': intTotal++; if (isCorrect) intCorrect++; break;
        case 'INTEGRITY': intgTotal++; if (isCorrect) intgCorrect++; break;
        case 'ENERGY': enTotal++; if (isCorrect) enCorrect++; break;
      }
    }

    const mcqScore = Math.max(0, Math.min(100, Math.round((totalCorrect / questions.length) * 100)));
    const scoreDetails = {
      mcqScore,
      intelligenceScore: intTotal > 0 ? Math.round((intCorrect / intTotal) * 100) : null,
      integrityScore: intgTotal > 0 ? Math.round((intgCorrect / intgTotal) * 100) : null,
      energyScore: enTotal > 0 ? Math.round((enCorrect / enTotal) * 100) : null,
      totalAnswered: answers.length,
      totalQuestions: questions.length,
    };

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: { aiScore: mcqScore, aiScoreDetails: scoreDetails as any },
    });

    return { ...scoreDetails, application: updated };
  }

  // ==================
  // M-2: UNIFIED READY-FOR-ONBOARDING VIEW (all 3 pipelines)
  // ==================

  /**
   * Returns candidates from ALL recruitment pipelines who are selected/hired but not yet fully onboarded.
   * Sources: WalkInCandidate (SELECTED), PublicApplication (SELECTED), Application (OFFER_ACCEPTED)
   */
  async getReadyForOnboarding(organizationId: string) {
    const [walkIns, publicApps, internalApps] = await Promise.all([
      // Walk-in: SELECTED status, not yet completed
      prisma.walkInCandidate.findMany({
        where: { organizationId, status: 'SELECTED' },
        select: {
          id: true, fullName: true, email: true, phone: true, tokenNumber: true,
          aiScore: true, createdAt: true, convertedToApp: true,
          jobOpening: { select: { title: true, department: true } },
          interviewRounds: { select: { id: true, roundName: true, status: true, overallScore: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Public apply: SELECTED but check if employee exists (invited or not)
      prisma.publicApplication.findMany({
        where: { organizationId, status: 'SELECTED', deletedAt: null },
        select: {
          id: true, candidateName: true, email: true, mobileNumber: true, candidateUid: true,
          totalAiScore: true, finalScore: true, createdAt: true, finalizedAt: true,
          jobOpening: { select: { title: true, department: true } },
        },
        orderBy: { finalizedAt: 'desc' },
      }),
      // Internal recruitment: OFFER_ACCEPTED
      prisma.application.findMany({
        where: { jobOpening: { organizationId }, status: 'OFFER_ACCEPTED' },
        include: {
          jobOpening: { select: { title: true, department: true, organizationId: true } },
          offerLetter: { select: { id: true, status: true, sentAt: true, respondedAt: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    // Collect all unique non-null emails across all three source lists
    const allEmails = [
      ...walkIns.map(c => c.email),
      ...publicApps.map(a => a.email),
      ...internalApps.map(a => a.email),
    ].filter((e): e is string => !!e).map(e => e.toLowerCase());

    const uniqueEmails = [...new Set(allEmails)];

    // Single batch query for employee existence
    const existingEmployees = await prisma.employee.findMany({
      where: { email: { in: uniqueEmails }, organizationId, deletedAt: null },
      select: { email: true },
    });
    const existingEmailSet = new Set(existingEmployees.map(e => e.email.toLowerCase()));

    // Single batch query for invitation status (internal apps only)
    const internalEmails = internalApps.map(a => a.email).filter((e): e is string => !!e).map(e => e.toLowerCase());
    const invitations = internalEmails.length > 0
      ? await prisma.employeeInvitation.findMany({
          where: { organizationId, email: { in: internalEmails } },
          orderBy: { createdAt: 'desc' },
          select: { email: true, status: true, createdAt: true, expiresAt: true },
        })
      : [];
    // Keep only the latest invite per email
    const latestInviteByEmail = new Map<string, typeof invitations[number]>();
    for (const inv of invitations) {
      const key = (inv.email ?? '').toLowerCase();
      if (!latestInviteByEmail.has(key)) latestInviteByEmail.set(key, inv);
    }

    const walkInResults = walkIns.map((c) => ({
      source: 'WALK_IN' as const,
      id: c.id,
      name: c.fullName,
      email: c.email,
      phone: c.phone,
      jobTitle: c.jobOpening?.title || null,
      department: c.jobOpening?.department || null,
      score: c.aiScore ? Number(c.aiScore) : null,
      appliedAt: c.createdAt,
      selectedAt: c.createdAt,
      ref: c.tokenNumber,
      onboardingStarted: c.convertedToApp,
      employeeExists: c.convertedToApp ? true : (c.email ? existingEmailSet.has(c.email.toLowerCase()) : false),
      inviteStatus: null,
    }));

    const publicAppResults = publicApps.map((a) => {
      const empExists = a.email ? existingEmailSet.has(a.email.toLowerCase()) : false;
      return {
        source: 'PUBLIC_APPLY' as const,
        id: a.id,
        name: a.candidateName,
        email: a.email,
        phone: a.mobileNumber,
        jobTitle: a.jobOpening?.title || null,
        department: a.jobOpening?.department || null,
        score: a.finalScore ? Number(a.finalScore) : a.totalAiScore ? Number(a.totalAiScore) : null,
        appliedAt: a.createdAt,
        selectedAt: a.finalizedAt,
        ref: a.candidateUid,
        onboardingStarted: empExists,
        employeeExists: empExists,
        inviteStatus: null,
      };
    });

    const internalResults = internalApps.map((a) => {
      const invite = a.email ? (latestInviteByEmail.get(a.email.toLowerCase()) || null) : null;
      return {
        source: 'INTERNAL' as const,
        id: a.id,
        name: a.candidateName,
        email: a.email,
        phone: a.phone,
        jobTitle: a.jobOpening?.title || null,
        department: a.jobOpening?.department || null,
        score: a.aiScore ? Number(a.aiScore) : null,
        appliedAt: a.createdAt,
        selectedAt: a.updatedAt,
        ref: a.id,
        onboardingStarted: invite?.status === 'ACCEPTED',
        employeeExists: a.email ? existingEmailSet.has(a.email.toLowerCase()) : false,
        inviteStatus: invite,
      };
    });

    const all = [...walkInResults, ...publicAppResults, ...internalResults]
      .sort((a, b) => new Date(b.selectedAt || b.appliedAt).getTime() - new Date(a.selectedAt || a.appliedAt).getTime());

    return {
      total: all.length,
      pendingOnboarding: all.filter(c => !c.employeeExists).length,
      onboardingInProgress: all.filter(c => c.employeeExists && !c.onboardingStarted).length,
      data: all,
    };
  }

  // ==================
  // M-3: BULK SEND ONBOARDING INVITES
  // ==================

  /**
   * Send onboarding invites to multiple selected walk-in candidates at once (M-3).
   */
  async bulkSendOnboardingInvites(walkInIds: string[], organizationId: string, hiredBy: string) {
    const results: Array<{ id: string; name: string; status: 'sent' | 'failed'; error?: string }> = [];

    for (const id of walkInIds) {
      try {
        const candidate = await prisma.walkInCandidate.findFirst({
          where: { id, organizationId, status: 'SELECTED' },
          include: { jobOpening: { select: { title: true } } },
        });
        if (!candidate) {
          results.push({ id, name: 'Unknown', status: 'failed', error: 'Candidate not found or not in SELECTED status' });
          continue;
        }

        const { walkInService } = await import('../walkIn/walkIn.service.js');
        const hireEmail = candidate.email || `${candidate.tokenNumber.toLowerCase().replace(/-/g, '.')}@candidates.aniston.com`;
        await walkInService.hireCandidate(id, hireEmail, organizationId, hiredBy);
        results.push({ id, name: candidate.fullName, status: 'sent' });
      } catch (err: any) {
        logger.error(`[BulkInvite] Failed to hire candidate ${id}:`, err);
        results.push({ id, name: '', status: 'failed', error: err.message || 'Unknown error' });
      }
    }

    return {
      total: walkInIds.length,
      sent: results.filter(r => r.status === 'sent').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
    };
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

  async shareJobViaEmail(jobId: string, email: string, customMessage: string | undefined, organizationId: string) {
    // Validate recipient is a proper email address
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      throw new BadRequestError('Invalid recipient email address');
    }
    email = email.trim().toLowerCase();

    const job = await prisma.jobOpening.findFirst({
      where: { id: jobId, organizationId },
    });
    if (!job) throw new NotFoundError('Job opening');
    if (!job.publicFormToken) throw new BadRequestError('This job does not have a public application form');

    const org = await prisma.organization.findUnique({ where: { id: job.organizationId }, select: { name: true } });
    const applyUrl = `https://hr.anistonav.com/apply/${job.publicFormToken}`;
    const orgName = org?.name || 'Aniston Technologies';

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

  // ==================
  // BULK RESUME UPLOAD (B2)
  // ==================

  /**
   * Upload multiple resumes for a job opening. Creates BulkResumeUpload + items,
   * then processes each resume asynchronously (non-blocking, in background).
   */
  async uploadBulkResumes(
    jobOpeningId: string,
    files: Express.Multer.File[],
    organizationId: string,
    uploadedBy: string,
  ) {
    const job = await prisma.jobOpening.findFirst({ where: { id: jobOpeningId, organizationId } });
    if (!job) throw new NotFoundError('Job opening not found');

    const upload = await prisma.bulkResumeUpload.create({
      data: {
        jobOpeningId,
        organizationId,
        uploadedBy,
        totalFiles: files.length,
        processedFiles: 0,
        status: 'PROCESSING',
      },
    });

    // Create pending items for each file
    const items = await prisma.$transaction(
      files.map(file =>
        prisma.bulkResumeItem.create({
          data: {
            bulkUploadId: upload.id,
            organizationId,
            fileName: file.originalname,
            fileUrl: file.path || file.filename || '',
            status: 'PENDING',
          },
        })
      )
    );

    // Fire-and-forget async processing (non-blocking)
    setImmediate(() => {
      this._processBulkUpload(upload.id, items, job, organizationId).catch(err =>
        logger.error('[BulkResume] Processing error:', err)
      );
    });

    return { ...upload, items };
  }

  private async _processBulkUpload(
    uploadId: string,
    items: Array<{ id: string; fileUrl: string; fileName: string }>,
    job: { id: string; title: string; description: string; requirements: string[]; organizationId: string },
    organizationId: string,
  ) {
    const { publicApplyService } = await import('../public-apply/public-apply.service.js');
    let processed = 0;

    for (const item of items) {
      try {
        await prisma.bulkResumeItem.update({ where: { id: item.id, organizationId }, data: { status: 'PROCESSING' } });

        // Resolve file buffer — basename-only to prevent path traversal
        let buffer: Buffer;
        if (item.fileUrl.startsWith('http://') || item.fileUrl.startsWith('https://')) {
          const res = await fetch(item.fileUrl, { signal: AbortSignal.timeout(20000) });
          if (!res.ok) throw new Error('Failed to download file');
          buffer = Buffer.from(await res.arrayBuffer());
        } else {
          const uploadsRoot = path.resolve(process.cwd(), 'uploads');
          const safePath = path.join(uploadsRoot, path.basename(item.fileUrl));
          if (!safePath.startsWith(uploadsRoot) || !fs.existsSync(safePath)) throw new Error('File not found');
          buffer = fs.readFileSync(safePath);
        }

        const result = await publicApplyService.scoreResumeBuffer(
          buffer, item.fileName,
          job.description, job.title, job.requirements, organizationId
        );

        await prisma.bulkResumeItem.update({
          where: { id: item.id },
          data: {
            status: 'SCORED',
            candidateName: result.candidateName || null,
            email: result.email || null,
            phone: result.phone || null,
            aiScore: result.matchScore ?? null,
            atsScore: result.atsScore ?? null,
            aiScoreDetails: {
              strengths: result.strengths,
              gaps: result.gaps,
              summary: result.summary,
              atsScoreData: result.atsScoreData,
              parseMethod: result.parseMethod,
            },
            resumeText: result.resumeText?.slice(0, 5000) || null,
            matchedKeywords: result.matchedKeywords ?? [],
            missingKeywords: result.missingKeywords ?? [],
          },
        });
      } catch (err: any) {
        logger.warn(`[BulkResume] Failed to score item ${item.id}:`, err);
        await prisma.bulkResumeItem.update({
          where: { id: item.id },
          data: { status: 'FAILED', errorMessage: err.message || 'Processing failed' },
        });
      }

      processed++;
      await prisma.bulkResumeUpload.update({
        where: { id: uploadId },
        data: { processedFiles: processed },
      });
    }

    await prisma.bulkResumeUpload.update({
      where: { id: uploadId },
      data: { status: 'COMPLETED' },
    });
  }

  async getBulkUploads(organizationId: string) {
    return prisma.bulkResumeUpload.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        jobOpening: { select: { title: true, department: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async getBulkUpload(uploadId: string, organizationId: string) {
    const upload = await prisma.bulkResumeUpload.findFirst({
      where: { id: uploadId, organizationId },
      include: {
        jobOpening: { select: { title: true, department: true } },
        items: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!upload) throw new NotFoundError('Bulk upload not found');
    return upload;
  }

  /**
   * Promote a scored bulk resume item into a Kanban Application record.
   */
  async createApplicationFromBulkItem(itemId: string, jobOpeningId: string, organizationId: string) {
    const job = await prisma.jobOpening.findFirst({ where: { id: jobOpeningId, organizationId } });
    if (!job) throw new NotFoundError('Job opening not found');

    return prisma.$transaction(async (tx) => {
      // Re-fetch inside transaction to prevent TOCTOU race
      const item = await tx.bulkResumeItem.findFirst({ where: { id: itemId, organizationId } });
      if (!item) throw new NotFoundError('Bulk resume item not found');
      if (item.status !== 'SCORED') throw new BadRequestError('Item must be fully scored before adding to pipeline');
      if (item.applicationId) throw new BadRequestError('This resume has already been added to the pipeline');

      const details: any = item.aiScoreDetails || {};

      const app = await tx.application.create({
        data: {
          jobOpeningId,
          candidateName: item.candidateName || item.fileName.replace(/\.[^.]+$/, ''),
          email: item.email || null,
          phone: item.phone || null,
          resumeUrl: item.fileUrl,
          resumeText: item.resumeText || null,
          source: 'NAUKRI',
          status: 'APPLIED',
          currentStage: 1,
          aiScore: item.aiScore ? Number(item.aiScore) : null,
          aiScoreDetails: {
            matchScore: item.aiScore ? Number(item.aiScore) : null,
            strengths: details.strengths || [],
            gaps: details.gaps || [],
            summary: details.summary || '',
            parseMethod: details.parseMethod || 'bulk-upload',
          },
          resumeMatchScore: item.aiScore ? Number(item.aiScore) : null,
          atsScore: item.atsScore ? Number(item.atsScore) : null,
          atsScoreData: item.aiScoreDetails as any,
          matchedKeywords: item.matchedKeywords,
          missingKeywords: item.missingKeywords,
        },
      });

      await tx.bulkResumeItem.update({ where: { id: itemId }, data: { applicationId: app.id } });

      return app;
    });
  }

  async deleteBulkUpload(uploadId: string, organizationId: string) {
    const upload = await prisma.bulkResumeUpload.findFirst({ where: { id: uploadId, organizationId } });
    if (!upload) throw new NotFoundError('Bulk upload not found');
    await prisma.bulkResumeItem.deleteMany({ where: { bulkUploadId: uploadId } });
    await prisma.bulkResumeUpload.delete({ where: { id: uploadId } });
  }

  async deleteBulkResumeItem(itemId: string, organizationId: string) {
    const item = await prisma.bulkResumeItem.findFirst({ where: { id: itemId, organizationId } });
    if (!item) throw new NotFoundError('Item not found');
    await prisma.bulkResumeItem.delete({ where: { id: itemId } });
  }
}

export const recruitmentService = new RecruitmentService();
