import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { publicApplyService } from './public-apply.service.js';

export class PublicApplyController {
  // Public: Get job form
  async getJobForm(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await publicApplyService.getJobForm(req.params.token);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // Public: Submit application
  async submitApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const body = z.object({
        candidateName: z.string().min(1),
        email: z.string().email().optional(),
        mobileNumber: z.string().optional(),
        mcqAnswers: z.array(z.object({ questionId: z.string(), selectedOption: z.string() })),
        resumeUrl: z.string().optional(),
      }).parse(req.body);
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
        interviewerId: z.string(),
        scheduledAt: z.string(),
        location: z.string(),
        roundType: z.enum(['HR', 'MANAGER', 'SUPERADMIN']),
      }).parse(req.body);
      const result = await publicApplyService.scheduleInterview(req.params.id, data, req.user!.organizationId);
      res.json({ success: true, data: result, message: 'Interview scheduled' });
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

  // HR: Finalize candidate
  async finalizeCandidate(req: Request, res: Response, next: NextFunction) {
    try {
      const { finalStatus } = z.object({ finalStatus: z.enum(['SELECTED', 'REJECTED', 'ON_HOLD']) }).parse(req.body);
      const result = await publicApplyService.finalizeCandidate(req.params.id, finalStatus, req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result, message: `Candidate marked as ${finalStatus}` });
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
