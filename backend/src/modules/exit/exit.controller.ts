import { Request, Response, NextFunction } from 'express';
import { exitService } from './exit.service.js';
import {
  setLastWorkingDaySchema, addHandoverTaskSchema, updateHandoverTaskSchema,
  confirmAssetReturnSchema, updateITChecklistSchema, saveExitInterviewSchema, saveITNotesSchema,
} from './exit.validation.js';

export class ExitController {
  async setLastWorkingDay(req: Request, res: Response, next: NextFunction) {
    try {
      const data = setLastWorkingDaySchema.parse(req.body);
      const result = await exitService.setLastWorkingDay(
        req.params.employeeId, data, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getHandoverData(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.getHandoverData(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async addHandoverTask(req: Request, res: Response, next: NextFunction) {
    try {
      const data = addHandoverTaskSchema.parse(req.body);
      const result = await exitService.addHandoverTask(
        req.params.employeeId, data, req.user!.userId, req.user!.organizationId,
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async updateHandoverTask(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateHandoverTaskSchema.parse(req.body);
      const result = await exitService.updateHandoverTask(
        req.params.taskId, data, req.user!.userId, req.user!.organizationId,
        req.user!.role, req.user!.employeeId ?? null,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async deleteHandoverTask(req: Request, res: Response, next: NextFunction) {
    try {
      await exitService.deleteHandoverTask(req.params.taskId, req.user!.organizationId);
      res.json({ success: true, data: null });
    } catch (err) { next(err); }
  }

  async getFnFDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.getFnFDetails(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async generateExperienceLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.generateExperienceLetter(
        req.params.employeeId, req.user!.userId, req.user!.organizationId,
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Employee self-service ──────────────────────────────────────────────────

  async getMyExitStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.getMyExitStatus(req.user!.userId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async confirmAssetReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const data = confirmAssetReturnSchema.parse(req.body);
      const result = await exitService.confirmAssetReturn(
        req.params.itemId, req.user!.userId, req.user!.organizationId, data,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async undoAssetReturnConfirmation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.undoAssetReturnConfirmation(
        req.params.itemId, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── IT Offboarding Checklist ───────────────────────────────────────────────

  async getITChecklist(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.getITChecklist(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async updateITChecklist(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateITChecklistSchema.parse(req.body);
      const result = await exitService.updateITChecklist(
        req.params.employeeId, data, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async saveITNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const data = saveITNotesSchema.parse(req.body);
      const result = await exitService.saveITNotes(req.params.employeeId, data, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  // ── Exit Interview ─────────────────────────────────────────────────────────

  async getExitInterview(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await exitService.getExitInterview(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async saveExitInterview(req: Request, res: Response, next: NextFunction) {
    try {
      const data = saveExitInterviewSchema.parse(req.body);
      const result = await exitService.saveExitInterview(
        req.params.employeeId, data, req.user!.userId, req.user!.organizationId,
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
}

export const exitController = new ExitController();
