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
      let orgId = (req.body.organizationId as string) || process.env.DEFAULT_ORG_ID || '';
      if (!orgId) {
        const { prisma } = await import('../../lib/prisma.js');
        const firstOrg = await prisma.organization.findFirst();
        orgId = firstOrg?.id || '';
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
      const candidate = await walkInService.getById(req.params.id as string);
      res.json({ success: true, data: candidate });
    } catch (err) { next(err); }
  }

  async updateCandidate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateCandidateSchema.parse(req.body);
      const candidate = await walkInService.updateCandidate(req.params.id as string, data);
      res.json({ success: true, data: candidate, message: 'Candidate details updated' });
    } catch (err) { next(err); }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateWalkInStatusSchema.parse(req.body);
      const candidate = await walkInService.updateStatus(req.params.id as string, status);
      res.json({ success: true, data: candidate, message: `Status updated to ${status}` });
    } catch (err) { next(err); }
  }

  async addNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const { notes } = z.object({ notes: z.string().min(1).max(2000) }).parse(req.body);
      const authorName = req.user?.email?.split('@')[0] || 'HR';
      const candidate = await walkInService.addHRNotes(req.params.id as string, notes, authorName);
      res.json({ success: true, data: candidate, message: 'Notes added' });
    } catch (err) { next(err); }
  }

  // Interview Rounds
  async addInterviewRound(req: Request, res: Response, next: NextFunction) {
    try {
      const data = addInterviewRoundSchema.parse(req.body);
      const round = await walkInService.addInterviewRound(req.params.id as string, data);
      res.status(201).json({ success: true, data: round, message: 'Interview round added' });
    } catch (err) { next(err); }
  }

  async updateInterviewRound(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateInterviewRoundSchema.parse(req.body);
      const round = await walkInService.updateInterviewRound(req.params.roundId as string, data);
      res.json({ success: true, data: round, message: 'Round updated' });
    } catch (err) { next(err); }
  }

  async deleteInterviewRound(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await walkInService.deleteInterviewRound(req.params.roundId as string);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async convertToApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const application = await walkInService.convertToApplication(req.params.id as string);
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
      const round = await walkInService.getMyInterviewDetail(req.user!.userId, req.params.roundId);
      res.json({ success: true, data: round });
    } catch (err) { next(err); }
  }

  async submitMyScore(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateInterviewRoundSchema.parse(req.body);
      const result = await walkInService.submitMyInterviewScore(req.user!.userId, req.params.roundId, data);
      res.json({ success: true, data: result, message: 'Score submitted' });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await walkInService.remove(req.params.id as string);
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
}

export const walkInController = new WalkInController();
