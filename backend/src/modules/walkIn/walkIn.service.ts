import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, BadRequestError, AppError } from '../../middleware/errorHandler.js';
import { logger } from '../../lib/logger.js';
import { emitToOrg } from '../../sockets/index.js';
import { enqueueEmail } from '../../jobs/queues.js';
import { encrypt, decrypt, maskAadhaar, maskPAN } from '../../utils/encryption.js';
import type { RegisterWalkInInput, WalkInQuery } from './walkIn.validation.js';

export class WalkInService {
  /**
   * Generate a unique token number: WALK-IN-YYYY-NNNN
   */
  private async generateToken(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `WALK-IN-${year}-`;

    const lastCandidate = await prisma.walkInCandidate.findFirst({
      where: {
        organizationId,
        tokenNumber: { startsWith: prefix },
      },
      orderBy: { tokenNumber: 'desc' },
    });

    let nextNum = 1;
    if (lastCandidate) {
      const lastNum = parseInt(lastCandidate.tokenNumber.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Register a new walk-in candidate (public — no auth)
   */
  async register(data: RegisterWalkInInput, organizationId: string) {
    // Check duplicate by email + same day
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existing = await prisma.walkInCandidate.findFirst({
      where: {
        email: data.email,
        organizationId,
        registrationDate: { gte: today, lt: tomorrow },
      },
    });
    if (existing) {
      throw new BadRequestError('You have already registered today. Your token is: ' + existing.tokenNumber);
    }

    const tokenNumber = await this.generateToken(organizationId);

    const candidate = await prisma.walkInCandidate.create({
      data: {
        tokenNumber,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        city: data.city,
        jobOpeningId: data.jobOpeningId || null,
        aadhaarFrontUrl: data.aadhaarFrontUrl,
        aadhaarBackUrl: data.aadhaarBackUrl,
        panCardUrl: data.panCardUrl,
        selfieUrl: data.selfieUrl,
        aadhaarNumber: data.aadhaarNumber ? encrypt(data.aadhaarNumber) : null,
        panNumber: data.panNumber ? encrypt(data.panNumber) : null,
        ocrVerifiedName: data.ocrVerifiedName,
        ocrVerifiedDob: data.ocrVerifiedDob ? new Date(data.ocrVerifiedDob) : null,
        ocrVerifiedAddress: data.ocrVerifiedAddress,
        tamperDetected: data.tamperDetected,
        tamperDetails: data.tamperDetails,
        qualification: data.qualification,
        fieldOfStudy: data.fieldOfStudy,
        experienceYears: data.experienceYears,
        experienceMonths: data.experienceMonths,
        isFresher: data.isFresher,
        currentCompany: data.currentCompany,
        currentCtc: data.currentCtc,
        expectedCtc: data.expectedCtc,
        noticePeriod: data.noticePeriod,
        skills: data.skills,
        aboutMe: data.aboutMe,
        resumeUrl: data.resumeUrl,
        status: 'WAITING',
        organizationId,
      },
      include: { jobOpening: { select: { title: true, department: true } } },
    });

    // Emit real-time notification to HR users in the organization
    emitToOrg(organizationId, 'walk_in:new', {
      id: candidate.id,
      tokenNumber: candidate.tokenNumber,
      fullName: candidate.fullName,
      jobTitle: candidate.jobOpening?.title || 'Unknown Position',
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget: AI resume scoring
    if (candidate.resumeUrl && candidate.jobOpeningId) {
      this.triggerAIScoring(candidate.id, candidate.jobOpeningId, candidate.resumeUrl, organizationId)
        .catch((err: any) => logger.error('[WalkIn] AI scoring failed:', err.message));
    }

    // Fire-and-forget: Aadhaar OCR validation
    if (candidate.aadhaarFrontUrl) {
      this.triggerAadhaarOCR(candidate.id, candidate.aadhaarFrontUrl, candidate.aadhaarNumber || undefined)
        .catch((err: any) => logger.error('[WalkIn] Aadhaar OCR failed:', err.message));
    }

    return candidate;
  }

  /**
   * Get today's walk-in candidates (HR view)
   */
  async getTodayWalkIns(organizationId: string, query: WalkInQuery) {
    const { page, limit, status, date, search } = query;
    const skip = (page - 1) * limit;

    // Default to today if no date specified
    const filterDate = date ? new Date(date) : new Date();
    filterDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(filterDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const where: any = {
      organizationId,
      registrationDate: { gte: filterDate, lt: nextDate },
    };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { tokenNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [candidates, total] = await Promise.all([
      prisma.walkInCandidate.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          jobOpening: { select: { title: true, department: true } },
          interviewRounds: { orderBy: { roundNumber: 'asc' } },
        },
      }),
      prisma.walkInCandidate.count({ where }),
    ]);

    return {
      data: candidates,
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get ALL walk-in candidates (no date restriction)
   */
  async getAllWalkIns(organizationId: string, query: WalkInQuery) {
    const { page, limit, status, dateFrom, dateTo, search } = query as any;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.registrationDate = {};
      if (dateFrom) where.registrationDate.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        where.registrationDate.lt = end;
      }
    }
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { tokenNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [candidates, total] = await Promise.all([
      prisma.walkInCandidate.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          jobOpening: { select: { title: true, department: true } },
          interviewRounds: { orderBy: { roundNumber: 'asc' } },
        },
      }),
      prisma.walkInCandidate.count({ where }),
    ]);

    return {
      data: candidates,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 },
    };
  }

  /**
   * Get status counts across ALL walk-in candidates
   */
  async getWalkInStats(organizationId: string) {
    const counts = await prisma.walkInCandidate.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: true,
    });
    const stats: Record<string, number> = {
      WAITING: 0, IN_INTERVIEW: 0, ON_HOLD: 0, SELECTED: 0,
      REJECTED: 0, COMPLETED: 0, NO_SHOW: 0,
    };
    let total = 0;
    counts.forEach(c => { stats[c.status] = c._count; total += c._count; });
    return { ...stats, total };
  }

  /**
   * Get a single walk-in candidate by ID
   */
  async getById(id: string) {
    const candidate = await prisma.walkInCandidate.findUnique({
      where: { id },
      include: {
        jobOpening: { select: { title: true, department: true, location: true } },
        interviewRounds: {
          orderBy: { roundNumber: 'asc' },
          include: {
            interviewer: {
              select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } },
            },
          },
        },
      },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');
    return candidate;
  }

  /**
   * Get a walk-in candidate by token number (public)
   */
  async getByToken(tokenNumber: string) {
    const candidate = await prisma.walkInCandidate.findUnique({
      where: { tokenNumber },
      include: {
        jobOpening: { select: { title: true, department: true } },
        interviewRounds: {
          orderBy: { roundNumber: 'asc' },
          select: {
            id: true,
            roundNumber: true,
            roundName: true,
            status: true,
            result: true,
            scheduledAt: true,
            completedAt: true,
          },
        },
      },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    // Return only safe public-facing fields
    return {
      tokenNumber: candidate.tokenNumber,
      fullName: candidate.fullName,
      jobTitle: candidate.jobOpening?.title || 'Not specified',
      department: candidate.jobOpening?.department || '',
      status: candidate.status,
      currentRound: candidate.currentRound,
      totalRounds: candidate.totalRounds,
      registrationDate: candidate.registrationDate,
      interviewRounds: candidate.interviewRounds,
    };
  }

  /**
   * Update walk-in candidate details (HR)
   */
  async updateCandidate(id: string, data: any) {
    const candidate = await prisma.walkInCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    return prisma.walkInCandidate.update({
      where: { id },
      data,
      include: {
        jobOpening: { select: { title: true, department: true, location: true } },
        interviewRounds: { orderBy: { roundNumber: 'asc' } },
      },
    });
  }

  /**
   * Update walk-in status (HR action)
   */
  async updateStatus(id: string, status: string) {
    const candidate = await prisma.walkInCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    return prisma.walkInCandidate.update({
      where: { id },
      data: { status: status as any },
      include: {
        jobOpening: { select: { title: true, department: true } },
        interviewRounds: { orderBy: { roundNumber: 'asc' } },
      },
    });
  }

  /**
   * Add HR notes — appends with author name and timestamp
   */
  async addHRNotes(id: string, notes: string, authorName?: string) {
    const candidate = await prisma.walkInCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    const timestamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const author = authorName || 'HR';
    const entry = `[${timestamp} — ${author}] ${notes}`;
    const existing = candidate.hrNotes ? candidate.hrNotes + '\n---\n' : '';

    return prisma.walkInCandidate.update({
      where: { id },
      data: { hrNotes: existing + entry },
    });
  }

  // =====================
  // INTERVIEW ROUNDS
  // =====================

  /**
   * Add an interview round
   */
  async addInterviewRound(walkInId: string, data: { roundName: string; interviewerName?: string; interviewerId?: string; scheduledAt?: string }) {
    const candidate = await prisma.walkInCandidate.findUnique({
      where: { id: walkInId },
      include: { interviewRounds: true },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    const nextRound = candidate.interviewRounds.length + 1;
    const totalRounds = Math.max(candidate.totalRounds, nextRound);

    let round: any;
    try {
      [round] = await prisma.$transaction([
        prisma.walkInInterviewRound.create({
          data: {
            walkInId,
            roundNumber: nextRound,
            roundName: data.roundName,
            interviewerName: data.interviewerName || null,
            interviewerId: data.interviewerId || null,
            scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
            status: data.scheduledAt ? 'SCHEDULED' : 'PENDING',
          },
        }),
        prisma.walkInCandidate.update({
          where: { id: walkInId },
          data: { totalRounds },
        }),
      ]);
    } catch (err: any) {
      if (err instanceof NotFoundError || err instanceof BadRequestError) throw err;
      logger.error(`[WalkIn] addInterviewRound() transaction failed: ${err.message}`);
      throw new AppError('Failed to add interview round. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    return round;
  }

  /**
   * Update an interview round (score, status, result, schedule)
   */
  async updateInterviewRound(roundId: string, data: any) {
    const round = await prisma.walkInInterviewRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundError('Interview round');

    const updateData: any = {};
    if (data.interviewerName !== undefined) updateData.interviewerName = data.interviewerName;
    if (data.interviewerId !== undefined) updateData.interviewerId = data.interviewerId || null;
    if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'COMPLETED') updateData.completedAt = new Date();
      if (data.status === 'SCHEDULED' && !updateData.scheduledAt && !round.scheduledAt) {
        throw new BadRequestError('Must provide scheduledAt when setting status to SCHEDULED');
      }
    }
    if (data.communication !== undefined) updateData.communication = data.communication;
    if (data.technical !== undefined) updateData.technical = data.technical;
    if (data.problemSolving !== undefined) updateData.problemSolving = data.problemSolving;
    if (data.culturalFit !== undefined) updateData.culturalFit = data.culturalFit;
    if (data.overallScore !== undefined) updateData.overallScore = data.overallScore;
    if (data.remarks !== undefined) updateData.remarks = data.remarks;
    if (data.result !== undefined) updateData.result = data.result;

    // If completing with a result, update candidate's currentRound
    const updated = await prisma.walkInInterviewRound.update({
      where: { id: roundId },
      data: updateData,
    });

    // Auto-update candidate status based on round result
    if (data.result || data.status === 'COMPLETED') {
      const candidate = await prisma.walkInCandidate.findUnique({
        where: { id: round.walkInId },
        include: { interviewRounds: { orderBy: { roundNumber: 'asc' } } },
      });
      if (candidate) {
        const completedRounds = candidate.interviewRounds.filter(r => r.status === 'COMPLETED' || r.id === roundId).length;
        const candidateUpdate: any = { currentRound: completedRounds };

        if (data.result === 'FAILED') {
          candidateUpdate.status = 'REJECTED';
        } else if (data.result === 'ON_HOLD') {
          candidateUpdate.status = 'ON_HOLD';
        } else if (data.result === 'PASSED' && completedRounds >= candidate.totalRounds) {
          candidateUpdate.status = 'SELECTED';
        } else if (data.result === 'PASSED') {
          candidateUpdate.status = 'IN_INTERVIEW';
        }

        await prisma.walkInCandidate.update({
          where: { id: round.walkInId },
          data: candidateUpdate,
        });
      }
    }

    return updated;
  }

  /**
   * Delete an interview round
   */
  async deleteInterviewRound(roundId: string) {
    const round = await prisma.walkInInterviewRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundError('Interview round');

    await prisma.walkInInterviewRound.delete({ where: { id: roundId } });

    // Re-number remaining rounds
    const remaining = await prisma.walkInInterviewRound.findMany({
      where: { walkInId: round.walkInId },
      orderBy: { roundNumber: 'asc' },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].roundNumber !== i + 1) {
        await prisma.walkInInterviewRound.update({
          where: { id: remaining[i].id },
          data: { roundNumber: i + 1 },
        });
      }
    }

    await prisma.walkInCandidate.update({
      where: { id: round.walkInId },
      data: { totalRounds: remaining.length || 1 },
    });

    return { message: 'Round deleted' };
  }

  /**
   * Convert walk-in candidate to a full recruitment application
   */
  async convertToApplication(id: string) {
    const candidate = await prisma.walkInCandidate.findUnique({
      where: { id },
      include: { jobOpening: true },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');
    if (candidate.convertedToApp) {
      throw new BadRequestError('This candidate has already been converted to an application');
    }
    if (!candidate.jobOpeningId) {
      throw new BadRequestError('Cannot convert: No job opening linked to this walk-in');
    }

    let result: any;
    try {
      result = await prisma.$transaction(async (tx) => {
        // Create Application
        const application = await tx.application.create({
          data: {
            jobOpeningId: candidate.jobOpeningId!,
            candidateName: candidate.fullName,
            email: candidate.email,
            phone: candidate.phone,
            resumeUrl: candidate.resumeUrl || '',
            source: 'WALK_IN',
            status: 'SCREENING',
            currentStage: 2,
            aiScore: candidate.aiScore || null,
            aiScoreDetails: candidate.aiScoreDetails || undefined,
          },
        });

        // Update walk-in record
        await tx.walkInCandidate.update({
          where: { id },
          data: {
            convertedToApp: true,
            applicationId: application.id,
            status: 'IN_INTERVIEW',
          },
        });

        return application;
      });
    } catch (err: any) {
      if (err instanceof NotFoundError || err instanceof BadRequestError) throw err;
      logger.error(`[WalkIn] convertToApplication() transaction failed: ${err.message}`);
      throw new AppError('Failed to convert walk-in to application. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    return result;
  }

  /**
   * Delete a walk-in record + clean up WhatsApp messages (HR only)
   * Note: WalkInInterviewRound has onDelete: Cascade, so rounds auto-delete
   */
  async remove(id: string) {
    const candidate = await prisma.walkInCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    // Delete WhatsApp messages sent to this candidate's phone (best-effort)
    if (candidate.mobileNumber && candidate.organizationId) {
      try {
        const phone = candidate.mobileNumber.replace(/\D/g, '');
        await prisma.whatsAppMessage.deleteMany({
          where: { to: { contains: phone }, organizationId: candidate.organizationId },
        });
      } catch {
        // Silently continue if WhatsApp cleanup fails
      }
    }

    await prisma.walkInCandidate.delete({ where: { id } });
    return { message: 'Walk-in record deleted' };
  }

  /**
   * Hire a walk-in candidate — creates User + Employee, sends onboarding invite
   */
  async hireCandidate(walkInId: string, teamsEmail: string, organizationId: string, hiredBy: string) {
    // Guard: teamsEmail must be a valid email address (not a phone number fallback)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!teamsEmail || !emailRegex.test(teamsEmail.trim())) {
      throw new BadRequestError('A valid corporate email address is required to hire the candidate. Please provide an email (e.g. name@company.com).');
    }
    teamsEmail = teamsEmail.trim().toLowerCase();

    const candidate = await prisma.walkInCandidate.findUnique({
      where: { id: walkInId },
      include: { jobOpening: { select: { title: true } } },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    // Generate employee code
    const empCount = await prisma.employee.count({ where: { organizationId } });
    const employeeCode = `EMP-${String(empCount + 1).padStart(3, '0')}`;

    // Create User + Employee in transaction
    let result: any;
    try {
      result = await prisma.$transaction(async (tx) => {
        const tempPassword = crypto.randomBytes(16).toString('hex');
        const passwordHash = await bcrypt.hash(tempPassword, 12);

        const user = await tx.user.create({
          data: {
            email: teamsEmail,
            passwordHash,
            role: 'EMPLOYEE',
            status: 'PENDING_VERIFICATION',
            organizationId,
          },
        });

        // Split name into first/last
        const nameParts = candidate.fullName.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || nameParts[0];

        const employee = await tx.employee.create({
          data: {
            employeeCode,
            userId: user.id,
            firstName,
            lastName,
            email: teamsEmail,
            personalEmail: candidate.email,
            phone: candidate.phone,
            gender: 'PREFER_NOT_TO_SAY',
            workMode: 'OFFICE',
            joiningDate: new Date(),
            status: 'PROBATION',
            organizationId,
          },
        });

        // Update walk-in status
        await tx.walkInCandidate.update({
          where: { id: walkInId },
          data: { status: 'COMPLETED', convertedToApp: true },
        });

        return { user, employee, employeeCode };
      });
    } catch (err: any) {
      if (err instanceof NotFoundError || err instanceof BadRequestError) throw err;
      logger.error(`[WalkIn] hireCandidate() transaction failed: ${err.message}`);
      throw new AppError('Failed to create employee record for candidate. Please try again.', 500, 'TRANSACTION_FAILED');
    }

    // Generate onboarding token (Redis, 7-day TTL)
    const token = crypto.randomBytes(32).toString('hex');
    await redis.setex(`onboarding:${token}`, 7 * 86400, JSON.stringify({
      employeeId: result.employee.id,
      email: teamsEmail,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      currentStep: 1,
      stepData: {},
    }));

    const onboardingUrl = `/onboarding/${token}`;

    // Enqueue welcome email
    await enqueueEmail({
      to: teamsEmail,
      subject: 'Welcome to Aniston Technologies — Complete Your Onboarding',
      template: 'onboarding-invite',
      context: {
        name: candidate.fullName,
        link: `https://hr.anistonav.com${onboardingUrl}`,
      },
    });

    // Copy documents from walkin folder to employee folder (best-effort)
    try {
      const { storageService } = await import('../../services/storage.service.js');
      const srcDir = storageService.getAbsoluteDir('walkin', candidate.tokenNumber);
      const destDir = storageService.getAbsoluteDir('employees', result.employeeCode);
      if (fs.existsSync(srcDir)) {
        const files = fs.readdirSync(srcDir);
        files.forEach(file => fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file)));
      }
    } catch { /* best-effort, don't fail if files don't exist */ }

    // Send HR notification email to adminNotificationEmail
    try {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (org?.adminNotificationEmail) {
        await enqueueEmail({
          to: org.adminNotificationEmail,
          subject: `New hire onboarding started — ${candidate.fullName}`,
          template: 'generic',
          context: {
            title: 'New Hire Onboarding Started',
            message: `Candidate ${candidate.fullName} (${candidate.tokenNumber}) has been hired for ${candidate.jobOpening?.title || 'Open Position'}.\n\nEmployee Code: ${result.employeeCode}\nEmail: ${teamsEmail}\nOnboarding link sent.\n\nPlease complete the remaining HR setup.`,
          },
        });
      }
    } catch { /* best-effort */ }

    return {
      employee: result.employee,
      employeeCode: result.employeeCode,
      onboardingUrl,
    };
  }

  /**
   * Get open job openings for walk-in dropdown (public)
   * If no orgId, fetches from the first organization
   */
  async getOpenJobs(organizationId?: string) {
    let orgId = organizationId;
    if (!orgId) {
      const firstOrg = await prisma.organization.findFirst();
      orgId = firstOrg?.id || '';
    }
    if (!orgId) return [];

    return prisma.jobOpening.findMany({
      where: { organizationId: orgId, status: 'OPEN' },
      select: {
        id: true, title: true, department: true, location: true, type: true,
        experience: true, description: true, openings: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  /**
   * AI Resume Scoring — called async after registration
   */
  private async triggerAIScoring(walkInId: string, jobOpeningId: string, resumeUrl: string, organizationId: string) {
    const job = await prisma.jobOpening.findUnique({ where: { id: jobOpeningId } });
    if (!job) return;

    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    let scoreResult: any;

    try {
      const response = await fetch(`${aiServiceUrl}/ai/scoring/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.AI_SERVICE_API_KEY || 'dev-ai-key',
        },
        body: JSON.stringify({
          resume_text: resumeUrl,
          job_description: job.description || job.title,
          job_title: job.title,
          required_skills: job.requirements || [],
        }),
      });
      if (response.ok) {
        const body = await response.json();
        scoreResult = body.data || body;
      } else {
        throw new Error(`AI service returned ${response.status}`);
      }
    } catch {
      // Mock fallback
      scoreResult = {
        overall_score: Math.round((60 + Math.random() * 30) * 10) / 10,
        match_percentage: Math.round((50 + Math.random() * 40) * 10) / 10,
        strengths: ['Relevant experience', 'Skills alignment'],
        gaps: ['Further evaluation needed'],
        reasoning: 'Score generated from fallback analysis',
      };
    }

    await prisma.walkInCandidate.update({
      where: { id: walkInId },
      data: {
        aiScore: scoreResult.overall_score,
        aiScoreDetails: scoreResult,
      },
    });

    // Notify HR dashboard about AI score update
    emitToOrg(organizationId, 'walk_in:ai_scored', {
      id: walkInId,
      aiScore: scoreResult.overall_score,
    });
  }

  /**
   * Aadhaar OCR validation — called async after registration
   */
  private async triggerAadhaarOCR(walkInId: string, imageUrl: string, aadhaarNumber?: string) {
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    try {
      const response = await fetch(`${aiServiceUrl}/ai/ocr/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.AI_SERVICE_API_KEY || 'dev-ai-key',
        },
        body: JSON.stringify({ image_url: imageUrl, document_type: 'aadhaar' }),
      });

      if (response.ok) {
        const body = await response.json();
        const ocrData = body.data || body;

        const updateData: any = {};
        if (ocrData.name) updateData.ocrVerifiedName = ocrData.name;
        if (ocrData.dob) updateData.ocrVerifiedDob = new Date(ocrData.dob);
        if (ocrData.address) updateData.ocrVerifiedAddress = ocrData.address;

        // Validate Aadhaar number format (12 digits)
        if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) {
          updateData.tamperDetected = true;
          updateData.tamperDetails = 'Aadhaar number is not a valid 12-digit number';
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.walkInCandidate.update({ where: { id: walkInId }, data: updateData });
        }
      }
    } catch {
      // OCR is best-effort, don't fail
    }
  }

  /**
   * Get selected (interview-passed) candidates for hiring dashboard
   */
  async getSelectedCandidates(organizationId: string, query: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;
    const where: any = { organizationId, status: 'SELECTED' };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { tokenNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [candidates, total] = await Promise.all([
      prisma.walkInCandidate.findMany({
        where, skip, take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          jobOpening: { select: { title: true, department: true } },
          interviewRounds: { orderBy: { roundNumber: 'asc' } },
        },
      }),
      prisma.walkInCandidate.count({ where }),
    ]);
    return { data: candidates, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /**
   * Get ALL active users who can be assigned as interviewers
   */
  async getInterviewers(organizationId: string) {
    return prisma.user.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        role: true,
        employee: { select: { firstName: true, lastName: true } },
      },
      orderBy: { email: 'asc' },
    });
  }

  /**
   * Get interview rounds assigned to a specific user (employee view)
   */
  async getMyInterviews(userId: string) {
    return prisma.walkInInterviewRound.findMany({
      where: { interviewerId: userId },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        walkIn: {
          select: {
            id: true, fullName: true, tokenNumber: true, email: true, phone: true,
            aiScore: true, aiScoreDetails: true, status: true, resumeUrl: true,
            jobOpening: { select: { title: true, department: true } },
          },
        },
      },
    });
  }

  /**
   * Get a single interview round detail for the assigned employee
   */
  async getMyInterviewDetail(userId: string, roundId: string) {
    const round = await prisma.walkInInterviewRound.findUnique({
      where: { id: roundId },
      include: {
        walkIn: {
          include: {
            jobOpening: { select: { title: true, department: true, location: true, requirements: true } },
            interviewRounds: { orderBy: { roundNumber: 'asc' } },
          },
        },
      },
    });
    if (!round) throw new NotFoundError('Interview round');
    if (round.interviewerId !== userId) throw new BadRequestError('This interview is not assigned to you');
    return round;
  }

  /**
   * Employee submits scores for their assigned interview round
   */
  async submitMyInterviewScore(userId: string, roundId: string, data: any) {
    const round = await prisma.walkInInterviewRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundError('Interview round');
    if (round.interviewerId !== userId) throw new BadRequestError('This interview is not assigned to you');
    return this.updateInterviewRound(roundId, { ...data, status: 'COMPLETED' });
  }
}

export const walkInService = new WalkInService();
