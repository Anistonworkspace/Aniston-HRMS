import { Request, Response, NextFunction } from 'express';
import { brandingService } from './branding.service.js';
import { updateBrandingSchema } from './branding.validation.js';
import { storageService, StorageFolder } from '../../services/storage.service.js';

export class BrandingController {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const branding = await brandingService.get(req.user!.organizationId);
      res.json({ success: true, data: branding });
    } catch (err) {
      next(err);
    }
  }

  async upsert(req: Request, res: Response, next: NextFunction) {
    try {
      const { companyName, companyAddress } = updateBrandingSchema.parse(req.body);
      const branding = await brandingService.upsert(req.user!.organizationId, {
        companyName,
        companyAddress,
      });
      res.json({ success: true, data: branding, message: 'Branding updated' });
    } catch (err) {
      next(err);
    }
  }

  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Logo file is required' } });
        return;
      }
      const filePath = storageService.buildUrl(StorageFolder.BRANDING, file.filename);
      const branding = await brandingService.uploadAsset(req.user!.organizationId, 'logoUrl', filePath);
      res.json({ success: true, data: branding, message: 'Logo uploaded' });
    } catch (err) {
      next(err);
    }
  }

  async uploadSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Signature file is required' } });
        return;
      }
      const filePath = storageService.buildUrl(StorageFolder.BRANDING, file.filename);
      const branding = await brandingService.uploadAsset(req.user!.organizationId, 'signatureUrl', filePath);
      res.json({ success: true, data: branding, message: 'Signature uploaded' });
    } catch (err) {
      next(err);
    }
  }

  async uploadStamp(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Stamp file is required' } });
        return;
      }
      const filePath = storageService.buildUrl(StorageFolder.BRANDING, file.filename);
      const branding = await brandingService.uploadAsset(req.user!.organizationId, 'stampUrl', filePath);
      res.json({ success: true, data: branding, message: 'Stamp uploaded' });
    } catch (err) {
      next(err);
    }
  }
}

export const brandingController = new BrandingController();
