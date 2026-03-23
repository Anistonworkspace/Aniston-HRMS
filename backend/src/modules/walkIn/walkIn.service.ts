import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError, BadRequestError } from '../../middleware/errorHandler.js';
import { emitToOrg } from '../../sockets/index.js';
import { enqueueEmail } from '../../jobs/queues.js';
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
        aadhaarNumber: data.aadhaarNumber,
        panNumber: data.panNumber,
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
        include: { jobOpening: { select: { title: true, department: true } } },
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
   * Get a single walk-in candidate by ID
   */
  async getById(id: string) {
    const candidate = await prisma.walkInCandidate.findUnique({
      where: { id },
      include: { jobOpening: { select: { title: true, department: true, location: true } } },
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
      include: { jobOpening: { select: { title: true, department: true } } },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');
    return candidate;
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
      include: { jobOpening: { select: { title: true, department: true } } },
    });
  }

  /**
   * Add HR notes
   */
  async addHRNotes(id: string, notes: string) {
    const candidate = await prisma.walkInCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    return prisma.walkInCandidate.update({
      where: { id },
      data: { hrNotes: notes },
    });
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

    const result = await prisma.$transaction(async (tx) => {
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

    return result;
  }

  /**
   * Delete a walk-in record (HR only)
   */
  async remove(id: string) {
    const candidate = await prisma.walkInCandidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    await prisma.walkInCandidate.delete({ where: { id } });
    return { message: 'Walk-in record deleted' };
  }

  /**
   * Hire a walk-in candidate — creates User + Employee, sends onboarding invite
   */
  async hireCandidate(walkInId: string, teamsEmail: string, organizationId: string, hiredBy: string) {
    const candidate = await prisma.walkInCandidate.findUnique({
      where: { id: walkInId },
      include: { jobOpening: { select: { title: true } } },
    });
    if (!candidate) throw new NotFoundError('Walk-in candidate');

    // Generate employee code
    const empCount = await prisma.employee.count({ where: { organizationId } });
    const employeeCode = `EMP-${String(empCount + 1).padStart(3, '0')}`;

    // Create User + Employee in transaction
    const result = await prisma.$transaction(async (tx) => {
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
        link: `${process.env.FRONTEND_URL || 'http://localhost:5173'}${onboardingUrl}`,
      },
    });

    // Copy documents from walkin folder to employee folder (best-effort)
    try {
      let base = process.cwd();
      if (base.endsWith('backend') || base.endsWith('backend\\') || base.endsWith('backend/')) base = path.resolve(base, '..');
      const srcDir = path.join(base, 'uploads', 'walkin', candidate.tokenNumber);
      const destDir = path.join(base, 'uploads', 'employees', result.employeeCode);
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        const files = fs.readdirSync(srcDir);
        files.forEach(file => fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file)));
      }
    } catch { /* best-effort, don't fail if files don't exist */ }

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
}

export const walkInService = new WalkInService();
