import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { publicApplyService } from './public-apply.service.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';

export class PublicApplyController {
  // Public: Get job form
  async getJobForm(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await publicApplyService.getJobForm(req.params.token);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // Public: Submit application (multipart form data with optional resume)
  async submitApplication(req: Request, res: Response, next: NextFunction) {
    try {
      // mcqAnswers comes as JSON string from FormData
      const rawAnswers = req.body.mcqAnswers;
      const mcqAnswers = typeof rawAnswers === 'string' ? JSON.parse(rawAnswers) : rawAnswers;

      const body = z.object({
        candidateName: z.string().min(1),
        email: z.string().email().optional(),
        mobileNumber: z.string().optional(),
        city: z.string().optional(),
        experience: z.string().optional(),
        currentDesignation: z.string().optional(),
        preferredLocation: z.string().optional(),
        willingToRelocate: z.enum(['yes', 'no', 'maybe']).optional(),
        currentCTC: z.string().optional(),
        expectedCTC: z.string().optional(),
        noticePeriod: z.string().optional(),
        mcqAnswers: z.array(z.object({ questionId: z.string(), selectedOption: z.string() })),
        resumeUrl: z.string().optional(),
      }).parse({ ...req.body, mcqAnswers });

      // If a resume file was uploaded, set resumeUrl to its path
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) {
        body.resumeUrl = storageService.buildUrl(StorageFolder.EMPLOYEE_DOCUMENTS, file.filename);
      }

      const result = await publicApplyService.submitApplication(req.params.token, body);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // Public: Track application
  async trackApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await publicApplyService.trackApplication(req.params.uid);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // HR: Generate screening questions
  async generateQuestions(req: Request, res: Response, next: NextFunction) {
    try {
      const questions = await publicApplyService.generateQuestions(req.params.jobId, req.user!.organizationId);
      res.json({ success: true, data: questions });
    } catch (err) { next(err); }
  }

  // HR: Schedule interview
  async scheduleInterview(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        interviewerId: z.string().optional(),
        interviewerName: z.string().optional(),
        scheduledAt: z.string(),
        location: z.string(),
        notes: z.string().optional(),
        messageType: z.enum(['whatsapp', 'email', 'both']).optional(),
        roundType: z.enum(['HR', 'MANAGER', 'SUPERADMIN']).optional(),
      }).parse(req.body);
      const result = await publicApplyService.scheduleInterview(req.params.id, data, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: 'Interview scheduled & notifications sent' });
    } catch (err) { next(err); }
  }

  // HR: Preview schedule message
  async previewScheduleMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        scheduledAt: z.string().min(1),
        location: z.string().min(1),
        interviewerName: z.string().min(1),
        jobTitle: z.string().min(1),
        companyName: z.string().min(1),
        candidateName: z.string().min(1),
      }).parse(req.body);
      const result = await publicApplyService.previewScheduleMessage(req.user!.organizationId, data);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // HR: Generate interview questions for a round
  async generateInterviewQuestions(req: Request, res: Response, next: NextFunction) {
    try {
      const questions = await publicApplyService.generateInterviewQuestions(req.params.roundId, req.user!.organizationId);
      res.json({ success: true, data: questions });
    } catch (err) { next(err); }
  }

  // Interviewer: Score a round
  async scoreRound(req: Request, res: Response, next: NextFunction) {
    try {
      const { score, feedback } = z.object({ score: z.number().min(0).max(100), feedback: z.string().optional() }).parse(req.body);
      const result = await publicApplyService.scoreRound(req.params.roundId, score, feedback || '', req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Score submitted' });
    } catch (err) { next(err); }
  }

  // HR: Create interview round
  async createRound(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z.object({
        roundType: z.enum(['HR', 'MANAGER', 'SUPERADMIN']),
        conductedBy: z.string().uuid(),
        scheduledAt: z.string().optional(),
      }).parse(req.body);
      const result = await publicApplyService.createRound(req.params.id, data, req.user!.organizationId);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // HR: Finalize candidate
  async finalizeCandidate(req: Request, res: Response, next: NextFunction) {
    try {
      const { finalStatus } = z.object({ finalStatus: z.enum(['SELECTED', 'REJECTED', 'ON_HOLD']) }).parse(req.body);
      const result = await publicApplyService.finalizeCandidate(req.params.id, finalStatus, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result, message: `Candidate marked as ${finalStatus}` });
    } catch (err) { next(err); }
  }

  // Authenticated: Get interview tasks for current user
  async getInterviewTasks(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await publicApplyService.getInterviewTasks(req.user!.userId, req.user!.role, req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // HR: Get application detail
  async getApplicationDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await publicApplyService.getApplicationDetail(req.params.id, req.user!.organizationId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // HR: List public applications
  async listApplications(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, jobId } = z.object({
        page: z.coerce.number().min(1).default(1),
        limit: z.coerce.number().min(1).max(100).default(20),
        jobId: z.string().optional(),
      }).parse(req.query);
      const result = await publicApplyService.listApplications(req.user!.organizationId, jobId, page, limit);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }
}

export const publicApplyController = new PublicApplyController();
