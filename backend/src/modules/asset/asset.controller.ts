import { Request, Response, NextFunction } from 'express';
import { assetService } from './asset.service.js';
import { createAssetSchema, updateAssetSchema, assignAssetSchema, returnAssetSchema, exitChecklistItemSchema, assetQuerySchema } from './asset.validation.js';

export class AssetController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = assetQuerySchema.parse(req.query);
      const result = await assetService.list(query, req.user!.organizationId);
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const asset = await assetService.getById(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: asset });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createAssetSchema.parse(req.body);
      const asset = await assetService.create(data, req.user!.organizationId, req.user!.userId);
      res.status(201).json({ success: true, data: asset, message: 'Asset created' });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateAssetSchema.parse(req.body);
      const asset = await assetService.update(req.params.id, data, req.user!.organizationId, req.user!.userId);
      res.json({ success: true, data: asset, message: 'Asset updated' });
    } catch (err) { next(err); }
  }

  async assign(req: Request, res: Response, next: NextFunction) {
    try {
      const data = assignAssetSchema.parse({
        ...req.body,
        assetId: req.params.id,
      });
      const assignment = await assetService.assign(data, req.user!.userId, req.user!.organizationId);
      res.status(201).json({ success: true, data: assignment, message: 'Asset assigned' });
    } catch (err) { next(err); }
  }

  async returnAsset(req: Request, res: Response, next: NextFunction) {
    try {
      const returnData = returnAssetSchema.parse(req.body || {});
      const assignment = await assetService.returnAsset(req.params.id, returnData, req.user!.organizationId);
      res.json({ success: true, data: assignment, message: 'Asset returned' });
    } catch (err) { next(err); }
  }

  async getMyAssets(req: Request, res: Response, next: NextFunction) {
    try {
      const assets = await assetService.getMyAssets(req.user!.userId);
      res.json({ success: true, data: assets });
    } catch (err) { next(err); }
  }

  async getAssignments(req: Request, res: Response, next: NextFunction) {
    try {
      const assignments = await assetService.getAssignments(req.params.id, req.user!.organizationId);
      res.json({ success: true, data: assignments });
    } catch (err) { next(err); }
  }

  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await assetService.getStats(req.user!.organizationId);
      res.json({ success: true, data: stats });
    } catch (err) { next(err); }
  }

  async getEmployeeAssets(req: Request, res: Response, next: NextFunction) {
    try {
      const assets = await assetService.getEmployeeAssets(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: assets });
    } catch (err) { next(err); }
  }

  async getExitChecklist(req: Request, res: Response, next: NextFunction) {
    try {
      const checklist = await assetService.getExitChecklist(req.params.employeeId, req.user!.organizationId);
      res.json({ success: true, data: checklist });
    } catch (err) { next(err); }
  }

  async markChecklistItem(req: Request, res: Response, next: NextFunction) {
    try {
      const data = exitChecklistItemSchema.parse(req.body);
      const checklist = await assetService.markChecklistItemReturned(
        req.params.employeeId,
        data,
        req.user!.userId,
        req.user!.organizationId
      );
      res.json({ success: true, data: checklist, message: 'Checklist updated' });
    } catch (err) { next(err); }
  }
}

export const assetController = new AssetController();
