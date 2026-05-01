import { Request, Response, NextFunction } from 'express';
import { internService } from './intern.service.js';
import { createInternProfileSchema, updateInternProfileSchema, createAchievementLetterSchema } from './intern.validation.js';

export class InternController {
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await internService.getProfile(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: profile });
    } catch (err) { next(err); }
  }

  async createProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createInternProfileSchema.parse(req.body);
      const profile = await internService.createProfile(req.params.employeeId, data, req.user!.organizationId);
      res.status(201).json({ success: true, data: profile, message: 'Intern profile created' });
    } catch (err) { next(err); }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateInternProfileSchema.parse(req.body);
      const profile = await internService.updateProfile(req.params.employeeId, data, req.user!.organizationId);
      res.json({ success: true, data: profile, message: 'Intern profile updated' });
    } catch (err) { next(err); }
  }

  async getAchievementLetters(req: Request, res: Response, next: NextFunction) {
    try {
      const letters = await internService.getAchievementLetters(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: letters });
    } catch (err) { next(err); }
  }

  async issueAchievementLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createAchievementLetterSchema.parse(req.body);
      const letter = await internService.issueAchievementLetter(req.params.employeeId, data, req.user!.organizationId);
      res.status(201).json({ success: true, data: letter, message: 'Achievement letter issued' });
    } catch (err) { next(err); }
  }

  async downloadAchievementLetterPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const pdfBuffer = await internService.generateAchievementLetterPdf(req.params.letterId, req.user!.organizationId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=achievement-letter-${req.params.letterId}.pdf`);
      res.send(pdfBuffer);
    } catch (err) { next(err); }
  }
}

export const internController = new InternController();
