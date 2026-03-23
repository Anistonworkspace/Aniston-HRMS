import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { walkInService } from './walkIn.service.js';
import { registerWalkInSchema, updateWalkInStatusSchema, walkInQuerySchema } from './walkIn.validation.js';

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
      const candidate = await walkInService.getByToken(req.params.tokenNumber);
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
      const candidate = await walkInService.getById(req.params.id);
      res.json({ success: true, data: candidate });
    } catch (err) { next(err); }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = updateWalkInStatusSchema.parse(req.body);
      const candidate = await walkInService.updateStatus(req.params.id, status);
      res.json({ success: true, data: candidate, message: `Status updated to ${status}` });
    } catch (err) { next(err); }
  }

  async addNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const { notes } = z.object({ notes: z.string().min(1).max(2000) }).parse(req.body);
      const candidate = await walkInService.addHRNotes(req.params.id, notes);
      res.json({ success: true, data: candidate, message: 'Notes added' });
    } catch (err) { next(err); }
  }

  async convertToApplication(req: Request, res: Response, next: NextFunction) {
    try {
      const application = await walkInService.convertToApplication(req.params.id);
      res.json({ success: true, data: application, message: 'Converted to application' });
    } catch (err) { next(err); }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await walkInService.remove(req.params.id);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async uploadFile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
      const folder = req.body.folder || 'temp';
      // Resolve to project root (handles both root and backend/ cwd)
      let base = process.cwd();
      if (base.endsWith('backend') || base.endsWith('backend\\') || base.endsWith('backend/')) {
        base = path.resolve(base, '..');
      }
      const targetDir = path.join(base, 'uploads', 'walkin', folder);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const targetPath = path.join(targetDir, safeFilename);
      fs.renameSync(req.file.path, targetPath);
      const url = `/uploads/walkin/${folder}/${safeFilename}`;
      res.json({ success: true, data: { url, filename: safeFilename } });
    } catch (err) { next(err); }
  }

  async hire(req: Request, res: Response, next: NextFunction) {
    try {
      const { teamsEmail } = z.object({ teamsEmail: z.string().email() }).parse(req.body);
      const result = await walkInService.hireCandidate(req.params.id, teamsEmail, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: result, message: `Employee ${result.employeeCode} created and invite sent` });
    } catch (err) { next(err); }
  }
}

export const walkInController = new WalkInController();
