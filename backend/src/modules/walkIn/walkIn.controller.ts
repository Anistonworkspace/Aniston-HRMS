import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { walkInService } from './walkIn.service.js';
import { storageService, StoragePath } from '../../services/storage.service.js';
import {
  registerWalkInSchema, updateWalkInStatusSchema, walkInQuerySchema,
  addInterviewRoundSchema, updateInterviewRoundSchema, updateCandidateSchema,
} from './walkIn.validation.js';

export class WalkInController {
  async getOpenJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const orgId = (req.query.orgId as string) || process.env.DEFAULT_ORG_ID || undefined;
      const jobs = await walkInService.getOpenJobs(orgId);
      res.json({ success: true, data: jobs });
    } catch (err) { next(err); }
  }

  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const data = registerWalkInSchema.parse(req.body);
      // GAP-3 FIX: Never trust organizationId from request body on public routes.
      // Always use DEFAULT_ORG_ID from environment; fall back to first org in DB.
      let orgId = process.env.DEFAULT_ORG_ID || '';
      if (!orgId) {
        const { prisma } = await import('../../lib/prisma.js');
        const firstOrg = await prisma.organization.findFirst();
        orgId = firstOrg?.id || '';
      }
      if (!orgId) {
        res.status(503).json({ success: false, error: { code: 'ORG_NOT_FOUND', message: 'Organization not configured' } });
        return;
      }
      const candidate = await walkInService.register(data, orgId);
      res.status(201).json({
        success: true,
        data: candidate,
        message: `Registration complete! Your token: ${candidate.tokenNumber}`,
      });
    } catch (err) { next(err); }
  }

  async getByToken(req: Request, res: Response, next: NextFunction) {
    try {
      const candidate = await walkInService.getByToken(req.params.tokenNumber as string);
      res.json({ success: true, data: candidate });
    } catch (err) { next(err); }
  }

  async getTodayWalkIns(req: Request, res: Response, next: NextFunction) {
    try {
      const query = walkInQuerySchema.parse(req.query);
      const result = await walkInService.getTodayWalkIns(req.user!.organizationId, query);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const candidate = await walkInService.getById(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: candidate });
    } catch (err) { next(err); }
  }

  async updateCandidate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateCandidateSchema.parse(req.body);
      const candidate = await walkInService.updateCandidate(req.params.id as string, data, req.user!.organizationId);
      res.json({ success: true, data: candidate, message: 'Candidate details updated' });
    } catch (err) { next(err); }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateWalkInStatusSchema.parse(req.body);
      const candidate = await walkInService.updateStatus(req.params.id as string, status, req.user!.organizationId);
      res.json({ success: true, data: candidate, message: `Status updated to ${status}` });
    } catch (err) { next(err); }
  }

  async addNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const { notes } = z.object({ notes: z.string().min(1).max(2000) }).parse(req.body);
      const authorName = req.user?.email ? req.user.email.split('@')[0] : 'HR';
      const candidate = await walkInService.addHRNotes(req.params.id as string, notes, req.user!.organizationId, authorName);
      res.json({ success: true, data: candidate, message: 'Notes added' });
    } catch (err) { next(err); }
  }

  // Interview Rounds
  async addInterviewRound(req: Request, res: Response, next: NextFunction) {
    try {
      const data = addInterviewRoundSchema.parse(req.body);
      const round = await walkInService.addInterviewRound(req.params.id as string, data, req.user!.organizationId);
      res.status(201).json({ success: true, data: round, message: 'Interview round added' });
    } catch (err) { next(err); }
  }

  async updateInterviewRound(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateInterviewRoundSchema.parse(req.body);
      const round = await walkInService.updateInterviewRound(req.params.roundId as string, data, req.user!.organizationId);
      res.json({ success: true, data: round, message: 'Round updated' });
    } catch (err) { next(err); }
  }

  async deleteInterviewRound(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await walkInService.deleteInterviewRound(req.params.roundId as string, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async convertToApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const application = await walkInService.convertToApplication(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: application, message: 'Converted to application' });
    } catch (err) { next(err); }
  }

  async getSelectedCandidates(req: Request, res: Response, next: NextFunction) {
    try {
      const query = {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
        search: req.query.search as string | undefined,
      };
      const result = await walkInService.getSelectedCandidates(req.user!.organizationId, query);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getInterviewers(req: Request, res: Response, next: NextFunction) {
    try {
      const interviewers = await walkInService.getInterviewers(req.user!.organizationId);
      res.json({ success: true, data: interviewers });
    } catch (err) { next(err); }
  }

  async getAllWalkIns(req: Request, res: Response, next: NextFunction) {
    try {
      const query = walkInQuerySchema.parse(req.query);
      const result = await walkInService.getAllWalkIns(req.user!.organizationId, query);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await walkInService.getWalkInStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }

  async getMyInterviews(req: Request, res: Response, next: NextFunction) {
    try {
      const interviews = await walkInService.getMyInterviews(req.user!.userId);
      res.json({ success: true, data: interviews });
    } catch (err) { next(err); }
  }

  async getMyInterviewDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const round = await walkInService.getMyInterviewDetail(req.user!.userId, req.params.roundId as string);
      res.json({ success: true, data: round });
    } catch (err) { next(err); }
  }

  async submitMyScore(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateInterviewRoundSchema.parse(req.body);
      const result = await walkInService.submitMyInterviewScore(req.user!.userId, req.params.roundId as string, data);
      res.json({ success: true, data: result, message: 'Score submitted' });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await walkInService.remove(req.params.id as string, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async uploadFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });

      // Generate a UUID session folder — never use raw user input as folder name
      // to prevent path traversal attacks.
      const sessionId = randomUUID();
      const targetDir = storageService.getAbsoluteDir(StoragePath.walkinSession(sessionId));

      const ext = path.extname(req.file.originalname).toLowerCase();
      const allowedExts = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp'];
      if (!allowedExts.includes(ext)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, error: { message: `File type '${ext}' is not allowed. Allowed: ${allowedExts.join(', ')}` } });
      }
      const safeFilename = `upload${ext}`;
      const targetPath = path.join(targetDir, safeFilename);

      fs.renameSync(req.file.path, targetPath);

      const url = storageService.buildUrl(`walkin/${sessionId}`, safeFilename);
      res.json({ success: true, data: { url, filename: safeFilename, sessionId } });
    } catch (err) { next(err); }
  }

  async hire(req: Request, res: Response, next: NextFunction) {
    try {
      const { teamsEmail } = z.object({ teamsEmail: z.string().email() }).parse(req.body);
      const result = await walkInService.hireCandidate(req.params.id as string, teamsEmail, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: `Employee ${result.employeeCode} created and invite sent` });
    } catch (err) { next(err); }
  }

  async bulkImport(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: { message: 'No CSV file uploaded' } });
        return;
      }
      const csvContent = req.file.buffer?.toString('utf-8') || fs.readFileSync(req.file.path, 'utf-8');
      if (req.file.path) { try { fs.unlinkSync(req.file.path); } catch { /* best-effort */ } }

      const lines = csvContent.split('\n').map((l: string) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        res.status(400).json({ success: false, error: { message: 'CSV must have a header row and at least one data row' } });
        return;
      }

      const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase().replace(/["\s]/g, ''));
      const col = (names: string[]) => names.reduce((found: number, n: string) => found >= 0 ? found : headers.indexOf(n), -1);
      const nameIdx = col(['fullname', 'name', 'candidatename', 'candidate_name']);
      const phoneIdx = col(['phone', 'mobile', 'mobileno', 'phonenumber', 'contact']);
      const emailIdx = col(['email', 'emailaddress', 'email_address']);
      const positionIdx = col(['position', 'role', 'jobtitle', 'job_title', 'designation']);
      const expIdx = col(['experienceyears', 'experience', 'exp', 'years']);

      if (nameIdx < 0 || phoneIdx < 0) {
        res.status(400).json({ success: false, error: { message: 'CSV must have columns: fullName, phone. Optional: email, position, experienceYears' } });
        return;
      }

      const isValidIndianPhone = (p: string) => {
        const digits = p.replace(/[\s\-()]/g, '').replace(/^\+/, '');
        return /^[6-9]\d{9}$/.test(digits) || /^91[6-9]\d{9}$/.test(digits);
      };

      const rows = lines.slice(1).map((line: string) => {
        const cells = line.split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''));
        return {
          fullName: cells[nameIdx] || '',
          phone: cells[phoneIdx]?.replace(/[\s\-()]/g, '').replace(/^\+/, '') || '',
          email: emailIdx >= 0 ? cells[emailIdx] || undefined : undefined,
          position: positionIdx >= 0 ? cells[positionIdx] || undefined : undefined,
          experienceYears: expIdx >= 0 ? parseInt(cells[expIdx]) || 0 : 0,
        };
      }).filter((r: any) => r.fullName && r.phone && isValidIndianPhone(r.phone));

      const result = await walkInService.bulkImportFromCsv(rows, req.user!.organizationId);
      res.status(201).json({ success: true, data: result, message: `Imported ${result.created} candidates (${result.skipped} skipped)` });
    } catch (err) { next(err); }
  }

  // Public: get in-person psychometric questions (INTEGRITY + ENERGY, no correct answers)
  async getPsychometricQuestions(_req: Request, res: Response, next: NextFunction) {
    try {
      const { getPsychometricQuestions } = await import('../public-apply/public-apply.service.js');
      res.json({ success: true, data: getPsychometricQuestions() });
    } catch (err) { next(err); }
  }

  // HR: generate AI interview questions for a walk-in candidate
  async generateInterviewQuestions(req: Request, res: Response, next: NextFunction) {
    try {
      const candidate = await walkInService.getById(req.params.id as string, req.user!.organizationId);
      const { aiService } = await import('../../services/ai.service.js');
      const { prisma } = await import('../../lib/prisma.js');
      const job = candidate.jobOpeningId
        ? await prisma.jobOpening.findUnique({ where: { id: candidate.jobOpeningId }, select: { title: true, description: true } })
        : null;

      const prompt = `Generate 8 targeted interview questions for a candidate with these details:
Name: ${candidate.fullName}
Position: ${job?.title || 'General role'}
Experience: ${candidate.experienceYears} years ${candidate.experienceMonths} months
Last Company: ${candidate.currentCompany || candidate.lastEmployer || 'N/A'}
Skills: ${(candidate.skills || []).join(', ') || 'Not specified'}
Key Responsibilities: ${candidate.keyResponsibilities || 'Not specified'}

Generate questions that assess:
1. Technical competency for the role
2. Behavioral situations (STAR method)
3. Motivation and cultural fit
4. Problem-solving ability

Return as a JSON array: [{ "question": "...", "category": "Technical|Behavioral|Motivation|Problem Solving", "followUp": "optional follow-up hint" }]`;

      let questions: any[] = [];
      try {
        const aiResponse = await aiService.prompt(req.user!.organizationId, 'You are a professional HR interviewer. Generate structured interview questions as a JSON array.', prompt);
        const text = aiResponse.data || '';
        const match = text.match(/\[[\s\S]*\]/);
        if (match) questions = JSON.parse(match[0]);
      } catch {
        questions = [
          { question: `Tell me about your experience at ${candidate.currentCompany || 'your last company'}.`, category: 'Behavioral', followUp: 'Ask for specific achievements.' },
          { question: `Why are you interested in the ${job?.title || 'this'} role?`, category: 'Motivation', followUp: 'Look for genuine interest.' },
          { question: 'Describe a challenging situation and how you handled it.', category: 'Behavioral', followUp: 'Apply STAR method.' },
          { question: 'What are your key technical strengths relevant to this position?', category: 'Technical', followUp: 'Ask for examples.' },
          { question: 'Where do you see yourself in the next 3 years?', category: 'Motivation', followUp: 'Check alignment with company growth.' },
          { question: 'How do you prioritize when handling multiple deadlines?', category: 'Problem Solving', followUp: 'Look for structured approach.' },
          { question: 'What was your biggest professional achievement so far?', category: 'Behavioral', followUp: 'Quantify impact if possible.' },
          { question: 'What do you know about Aniston Technologies?', category: 'Motivation', followUp: 'Check research and interest level.' },
        ];
      }

      res.json({ success: true, data: questions });
    } catch (err) { next(err); }
  }

  // HR: send WhatsApp interview invite with walk-in form link
  async sendWhatsAppInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { phone, candidateName, position, interviewDate, interviewTime, jobId } = z.object({
        phone: z.string().min(1),
        candidateName: z.string(),
        position: z.string(),
        interviewDate: z.string(),
        interviewTime: z.string(),
        jobId: z.string().optional(),
      }).parse(req.body);

      // Validate phone: strip formatting, then accept Indian 10-digit or E.164 with country code
      const phoneDigits = phone.replace(/[\s\-()]/g, '').replace(/^\+/, '');
      const isIndian10 = /^[6-9]\d{9}$/.test(phoneDigits);
      const isWithCountryCode = /^91[6-9]\d{9}$/.test(phoneDigits);
      if (!isIndian10 && !isWithCountryCode) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PHONE', message: 'Enter a valid Indian mobile number (10 digits starting with 6–9, or with 91 country code)' } });
        return;
      }

      const baseUrl = 'https://hr.anistonav.com';
      const formLink = jobId ? `${baseUrl}/walk-in?jobId=${jobId}` : `${baseUrl}/walk-in`;

      const { prisma } = await import('../../lib/prisma.js');
      const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { name: true, address: true } });
      const companyName = org?.name || 'Aniston Technologies LLP';
      const addr = org?.address as any;
      const venue = addr ? [addr.street, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ') : '207B, Jaksons Crown Heights, Sec-10, Rohini, New Delhi - 110085';

      const message = `Hello ${candidateName},

Congratulations! You have been shortlisted for the *${position}* position at *${companyName}*.

*Interview Details:*
Date: ${interviewDate}
Time: ${interviewTime}
Venue: ${venue}

Please fill your interview registration form before arriving:
${formLink}

Bring your original documents (ID proof, certificates, resume).

Best regards,
HR Team | ${companyName}`;

      const { whatsAppService } = await import('../whatsapp/whatsapp.service.js');
      const allowed = await whatsAppService.checkAutoSendQuota(req.user!.organizationId);
      if (!allowed) {
        res.json({ success: true, data: { message, phone: phoneDigits, messageSent: false, reason: 'Auto-send quota exceeded (10/min). Try again shortly.' } });
        return;
      }
      try {
        await whatsAppService.sendMessage(
          { to: phoneDigits, message },
          req.user!.organizationId,
          req.user!.userId,
          'INTERVIEW_INVITE',
          { skipQuotaCheck: true }
        );
        res.json({ success: true, data: { message, phone: phoneDigits, messageSent: true } });
      } catch (waErr: any) {
        // WhatsApp not connected or number not found — return success with messageSent: false
        // so the walk-in record is not lost due to a WhatsApp connectivity issue
        const { logger } = await import('../../lib/logger.js');
        logger.warn('[Walk-in] WhatsApp invite failed:', waErr.message);
        res.json({
          success: true,
          data: { message, phone: phoneDigits, messageSent: false, reason: waErr.message || 'WhatsApp not connected' },
        });
      }
    } catch (err) { next(err); }
  }
}

export const walkInController = new WalkInController();
