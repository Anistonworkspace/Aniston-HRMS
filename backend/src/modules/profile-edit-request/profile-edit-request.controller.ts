import type { Request, Response, NextFunction } from 'express';
import { profileEditRequestService } from './profile-edit-request.service.js';

export class ProfileEditRequestController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId!;
      const organizationId = req.user!.organizationId;
      const { category, requestedData } = req.body;
      const result = await profileEditRequestService.create(employeeId, organizationId, category, requestedData);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async listMine(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId!;
      const data = await profileEditRequestService.listForEmployee(employeeId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async listForOrg(req: Request, res: Response, next: NextFunction) {
    try {
      const { organizationId } = req.user!;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string | undefined;
      const result = await profileEditRequestService.listForOrg(organizationId, page, limit, status);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  }

  async listForEmployee(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await profileEditRequestService.listForEmployee(req.params.employeeId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async review(req: Request, res: Response, next: NextFunction) {
    try {
      const { organizationId, userId } = req.user!;
      const { status, hrNote } = req.body;
      const result = await profileEditRequestService.review(
        req.params.id, organizationId, userId, status, hrNote
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async apply(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.user!.employeeId!;
      const organizationId = req.user!.organizationId;
      const result = await profileEditRequestService.applyApprovedEdit(
        req.params.id, employeeId, organizationId, req.body
      );
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async getProfileCompletion(req: Request, res: Response, next: NextFunction) {
    try {
      const employeeId = req.params.employeeId || req.user!.employeeId!;
      const data = await profileEditRequestService.getProfileCompletion(employeeId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
}

export const profileEditRequestController = new ProfileEditRequestController();
